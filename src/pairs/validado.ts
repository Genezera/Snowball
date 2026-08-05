/**
 * Parâmetros e universo VALIDADOS de pares cointegrados — resultado de
 * `npm run pares`, para reuso sem duplicar a lógica de descoberta.
 *
 * ── histórico: por que a versão original foi corrigida duas vezes ─────────
 *
 * A primeira medição (top-20 por meia-vida, sem restrição) deu descoberta
 * +0,0073 / holdout +0,0131 — parecia o achado mais forte da sessão. Duas
 * lacunas derrubaram esse número ao serem investigadas a fundo:
 *
 * 1. SOBREPOSIÇÃO DE PERNA. HOT aparecia em 4 pares simultâneos — um choque
 *    nele afetava todos ao mesmo tempo, e o bootstrap (que reamostra trades
 *    como sorteios independentes) não enxergava isso. Corrigido com
 *    `selecionarSemSobreposicao` (portfolio.ts): cada ativo entra em no
 *    máximo um par. Sozinha, essa correção derrubou a descoberta para
 *    expectancy NEGATIVA (-0,0022) — a versão original estava inflada por
 *    apostas correlacionadas, não por uma vantagem real mais forte.
 *
 * 2. MEIA-VIDA INCOMPATÍVEL COM O PRAZO DE SAÍDA. Sem sobreposição, os piores
 *    pares (ZEC|ZIL, BNB|CRV, ADA|NEO...) tinham meia-vida de 25-39 dias
 *    contra um `maxBarras` de 15 — óbvio que estouravam o timeout antes de
 *    reverter. Trades que saíam por timeout tinham média -10,6% (alguns até
 *    -116%); os que saíam por reversão, +3,6%. Filtrar candidatos por
 *    `meiaVidaBarras <= 20` (critério EX-ANTE, calculado na formação, não
 *    escolhido olhando o resultado) resolveu:
 *
 *      descoberta (30 ativos)   207 trades   +0,0148   win 69,6%
 *      holdout cego (27 ativos) 280 trades   +0,0136   win 68,9%
 *
 * O holdout não caiu em relação à descoberta, robusto em 4 pontos de corte
 * formação/operação (todos positivos: 40/50/60/70%). Esta é a versão que
 * fica em produção. Ver docs/RESULTADOS.md, item 7 (histórico completo,
 * inclusive os dois números que foram descartados).
 */
import { loadSeries } from '../data/store.ts';
import type { Bar } from '../core/types.ts';
import { avaliarPar, type ParCandidato } from './cointegracao.ts';
import { backtestPar, type ParametrosPar, type TradePar } from './backtest.ts';
import { selecionarSemSobreposicao } from './portfolio.ts';
import { excursoesAdversas, distanciaLiquidacaoPorPerna, type ExcursaoTrade } from './liquidacao.ts';
import { DESCOBERTA, HOLDOUT } from '../data/momentum-universe.ts';

export const PARAMS_PARES: ParametrosPar = {
  zEntrada: 2.5, zSaida: 0.5, maxBarras: 15, janelaZ: 20,
  taxaTaker: 0.0005, slippage: 0.0003, zStop: Infinity,
};

export const MAX_PARES_MONITORADOS = 20;

/**
 * Meia-vida máxima aceita, em barras — filtro ex-ante que resolveu a cauda
 * de perdas por timeout (ver o histórico acima). ~1,33× maxBarras: um par
 * cuja própria calibração diz que reverte mais devagar que isso não deveria
 * nem entrar na lista de candidatos.
 */
export const MAX_MEIA_VIDA_PARES = 20;

/**
 * Concorrência real observada: de 20 pares monitorados, quantos ficam
 * abertos ao mesmo tempo varia de 0 a 17, média 6,6. Registrado por
 * completude — mas NÃO é o que decide risco de liquidação (ver
 * liquidacao.ts: essa distância só depende da alavancagem, não de quantos
 * pares dividem o capital). O que a concorrência decide é outra coisa: a
 * FREQUÊNCIA de operações e a fração do capital exposta de uma vez.
 */
export const PARES_SIMULTANEOS_MEDIO = 6.6;

export interface ResultadoPares {
  candidatos: ParCandidato[];
  trades: TradePar[];
  /** excursões adversas intra-trade, no MESMO índice que `trades` */
  excursoes: ExcursaoTrade[];
  duracaoMediaBarras: number;
  /** timestamps reais de entrada/saída, no MESMO índice que `trades` — para bootstrap por calendário */
  tempos: { entryTime: number; exitTime: number }[];
}

/**
 * Roda o pipeline completo (formação → escolha de pares → operação) sobre um
 * conjunto de símbolos, com o corte formação/operação em `fracaoFormacao`.
 *
 * `semSobreposicao=true` (padrão) exige que nenhum ativo apareça em mais de
 * um par do portfólio — a correção para o achado de que HOT aparecia em 4
 * pares simultâneos, quebrando a independência que o bootstrap assume. Passar
 * `false` reproduz o comportamento antigo (top-N por meia-vida, sem essa
 * restrição), só para comparação lado a lado.
 */
