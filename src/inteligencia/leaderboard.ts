/**
 * LEADERBOARD — compara cada challenger contra o champion, sempre na mesma
 * janela de tempo, sempre com a métrica principal sendo PnL ajustado.
 *
 * v2 desta sessão — CORREÇÃO DE DUPLA CONTAGEM (Parte 4):
 *
 * A v1 penalizava `notionalAberto × ESCORREGAMENTO_PERNA` no ajuste de
 * realismo — a MESMA constante que `virtual-portfolio.ts` já soma dentro de
 * `custos.slippageEntradaModelado`/`slippageSaidaModelado` a cada trade. O
 * slippage "modelado" estava sendo descontado duas vezes: uma no PnL
 * realizado (correto), outra no "ajuste de realismo" (errado — não é uma
 * penalidade NOVA, é a mesma de novo).
 *
 * A correção: `pnlPaperBase` é só a soma dos componentes JÁ rastreados na
 * origem (reconciliação exata, testada). O "ajuste de realismo" agora só
 * aplica penalidades que NADA no PnL base já cobre: execução parcial, atraso
 * entre pernas, exchange indisponível, e slippage ACIMA do já modelado (só
 * no cenário stress, nunca no base).
 */
import fs from 'node:fs';
import path from 'node:path';
import type { EstadoVirtual, CustosDecompostos, ConfigChallenger } from './virtual-portfolio.ts';
import { avaliarEliminacao, nivelEvidencia, type NivelEvidencia } from './virtual-portfolio.ts';

// ── Parte 4: reconciliação exata ────────────────────────────────────────────

export interface ReconciliacaoPnl {
  fundingBruto: number;
  taxasEntrada: number;
  taxasSaida: number;
  slippageEntradaModelado: number;
  slippageSaidaModelado: number;
  custoEscalonamento: number;
  custoApara: number;
  custoReinvestimento: number;
  custoEmergencial: number;
  pnlPaperBase: number;
}

export function reconciliar(e: EstadoVirtual): ReconciliacaoPnl {
  const c = e.custos;
  const pnlPaperBase = e.fundingBruto
    - c.taxasEntrada - c.taxasSaida
    - c.slippageEntradaModelado - c.slippageSaidaModelado
    - c.custoEscalonamento - c.custoApara - c.custoReinvestimento - c.custoEmergencial;
  return {
    fundingBruto: e.fundingBruto,
    taxasEntrada: c.taxasEntrada, taxasSaida: c.taxasSaida,
    slippageEntradaModelado: c.slippageEntradaModelado, slippageSaidaModelado: c.slippageSaidaModelado,
    custoEscalonamento: c.custoEscalonamento, custoApara: c.custoApara,
    custoReinvestimento: c.custoReinvestimento, custoEmergencial: c.custoEmergencial,
    pnlPaperBase,
  };
}

// ── Parte 5: quatro cenários, penalidades DISTINTAS, nunca somadas numa "caixa preta" ──

export interface PenalidadesNaoModeladas {
  penalidadeExecucaoParcial: number;
  penalidadeAtrasoEntrePernas: number;
  penalidadeExchangeIndisponivel: number;
  penalidadeSlippageStress: number;
}

export interface CenarioRealismo {
  nome: 'ideal' | 'base' | 'conservador' | 'stress';
  /** probabilidade de uma perna preencher só parcialmente, por trade */
  probExecucaoParcial: number;
  /** custo de uma execução parcial, em fração do notional daquela perna */
  custoExecucaoParcial: number;
  /** custo esperado de deriva de preço no atraso entre as duas pernas, fração do notional */
  custoAtrasoEntrePernas: number;
  /** probabilidade de uma exchange ficar indisponível durante a vida da posição */
  probExchangeIndisponivel: number;
  /** custo de fechamento de emergência quando isso acontece, fração do notional */
  custoExchangeIndisponivel: number;
  /** slippage ADICIONAL além do já modelado em custos.slippage*Modelado — 0 no base */
  slippageStressExtra: number;
}

