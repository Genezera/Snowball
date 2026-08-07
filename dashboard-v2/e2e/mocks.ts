/**
 * Fixtures determinísticas (Fechamento do Quality Gate, item 6/7) — cenários
 * visuais que dependiam de o SISTEMA VIVO estar, no instante do teste, num
 * estado específico (posição aberta, alto risco, settlement concluído,
 * motor fora da janela comum) agora têm cobertura funcional garantida via
 * mock de rota, sem depender do mercado real. Os testes com dados reais
 * (arquivo `e2e/pages/*.spec.ts`) continuam existindo como smoke tests
 * adicionais — não foram removidos, só deixaram de ser a ÚNICA cobertura.
 *
 * Os payloads aqui seguem EXATAMENTE os schemas Zod reais
 * (`src/schemas/champion.ts`, `src/schemas/profitLab.ts`,
 * `src/schemas/multiStrategy.ts`) — nenhum campo inventado.
 */
import type { Page } from '@playwright/test';

const AGORA = 1_800_000_000_000; // timestamp fixo — determinístico entre execuções

function baseEstadoChampion(overrides: Record<string, unknown> = {}) {
  return {
    capital: 10_500, capitalInicial: 10_000, pico: 10_600,
    fundingTotal: 620, custosTotal: 120, pagamentos: 34,
    posicoes: [], iniciadoEm: AGORA - 30 * 86_400_000,
    ...overrides,
  };
}

function posicaoMock(overrides: Record<string, unknown> = {}) {
  return {
    symbol: 'BTCUSDT', exchangeShort: 'binance', exchangeLong: 'bybit',
    margemShort: 500, margemLong: 500, notionalPorPerna: 5000,
    precoEntrada: 63_000, precoUltimo: 63_150, abertaEm: AGORA - 3 * 3_600_000,
    spreadNaEntrada: 0.0008, fundingAcumulado: 4.2, pagamentos: 3,
    distanciaShort: 0.18, distanciaLong: 0.22, distanciaMinima: 0.18,
    pernaEmRisco: 'short', horasAberta: 3,
    ...overrides,
  };
}

function baseChampionResposta(overrides: Record<string, unknown> = {}) {
  return {
    estado: baseEstadoChampion(),
    marcacao: { equityMark: 10_540, equityLiquidacao: 10_480 },
    posicoes: [],
    curva: Array.from({ length: 10 }, (_, i) => ({ ts: AGORA - (10 - i) * 3_600_000, capital: 10_000 + i * 50 })),
    pagamentosPorDia: [{ dia: '2027-01-01', total: 12.5 }],
    processos: [{ chave: 'champion', nome: 'Champion', vivo: true, memoriaMB: 80, desde: AGORA - 30 * 86_400_000 }],
    vigilancia: { viva: true, candidatos: 0, fonte: 'watchdog' },
    custos: {
      autoritativo: {
        fundingTotalLifetime: 620, custosTotalLifetime: 120, pnlRealizadoLifetime: 500,
        reconciliado: true, diferenca: 0, tolerancia: 0.01,
        origemFunding: 'diario', origemCustos: 'diario', origemPnL: 'estado', atualizadoEm: AGORA,
      },
      decomposicao: {
        escopo: 'complete', linhasLidas: 400, linhasTotaisNoArquivo: 400,
        buckets: {
          entrada: 40, saida: 40,
          slippageEntrada: { valor: null, tracked: false, motivo: 'não instrumentado pelo motor atual' },
          slippageSaida: { valor: null, tracked: false, motivo: 'não instrumentado pelo motor atual' },
          escalonamento: 10, apara: 5, reinvestimento: 5,
          emergencial: { valor: null, tracked: false, motivo: 'não instrumentado pelo motor atual' },
          fechamentoEstimado: null, outros: 20,
        },
        notas: { slippage: 'não instrumentado', emergencial: 'não instrumentado', fechamentoEstimado: 'indisponível nesta janela' },
        fundingBrutoNoEscopo: 620, custoTotalNoEscopo: 120,
        decomposicaoCompleta: true, custosNaoClassificados: 0,
      },
    },
    equityMark: 10_540, equityLiquidacao: 10_480,
    atualizadoEm: AGORA,
    ...overrides,
  };
}