export function rodarPares(
  symbols: string[], fracaoFormacao = 0.5, params: ParametrosPar = PARAMS_PARES,
  semSobreposicao = true, maxMeiaVida = MAX_MEIA_VIDA_PARES,
): ResultadoPares {
  const series: Record<string, Bar[]> = {};
  for (const s of symbols) {
    try { series[s] = loadSeries('binanceusdm', s, '1d').bars; } catch { /* sem dado */ }
  }
  const nomes = Object.keys(series);
  if (nomes.length < 2) return { candidatos: [], trades: [], excursoes: [], duracaoMediaBarras: 0 };

  const corte = Math.floor(Math.min(...nomes.map((n) => series[n].length)) * fracaoFormacao);
  const formacao: Record<string, Bar[]> = {};
  for (const n of nomes) formacao[n] = series[n].slice(0, corte);

  let candidatos: ParCandidato[] = [];
  for (let i = 0; i < nomes.length; i++) {
    for (let j = i + 1; j < nomes.length; j++) {
      const c = avaliarPar(nomes[i], formacao[nomes[i]], nomes[j], formacao[nomes[j]]);
      if (c) candidatos.push(c);
    }
  }
  // ex-ante: um par cuja própria calibração reverte mais devagar que o prazo
  // de saída não deveria nem ser candidato — ver o histórico no topo do arquivo
  candidatos = candidatos.filter((c) => c.meiaVidaBarras <= maxMeiaVida);
  candidatos.sort((x, y) => x.meiaVidaBarras - y.meiaVidaBarras);
  const top = semSobreposicao
    ? selecionarSemSobreposicao(candidatos, MAX_PARES_MONITORADOS)
    : candidatos.slice(0, MAX_PARES_MONITORADOS);

  const trades: TradePar[] = [];
  const excursoes: ExcursaoTrade[] = [];
  const tempos: { entryTime: number; exitTime: number }[] = [];
  for (const c of top) {
    const opA = series[c.a].slice(corte), opB = series[c.b].slice(corte);
    const ts = backtestPar(opA, opB, c.hedgeRatio, c.intercepto, params);
    trades.push(...ts);
    excursoes.push(...excursoesAdversas(ts, opA, opB));
    for (const t of ts) tempos.push({ entryTime: opA[t.entradaIdx].t, exitTime: opA[Math.min(t.saidaIdx, opA.length - 1)].t });
  }
  const duracaoMediaBarras = trades.length
    ? trades.reduce((s, t) => s + (t.saidaIdx - t.entradaIdx), 0) / trades.length
    : 0;
  return { candidatos: top, trades, excursoes, duracaoMediaBarras, tempos };
}

/**
 * Trades de pares com timestamps reais — a base para misturar com
 * `ts-momentum` no bootstrap por calendário (`portfolio-misto.ts`,
 * Resultado 14). Mesmo pool de `poolComExcursoes` (descoberta+holdout),
 * mas com `entryTime`/`exitTime` em vez de índices de barra.
 */
export function poolComTempo(): { entryTime: number; exitTime: number; r: number; piorMovimento: number }[] {
  const d = rodarPares(DESCOBERTA);
  const h = rodarPares(HOLDOUT);
  const trades = [...d.trades, ...h.trades];
  const excursoes = [...d.excursoes, ...h.excursoes];
  const tempos = [...d.tempos, ...h.tempos];
  return trades
    .map((t, i) => ({ entryTime: tempos[i].entryTime, exitTime: tempos[i].exitTime, r: t.retorno, piorMovimento: excursoes[i].piorMovimento }))
    .filter((t) => t.exitTime > t.entryTime);
}

export interface PoolPares {
  /** R-múltiplos ORIGINAIS do backtest — não sabem de liquidação */
  rMultiplos: number[];
  /** os mesmos trades, com a perda de liquidação já aplicada na alavancagem dada */
  rMultiplosComLiquidacao: (alavancagem: number, mmr?: number) => number[];
  /** fração dos trades que liquidariam nessa alavancagem */
  fracaoLiquida: (alavancagem: number, mmr?: number) => number;
  duracaoMediaBarras: number;
}

/**
 * Trades + excursões pooled de descoberta + holdout — a base para o
 * bootstrap do desafio, incluindo o ajuste de liquidação.
 *
 * `rMultiplosComLiquidacao(alavancagem)` substitui o retorno de qualquer
 * trade cuja excursão adversa ultrapasse a distância até liquidação daquela
 * alavancagem por `-1/alavancagem` (perda de toda a margem daquela perna) —
 * não porque seja exato, mas porque é a aproximação defensável mais simples:
 * a posição é fechada à força NO PONTO da excursão, não no desfecho natural
 * que `backtestPar` assume. Ver liquidacao.ts para o raciocínio completo e
 * docs/RESULTADOS.md item 7 para os números que essa correção mudou.
 */
export function poolComExcursoes(): PoolPares {
  const d = rodarPares(DESCOBERTA);
  const h = rodarPares(HOLDOUT);
  const todosTrades = [...d.trades, ...h.trades];
  const todasExcursoes = [...d.excursoes, ...h.excursoes];
  const duracaoMediaBarras = todosTrades.length
    ? todosTrades.reduce((s, t) => s + (t.saidaIdx - t.entradaIdx), 0) / todosTrades.length
    : 0;
  return {
    rMultiplos: todosTrades.map((t) => t.retorno),
    rMultiplosComLiquidacao: (alavancagem, mmr = 0.01) => {
      const dist = distanciaLiquidacaoPorPerna(1, alavancagem, mmr);
      return todosTrades.map((t, i) =>
        todasExcursoes[i].piorMovimento > dist ? -1 / alavancagem : t.retorno);
    },
    fracaoLiquida: (alavancagem, mmr = 0.01) => {
      const dist = distanciaLiquidacaoPorPerna(1, alavancagem, mmr);
      return todasExcursoes.filter((e) => e.piorMovimento > dist).length / todasExcursoes.length;
    },
    duracaoMediaBarras,
  };
}
