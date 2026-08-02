/**
 * Deteccao de regime de mercado.
 *
 * Este arquivo existe por uma razao especifica: as 5 estrategias do projeto nao
 * sao todas do mesmo tipo. `momentum-breakout` e `body-breakout` sao
 * seguidoras de tendencia -- elas precisam que o mercado ANDE. `zscore-dip` e
 * `vwma-dip` sao reversao a media -- elas precisam que o mercado VOLTE. Rodar
 * as duas familias o tempo todo significa que metade delas esta sempre operando
 * no ambiente errado, pagando taxa para descobrir isso.
 *
 * A pergunta que o regime responde nao e "o preco vai subir?". E "o mercado
 * agora premia continuacao ou premia reversao?". Essa pergunta e muito mais
 * facil e muito mais estavel que prever direcao.
 *
 * Nenhuma feature aqui olha para o futuro. Todas leem apenas bars[0..i].
 */
import type { Bar } from '../core/types.ts';
import { atr, closes, ema, rollingStd, sma } from '../core/indicators.ts';

/**
 * Efficiency Ratio de Kaufman. E a feature mais importante deste arquivo.
 *
 * Numerador: o quanto o preco andou em linha reta em n barras.
 * Denominador: o quanto ele andou no total, somando cada passo.
 *
 * Perto de 1 = movimento direcional limpo (tendencia). Perto de 0 = muito
 * movimento sem sair do lugar (serrote). E exatamente a distincao entre o
 * ambiente que paga breakout e o que paga reversao a media.
 */
export function efficiencyRatio(bars: Bar[], n: number): number[] {
  const c = closes(bars);
  const out = new Array<number>(bars.length).fill(NaN);
  let churn = 0;
  for (let i = 1; i < c.length; i++) {
    churn += Math.abs(c[i] - c[i - 1]);
    if (i > n) churn -= Math.abs(c[i - n] - c[i - n - 1]);
    if (i >= n) {
      const net = Math.abs(c[i] - c[i - n]);
      out[i] = churn > 0 ? net / churn : 0;
    }
  }
  return out;
}

/**
 * Autocorrelacao de lag 1 dos retornos, em janela movel.
 *
 * Positiva = retornos se encadeiam, momentum funciona.
 * Negativa = retornos se revertem, reversao a media funciona.
 * E a medida direta de qual familia de estrategia o mercado esta premiando.
 */
export function returnAutocorr(bars: Bar[], n: number): number[] {
  const c = closes(bars);
  const r = new Array<number>(c.length).fill(0);
  for (let i = 1; i < c.length; i++) r[i] = c[i - 1] > 0 ? c[i] / c[i - 1] - 1 : 0;

  const out = new Array<number>(bars.length).fill(NaN);
  for (let i = n + 1; i < c.length; i++) {
    let sx = 0, sy = 0, sxy = 0, sxx = 0, syy = 0;
    for (let j = i - n + 1; j <= i; j++) {
      const x = r[j - 1], y = r[j];
      sx += x; sy += y; sxy += x * y; sxx += x * x; syy += y * y;
    }
    const num = n * sxy - sx * sy;
    const den = Math.sqrt((n * sxx - sx * sx) * (n * syy - sy * sy));
    out[i] = den > 0 ? num / den : 0;
  }
  return out;
}

/** Assimetria realizada dos retornos. Mercado com cauda esquerda gorda quebra stops. */
export function realizedSkew(bars: Bar[], n: number): number[] {
  const c = closes(bars);
  const r = c.map((v, i) => (i > 0 && c[i - 1] > 0 ? v / c[i - 1] - 1 : 0));
  const out = new Array<number>(bars.length).fill(NaN);
  for (let i = n; i < r.length; i++) {
    const w = r.slice(i - n + 1, i + 1);
    const m = w.reduce((a, b) => a + b, 0) / n;
    const sd = Math.sqrt(w.reduce((a, b) => a + (b - m) ** 2, 0) / n);
    out[i] = sd > 0 ? w.reduce((a, b) => a + ((b - m) / sd) ** 3, 0) / n : 0;
  }
  return out;
}

export const REGIME_FEATURES = [
  'er20',        // efficiency ratio curto: tendencia vs serrote agora
  'er100',       // efficiency ratio longo: o regime de fundo
  'erSlope',     // er20 - er100: a tendencia esta se firmando ou se dissolvendo
  'atrPct',      // nivel absoluto de volatilidade
  'volRatio',    // ATR curto / ATR longo: volatilidade expandindo ou contraindo
  'autocorr',    // momentum vs reversao, medido diretamente
  'trendZ',      // (close - SMA100) / ATR: quao esticado o preco esta
  'skew',        // assimetria: risco de cauda
  'volumeRatio', // volume atual vs media
  'rangePct',    // range do candio atual sobre o preco
  'hourSin',
  'hourCos',
  'dow',
] as const;

export interface RegimeContext {
  names: string[];
  /** matriz [barra][feature] */
  rows: number[][];
}

/** Pre-calcula todas as features de regime para a serie inteira, uma vez. */
export function buildRegimeContext(bars: Bar[]): RegimeContext {
  const c = closes(bars);
  const er20 = efficiencyRatio(bars, 20);
  const er100 = efficiencyRatio(bars, 100);
  const a14 = atr(bars, 14);
  const a50 = atr(bars, 50);
  const ac = returnAutocorr(bars, 50);
  const sk = realizedSkew(bars, 50);
  const trend = sma(c, 100);
  const volAvg = sma(bars.map((b) => b.v), 20);

  const rows: number[][] = new Array(bars.length);
  for (let i = 0; i < bars.length; i++) {
    const b = bars[i];
    const px = b.c || 1;
    const atrPct = isFinite(a14[i]) ? a14[i] / px : 0;
    const d = new Date(b.t);
    const hour = d.getUTCHours();
    const num = (v: number) => (isFinite(v) ? v : 0);

    rows[i] = [
      num(er20[i]),
      num(er100[i]),
      num(er20[i]) - num(er100[i]),
      atrPct,
      isFinite(a50[i]) && a50[i] > 0 ? num(a14[i]) / a50[i] : 1,
      num(ac[i]),
      isFinite(trend[i]) && isFinite(a14[i]) && a14[i] > 0 ? (b.c - trend[i]) / a14[i] : 0,
      num(sk[i]),
      isFinite(volAvg[i]) && volAvg[i] > 0 ? b.v / volAvg[i] : 1,
      (b.h - b.l) / px,
      Math.sin((2 * Math.PI * hour) / 24),
      Math.cos((2 * Math.PI * hour) / 24),
      d.getUTCDay(),
    ];
  }
  return { names: [...REGIME_FEATURES], rows };
}

/**
 * Rotulagem grosseira do regime, para leitura humana e para os relatorios.
 * O modelo NAO usa este rotulo -- ele usa as features continuas. Isto existe
 * para que um humano consiga olhar e entender o que o modelo esta vendo.
 */
export function labelRegime(ctx: RegimeContext, i: number): string {
  const r = ctx.rows[i];
  if (!r) return 'indefinido';
  const er = r[0];
  const volExp = r[4] > 1.1;
  if (er > 0.35) return volExp ? 'tendencia-forte' : 'tendencia-calma';
  if (er < 0.15) return volExp ? 'lateral-volatil' : 'lateral-calmo';
  return volExp ? 'misto-volatil' : 'misto-calmo';
}
