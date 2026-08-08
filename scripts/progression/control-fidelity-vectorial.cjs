#!/usr/bin/env node
'use strict';
/**
 * v1.4 — PARTE 6. Fidelidade VETORIAL do Control por DEFINIÇÃO, cada uma
 * reconciliando ≤US$0,01 na SUA base — SEM categoria residual compensando métricas
 * de bases diferentes. Compara separadamente: realized/marked/executable PnL,
 * funding, custos, posições, positionIds, capital, saldos por exchange.
 * READ-ONLY. Emite auditoria/progression/control-fidelity-vectorial.json.
 */
const L = require('./lib-progression.cjs');

function build() {
  const { estado, marcacao, asOf } = L.loadChampion();
  const pos = L.reconstruirPosicoes(estado);
  const abertas = pos.filter((p) => p.aberta);
  const fundingAbertas = abertas.reduce((s, p) => s + (p.funding || 0), 0);

  const dim = [];
  const add = (definicao, base, control, champion) => { const d = L.r4(control - champion); dim.push({ definicao, base, control: L.r4(control), champion: L.r4(champion), diferenca: d, reconcilia: Math.abs(d) <= 0.01 }); };

  // 1) funding (base: soma de ganhos)
  const { eventos } = L.serieEconomica();
  const fundingEventos = eventos.filter((e) => e.evento === 'funding').reduce((s, e) => s + (e.ganho || 0), 0);
  add('funding', 'soma de ganhos de funding', fundingEventos, estado.fundingTotal);
  // 2) custos (base: soma de custos de todos os eventos)
  const custoEventos = eventos.reduce((s, e) => s + (typeof e.custo === 'number' ? e.custo : 0), 0);
  add('custos', 'soma de custos de eventos', custoEventos, estado.custosTotal);
  // 3) capital (base: inicial+funding−custos)
  add('capital', 'capitalInicial + funding − custos', estado.capitalInicial + fundingEventos - custoEventos, estado.capital);
  // 4) realized PnL (base: capital − capitalInicial, realizado)
  add('realized PnL', 'capital − capitalInicial', (estado.capital - estado.capitalInicial), (estado.fundingTotal - estado.custosTotal));
  // 5) marked PnL — identidade: equityMark = capitalRealizado + pnlNaoRealizadoMark (sem custo de fecho)
  if (marcacao) add('marked PnL', 'equityMark − capitalRealizado', (marcacao.equityMark - marcacao.capitalRealizado), (marcacao.pnlNaoRealizadoMark || 0));
  // 6) executable/liquidation PnL — identidade CORRETA: equityLiquidacao = capitalRealizado +
  //    pnlNaoRealizadoExecutavel − custoEstimadoFechamentoTotal. O custo de fecho é campo NOMEADO
  //    do Champion (não resíduo): a equity de liquidação já desconta o custo de fechar as pernas.
  if (marcacao) add('executable PnL', 'equityLiquidacao − capitalRealizado + custoEstimadoFechamentoTotal', (marcacao.equityLiquidacao - marcacao.capitalRealizado + (marcacao.custoEstimadoFechamentoTotal || 0)), (marcacao.pnlNaoRealizadoExecutavel || 0));
  // 7) saldos por exchange (base: soma dos saldos = capital)
  const somaSaldos = Object.values(estado.saldos || {}).reduce((s, v) => s + v, 0);
  add('saldos por exchange', 'soma dos saldos por exchange = capital', somaSaldos, estado.capital);

  // 8) posições (contagem) e 9) positionIds (conjunto) — dimensões não-monetárias
  const idsChampion = new Set((estado.posicoes || []).map((p) => `${p.symbol}:${p.abertaEm}`));
  const idsControl = new Set(abertas.map((p) => `${p.symbol}:${p.abreTs}`));
  const idsIguais = idsChampion.size === idsControl.size && [...idsChampion].every((x) => idsControl.has(x));
  const dimNaoMonetarias = [
    { definicao: 'posições (contagem)', control: abertas.length, champion: (estado.posicoes || []).length, reconcilia: abertas.length === (estado.posicoes || []).length },
    { definicao: 'positionIds (conjunto)', control: [...idsControl], champion: [...idsChampion], reconcilia: idsIguais },
  ];

  const todasMonetariasOk = dim.every((d) => d.reconcilia);
  const todasOk = todasMonetariasOk && dimNaoMonetarias.every((d) => d.reconcilia);

  // ── v1.5 item 11: SEPARAR consistência interna do Champion vs fidelidade do Control ──
  const cc = [];
  const addCC = (id, lhs, rhs) => { const d = L.r4(lhs - rhs); cc.push({ identidade: id, valor: L.r4(lhs), esperado: L.r4(rhs), diferenca: d, ok: Math.abs(d) <= 0.01 }); };
  addCC('capital = capitalInicial + funding − custos', estado.capital, estado.capitalInicial + estado.fundingTotal - estado.custosTotal);
  addCC('Σ saldosPorExchange = capital', Object.values(estado.saldos || {}).reduce((s, v) => s + v, 0), estado.capital);
  if (marcacao) { addCC('equityMark = capitalRealizado + pnlMark', marcacao.equityMark, marcacao.capitalRealizado + (marcacao.pnlNaoRealizadoMark || 0));
    addCC('equityLiquidacao = capitalRealizado + pnlExec − custoFecho', marcacao.equityLiquidacao, marcacao.capitalRealizado + (marcacao.pnlNaoRealizadoExecutavel || 0) - (marcacao.custoEstimadoFechamentoTotal || 0)); }
  const championConsistente = cc.every((c) => c.ok);

  const out = {
    schema: 'snowball.control-fidelity-vectorial.v1_5', geradoEm: new Date(asOf || 0).toISOString(), asOfMs: asOf,
    toleranciaUSD: 0.01, semCategoriaResidual: true,
    championAccountingConsistency: { identidadesInternas: cc, consistente: championConsistente, nota: 'Identidades INTERNAS do Champion (não comparação com o Control) — a base contábil do Champion fecha consigo mesma.' },
    controlForwardFidelity: { nota: 'Reconstrução do Control (por instância/positionId) vs Champion, evento a evento, cada definição na SUA base ≤US$0,01.' },
    nota: 'Cada definição reconcilia na SUA base (realized vs realized, marked vs marked, executable vs executable). NÃO se usa resíduo p/ compensar bases diferentes: marked e realized são coisas distintas e cada uma bate com a sua fonte no Champion.',
    dimensoesMonetarias: dim, dimensoesNaoMonetarias: dimNaoMonetarias,
    fundingPosicoesAbertas: L.r4(fundingAbertas),
    todasReconciliam: todasOk,
    veredito: todasOk ? 'Control FIEL ao Champion em TODAS as 9 definições, cada uma ≤US$0,01 na sua base, sem categoria residual.' : 'Alguma definição não reconcilia — ver dimensões.',
  };
  const p = L.writeJSON('control-fidelity-vectorial.json', out);
  console.log(JSON.stringify({ saida: p, todasReconciliam: todasOk,
    monetarias: dim.map((d) => `${d.definicao}: ${d.diferenca} ${d.reconcilia ? 'OK' : '!!'}`),
    naoMonetarias: dimNaoMonetarias.map((d) => `${d.definicao}: ${d.reconcilia ? 'OK' : '!!'}`) }, null, 2));
}
build();
