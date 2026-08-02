/**
 * Indicadores. Todos retornam arrays alinhados ao input, com NaN nas posicoes
 * onde ainda nao ha dados suficientes. Nenhum deles olha para o futuro.
 */
import type { Bar } from './types.ts';


export function sma(x: number[], n: number): number[] {
  const out = new Array<number>(x.length).fill(NaN);
  let sum = 0;
  for (let i = 0; i < x.length; i++) {
    sum += x[i];
    if (i >= n) sum -= x[i - n];
    if (i >= n - 1) out[i] = sum / n;
  }
  return out;
}

export function ema(x: number[], n: number): number[] {
  const out = new Array<number>(x.length).fill(NaN);
  const k = 2 / (n + 1);
  let prev = NaN;
  let sum = 0;
  for (let i = 0; i < x.length; i++) {
    if (i < n - 1) {
      sum += x[i];
      continue;
    }
    if (i === n - 1) {
      sum += x[i];
      prev = sum / n;
      out[i] = prev;
      continue;
    }
    prev = x[i] * k + prev * (1 - k);
    out[i] = prev;
  }
  return out;
}

/** Desvio padrao movel populacional. */
export function rollingStd(x: number[], n: number): number[] {
  const out = new Array<number>(x.length).fill(NaN);
  let sum = 0;
  let sumSq = 0;
  for (let i = 0; i < x.length; i++) {
    sum += x[i];
    sumSq += x[i] * x[i];
    if (i >= n) {
      sum -= x[i - n];
      sumSq -= x[i - n] * x[i - n];
    }
    if (i >= n - 1) {
      const mean = sum / n;
      const varr = Math.max(0, sumSq / n - mean * mean);
      out[i] = Math.sqrt(varr);
    }
  }
  return out;
}

/** Z-score de x contra sua propria media/desvio de janela n. */
export function zscore(x: number[], n: number): number[] {
  const m = sma(x, n);
  const s = rollingStd(x, n);
  return x.map((v, i) => (s[i] > 0 ? (v - m[i]) / s[i] : NaN));
}

/** True Range e ATR de Wilder. */
export function atr(bars: Bar[], n: number): number[] {
  const tr = new Array<number>(bars.length).fill(NaN);
  for (let i = 0; i < bars.length; i++) {
    if (i === 0) {
      tr[i] = bars[i].h - bars[i].l;
      continue;
    }
    const pc = bars[i - 1].c;
    tr[i] = Math.max(bars[i].h - bars[i].l, Math.abs(bars[i].h - pc), Math.abs(bars[i].l - pc));
  }
  const out = new Array<number>(bars.length).fill(NaN);
  let prev = NaN;
  let sum = 0;
  for (let i = 0; i < bars.length; i++) {
    if (i < n) {
      sum += tr[i];
      if (i === n - 1) {
        prev = sum / n;
        out[i] = prev;
      }
      continue;
    }
    prev = (prev * (n - 1) + tr[i]) / n;
    out[i] = prev;
  }
  return out;
}

/** Volume Weighted Moving Average. */
export function vwma(bars: Bar[], n: number): number[] {
  const out = new Array<number>(bars.length).fill(NaN);
  let pv = 0;
  let vv = 0;
  for (let i = 0; i < bars.length; i++) {
    pv += bars[i].c * bars[i].v;
    vv += bars[i].v;
    if (i >= n) {
      pv -= bars[i - n].c * bars[i - n].v;
      vv -= bars[i - n].v;
    }
    if (i >= n - 1 && vv > 0) out[i] = pv / vv;
  }
  return out;
}

/**
 * Fracao do corpo do candle sobre o range total. Perto de 1 = candle sem pavio
 * (movimento decidido); perto de 0 = indecisao. E o "body fraction" do video.
 */
export function bodyFraction(bars: Bar[]): number[] {
  return bars.map((b) => {
    const range = b.h - b.l;
    return range > 0 ? Math.abs(b.c - b.o) / range : 0;
  });
}

