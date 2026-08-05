/**
 * Parâmetros e universo VALIDADOS de pares cointegrados — resultado de
 * `npm run pares`, para reuso sem duplicar a lógica de descoberta.
 *
 * Descoberta (30 ativos): 664 trades, expectancy +0,0073, win rate 66,9%.
 * Holdout cego (27 ativos, mesmos parâmetros, sem reajuste): 678 trades,
 * expectancy +0,0131 (MAIOR que a descoberta), win rate 70,6%.
 *
 * Robustez ao ponto de corte formação/operação (40/50/60/70%): positivo nos
 * quatro, crescente com mais dado de formação — não é artefato de um split.
 * Concentração: 20 pares ativos, os 3 mais negociados são 17,4% do total —
 * não é um único par carregando o resultado.
 *
 * É o achado mais robusto desta sessão. Ver docs/RESULTADOS.md, item 7.
 */
import { loadSeries } from '../data/store.ts';
import type { Bar } from '../core/types.ts';
import { avaliarPar, type ParCandidato } from './cointegracao.ts';
import { backtestPar, type ParametrosPar, type TradePar } from './backtest.ts';
import { DESCOBERTA, HOLDOUT } from '../data/momentum-universe.ts';

export const PARAMS_PARES: ParametrosPar = {
  zEntrada: 2.5, zSaida: 0.5, maxBarras: 15, janelaZ: 20,
  taxaTaker: 0.0005, slippage: 0.0003,
};

export const MAX_PARES_MONITORADOS = 20;

/**
 * Concorrência real observada: de 20 pares monitorados, quantos ficam
 * abertos ao mesmo tempo varia de 0 a 17, média 6,6. Isso NÃO é constante —
 * é a distribuição real. Usar a média como "N pares simultâneos" no
 * dimensionamento de capital é a aproximação mais defensável sem modelar a
 * alocação dinâmica por completo.
 */
export const PARES_SIMULTANEOS_MEDIO = 6.6;

export interface ResultadoPares {
  candidatos: ParCandidato[];
  trades: TradePar[];
  duracaoMediaBarras: number;
}

/**
 * Roda o pipeline completo (formação → escolha de pares → operação) sobre um
 * conjunto de símbolos, com o corte formação/operação em `fracaoFormacao`.
 */
export function rodarPares(
  symbols: string[], fracaoFormacao = 0.5, params: ParametrosPar = PARAMS_PARES,
): ResultadoPares {
  const series: Record<string, Bar[]> = {};
  for (const s of symbols) {
    try { series[s] = loadSeries('binanceusdm', s, '1d').bars; } catch { /* sem dado */ }
  }
  const nomes = Object.keys(series);
  if (nomes.length < 2) return { candidatos: [], trades: [], duracaoMediaBarras: 0 };

  const corte = Math.floor(Math.min(...nomes.map((n) => series[n].length)) * fracaoFormacao);
  const formacao: Record<string, Bar[]> = {};
  for (const n of nomes) formacao[n] = series[n].slice(0, corte);

  const candidatos: ParCandidato[] = [];
  for (let i = 0; i < nomes.length; i++) {
    for (let j = i + 1; j < nomes.length; j++) {
      const c = avaliarPar(nomes[i], formacao[nomes[i]], nomes[j], formacao[nomes[j]]);
      if (c) candidatos.push(c);
    }
  }
  candidatos.sort((x, y) => x.meiaVidaBarras - y.meiaVidaBarras);
  const top = candidatos.slice(0, MAX_PARES_MONITORADOS);

  const trades: TradePar[] = [];
  for (const c of top) {
    const opA = series[c.a].slice(corte), opB = series[c.b].slice(corte);
    trades.push(...backtestPar(opA, opB, c.hedgeRatio, c.intercepto, params));
  }
  const duracaoMediaBarras = trades.length
    ? trades.reduce((s, t) => s + (t.saidaIdx - t.entradaIdx), 0) / trades.length
    : 0;
  return { candidatos: top, trades, duracaoMediaBarras };
}

/** Trades pooled de descoberta + holdout, para o bootstrap do desafio. */
export function poolCompletoDePares(): { rMultiplos: number[]; duracaoMediaBarras: number } {
  const d = rodarPares(DESCOBERTA);
  const h = rodarPares(HOLDOUT);
  const todos = [...d.trades, ...h.trades];
  const rMultiplos = todos.map((t) => t.retorno);
  const duracaoMediaBarras = todos.length
    ? todos.reduce((s, t) => s + (t.saidaIdx - t.entradaIdx), 0) / todos.length
    : 0;
  return { rMultiplos, duracaoMediaBarras };
}