export const CENARIOS: Record<CenarioRealismo['nome'], CenarioRealismo> = {
  ideal: {
    nome: 'ideal', probExecucaoParcial: 0, custoExecucaoParcial: 0,
    custoAtrasoEntrePernas: 0, probExchangeIndisponivel: 0, custoExchangeIndisponivel: 0,
    slippageStressExtra: 0,
  },
  base: {
    // taxas e slippage já estão no pnlPaperBase (medidos, não hipotéticos) —
    // "base realista" soma só um atraso pequeno entre pernas, que o
    // simulador não representa (abertura tratada como atômica)
    nome: 'base', probExecucaoParcial: 0, custoExecucaoParcial: 0,
    custoAtrasoEntrePernas: 0.0003, probExchangeIndisponivel: 0, custoExchangeIndisponivel: 0,
    slippageStressExtra: 0,
  },
  conservador: {
    nome: 'conservador', probExecucaoParcial: 0.05, custoExecucaoParcial: 0.15,
    custoAtrasoEntrePernas: 0.0008, probExchangeIndisponivel: 0.01, custoExchangeIndisponivel: 0.3,
    slippageStressExtra: 0,
  },
  stress: {
    // aqui sim entra slippage ACIMA do modelado — 2x o que já está em
    // custos.slippage*Modelado, mas como incremento explícito, não repetindo
    // o valor já contado
    nome: 'stress', probExecucaoParcial: 0.18, custoExecucaoParcial: 0.3,
    custoAtrasoEntrePernas: 0.0020, probExchangeIndisponivel: 0.05, custoExchangeIndisponivel: 0.5,
    slippageStressExtra: 1.0, // 100% a mais que o já modelado, i.e. 2x no total
  },
};

export function calcularPenalidades(e: EstadoVirtual, cenario: CenarioRealismo): PenalidadesNaoModeladas {
  // usa o notional das posições ABERTAS agora — este Lab não guarda notional
  // por trade individual já fechado, então a penalidade de execução/atraso
  // se aplica ao que está exposto no momento, não ao histórico completo
  const notionalAtual = e.posicoesVirtuais.reduce((s, p) => s + p.notionalPorPerna, 0);
  return {
    penalidadeExecucaoParcial: e.trades * cenario.probExecucaoParcial * (notionalAtual / Math.max(1, e.posicoesVirtuais.length || 1)) * cenario.custoExecucaoParcial,
    penalidadeAtrasoEntrePernas: notionalAtual * cenario.custoAtrasoEntrePernas,
    penalidadeExchangeIndisponivel: e.trades * cenario.probExchangeIndisponivel * (notionalAtual / Math.max(1, e.posicoesVirtuais.length || 1)) * cenario.custoExchangeIndisponivel,
    penalidadeSlippageStress: (e.custos.slippageEntradaModelado + e.custos.slippageSaidaModelado) * cenario.slippageStressExtra,
  };
}

export function pnlAjustadoNoCenario(e: EstadoVirtual, nomeCenario: CenarioRealismo['nome']): { pnlPaperBase: number; penalidades: PenalidadesNaoModeladas; pnlPaperAjustado: number } {
  const { pnlPaperBase } = reconciliar(e);
  const penalidades = calcularPenalidades(e, CENARIOS[nomeCenario]);
  const totalPenalidades = penalidades.penalidadeExecucaoParcial + penalidades.penalidadeAtrasoEntrePernas + penalidades.penalidadeExchangeIndisponivel + penalidades.penalidadeSlippageStress;
  return { pnlPaperBase, penalidades, pnlPaperAjustado: pnlPaperBase - totalPenalidades };
}

// ── leaderboard ──────────────────────────────────────────────────────────────