export function rsi(x: number[], n: number): number[] {
  const out = new Array<number>(x.length).fill(NaN);
  let avgGain = 0;
  let avgLoss = 0;
  for (let i = 1; i < x.length; i++) {
    const d = x[i] - x[i - 1];
    const g = Math.max(0, d);
    const l = Math.max(0, -d);
    if (i <= n) {
      avgGain += g / n;
      avgLoss += l / n;
      if (i === n) out[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
      continue;
    }
    avgGain = (avgGain * (n - 1) + g) / n;
    avgLoss = (avgLoss * (n - 1) + l) / n;
    out[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  }
  return out;
}

/** Maior alta / menor baixa das ultimas n barras, EXCLUINDO a barra atual. */
export function priorExtremes(bars: Bar[], n: number): { hh: number[]; ll: number[] } {
  const hh = new Array<number>(bars.length).fill(NaN);
  const ll = new Array<number>(bars.length).fill(NaN);
  for (let i = n; i < bars.length; i++) {
    let mx = -Infinity;
    let mn = Infinity;
    for (let j = i - n; j < i; j++) {
      if (bars[j].h > mx) mx = bars[j].h;
      if (bars[j].l < mn) mn = bars[j].l;
    }
    hh[i] = mx;
    ll[i] = mn;
  }
  return { hh, ll };
}

/** Fecho maximo/minimo das ultimas n barras anteriores a atual. */
export function priorCloseExtremes(bars: Bar[], n: number): { hc: number[]; lc: number[] } {
  const hc = new Array<number>(bars.length).fill(NaN);
  const lc = new Array<number>(bars.length).fill(NaN);
  for (let i = n; i < bars.length; i++) {
    let mx = -Infinity;
    let mn = Infinity;
    for (let j = i - n; j < i; j++) {
      if (bars[j].c > mx) mx = bars[j].c;
      if (bars[j].c < mn) mn = bars[j].c;
    }
    hc[i] = mx;
    lc[i] = mn;
  }
  return { hc, lc };
}

export const closes = (bars: Bar[]) => bars.map((b) => b.c);

/** Range bruto do candle (high - low). Base do filtro de expansao de volatilidade. */
export const ranges = (bars: Bar[]) => bars.map((b) => b.h - b.l);

/** Suavizacao de Wilder (ta.rma no Pine). Usada por ADX e DMI. */
export function rma(x: number[], n: number): number[] {
  const out = new Array<number>(x.length).fill(NaN);
  let prev = NaN;
  let sum = 0;
  for (let i = 0; i < x.length; i++) {
    const v = isFinite(x[i]) ? x[i] : 0;
    if (i < n - 1) { sum += v; continue; }
    if (i === n - 1) { sum += v; prev = sum / n; out[i] = prev; continue; }
    prev = (prev * (n - 1) + v) / n;
    out[i] = prev;
  }
  return out;
}

/**
 * SuperTrend, replicando `ta.supertrend` do Pine.
 *
 * Retorna a linha e a direcao, onde direcao -1 = alta e +1 = baixa (a mesma
 * convencao invertida do Pine, mantida de proposito para que a comparacao com
 * a estrategia original seja literal).
 *
 * O detalhe que quebra implementacoes ingenuas: as bandas sao "pegajosas" --
 * so se movem contra a posicao quando o preco de fato as rompe. Sem isso o
 * indicador oscila e a estrategia vira ruido.
 */
export function supertrend(bars: Bar[], factor: number, atrPeriod: number): { line: number[]; dir: number[] } {
  const a = atr(bars, atrPeriod);
  const n = bars.length;
  const line = new Array<number>(n).fill(NaN);
  const dir = new Array<number>(n).fill(NaN);

  let prevUpper = NaN, prevLower = NaN, prevST = NaN, prevDir = 1;

  for (let i = 0; i < n; i++) {
    if (!isFinite(a[i])) continue;
    const hl2 = (bars[i].h + bars[i].l) / 2;
    let upper = hl2 + factor * a[i];
    let lower = hl2 - factor * a[i];
    const prevClose = i > 0 ? bars[i - 1].c : bars[i].c;

    if (isFinite(prevLower)) lower = lower > prevLower || prevClose < prevLower ? lower : prevLower;
    if (isFinite(prevUpper)) upper = upper < prevUpper || prevClose > prevUpper ? upper : prevUpper;

    let d: number;
    if (!isFinite(prevST)) d = 1;
    else if (prevST === prevUpper) d = bars[i].c > upper ? -1 : 1;
    else d = bars[i].c < lower ? 1 : -1;

    const st = d === -1 ? lower : upper;
    line[i] = st;
    dir[i] = d;

    prevUpper = upper; prevLower = lower; prevST = st; prevDir = d;
  }
  return { line, dir };
}

/**
 * DMI e ADX, replicando `ta.dmi` do Pine.
 * ADX mede FORCA de tendencia sem dizer a direcao -- e o filtro que separa
 * "mercado andando" de "mercado serrando".
 */
export function dmi(bars: Bar[], diLen: number, adxLen: number): { plus: number[]; minus: number[]; adx: number[] } {
  const n = bars.length;
  const tr = new Array<number>(n).fill(0);
  const plusDM = new Array<number>(n).fill(0);
  const minusDM = new Array<number>(n).fill(0);

  for (let i = 1; i < n; i++) {
    const up = bars[i].h - bars[i - 1].h;
    const down = bars[i - 1].l - bars[i].l;
    plusDM[i] = up > down && up > 0 ? up : 0;
    minusDM[i] = down > up && down > 0 ? down : 0;
    const pc = bars[i - 1].c;
    tr[i] = Math.max(bars[i].h - bars[i].l, Math.abs(bars[i].h - pc), Math.abs(bars[i].l - pc));
  }

  const trur = rma(tr, diLen);
  const sp = rma(plusDM, diLen);
  const sm = rma(minusDM, diLen);

  const plus = new Array<number>(n).fill(NaN);
  const minus = new Array<number>(n).fill(NaN);
  const dx = new Array<number>(n).fill(NaN);
  for (let i = 0; i < n; i++) {
    if (!isFinite(trur[i]) || trur[i] === 0) continue;
    plus[i] = (100 * sp[i]) / trur[i];
    minus[i] = (100 * sm[i]) / trur[i];
    const sum = plus[i] + minus[i];
    dx[i] = sum > 0 ? (100 * Math.abs(plus[i] - minus[i])) / sum : 0;
  }
  return { plus, minus, adx: rma(dx, adxLen) };
}