/** Champion com N posições abertas (0, 1 ou 2) — item 7: fixture determinística de posição. */
export function championComPosicoes(n: 0 | 1 | 2, opts: { risco?: boolean } = {}) {
  const posicoes = Array.from({ length: n }, (_, i) => posicaoMock({
    symbol: i === 0 ? 'BTCUSDT' : 'ETHUSDT',
    distanciaMinima: opts.risco && i === 0 ? 0.02 : 0.18, // achado de risco elevado: distância mínima até liquidação muito baixa
    pernaEmRisco: opts.risco && i === 0 ? 'short' : 'nenhuma',
  }));
  return baseChampionResposta({
    estado: baseEstadoChampion({ posicoes }),
    posicoes,
  });
}

function linhaMultiMock(overrides: Record<string, unknown> = {}) {
  return {
    strategyId: 'baseline-equal-weight', familia: 'baseline', disponivel: true,
    capitalVirtual: 1000, pnlDesdeOInicio: 40, pnlPct: 4,
    drawdownMaxPct: 2, iniciadoEm: AGORA - 20 * 86_400_000, diasRodando: 20,
    dentroDaJanelaComumDesdeOInicio: true, comparavelNaJanela: true, nota: 'dentro da janela comum',
    ...overrides,
  };
}

function baseProfitLabResposta(overrides: Record<string, unknown> = {}) {
  return {
    status: 'saudavel', statusMotivo: 'operando normalmente',
    heartbeat: {
      pid: 4242, startedAt: AGORA - 3_600_000, ultimoCiclo: AGORA, ciclosProcessados: 500, ciclosComErro: 0,
      reinicios: 0, statusPorChallenger: {},
    },
    resumo: {
      geradoEm: AGORA,
      champion: {
        pnlRealizado: 500, pnlNaoRealizadoMark: 40, pnlNaoRealizadoExecutavel: 35, equityMark: 10_540,
        equityLiquidacao: 10_480, fundingBruto: 620, custosTotais: 120, capitalInicial: 10_000, capitalAtual: 10_500,
        pnlPct: 5, marcacaoDisponivel: true,
      },
      control: { pnlBase: 100, pnlAjustado: 90, retornoPct: 1, trades: 20 },
      melhorPnlBase: { challengerId: 'challenger-a', valor: 60 },
      melhorPnlAjustado: { challengerId: 'challenger-a', valor: 55 },
      melhorRetornoPorMargem: { challengerId: 'challenger-a', valor: 3 },
      menorDrawdown: { challengerId: 'challenger-b', valor: 1 },
      maiorFrequencia: { challengerId: 'challenger-c', valor: 90 },
      menorCusto: { challengerId: 'challenger-b', valor: 5 },
      capitalVirtualTotal: 12_000, tradesTotaisPaper: 340, settlementsTotaisPaper: 88,
      numeroChallengers: 6, numeroAtivos: 5, numeroPausados: 1, numeroEliminados: 0,
    },
    leaderboard: null,
    leaderboardMulti: {
      geradoEm: AGORA,
      janelaComum: { desde: AGORA - 20 * 86_400_000, ate: AGORA, descricao: '20 dias comuns a todos os motores comparáveis' },
      historicoTotalChampion: { desde: AGORA - 90 * 86_400_000, ate: AGORA, descricao: '90 dias de histórico total do champion' },
      linhas: [linhaMultiMock()],
      aviso: 'capital virtual — nunca representa dinheiro real',
    },
    janelaComum: null,
    custos: null,
    riscos: { porChallenger: [] },
    telemetria: null,
    championVsControl: null,
    capturaStatus: [],
    geradoEm: AGORA,
    ...overrides,
  };
}