export interface LinhaLeaderboard {
  challengerId: string;
  /** puramente informativo — nunca influencia ranking nem decisão (Parte 1 desta etapa) */
  familia?: 'exploitation' | 'exploration' | 'control' | 'capture' | 'allocation' | 'batch' | 'risk';
  hipotese?: string;
  experimentoStatus?: 'planejado' | 'rodando' | 'pausado' | 'concluido' | 'eliminado' | 'inconclusivo';
  configDesde?: number;
  pausado: boolean;
  motivoPausa?: string;
  /** true quando alavancagem > 5x (a do champion) — NUNCA recomendar promoção automática nesse caso, mesmo com PnL bom (Parte 8) */
  altoRiscoAlavancagem: boolean;
  pnlPaperBruto: number; // = pnlRealizado, igual ao pnlPaperBase por reconciliação exata
  pnlPaperBase: number;
  pnlPaperAjustado: number; // cenário 'base', a métrica default do ranking
  diferencaDeRealismo: number;
  cenarios: Record<CenarioRealismo['nome'], number>; // pnlPaperAjustado em cada um dos 4
  equity: number;
  retornoPct: number;
  drawdownMaxPct: number;
  trades: number;
  settlements: number;
  custosTotais: number;
  feeToGross: number;
  retornoPorMargem: number;
  concentracaoMaxima: number;
  capitalOcioso: number;
  bloqueiosPorSaldo: number;
  nivelEvidencia: NivelEvidencia;
  eliminado: boolean;
  motivoEliminacao?: string;
  recomendadoEliminar: boolean;
  motivoRecomendacao?: string;
  pnlIncremental: number;
}

export function linhaDe(e: EstadoVirtual, championPnlAjustadoPct: number, cfg?: ConfigChallenger): LinhaLeaderboard {
  const { pnlPaperBase } = reconciliar(e);
  const cenarioResultados = Object.fromEntries(
    (Object.keys(CENARIOS) as CenarioRealismo['nome'][]).map((nome) => [nome, pnlAjustadoNoCenario(e, nome).pnlPaperAjustado]),
  ) as Record<CenarioRealismo['nome'], number>;
  const pnlPaperAjustado = cenarioResultados.base;

  const equity = e.capitalInicialVirtual + e.pnlRealizado;
  const retornoPct = e.capitalInicialVirtual > 0 ? (pnlPaperAjustado / e.capitalInicialVirtual) * 100 : 0;
  const margemTotal = e.posicoesVirtuais.reduce((s, p) => s + p.margemShort + p.margemLong, 0);
  const capitalOcioso = Object.values(e.saldoVirtualPorExchange).reduce((a, b) => a + b, 0);
  const exposicao: Record<string, number> = {};
  for (const p of e.posicoesVirtuais) {
    exposicao[p.exchangeShort] = (exposicao[p.exchangeShort] ?? 0) + p.margemShort;
    exposicao[p.exchangeLong] = (exposicao[p.exchangeLong] ?? 0) + p.margemLong;
  }
  const concentracaoMaxima = e.capitalInicialVirtual > 0
    ? Math.max(0, ...Object.values(exposicao)) / e.capitalInicialVirtual : 0;
  const recomendacao = e.eliminado ? null : avaliarEliminacao(e, championPnlAjustadoPct);

  return {
    challengerId: e.challengerId,
    familia: e.familia, hipotese: e.hipotese,
    experimentoStatus: e.experimentoStatus, configDesde: e.configDesde,
    pausado: !!e.pausado, motivoPausa: e.pausado?.motivo,
    altoRiscoAlavancagem: (cfg?.alavancagem ?? 0) > 5,
    pnlPaperBruto: e.pnlRealizado, pnlPaperBase, pnlPaperAjustado,
    diferencaDeRealismo: pnlPaperBase - pnlPaperAjustado,
    cenarios: cenarioResultados,
    equity, retornoPct, drawdownMaxPct: e.drawdownMaxPct,
    trades: e.trades, settlements: e.settlements, custosTotais: e.custosTotais,
    feeToGross: e.fundingBruto > 0 ? e.custosTotais / e.fundingBruto : Infinity,
    retornoPorMargem: margemTotal > 0 ? pnlPaperAjustado / margemTotal : 0,
    concentracaoMaxima, capitalOcioso, bloqueiosPorSaldo: e.bloqueiosPorSaldo,
    nivelEvidencia: nivelEvidencia(e),
    eliminado: !!e.eliminado, motivoEliminacao: e.eliminado?.motivo,
    recomendadoEliminar: !!recomendacao, motivoRecomendacao: recomendacao?.motivo,
    pnlIncremental: retornoPct - championPnlAjustadoPct,
  };
}

