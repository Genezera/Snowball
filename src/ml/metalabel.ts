/**
 * Meta-labeling (Lopez de Prado).
 *
 * A ideia: nao tente prever o mercado com ML. Deixe a estrategia primaria
 * decidir DIRECAO e use o ML apenas para decidir SE VALE A PENA TOMAR o trade.
 * Isso transforma um problema de regressao impossivel num problema de
 * classificacao binaria com rotulo objetivo: este trade especifico deu lucro?
 *
 * Por que isso pode salvar uma estrategia com expectancy negativa: se 30% dos
 * sinais concentram todo o prejuizo, filtrar esses 30% economiza a taxa E o
 * prejuizo. Se o modelo NAO consegue separar, a estrategia nao tem estrutura
 * aproveitavel e nenhuma quantidade de ML muda isso. As duas respostas sao
 * uteis; a segunda economiza dinheiro.
 *
 * Validacao: purged walk-forward. Trades se sobrepoem no tempo (um trade dura
 * varias barras), entao um split ingenuo vaza futuro para o treino. Purge
 * remove do treino tudo que se sobrepoe ao teste; embargo remove uma margem
 * extra depois do teste.
 */
import type { Trade } from '../core/types.ts';
import { GBDT, auc, type GBDTParams } from './gbdt.ts';

export interface Dataset {
  X: number[][];
  y: number[];
  featureNames: string[];
  trades: Trade[];
}

export function buildDataset(trades: Trade[]): Dataset {
  const withFeat = trades.filter((t) => t.features && Object.keys(t.features).length);
  if (!withFeat.length) throw new Error('nenhum trade tem features gravadas');
  const featureNames = Object.keys(withFeat[0].features!).sort();
  // O lado do trade entra como feature: o modelo pode aprender que os shorts
  // desta estrategia sao lixo e os longs prestam.
  featureNames.push('isLong');
  const X = withFeat.map((t) => {
    const f = t.features!;
    const row = featureNames.slice(0, -1).map((k) => {
      const v = f[k];
      return isFinite(v) ? v : 0;
    });
    row.push(t.side === 'long' ? 1 : 0);
    return row;
  });
  const y = withFeat.map((t) => (t.pnl > 0 ? 1 : 0));
  return { X, y, featureNames, trades: withFeat };
}

export interface PurgedFoldResult {
  fold: number;
  trainSize: number;
  testSize: number;
  auc: number;
  /** trades de teste com a probabilidade prevista */
  scored: { trade: Trade; p: number }[];
}

/**
 * Purged walk-forward CV. Anda para frente no tempo; nunca treina em dados
 * posteriores ao teste.
 */
export function purgedWalkForwardCV(
  ds: Dataset,
  opts: { folds?: number; embargoPct?: number; params?: Partial<GBDTParams> } = {},
): { folds: PurgedFoldResult[]; allScored: { trade: Trade; p: number }[]; meanAuc: number } {
  const nFolds = opts.folds ?? 5;
  const embargoPct = opts.embargoPct ?? 0.01;
  const n = ds.trades.length;
  const foldSize = Math.floor(n / (nFolds + 1));
  if (foldSize < 40) throw new Error(`poucos trades (${n}) para ${nFolds} folds de ML`);

  const embargo = Math.max(1, Math.floor(n * embargoPct));
  const folds: PurgedFoldResult[] = [];
  const allScored: { trade: Trade; p: number }[] = [];

  for (let k = 1; k <= nFolds; k++) {
    const testStart = k * foldSize;
    const testEnd = k === nFolds ? n : testStart + foldSize;
    const testTrades = ds.trades.slice(testStart, testEnd);
    if (!testTrades.length) continue;
    const testStartTime = testTrades[0].entryTime;

    // Purge: descarta do treino qualquer trade cuja SAIDA invade o periodo de
    // teste. Sem isso o rotulo do treino ja conhece o que acontece no teste.
    const trainIdx: number[] = [];
    for (let i = 0; i < testStart - embargo; i++) {
      if (ds.trades[i].exitTime < testStartTime) trainIdx.push(i);
    }
    if (trainIdx.length < 100) continue;

    const Xtr = trainIdx.map((i) => ds.X[i]);
    const ytr = trainIdx.map((i) => ds.y[i]);
    // Se o treino tem uma unica classe nao ha o que aprender.
    const posRate = ytr.reduce((a, b) => a + b, 0) / ytr.length;
    if (posRate < 0.02 || posRate > 0.98) continue;

    const model = new GBDT(opts.params).fit(Xtr, ytr, ds.featureNames);
    const Xte = ds.X.slice(testStart, testEnd);
    const yte = ds.y.slice(testStart, testEnd);
    const ps = model.predictAll(Xte);

    const scored = testTrades.map((t, i) => ({ trade: t, p: ps[i] }));
    allScored.push(...scored);
    folds.push({ fold: k, trainSize: trainIdx.length, testSize: testTrades.length, auc: auc(yte, ps), scored });
  }

  const meanAuc = folds.length ? folds.reduce((a, b) => a + b.auc, 0) / folds.length : 0.5;
  return { folds, allScored, meanAuc };
}

export interface ThresholdRow {
  threshold: number;
  trades: number;
  kept: number;
  winRate: number;
  expectancyR: number;
  sumR: number;
  profitFactor: number;
}

/**
 * Varre limiares de probabilidade e mede o que sobra. O limiar util e aquele
 * que melhora a expectancy SEM reduzir o numero de trades a um punhado, porque
 * 12 trades bons podem ser sorte.
 */
export function thresholdSweep(scored: { trade: Trade; p: number }[]): ThresholdRow[] {
  const rows: ThresholdRow[] = [];
  for (let thr = 0.3; thr <= 0.75; thr += 0.025) {
    const kept = scored.filter((s) => s.p >= thr);
    if (!kept.length) continue;
    const rs = kept.map((s) => s.trade.rEquity);
    const wins = rs.filter((r) => r > 0);
    const losses = rs.filter((r) => r <= 0);
    const gw = wins.reduce((a, b) => a + b, 0);
    const gl = Math.abs(losses.reduce((a, b) => a + b, 0));
    const avgWin = wins.length ? gw / wins.length : 0;
    const avgLoss = losses.length ? gl / losses.length : 0;
    const wr = wins.length / kept.length;
    rows.push({
      threshold: Number(thr.toFixed(3)),
      trades: scored.length,
      kept: kept.length,
      winRate: wr,
      expectancyR: avgLoss > 0 ? (wr * avgWin - (1 - wr) * avgLoss) / avgLoss : 0,
      sumR: rs.reduce((a, b) => a + b, 0),
      profitFactor: gl > 0 ? gw / gl : gw > 0 ? Infinity : 0,
    });
  }
  return rows;
}

/**
 * Escolhe o limiar de producao. Exige um minimo de trades retidos para nao
 * escolher um limiar que sobreviveu por ter 8 amostras.
 */
export function pickThreshold(rows: ThresholdRow[], minKeepFraction = 0.2): ThresholdRow | null {
  const viable = rows.filter((r) => r.kept >= Math.max(50, r.trades * minKeepFraction));
  if (!viable.length) return null;
  return viable.reduce((a, b) => (b.expectancyR > a.expectancyR ? b : a));
}

/** Treina o modelo final em TODO o historico, para uso em producao. */
export function trainFinal(ds: Dataset, params?: Partial<GBDTParams>): GBDT {
  return new GBDT(params).fit(ds.X, ds.y, ds.featureNames);
}
