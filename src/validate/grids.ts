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
  // Time-series momentum (Moskowitz/Ooi/Pedersen). Lookback em barras — a 4h,
  // 60 barras ~10 dias, 180 ~30 dias. Stop/alvo largos: são rede de segurança,
  // a saída de verdade é por tempo (maxBarsInTrade no config do backtest).
  'ts-momentum': {
    lookback: [30, 60, 120],
    minRet: [0.03, 0.05, 0.08],
    stopPct: [0.10, 0.15],
    // takePct largo (2-5) supera 0,30-0,50 de forma robusta: a distribuição
    // real de R mostrava os vencedores TRAVADOS bem no take fixo antigo
    // (p95=p99≈3,3R, a assinatura de um teto artificial). Um alvo largo não
    // sofre do problema que trailing stop tem aqui (fechar cedo demais numa
    // correção) — é só um gatilho simples, mais distante. Confirmado robusto
    // em 4 de 5 anos individuais do universo. Ver docs/RESULTADOS.md item 10.
    takePct: [0.40, 2.0, 5.0],
  },
  'xs-momentum': {
    formacao: [90, 180],
    manutencao: [21, 42],
    minRet: [0.05, 0.10, 0.15],
    stopPct: [0.10, 0.15],
    takePct: [0.25, 0.40],
  },
};