export interface Leaderboard {
  geradoEm: number;
  championPnlPct: number;
  linhas: LinhaLeaderboard[];
  rankings: {
    maiorPnl: string[];
    melhorRetornoPorMargem: string[];
    menorDrawdown: string[];
    melhorPnlSobreDrawdown: string[];
    menorCusto: string[];
    maisConsistente: string[];
    /** Parte 17 — leaderboards expandidos: crescimento/frequência/eficiência/risco-ajustado */
    maiorCrescimento: string[]; // pnlIncremental vs champion
    maiorFrequencia: string[]; // trades + settlements, normalizado por dia de vida
    maisEficiente: string[]; // menor feeToGross (custo por dólar de funding bruto)
    melhorAjustadoPorRisco: string[]; // pnlPaperAjustado / (drawdown × concentração), sem promover alto risco de alavancagem
  };
}

function ordenarPor(linhas: LinhaLeaderboard[], chave: (l: LinhaLeaderboard) => number, desc = true): string[] {
  return [...linhas].sort((a, b) => desc ? chave(b) - chave(a) : chave(a) - chave(b)).map((l) => l.challengerId);
}

export function montarLeaderboard(estados: EstadoVirtual[], championPnlPct: number, configs?: ConfigChallenger[]): Leaderboard {
  const cfgPorId = new Map((configs ?? []).map((c) => [c.challengerId, c]));
  const linhas = estados.map((e) => linhaDe(e, championPnlPct, cfgPorId.get(e.challengerId)));
  return {
    geradoEm: Date.now(), championPnlPct, linhas,
    rankings: {
      maiorPnl: ordenarPor(linhas, (l) => l.pnlPaperAjustado),
      melhorRetornoPorMargem: ordenarPor(linhas, (l) => l.retornoPorMargem),
      menorDrawdown: ordenarPor(linhas, (l) => l.drawdownMaxPct, false),
      melhorPnlSobreDrawdown: ordenarPor(linhas, (l) => l.pnlPaperAjustado / Math.max(0.01, l.drawdownMaxPct)),
      menorCusto: ordenarPor(linhas, (l) => l.custosTotais, false),
      maisConsistente: ordenarPor(linhas, (l) => l.trades > 0 ? l.pnlPaperAjustado / Math.sqrt(l.trades) : -Infinity),
      maiorCrescimento: ordenarPor(linhas, (l) => l.pnlIncremental),
      maiorFrequencia: ordenarPor(linhas, (l) => l.trades + l.settlements),
      maisEficiente: ordenarPor(linhas, (l) => Number.isFinite(l.feeToGross) ? l.feeToGross : Infinity, false),
      // alto risco de alavancagem entra na ordenação normal (ela só ORDENA, nunca
      // recomenda) mas fica marcado em cada linha — quem lê decide o que fazer
      melhorAjustadoPorRisco: ordenarPor(linhas, (l) => l.pnlPaperAjustado / Math.max(0.01, l.drawdownMaxPct) / Math.max(0.01, l.concentracaoMaxima)),
    },
  };
}

export function salvarLeaderboard(root: string, lb: Leaderboard): void {
  const p = path.join(root, 'inteligencia', 'leaderboard.json');
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(lb, null, 2));
}
