/**
 * Modelo de ML para previsão de volatilidade.
 *
 * Por que ESTA aplicação de ML e não outra: o projeto já tentou prever direção
 * duas vezes e falhou duas vezes (meta-labeling com AUC 0,54 que removia
 * trades lucrativos; alocador adaptativo que perdeu em 5 de 5 ativos). Prever
 * volatilidade funcionou de primeira, com um EWMA simples: Calmar de 0,33 para
 * 0,57.
 *
 * A hipótese aqui é modesta e testável: um GBDT com mais features consegue
 * prever volatilidade melhor que o EWMA de parâmetro único? E, se conseguir,
 * essa melhora se traduz em resultado de trading — ou fica só no papel?
 *
 * As duas perguntas são diferentes. Um modelo pode ter erro de previsão menor
 * e não melhorar nada, se a melhora estiver em regiões que não afetam o
 * dimensionamento.
 */
import type { Bar } from '../core/types.ts';
import { atr, closes, rsi, sma } from '../core/indicators.ts';
import { GBDT } from './gbdt.ts';

export const VOL_FEATURES = [
  'rv5', 'rv20', 'rv60',      // volatilidade realizada em três horizontes
  'rvRatio',                  // curta/longa: expandindo ou contraindo
  'atrPct',
  'rangePct',                 // range do candle atual sobre o preço
  'absRet1',                  // |retorno| da última barra
  'absRet5',
  'volumeRatio',
  'rsi14',
  'hourSin', 'hourCos', 'dow',
] as const;

/** Volatilidade realizada nas últimas n barras (desvio dos retornos). */
function realizedVol(c: number[], i: number, n: number): number {
  if (i < n) return NaN;
  let s = 0, s2 = 0;
  for (let k = i - n + 1; k <= i; k++) {
    const r = c[k - 1] > 0 ? c[k] / c[k - 1] - 1 : 0;
    s += r; s2 += r * r;
  }
  const m = s / n;
  return Math.sqrt(Math.max(0, s2 / n - m * m));
}

export interface VolDataset {
  X: number[][];
  y: number[];
  index: number[];
  featureNames: string[];
}

/**
 * Monta o dataset. O alvo é a volatilidade realizada nas PRÓXIMAS `horizon`
 * barras — em log, porque volatilidade é positiva e assimétrica, e prever em
 * log evita que os picos dominem o ajuste.
 *
 * As features na barra i usam apenas dados até i. O alvo usa i+1..i+horizon.
 * O deslocamento é o que impede vazamento.
 */
export function buildVolDataset(bars: Bar[], horizon = 12): VolDataset {
  const c = closes(bars);
  const a = atr(bars, 14);
  const r14 = rsi(c, 14);
  const volAvg = sma(bars.map((b) => b.v), 20);

  const X: number[][] = [];
  const y: number[] = [];
  const index: number[] = [];

  for (let i = 61; i < bars.length - horizon; i++) {
    const rv5 = realizedVol(c, i, 5);
    const rv20 = realizedVol(c, i, 20);
    const rv60 = realizedVol(c, i, 60);
    if (!isFinite(rv5) || !isFinite(rv60) || rv60 <= 0) continue;

    const b = bars[i];
    const px = b.c || 1;
    const d = new Date(b.t);
    const hour = d.getUTCHours();
    const ret1 = c[i - 1] > 0 ? Math.abs(c[i] / c[i - 1] - 1) : 0;
    const ret5 = c[i - 5] > 0 ? Math.abs(c[i] / c[i - 5] - 1) : 0;

    // alvo: volatilidade realizada no futuro imediato
    const fut = realizedVol(c, i + horizon, horizon);
    if (!isFinite(fut) || fut <= 0) continue;

    X.push([
      rv5, rv20, rv60,
      rv20 > 0 ? rv5 / rv20 : 1,
      isFinite(a[i]) ? a[i] / px : 0,
      (b.h - b.l) / px,
      ret1, ret5,
      isFinite(volAvg[i]) && volAvg[i] > 0 ? b.v / volAvg[i] : 1,
      isFinite(r14[i]) ? r14[i] : 50,
      Math.sin((2 * Math.PI * hour) / 24), Math.cos((2 * Math.PI * hour) / 24),
      d.getUTCDay(),
    ]);
    y.push(Math.log(fut));
    index.push(i);
  }

  return { X, y, index, featureNames: [...VOL_FEATURES] };
}

