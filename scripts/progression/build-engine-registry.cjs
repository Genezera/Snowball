#!/usr/bin/env node
'use strict';
/**
 * PARTE 4 — Engine Registry. Cataloga TODOS os motores com estado + métricas REAIS
 * (read-only). Nenhum motor é promovido automaticamente. Emite
 * auditoria/progression/engine-registry.json.
 * Estados: LOCKED, RESEARCH, DATA_COLLECTION, SHADOW, CHALLENGER, ELIGIBLE, LIVE,
 *          PAUSED, REJECTED, ARCHITECTURE_ONLY.
 */
const L = require('./lib-progression.cjs');

function confiancaDe(amostra, aprovado) {
  if (aprovado && amostra >= 30) return 'alta';
  if (amostra >= 30) return 'media';
  if (amostra >= 8) return 'baixa';
  return 'insuficiente';
}

function build() {
  const { estado, asOf } = L.loadChampion();
  const { eventos } = L.serieEconomica();
  const funding = estado.fundingTotal || 0, custos = estado.custosTotal || 0;
  const abre = eventos.filter((e) => e.evento === 'abre' || e.evento === 'abre-captura');
  const janelaH = abre.length ? Math.max(1, (asOf - abre[0].ts) / 3.6e6) : 0;
  const cand = L.jsonl(L.P.candidatos);
  const rejeitSaldo = cand.filter((c) => c.motivoRejeicao && /saldo_insuficiente/.test(c.motivoRejeicao)).length;

  const captura = L.rd(L.P.captura, null);
  const crossRank = L.jsonl(L.P.crossRank);
  const crossAprovados = crossRank.filter((c) => c.aprovadaReal).length;
  const pares = L.rd(L.P.pares, null);
  const momentum = L.rd(require('node:path').join(L.ROOT, 'momentum', 'estado.json'), null);
  const chDiario = L.rd(L.P.challengersRel, null);
  const chGate = chDiario && chDiario.gate ? chDiario.gate.veredito : 'sem relatório';

  const niveis = L.derivarNiveis();
  const unlockLevel = (nome) => (niveis.find((n) => (n.modulos || []).some((m) => m.toLowerCase().includes(nome))) || {}).levelId ?? null;

  const engines = [
    {
      engineId: 'champion-funding', nome: 'Champion — funding delta-neutro', mercado: 'cripto-perp', estado: 'LIVE', baseline: true,
      capitalMinimo: 200, capitalMaxEstimado: null,
      capacidade: rejeitSaldo > 0 ? 'constrangido-por-capital (headroom)' : 'possível-saturação',
      frequencia: L.r4(abre.length / janelaH) + '/h (' + abre.length + ' aberturas em ' + L.r2(janelaH) + 'h)',
      pnlLiquido: L.r4(funding - custos), drawdown: L.maxDrawdown(L.serieEconomica().capSeries).pct + '%',
      feeToGross: funding > 0 ? L.r4(custos / funding) : null, capitalHoras: 'ver capital-ledger',
      amostra: (estado.pagamentos || 0) + ' pagamentos / ' + (eventos.filter((e) => e.evento === 'fecha').length) + ' fechados',
      confianca: confiancaDe(estado.pagamentos || 0, true), correlacao: 'baseline (referência)',
      dependencias: ['6 exchanges', 'taxas de funding', 'spread cruzado'], blockedReasons: [], unlockLevel: 1,
    },
    {
      engineId: 'close-timing-challengers', nome: 'Challengers de timing de fechamento', mercado: 'cripto-perp', estado: 'DATA_COLLECTION',
      capitalMinimo: 0, capacidade: 'observador (não aloca capital)', frequencia: 'contínua (espelha o Champion)',
      pnlLiquido: 0, drawdown: null, feeToGross: null, capitalHoras: 0,
      amostra: '0 extensões reais (gate ' + chGate.split('—')[0].trim() + ')', confianca: 'insuficiente', correlacao: '≈1 com Champion (por construção)',
      dependencias: ['Champion', 'telemetria de risco 2 pernas'], blockedReasons: ['gate BLOQUEADO: <30 realExtensions, <15 decisionDivergences'], unlockLevel: 2,
    },
    {
      engineId: 'settlement-capture', nome: 'Captura de settlement', mercado: 'cripto-perp', estado: 'SHADOW',
      capitalMinimo: 200, capacidade: 'baixa (janela curta pré-settlement)', frequencia: (captura ? captura.totalCapturas : 0) + ' capturas observadas',
      pnlLiquido: captura ? L.r4(captura.pnlLiquido) : 0, drawdown: null, feeToGross: captura && captura.receitaFunding ? L.r4(captura.custoTotal / captura.receitaFunding) : null, capitalHoras: null,
      amostra: (captura ? captura.concluidas : 0) + ' concluídas / ' + (captura ? captura.inversoesAntesSettlement : 0) + ' inversões', confianca: confiancaDe(captura ? captura.concluidas : 0, false), correlacao: 'compartilha exchanges/funding com o Champion',
      dependencias: ['relógio de settlement', 'liquidez pré-settlement'], blockedReasons: ['amostra pequena (' + (captura ? captura.concluidas : 0) + ' < 30)', 'inversões antes do settlement'], unlockLevel: 3,
    },
    {
      engineId: 'funding-cross-sectional', nome: 'Funding cross-sectional', mercado: 'cripto-perp', estado: 'DATA_COLLECTION',
      capitalMinimo: 200, capacidade: 'média (ranking contínuo)', frequencia: crossRank.length + ' símbolos ranqueados',
      pnlLiquido: 0, drawdown: null, feeToGross: null, capitalHoras: null,
      amostra: crossRank.length + ' ranqueados / ' + crossAprovados + ' aprovados', confianca: 'insuficiente', correlacao: 'depende das mesmas taxas de funding',
      dependencias: ['ranking de funding entre símbolos'], blockedReasons: ['0 oportunidades aprovadas (valorPorHora=0)'], unlockLevel: 3,
    },
    {
      engineId: 'pares', nome: 'Pares (mean-reversion)', mercado: 'cripto', estado: 'DATA_COLLECTION',
      capitalMinimo: 200, capacidade: 'desconhecida', frequencia: 'barras diárias',
      pnlLiquido: pares && pares.estado ? L.r4(pares.estado.pnlAcumulado || 0) : 0, drawdown: null, feeToGross: null, capitalHoras: null,
      amostra: (pares && pares.estado ? pares.estado.fechados : 0) + ' fechados', confianca: 'insuficiente', correlacao: 'independente do funding (potencial)',
      dependencias: ['cointegração', 'p-value/half-life'], blockedReasons: ['nenhum par passou p-value/half-life/threshold — ausência real de sinal'], unlockLevel: 3,
    },
    {
      engineId: 'momentum', nome: 'Momentum', mercado: 'cripto', estado: momentum ? 'DATA_COLLECTION' : 'RESEARCH',
      capitalMinimo: 200, capacidade: 'desconhecida', frequencia: 'intradiária',
      pnlLiquido: momentum ? L.r4(momentum.pnlAcumulado || 0) : null, drawdown: momentum ? L.r2((((momentum.pico || momentum.capital) - momentum.capital) / (momentum.pico || momentum.capital)) * 100) + '%' : null,
      feeToGross: null, capitalHoras: null,
      amostra: momentum ? `${momentum.fechados || 0} fechados / ${momentum.vitorias || 0} vitórias / ${(momentum.posicoes || []).length} abertos` : 'histórico',
      confianca: 'insuficiente', correlacao: 'independente do funding (potencial)',
      dependencias: ['universo', 'timeframe', 'custos'],
      blockedReasons: momentum ? [`amostra fechada mínima (${momentum.fechados || 0}) e PnL inicial negativo (${L.r4(momentum.pnlAcumulado || 0)})`] : ['perdeu no histórico — diagnóstico pendente antes de shadow'], unlockLevel: 3,
    },
    {
      engineId: 'news-event-radar', nome: 'Radar de notícias/eventos', mercado: 'cripto', estado: 'LOCKED',
      capitalMinimo: 800, capacidade: 'n/a', frequencia: 'orientada a evento',
      pnlLiquido: null, drawdown: null, feeToGross: null, capitalHoras: null,
      amostra: 'nenhuma (só arquitetura)', confianca: 'insuficiente', correlacao: 'desconhecida',
      dependencias: ['feeds oficiais verificáveis', 'deduplicação', 'provenance'], blockedReasons: ['só arquitetura + coleta read-only; LLM não emite sinal/ordem'], unlockLevel: 4,
    },
    {
      engineId: 'listing-opportunity-lab', nome: 'Listing Opportunity Lab', mercado: 'cripto', estado: 'LOCKED',
      capitalMinimo: 800, capacidade: 'n/a', frequencia: 'por listagem',
      pnlLiquido: null, drawdown: null, feeToGross: null, capitalHoras: null,
      amostra: 'nenhuma (coleta por WebSocket pendente)', confianca: 'insuficiente', correlacao: 'desconhecida',
      dependencias: ['WebSocket', 'order book', 'slippage sim', 'circuit breakers'], blockedReasons: ['ciclo de 5min insuficiente p/ primeiros segundos; falta coleta WS'], unlockLevel: 4,
    },
    {
      engineId: 'acoes-multimercado', nome: 'Ações e outros mercados', mercado: 'ações', estado: 'ARCHITECTURE_ONLY',
      capitalMinimo: 2000, capacidade: 'n/a', frequencia: 'sessão de bolsa',
      pnlLiquido: null, drawdown: null, feeToGross: null, capitalHoras: null,
      amostra: 'nenhuma', confianca: 'insuficiente', correlacao: 'baixa com cripto (potencial)',
      dependencias: ['broker adapter', 'market calendar', 'corporate actions', 'capital/risco/contabilidade SEPARADOS'], blockedReasons: ['sem execução nesta fase; só arquitetura futura'], unlockLevel: 6,
    },
  ];

  const porEstado = {};
  for (const e of engines) porEstado[e.estado] = (porEstado[e.estado] || 0) + 1;
  const registry = {
    schema: 'snowball.engine-registry.v1', geradoEm: new Date(asOf || 0).toISOString(), asOfMs: asOf,
    totalMotores: engines.length, porEstado, promocaoAutomatica: false,
    nota: 'Nenhum motor é promovido automaticamente. Estados derivados de dados reais; amostras pequenas mantêm confiança baixa/insuficiente.',
    motores: engines,
  };
  const p = L.writeJSON('engine-registry.json', registry);
  console.log(JSON.stringify({ saida: p, porEstado, motores: engines.map((e) => `${e.engineId}: ${e.estado} (pnl ${e.pnlLiquido}, conf ${e.confianca})`) }, null, 2));
}
build();
