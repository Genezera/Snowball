/**
 * Walk-forward. A unica forma barata de descobrir que uma estrategia so
 * funcionava porque voce escolheu os parametros olhando o resultado.
 *
 * Mecanica: fatia o historico em blocos. Em cada bloco, otimiza os parametros
 * usando SOMENTE a janela in-sample anterior, e depois opera o bloco seguinte
 * com esses parametros congelados. Concatena todos os trades out-of-sample.
 * O resultado OOS e a unica estimativa nao-enviesada que existe aqui.
 *
 * Se o desempenho IS e otimo e o OOS e ruim, a estrategia nao tem edge: voce
 * ajustou ruido. Essa razao (a "eficiencia walk-forward") e o numero que
 * decide se o robo recebe dinheiro ou vai para o lixo.
 */
import type { BacktestConfig, Series, Trade } from '../core/types.ts';
import { runBacktest } from '../backtest/engine.ts';
import { computeMetrics, type Metrics } from '../backtest/metrics.ts';
import { buildStrategy, type StratParams } from '../strategies/index.ts';

export interface ParamGrid {
  [key: string]: (number | boolean)[];
}

export function expandGrid(grid: ParamGrid): StratParams[] {
  const keys = Object.keys(grid);
  if (!keys.length) return [{}];
  let out: StratParams[] = [{}];
  for (const k of keys) {
    const next: StratParams[] = [];
    for (const base of out) for (const v of grid[k]) next.push({ ...base, [k]: v });
    out = next;
  }
  return out;
}

/**
 * Criterio de selecao no in-sample. NAO usa retorno total de proposito:
 * retorno total premia a combinacao que pegou um rally, nao a que tem edge.
 * Usa expectancy penalizada por drawdown e exige um numero minimo de trades.
 */
export function objective(m: Metrics, minTrades: number): number {
  if (m.trades < minTrades) return -Infinity;
  if (!isFinite(m.sharpe)) return -Infinity;
  const ddPenalty = 1 + Math.max(0, m.maxDrawdown) * 3;
  return (m.expectancyR * Math.sqrt(m.trades)) / ddPenalty;
}

export interface WalkForwardFold {
  index: number;
  isFrom: string;
  isTo: string;
  oosFrom: string;
  oosTo: string;
  bestParams: StratParams;
  isMetrics: Metrics;
  oosMetrics: Metrics;
}

export interface WalkForwardResult {
  folds: WalkForwardFold[];
  /** Metricas do backtest OOS concatenado, com equity composto entre folds. */
  combined: Metrics;
  combinedTrades: Trade[];
  /** OOS / IS. Abaixo de ~0.5 a estrategia esta sobreajustada. */
  efficiency: number;
  totalCombosTested: number;
}

export function walkForward(opts: {
  series: Series;
  strategyName: string;
  grid: ParamGrid;
  cfg: BacktestConfig;
  folds?: number;
  /** fracao de cada bloco usada como in-sample; o resto e out-of-sample */
  isFraction?: number;
  minTrades?: number;
  onFold?: (f: WalkForwardFold) => void;
}): WalkForwardResult {
  const { series, strategyName, grid, cfg } = opts;
  const nFolds = opts.folds ?? 6;
  const isFraction = opts.isFraction ?? 0.7;
  const minTrades = opts.minTrades ?? 30;
  const combos = expandGrid(grid);

  const bars = series.bars;
  const blockSize = Math.floor(bars.length / nFolds);
  const folds: WalkForwardFold[] = [];
  const combinedTrades: Trade[] = [];

  // O equity e composto de um fold para o outro: e assim que a bola de neve
  // realmente se comportaria, e e assim que um drawdown no fold 2 encolhe o
  // tamanho das posicoes no fold 3.
  let equity = cfg.initialEquity;

  for (let f = 0; f < nFolds; f++) {
    const start = f * blockSize;
    const end = f === nFolds - 1 ? bars.length : (f + 1) * blockSize;
    const split = start + Math.floor((end - start) * isFraction);
    if (split - start < 500 || end - split < 200) continue;

    const isSeries: Series = { ...series, bars: bars.slice(start, split) };
    // O OOS recebe barras de aquecimento antes do seu inicio para que os
    // indicadores ja estejam validos na primeira barra negociavel. Elas nao
    // geram trades porque o motor respeita `warmup`.
    const warmPad = 300;
    const oosSeries: Series = { ...series, bars: bars.slice(Math.max(0, split - warmPad), end) };

    let best: { params: StratParams; score: number; m: Metrics } | null = null;
    for (const params of combos) {
      const strat = buildStrategy(strategyName, params);
      const res = runBacktest(isSeries, strat, { ...cfg, initialEquity: cfg.initialEquity });
      const m = computeMetrics(res, cfg.initialEquity);
      const score = objective(m, minTrades);
      if (!best || score > best.score) best = { params, score, m };
    }
    if (!best || best.score === -Infinity) continue;

    const oosRes = runBacktest(oosSeries, buildStrategy(strategyName, best.params), {
      ...cfg,
      initialEquity: equity,
    });
    const oosM = computeMetrics(oosRes, equity);
    equity = oosRes.finalEquity;
    combinedTrades.push(...oosRes.trades);

    const fold: WalkForwardFold = {
      index: f,
      isFrom: new Date(bars[start].t).toISOString().slice(0, 10),
      isTo: new Date(bars[split - 1].t).toISOString().slice(0, 10),
      oosFrom: new Date(bars[split].t).toISOString().slice(0, 10),
      oosTo: new Date(bars[end - 1].t).toISOString().slice(0, 10),
      bestParams: best.params,
      isMetrics: best.m,
      oosMetrics: oosM,
    };
    folds.push(fold);
    opts.onFold?.(fold);

    if (oosRes.haltedAt) break; // conta desligada pelo circuit breaker: acabou
  }

  const equityCurve = combinedTrades.map((t) => ({ t: t.exitTime, equity: t.equityAfter }));
  if (equityCurve.length) equityCurve.unshift({ t: combinedTrades[0].entryTime, equity: cfg.initialEquity });
  const combined = computeMetrics(
    { trades: combinedTrades, equityCurve, finalEquity: equity },
    cfg.initialEquity,
  );

  const isAvg = folds.length ? folds.reduce((a, b) => a + b.isMetrics.expectancyR, 0) / folds.length : 0;
  const oosAvg = folds.length ? folds.reduce((a, b) => a + b.oosMetrics.expectancyR, 0) / folds.length : 0;
  const efficiency = isAvg !== 0 ? oosAvg / isAvg : 0;

  return { folds, combined, combinedTrades, efficiency, totalCombosTested: combos.length * folds.length };
}