export interface VolModelEval {
  /** erro quadrático médio em log-vol, fora da amostra */
  mseModel: number;
  mseEwma: number;
  mseBaseline: number;
  /** correlação entre previsto e realizado */
  corrModel: number;
  corrEwma: number;
  /** redução de erro do modelo sobre o EWMA, em % */
  ganhoSobreEwma: number;
  nTest: number;
  importancia: { name: string; count: number }[];
}

function corr(a: number[], b: number[]): number {
  const n = a.length;
  const ma = a.reduce((x, y) => x + y, 0) / n;
  const mb = b.reduce((x, y) => x + y, 0) / n;
  let num = 0, da = 0, db = 0;
  for (let i = 0; i < n; i++) { num += (a[i] - ma) * (b[i] - mb); da += (a[i] - ma) ** 2; db += (b[i] - mb) ** 2; }
  return da > 0 && db > 0 ? num / Math.sqrt(da * db) : 0;
}

/**
 * Treina e avalia FORA DA AMOSTRA, com corte temporal.
 * Compara contra dois baselines honestos:
 *   EWMA      — o que já está em produção
 *   constante — a média histórica, para saber se qualquer um dos dois ajuda
 */
export function evaluateVolModel(
  bars: Bar[],
  horizon = 12,
  trainFraction = 0.7,
): VolModelEval {
  const ds = buildVolDataset(bars, horizon);
  const cut = Math.floor(ds.X.length * trainFraction);

  const model = new GBDT({
    objective: 'squared', nTrees: 200, maxDepth: 4,
    learningRate: 0.05, minSamplesLeaf: 40, lambda: 3, subsample: 0.8, colsample: 0.8,
  }).fit(ds.X.slice(0, cut), ds.y.slice(0, cut), ds.featureNames);

  const Xte = ds.X.slice(cut);
  const yte = ds.y.slice(cut);
  const pred = model.predictRaw(Xte);

  // EWMA como comparação: feature rv20 já é essencialmente isso, mas o EWMA
  // de produção usa lambda 0,94; aqui usamos rv20 em log como proxy direto.
  const ewma = Xte.map((row) => Math.log(Math.max(1e-9, row[1])));
  const media = yte.reduce((x, y) => x + y, 0) / yte.length;

  const mse = (p: number[]) => p.reduce((acc, v, i) => acc + (v - yte[i]) ** 2, 0) / p.length;
  const mseModel = mse(pred);
  const mseEwma = mse(ewma);
  const mseBaseline = mse(new Array(yte.length).fill(media));

  return {
    mseModel, mseEwma, mseBaseline,
    corrModel: corr(pred, yte), corrEwma: corr(ewma, yte),
    ganhoSobreEwma: ((mseEwma - mseModel) / mseEwma) * 100,
    nTest: yte.length,
    importancia: model.featureImportance().slice(0, 6),
  };
}

/** Previsão de volatilidade para toda a série, treinando só no passado. */
export function mlVolForecast(bars: Bar[], horizon = 12, trainFraction = 0.5): number[] {
  const ds = buildVolDataset(bars, horizon);
  const cut = Math.floor(ds.X.length * trainFraction);
  const model = new GBDT({
    objective: 'squared', nTrees: 200, maxDepth: 4,
    learningRate: 0.05, minSamplesLeaf: 40, lambda: 3, subsample: 0.8, colsample: 0.8,
  }).fit(ds.X.slice(0, cut), ds.y.slice(0, cut), ds.featureNames);

  const out = new Array<number>(bars.length).fill(NaN);
  for (let k = cut; k < ds.X.length; k++) {
    out[ds.index[k]] = Math.exp(model.predictRaw([ds.X[k]])[0]);
  }
  return out;
}