/** Item 3 (Command Center): motor com histórico mais curto que a janela comum NUNCA pode aparecer como melhor/pior comparável. */
export function profitLabComMotorForaDaJanela() {
  return baseProfitLabResposta({
    leaderboardMulti: {
      geradoEm: AGORA,
      janelaComum: { desde: AGORA - 20 * 86_400_000, ate: AGORA, descricao: '20 dias comuns' },
      historicoTotalChampion: { desde: AGORA - 90 * 86_400_000, ate: AGORA, descricao: '90 dias' },
      linhas: [
        linhaMultiMock({ strategyId: 'motor-veterano-a', pnlDesdeOInicio: 200, comparavelNaJanela: true }),
        linhaMultiMock({ strategyId: 'motor-veterano-b', pnlDesdeOInicio: -50, comparavelNaJanela: true }),
        // este motor entrou depois do início da janela comum — não pode
        // nunca ser eleito melhor/pior, mesmo tendo o maior pnl absoluto
        linhaMultiMock({
          strategyId: 'motor-recem-chegado-pnl-altissimo', pnlDesdeOInicio: 9999, iniciadoEm: AGORA - 2 * 86_400_000,
          diasRodando: 2, dentroDaJanelaComumDesdeOInicio: false, comparavelNaJanela: false,
          nota: 'fora da janela comum — histórico mais curto que os demais motores',
        }),
      ],
      aviso: 'capital virtual — nunca representa dinheiro real',
    },
  });
}

/** Item 8 (Risk Center): challenger acima de 5x alavancagem — selo obrigatório. */
export function profitLabComAltoRisco() {
  return baseProfitLabResposta({
    riscos: {
      porChallenger: [
        { challengerId: 'challenger-leverage-8', familia: 'leverage', drawdownMaxPct: 12, concentracaoMaxima: 0.8, altoRiscoAlavancagem: true, posicoesAbertas: 1, capitalOcioso: 50 },
        { challengerId: 'challenger-equal-weight', familia: 'baseline', drawdownMaxPct: 3, concentracaoMaxima: 0.3, altoRiscoAlavancagem: false, posicoesAbertas: 2, capitalOcioso: 200 },
      ],
    },
  });
}

/** Item 6 (Settlement Capture): janela concluída — inclui uma aberta e uma concluída pra cobrir os dois ramos do componente. */
export function profitLabComSettlementConcluido() {
  return baseProfitLabResposta({
    capturaStatus: [
      {
        challengerId: 'capture-isolated-30m', janelaMin: 30, status: 'posicao_aberta',
        symbol: 'ETHUSDT', exchangeShort: 'binance', exchangeLong: 'bybit',
        proximaLiquidacaoEm: AGORA + 15 * 60_000, fundingJaRecebido: false,
        trades: 1, settlements: 0, pnlRealizado: null, custosTotais: 2.4,
        notionalPorPerna: 2000, spread8hEntrada: 0.0006, intervaloHorasLiquidacao: 8,
      },
      {
        // fundingJaRecebido:false é intencional — o componente
        // (SettlementTimeline) só usa pnlRealizado+custosTotais como base
        // do fundingRecebido exibido quando fundingJaRecebido é false;
        // com true ele recalcularia a partir de notional×spread, que é uma
        // ESTIMATIVA, não o valor realizado que este mock quer expressar.
        challengerId: 'capture-isolated-60m', janelaMin: 60, status: 'concluida',
        symbol: 'BTCUSDT', exchangeShort: 'bybit', exchangeLong: 'binance',
        proximaLiquidacaoEm: null, fundingJaRecebido: false,
        trades: 2, settlements: 1, pnlRealizado: 8.4, custosTotais: 3.1,
        notionalPorPerna: 3000, spread8hEntrada: 0.0009, intervaloHorasLiquidacao: 8,
      },
    ],
  });
}

/** Registra as rotas mockadas de champion + profit-lab pra uma página inteira, com merge sobre a base saudável. */
export async function mockarChampionEProfitLab(page: Page, opts: { champion?: Record<string, unknown>; profitLab?: Record<string, unknown> } = {}) {
  const championBody = opts.champion ?? baseChampionResposta();
  const profitLabBody = opts.profitLab ?? baseProfitLabResposta();
  await page.route('**/api/v2/champion', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(championBody) }));
  await page.route('**/api/v2/profit-lab', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(profitLabBody) }));
}

export { baseChampionResposta, baseProfitLabResposta };
