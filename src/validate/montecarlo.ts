/**
 * Monte Carlo sobre a sequencia de trades.
 *
 * A curva de equity de um backtest e UM caminho entre milhoes possiveis. A
 * mesma estrategia, com os mesmos trades em ordem diferente, poderia ter tido
 * um drawdown duas vezes maior e quebrado a conta. O que interessa nao e o
 * caminho que aconteceu, e a distribuicao dos caminhos que poderiam acontecer.
 *
 * Duas simulacoes distintas:
 *  - shuffle: embaralha a ordem dos trades observados (preserva a distribuicao,
 *    destroi a sequencia). Responde "e se a sorte tivesse vindo em outra ordem?"
 *  - bootstrap: reamostra com reposicao. Responde "e nos proximos N trades?"
 */
import type { Trade } from '../core/types.ts';

export interface MonteCarloResult {
  sims: number;
  horizon: number;
  /** probabilidade de terminar abaixo do capital inicial */
  pLoss: number;
  /** probabilidade de perder metade do capital em algum momento */
  pRuin50: number;
  /** probabilidade de bater o circuit breaker de drawdown configurado */
  pHitDdStop: number;
  medianReturn: number;
  p5Return: number;
  p95Return: number;
  medianMaxDd: number;
  p95MaxDd: number;
  worstMaxDd: number;
}

function mkRng(seed: number) {
  let s = seed >>> 0;
  return () => {
    // xorshift32: deterministico e rapido
    s ^= s << 13;
    s >>>= 0;
    s ^= s >> 17;
    s ^= s << 5;
    s >>>= 0;
    return s / 4294967296;
  };
}

function quantile(sorted: number[], q: number): number {
  if (!sorted.length) return 0;
  const i = (sorted.length - 1) * q;
  const lo = Math.floor(i);
  const hi = Math.ceil(i);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (i - lo);
}

export function monteCarlo(
  trades: Trade[],
  opts: { sims?: number; horizon?: number; mode?: 'shuffle' | 'bootstrap'; ddStop?: number; seed?: number } = {},
): MonteCarloResult {
  const sims = opts.sims ?? 5000;
  const mode = opts.mode ?? 'bootstrap';
  const horizon = opts.horizon ?? trades.length;
  const ddStop = opts.ddStop ?? 0.2;
  const rnd = mkRng(opts.seed ?? 987654321);
  const rs = trades.map((t) => t.rEquity);

  if (!rs.length) {
    return { sims: 0, horizon: 0, pLoss: 1, pRuin50: 1, pHitDdStop: 1, medianReturn: 0, p5Return: 0, p95Return: 0, medianMaxDd: 0, p95MaxDd: 0, worstMaxDd: 0 };
  }

  const finals: number[] = [];
  const dds: number[] = [];
  let losses = 0;
  let ruins = 0;
  let ddHits = 0;

  for (let s = 0; s < sims; s++) {
    let order: number[];
    if (mode === 'shuffle') {
      order = rs.map((_, i) => i);
      for (let i = order.length - 1; i > 0; i--) {
        const j = Math.floor(rnd() * (i + 1));
        [order[i], order[j]] = [order[j], order[i]];
      }
      order = order.slice(0, horizon);
    } else {
      order = Array.from({ length: horizon }, () => Math.floor(rnd() * rs.length));
    }

    let eq = 1;
    let peak = 1;
    let maxDd = 0;
    let ruined = false;
    let hitDd = false;
    for (const idx of order) {
      eq *= 1 + rs[idx];
      if (eq > peak) peak = eq;
      const dd = (peak - eq) / peak;
      if (dd > maxDd) maxDd = dd;
      if (dd >= ddStop) hitDd = true;
      if (eq <= 0.5) {
        ruined = true;
        break;
      }
    }
    finals.push(eq - 1);
    dds.push(maxDd);
    if (eq < 1) losses++;
    if (ruined) ruins++;
    if (hitDd) ddHits++;
  }

  finals.sort((a, b) => a - b);
  dds.sort((a, b) => a - b);

  return {
    sims,
    horizon,
    pLoss: losses / sims,
    pRuin50: ruins / sims,
    pHitDdStop: ddHits / sims,
    medianReturn: quantile(finals, 0.5),
    p5Return: quantile(finals, 0.05),
    p95Return: quantile(finals, 0.95),
    medianMaxDd: quantile(dds, 0.5),
    p95MaxDd: quantile(dds, 0.95),
    worstMaxDd: dds[dds.length - 1],
  };
}

export function formatMonteCarlo(mc: MonteCarloResult): string {
  const p = (x: number) => `${(x * 100).toFixed(1)}%`;
  return [
    `Monte Carlo (${mc.sims} simulacoes, horizonte ${mc.horizon} trades)`,
    `  Prob. de terminar no prejuizo     ${p(mc.pLoss)}`,
    `  Prob. de perder 50% da conta      ${p(mc.pRuin50)}`,
    `  Prob. de bater o stop de drawdown ${p(mc.pHitDdStop)}`,
    `  Retorno mediano                   ${p(mc.medianReturn)}`,
    `  Retorno pessimista (p5)           ${p(mc.p5Return)}`,
    `  Retorno otimista (p95)            ${p(mc.p95Return)}`,
    `  Drawdown mediano                  ${p(mc.medianMaxDd)}`,
    `  Drawdown p95                      ${p(mc.p95MaxDd)}`,
    `  Pior drawdown simulado            ${p(mc.worstMaxDd)}`,
  ].join('\n');
}
