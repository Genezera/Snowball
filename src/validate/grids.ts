/**
 * Grades de busca por estrategia.
 *
 * Mantidas deliberadamente pequenas. Cada combinacao extra e uma tentativa a
 * mais de achar um bom resultado por sorte, e o Sharpe deflacionado cobra por
 * isso. Grade de 5000 combos nao produz estrategia melhor, produz overfit mais
 * convincente.
 *
 * Os valores do video estao sempre DENTRO da grade, para que o walk-forward
 * possa escolher os originais se eles forem realmente os melhores.
 */
import type { ParamGrid } from './walkforward.ts';

export const GRIDS: Record<string, ParamGrid> = {
  // filtro de volatilidade sobre o RANGE do candle
  'momentum-breakout': {
    fast: [10, 20],
    slow: [50, 100],
    lookback: [20, 50],
    stopPct: [0.01, 0.015, 0.02],
    takePct: [0.02, 0.03, 0.04],
  },
  'ma-cross': {
    fast: [20, 50],
    slow: [100, 200],
    stopPct: [0.01, 0.015, 0.02],
    takePct: [0.02, 0.03, 0.04],
    useCross: [false, true],
  },
  'zscore-dip': {
    emaLen: [10, 20],
    smaLen: [50, 100],
    lookback: [20, 50],
    zEntry: [-1.5, -2, -2.5],
    stopPct: [0.017, 0.025],
    takePct: [0.03, 0.04],
  },
  'body-breakout': {
    bodyLen: [10, 20],
    minBody: [0.4, 0.5, 0.6],
    trendLen: [100, 200],
    lookback: [20, 50],
    stopPct: [0.015, 0.02],
    takePct: [0.03, 0.04],
  },
  // Portada do trader.dev. Grade centrada nos valores originais do autor.
  'trend-rider': {
    factor: [2.0, 3.0, 4.0],
    adxThresh: [15, 20, 25],
    emaFast: [50, 100],
    emaSlow: [200],
    slAtr: [1.5, 2.0, 3.0],
    tpAtr: [3.0, 4.0, 6.0],
  },
  'vwma-dip': {
    bodyLen: [10, 20],
    minBody: [0.4, 0.5, 0.6],
    trendLen: [100, 200],
    zEntry: [-1.5, -2, -2.5],
    stopPct: [0.01, 0.015],
    takePct: [0.02, 0.03],
  },
};
