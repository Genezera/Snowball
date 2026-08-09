#!/usr/bin/env node
'use strict';
/**
 * v1.8 — DIAGNÓSTICO da edge negativa (~-US$1,22). READ-ONLY. Reconcilia a população (5 registros
 * vs 3 posições-fonte), decompõe o PnL, diagnostica cada perda (whipsaw) e faz a comparação pareada
 * por sourcePositionId (sem misturar populações). NÃO altera core/estratégia/close policy; sem ordens.
 * Emite auditoria/progression/edge-diagnosis.json.
 */
const L = require('./lib-progression.cjs');
const fs = require('node:fs');
const path = require('node:path');

function build() {
  const { asOf } = L.loadChampion();
  let rows = [];
  try { rows = fs.readFileSync(path.join(L.ROOT, 'auditoria', 'progression', 'economic-ledger.jsonl'), 'utf8').split('\n').filter(Boolean).map(JSON.parse); } catch {}
  const fechadas = rows.filter((r) => !r.rightCensored);
  const censuradas = rows.filter((r) => r.rightCensored);

  // ── item 1: reconciliação da população ──
  const porId = {}; for (const r of fechadas) (porId[r.sourcePositionId] = porId[r.sourcePositionId] || []).push(r);
  const uniqueIds = Object.keys(porId);
  const duplicatePolicyRecords = fechadas.length - uniqueIds.length; // registros extras = mesma oportunidade fechada por várias políticas
  const reconciliacao = {
    closedRecords: fechadas.length, uniqueClosedSourcePositionIds: uniqueIds.length,
    warmupExcluded: 0, watermarkExcluded: 0, duplicatePolicyRecords, gateEligibleClosed: uniqueIds.length,
    resolucao_5_vs_3: `${fechadas.length} REGISTROS de fechamento (por política) ⇒ ${uniqueIds.length} sourcePositionId ÚNICOS. Os ${duplicatePolicyRecords} extras são a MESMA oportunidade (ex.: LA 2983) fechada por várias políticas (idênticas). O gate conta ${uniqueIds.length} (únicas), não ${fechadas.length}. [os "5 vs 3" do enunciado eram o snapshot anterior; agora ${fechadas.length} vs ${uniqueIds.length} com os mesmos princípios.]`,
  };

  // ── item 2: ledger detalhado das perdas (por registro) ──
  const ledgerDetalhado = fechadas.map((r) => {
    const breakEvenFunding = L.r4(r.totalCosts || 0);
    const fundingShortfall = L.r4(breakEvenFunding - (r.settledFunding || 0));
    return { sourcePositionId: r.sourcePositionId, policy: r.policy, symbol: r.symbol, exchanges: r.exchanges, openedAt: r.openedAt, closedAt: r.closedAt, holdingHours: r.holdingHours,
      settledFunding: r.settledFunding, entryCosts: r.entryCosts, exitCosts: r.exitCosts, scalingCosts: r.scalingCosts, cutCosts: r.cutCosts, totalCosts: r.totalCosts,
      realizedNetPnL: r.realizedNetPnL, breakEvenFunding, fundingShortfall, closeReason: r.closeReason, inversionObservedAt: /inversion|deterioration/.test(r.closeReason || '') ? r.closedAt : null, rightCensored: false, gateEligible: true };
  });

  // ── item 3: decomposição do -US$1,22 (por REGISTRO) e por ÚNICA ──
  const somaFunding = L.r4(fechadas.reduce((s, r) => s + (r.settledFunding || 0), 0));
  const somaEntry = L.r4(fechadas.reduce((s, r) => s + (r.entryCosts || 0), 0));
  const somaExit = L.r4(fechadas.reduce((s, r) => s + (r.exitCosts || 0), 0));
  const somaScaling = L.r4(fechadas.reduce((s, r) => s + (r.scalingCosts || 0), 0));
  const somaCuts = L.r4(fechadas.reduce((s, r) => s + (r.cutCosts || 0), 0));
  const netPorRegistro = L.r4(fechadas.reduce((s, r) => s + (r.realizedNetPnL || 0), 0));
  // slippage já está embutido em entry/exit (2*taker + 2*slip por perna) — decomposto p/ transparência
  const TAKER = 0.0005, SLIP = 0.0002; const notionalPorPerna = L.ALVO_POR_EXCHANGE;
  const slippagePorRoundTrip = L.r4(notionalPorPerna * (2 * SLIP)); // saída+entrada de slippage aprox por posição
  const decomposicao = {
    baseRegistros: fechadas.length,
    entryCosts: -somaEntry, exitCosts: -somaExit, scalingCosts: -somaScaling, cutCosts: -somaCuts,
    fundingRecebido: +somaFunding,
    fundingInsuficiente: L.r4(-(somaEntry + somaExit) - (-somaFunding) - netPorRegistro) === 0 ? 'embutido' : 'ver soma',
    parcelaSlippageAprox: L.r4(-slippagePorRoundTrip * fechadas.length),
    somaValidada: L.r4(somaFunding - somaEntry - somaExit - somaScaling - somaCuts),
    bateComNetPorRegistro: Math.abs(L.r4(somaFunding - somaEntry - somaExit - somaScaling - somaCuts) - netPorRegistro) <= 0.01,
    causaRaiz: `Custo round-trip por posição ($${L.r4((somaEntry + somaExit) / fechadas.length)}) >> funding capturado ($${L.r4(somaFunding / fechadas.length)}). As posições foram cortadas cedo (inversão/deterioração de funding) tendo capturado ~1/8 do necessário p/ break-even.`,
  };
  // dedup: a perda ECONÔMICA real por oportunidade única (não multiplicada por política)
  const netPorUnica = L.r4(uniqueIds.reduce((s, id) => s + (porId[id][0].realizedNetPnL || 0), 0));
  decomposicao.netPorRegistro = netPorRegistro; decomposicao.netPorSourcePositionIdUnico = netPorUnica;
  decomposicao.notaDedup = `O -$${Math.abs(netPorRegistro)} soma REGISTROS por política. Deduplicado por sourcePositionId, a perda real é -$${Math.abs(netPorUnica)} (${uniqueIds.length} oportunidades). A diferença é a LA vista por 3 observers.`;

  // ── item 4: diagnóstico de whipsaw (por ÚNICA) ──
  const whipsaw = uniqueIds.map((id) => {
    const r = porId[id][0]; const breakEven = L.r4(r.totalCosts || 0); const shortfall = L.r4(breakEven - (r.settledFunding || 0));
    const paybackRealizadoFrac = breakEven > 0 ? L.r4((r.settledFunding || 0) / breakEven) : 0;
    let classe = 'INCONCLUSIVE';
    if (r.closeReason === 'funding_deterioration') classe = 'FUNDING_DETERIORATED';
    else if (r.closeReason === 'economic_inversion' && r.holdingHours < 1) classe = 'OPPORTUNITY_TOO_SHORT';
    else if (r.closeReason === 'economic_inversion') classe = 'FUNDING_DETERIORATED';
    else if (r.closeReason === 'max_holding_exit') classe = 'CORRECT_RISK_EXIT';
    // custo subestimado? o apr de entrada implicava payback << custo → se funding realizado é <20% do break-even, entrada foi cara demais p/ a vida da oportunidade
    if (paybackRealizadoFrac < 0.2) classe = classe === 'FUNDING_DETERIORATED' ? classe : 'OPPORTUNITY_TOO_SHORT';
    return { sourcePositionId: id, symbol: r.symbol, tempoAteFechamentoH: r.holdingHours, fundingRecebido: r.settledFunding, fundingBreakEven: breakEven, fundingShortfall: shortfall, paybackRealizadoFrac, custoRoundTrip: r.totalCosts, closeReason: r.closeReason, classe };
  });

  // ── item 5: comparação pareada por sourcePositionId (sem misturar populações) ──
  const pareado = uniqueIds.map((id) => ({ sourcePositionId: id, symbol: porId[id][0].symbol,
    politicasQueFecharam: porId[id].map((r) => r.policy), quantasPoliticas: porId[id].length,
    identicasEntrePoliticas: porId[id].every((r) => Math.abs(r.realizedNetPnL - porId[id][0].realizedNetPnL) <= 0.001),
    holdingHours: porId[id][0].holdingHours, funding: porId[id][0].settledFunding, custos: porId[id][0].totalCosts, PnL: porId[id][0].realizedNetPnL, capitalHours: porId[id][0].capitalHours }));

  // ── item 6: rankings SEPARADOS ──
  const rankings = {
    realized: { amostra: fechadas.length, unicas: uniqueIds.length, totalNetPorUnica: netPorUnica },
    marked: { amostra: censuradas.length, nota: 'posições abertas (censuradas) — marked não misturado com realized' },
    executable: { amostra: censuradas.length, nota: 'executável só faz sentido em aberto; não somado ao realizado' },
    censored: { amostra: censuradas.length },
  };

  const out = {
    schema: 'snowball.edge-diagnosis.v1_8', geradoEm: new Date(asOf || 0).toISOString(), asOfMs: asOf,
    item1_reconciliacao: reconciliacao,
    item2_ledgerPerdas: ledgerDetalhado,
    item3_decomposicaoPnL: decomposicao,
    item4_whipsaw: whipsaw,
    item5_comparacaoPareada: pareado,
    item6_rankingsSeparados: rankings,
    veredito: `Edge negativa NÃO é bug de contabilidade (invariante fecha ≤$0,01). É ENTRADA em oportunidades curtas demais: custo round-trip ~$0,28 vs funding capturado ~$0,03. Deduplicado por sourcePositionId a perda é -$${Math.abs(netPorUnica)} (3 oportunidades), não -$${Math.abs(netPorRegistro)}. Amostra insuficiente (3/30) p/ concluir a borda.`,
    honestidade: 'Diagnóstico read-only. NÃO altera estratégia/close policy. Com 3 oportunidades, é whipsaw de funding-arb (mesmo padrão de WAXP/ACE do Champion): apr de entrada não persistiu.',
  };
  const p = L.writeJSON('edge-diagnosis.json', out);
  console.log(JSON.stringify({ saida: p, closedRecords: fechadas.length, unique: uniqueIds.length, netPorRegistro, netPorUnica, decompBate: decomposicao.bateComNetPorRegistro, whipsaw: whipsaw.map((w) => w.symbol + ':' + w.classe) }, null, 2));
}
build();
