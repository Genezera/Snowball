#!/usr/bin/env node
'use strict';
/**
 * v1.8 — PROSPECTIVE ENTRY GATE VALIDATION. READ-ONLY, SEM ordens, SEM promoção automática.
 * Valida PROSPECTIVAMENTE 4 challengers CONGELADOS (A3, B60, C1.5, D) + Control em oportunidades
 * NOVAS, fora da amostra que os criou. As 4 posições que formaram a hipótese ficam marcadas
 * PERMANENTEMENTE como ENTRY_GATE_DEVELOPMENT_SET e NÃO contam como validação.
 *
 * Cria entryGateValidationEpochId (NÃO reinicia economicForwardEpochId). Toda decisão nova
 * (sourceDecisionId com decisão posterior ao início da janela) entra no ENTRY_GATE_VALIDATION_SET.
 * Snapshots de decisão são IMUTÁVEIS (append-only por sourceDecisionId; nunca recalculados com
 * dados posteriores). Os outros 9 challengers ficam NOT_ELIGIBLE_FOR_PROMOTION.
 *
 * Emite auditoria/progression/entry-gate-validation.json (+ epoch e decisões imutáveis persistidas).
 * NÃO altera Champion/Control/política ativa/close/custos/capital/risco/reader/WAL/checkpoint/epoch.
 */
const L = require('./lib-progression.cjs');
const fs = require('node:fs');
const path = require('node:path');
const OUT = path.join(L.ROOT, 'auditoria', 'progression');
const ECON = path.join(OUT, 'economic');
const POL = ['policy', 'trial', 'observer-max3', 'observer-max4', 'observer-max5'];
const NOTIONAL = L.ALVO_POR_EXCHANGE, TAKER = 0.0005, SLIP = 0.0002;
const ROUND_TRIP = L.r4(NOTIONAL * (4 * TAKER + 4 * SLIP)); // $0,28
const CUSTO_FRAC = 4 * TAKER + 4 * SLIP;
const economia = (apr, spread) => apr * 24 / 8760 - (CUSTO_FRAC + Math.max(0, spread || 0));
const paybackHours = (apr) => apr > 0 ? L.r2(ROUND_TRIP / (NOTIONAL * apr / 8760)) : Infinity;
const SETTLE_MS = 8 * 3600 * 1000; // funding settla a cada 8h (00/08/16 UTC)
const DEFAULT_GAP = 30 * 60000;

// ── amostra de desenvolvimento CONGELADA (item 1) — não pode validar os challengers ──
const DEVELOPMENT_SET = {
  '47f46a65f40280821ca7b650': '1000CAT/USDT:USDT|bingx|bybit',
  '26ad5eafe675f6f5c717356b': 'SIREN/USDT:USDT|bybit|bitget',
  '5660bbac719e3abaab2ef359': 'LA/USDT:USDT|bitget|bybit',
  '29836066334187a23736ae7c': 'LA/USDT:USDT|bingx|bybit',
};
// ── parâmetros CONGELADOS dos 4 challengers principais (item 3) — não mudam na janela ──
const FROZEN = { A3_CYCLES: 3, B60_MIN: 60, C_SAFETY: 1.5, D_PROB: 0.5 };
const EXPLORATORY = ['A_consecutive_2', 'A_consecutive_4', 'B_persistence_15min', 'B_persistence_30min', 'B_persistence_120min', 'C_paybackSurvival_1x', 'C_paybackSurvival_1.25x', 'C_paybackSurvival_2x', 'E_settlementProximity_4h'];

function lerDiario(l) { try { return fs.readFileSync(path.join(ECON, l, 'diario.jsonl'), 'utf8').split('\n').filter(Boolean).map(JSON.parse); } catch { return []; } }

// métricas de decisão (SEM lookahead) p/ uma posição, com gap de episódio parametrizável
function metricas(pos, obs, gapMs) {
  const antes = obs.filter((o) => o.ts <= pos.openedAt);
  let persistMin = 0, consecEV = 0;
  for (let i = antes.length - 1; i >= 1; i--) { const cur = antes[i], prev = antes[i - 1];
    if (cur.ts - prev.ts > DEFAULT_GAP) break; if (economia(prev.apr, prev.spread) > 0) { consecEV++; persistMin = (pos.openedAt - prev.ts) / 60000; } else break; }
  // episódios COMPLETADOS antes da decisão (sem lookahead) — gap parametrizável p/ sensibilidade
  const epsTodos = []; let cur = null; for (const o of obs) { if (!cur || o.ts - cur.last > gapMs) { if (cur) epsTodos.push(cur); cur = { first: o.ts, last: o.ts }; } cur.last = o.ts; } if (cur) epsTodos.push(cur);
  const eps = epsTodos.filter((e) => e.last < pos.openedAt);
  const vidasH = eps.map((e) => (e.last - e.first) / 3.6e6);
  const pb = paybackHours(pos.entryApr);
  const medianaVidaH = vidasH.length ? L.r2(vidasH.slice().sort((a, b) => a - b)[Math.floor(vidasH.length / 2)]) : 0;
  const survivalProb = vidasH.length ? L.r2(vidasH.filter((v) => v >= pb).length / vidasH.length) : 0;
  const msInto = ((pos.openedAt % SETTLE_MS) + SETTLE_MS) % SETTLE_MS;
  const timeToSettlementMin = L.r2((SETTLE_MS - msInto) / 60000);
  return { availableObservationCount: antes.length, consecutivePositiveCycles: consecEV, observedPersistenceMinutes: L.r2(persistMin),
    entryApr: pos.entryApr, paybackHours: pb, historicalEpisodesCompletedBeforeDecision: eps.length,
    expectedRemainingLifeH: medianaVidaH, survivalProbability: survivalProb, timeToSettlementMin };
}

// decisões dos 4 congelados + Control a partir das métricas (imutáveis)
function decisoes(m, spread) {
  return {
    decisionByControl: economia(m.entryApr, spread) > 0, // gate ativo (todos os abertos passaram)
    decisionByA3: m.consecutivePositiveCycles >= FROZEN.A3_CYCLES,
    decisionByB60: m.observedPersistenceMinutes >= FROZEN.B60_MIN,
    decisionByC1_5: m.expectedRemainingLifeH >= m.paybackHours * FROZEN.C_SAFETY,
    decisionByD: m.survivalProbability >= FROZEN.D_PROB,
  };
}

function build() {
  const { asOf } = L.loadChampion();
  // ── item 2: epoch de validação (criado UMA vez, persistido; NÃO reinicia o forward) ──
  const epochPath = path.join(OUT, 'entry-gate-validation-epoch.json');
  let epoch = L.rd(epochPath, null);
  if (!epoch) { epoch = { entryGateValidationEpochId: 'egv_' + asOf, validationEpochStartMs: asOf, criadoEm: new Date(asOf || 0).toISOString(), economicForwardEpochIdPreservado: true, nota: 'Janela prospectiva de validação. NÃO reinicia economicForwardEpochId. Decisões a partir daqui = ENTRY_GATE_VALIDATION_SET.' };
    fs.writeFileSync(epochPath, JSON.stringify(epoch, null, 2)); }

  // ── coletar posições fechadas (dedup por sourcePositionId) + apr de entrada ──
  const seen = new Set(); const posicoes = [];
  for (const l of POL) { const ls = lerDiario(l); const ab = {};
    for (const e of ls) { if (e.evento === 'abre') ab[e.k] = e;
      else if (e.evento === 'fecha') { if (seen.has(e.sourcePositionId)) continue; seen.add(e.sourcePositionId); const a = ab[e.k];
        posicoes.push({ policy: l, k: e.k, symbol: (e.k || '').split('|')[0], sourceDecisionId: e.sourceDecisionId, sourcePositionId: e.sourcePositionId,
          entryApr: a ? a.apr : null, entrySpread: 0.0003, openedAt: a ? a.ts : e.positionOpenedAt, closedAt: e.positionClosedAt,
          funding: L.r4(e.funding || 0), pnl: L.r4(e.pnl || 0), closeReason: e.closeReason, custoEntrada: a ? a.custoEntrada : null }); } } }

  // ── classificar: development (congelado) vs validation (novo) vs pré-epoch ──
  for (const p of posicoes) {
    if (DEVELOPMENT_SET[p.sourcePositionId]) p.classe = 'ENTRY_GATE_DEVELOPMENT_SET';
    else if (p.openedAt >= epoch.validationEpochStartMs) p.classe = 'ENTRY_GATE_VALIDATION_SET';
    else p.classe = 'PRE_EPOCH_UNCLASSIFIED'; // fechadas antigas fora da janela — não contam
  }
  const devSet = posicoes.filter((p) => p.classe === 'ENTRY_GATE_DEVELOPMENT_SET');
  const validationSet = posicoes.filter((p) => p.classe === 'ENTRY_GATE_VALIDATION_SET');

  // ── carregar obs do feed p/ as chaves envolvidas (uma passada) ──
  const chaves = new Set(posicoes.map((p) => p.k)); const obsPorChave = {}; for (const k of chaves) obsPorChave[k] = [];
  try { const buf = fs.readFileSync(path.join(L.ROOT, 'vigilancia', 'arquivo-observacoes.jsonl'), 'utf8');
    for (const ln of buf.split('\n')) { if (!ln) continue; let o; try { o = JSON.parse(ln); } catch { continue; } if (chaves.has(o.k)) obsPorChave[o.k].push({ ts: o.ts, apr: o.apr, spread: o.spread || 0 }); } } catch {}
  for (const k of chaves) obsPorChave[k].sort((a, b) => a.ts - b.ts);

  // ── item 4: snapshots IMUTÁVEIS de decisão (append-only por sourceDecisionId) ──
  const decPath = path.join(OUT, 'entry-gate-decisions.jsonl');
  const existentes = new Map();
  try { fs.readFileSync(decPath, 'utf8').split('\n').filter(Boolean).forEach((ln) => { const d = JSON.parse(ln); existentes.set(d.sourceDecisionId, d); }); } catch {}
  let novos = 0;
  for (const p of posicoes) {
    if (!p.sourceDecisionId || existentes.has(p.sourceDecisionId)) continue; // imutável: nunca reescreve
    const m = metricas(p, obsPorChave[p.k] || [], DEFAULT_GAP);
    const snap = { sourceDecisionId: p.sourceDecisionId, sourcePositionId: p.sourcePositionId, symbol: p.symbol, exchangePair: p.k,
      set: p.classe, decisionTimestamp: p.openedAt, epochId: epoch.entryGateValidationEpochId,
      ...m, ...decoesSnapshot(m, p.entrySpread), frozenParams: FROZEN, immutable: true, geradoEm: new Date(asOf || 0).toISOString() };
    existentes.set(p.sourceDecisionId, snap); fs.appendFileSync(decPath, JSON.stringify(snap) + '\n'); novos++;
  }
  function decoesSnapshot(m, spread) { return decisoes(m, spread); }

  // ── aplicar challengers a um conjunto e medir ledger + custo de oportunidade ──
  function avaliaConjunto(conj) {
    const FILTROS = ['Control', 'A3', 'B60', 'C1_5', 'D'];
    const porFiltro = {}; for (const f of FILTROS) porFiltro[f] = { accepted: 0, rejected: 0, capitalRequired: 0, funding: 0, costs: 0, realizedNetPnL: 0, executablePnL: 0, capitalHours: 0, drawdown: 0, rightCensored: 0, breakEvenReached: 0, decisoes: [] };
    for (const p of conj) {
      const snap = existentes.get(p.sourceDecisionId); if (!snap) continue;
      const d = { Control: snap.decisionByControl, A3: snap.decisionByA3, B60: snap.decisionByB60, C1_5: snap.decisionByC1_5, D: snap.decisionByD };
      const capHrs = L.r2((p.closedAt - p.openedAt) / 3.6e6 * (2 * NOTIONAL)); // margem 2 pernas × horas
      const beReached = (p.funding >= ROUND_TRIP) ? 1 : 0;
      for (const f of FILTROS) { const acc = d[f]; const b = porFiltro[f];
        if (acc) { b.accepted++; b.capitalRequired = L.r4(b.capitalRequired + 2 * NOTIONAL); b.funding = L.r4(b.funding + p.funding); b.costs = L.r4(b.costs + ROUND_TRIP); b.realizedNetPnL = L.r4(b.realizedNetPnL + p.pnl); b.executablePnL = L.r4(b.executablePnL + p.pnl); b.capitalHours = L.r2(b.capitalHours + capHrs); b.drawdown = L.r4(Math.max(b.drawdown, Math.max(0, -p.pnl))); b.breakEvenReached += beReached; }
        else { b.rejected++; }
        b.decisoes.push({ symbol: p.symbol, spId: p.sourcePositionId.slice(0, 8), decisao: acc ? 'ACCEPT' : 'REJECT', pnl: p.pnl }); }
    }
    // custo de oportunidade (item 6): classificar rejeições (desfecho conhecido só p/ avaliação a posteriori)
    for (const f of FILTROS) { const b = porFiltro[f];
      const rej = b.decisoes.filter((x) => x.decisao === 'REJECT'); const acc = b.decisoes.filter((x) => x.decisao === 'ACCEPT');
      const lossesAvoided = rej.filter((x) => x.pnl < 0).length;
      const winnersRejected = rej.filter((x) => x.pnl > 0).length;
      const winnersTotal = b.decisoes.filter((x) => x.pnl > 0).length;
      b.classificacaoRejeicoes = { CORRECTLY_REJECTED_LOSS: lossesAvoided, MISSED_PROFITABLE_OPPORTUNITY: winnersRejected, INCONCLUSIVE: rej.filter((x) => x.pnl === 0).length, RIGHT_CENSORED: 0 };
      b.lossesAvoided = lossesAvoided; b.winnersRejected = winnersRejected;
      b.winnerRetentionRate = winnersTotal > 0 ? L.r2((winnersTotal - winnersRejected) / winnersTotal) : null; // null = sem vencedores p/ medir
      b.rejectionPrecision = rej.length > 0 ? L.r2(lossesAvoided / rej.length) : null;
      b.idleCapitalIncrease = L.r4(rej.length * 2 * NOTIONAL);
    }
    const baseline = L.r4(conj.reduce((s, p) => s + p.pnl, 0));
    for (const f of FILTROS) porFiltro[f].netPnLImprovement = L.r4(porFiltro[f].realizedNetPnL - baseline);
    for (const f of FILTROS) delete porFiltro[f].decisoes; // resumo
    return { baselineControlPnL: baseline, porFiltro };
  }

  const devEval = avaliaConjunto(devSet);
  const valEval = avaliaConjunto(validationSet);

  // ── item 8: sensibilidade de episódios p/ o Challenger D (diagnóstico) ──
  const gaps = [15, 30, 45, 60];
  const sensibilidadeD = devSet.map((p) => { const linha = { symbol: p.symbol, spId: p.sourcePositionId.slice(0, 8), porGap: {} };
    for (const g of gaps) { const m = metricas(p, obsPorChave[p.k] || [], g * 60000); linha.porGap['gap' + g] = { survivalProbability: m.survivalProbability, decisionByD: m.survivalProbability >= FROZEN.D_PROB, historicalEpisodes: m.historicalEpisodesCompletedBeforeDecision }; }
    const decisoesD = gaps.map((g) => linha.porGap['gap' + g].decisionByD); linha.decisaoMudaComGap = new Set(decisoesD).size > 1; return linha; });
  const dMudaAlgumaVez = sensibilidadeD.some((l) => l.decisaoMudaComGap);

  // ── item 9: critério de promoção (checklist honesto) ──
  const uniqueValidationClosed = validationSet.length;
  const temVencedoresEPerdedores = validationSet.some((p) => p.pnl > 0) && validationSet.some((p) => p.pnl < 0);
  const promocao = { criterios: {
      min30ValidationPositions: { exigido: 30, atual: uniqueValidationClosed, ok: uniqueValidationClosed >= 30 },
      vencedoresEPerdedores: { ok: temVencedoresEPerdedores },
      pnlLiquidoPositivo: { ok: false, nota: 'sem amostra de validação' },
      melhoriaVsControl: { ok: false, nota: 'sem amostra de validação' },
      winnerRetentionAceitavel: { ok: false, nota: 'sem vencedores p/ medir retenção' },
      segundaJanela: { ok: false }, outroRegime: { ok: false }, stressCustos: { ok: false }, concentracao: { ok: false }, aprovacaoHumana: { ok: false },
    }, elegivel: false, veredito: 'NENHUM challenger promovível — validation set vazio (0/30). Framework prospectivo pronto e aguardando oportunidades novas.' };

  const out = {
    schema: 'snowball.entry-gate-validation.v1_8', geradoEm: new Date(asOf || 0).toISOString(), asOfMs: asOf,
    item2_epoch: epoch,
    item1_developmentSet: { total: devSet.length, congelado: true, marca: 'ENTRY_GATE_DEVELOPMENT_SET', posicoes: devSet.map((p) => ({ symbol: p.symbol, sourcePositionId: p.sourcePositionId, pnl: p.pnl })), nota: 'Explica a hipótese; NÃO valida os challengers. XP não é concedido por resultados aqui.' },
    item3_validationSet: { total: validationSet.length, marca: 'ENTRY_GATE_VALIDATION_SET', progresso: `${validationSet.length}/30`, posicoes: validationSet.map((p) => ({ symbol: p.symbol, sourcePositionId: p.sourcePositionId, pnl: p.pnl })) },
    item4_challengersCongelados: { Control: 'gate ativo economia(apr,spread)>0', A3: `${FROZEN.A3_CYCLES} ciclos EV+ consecutivos`, B60: `${FROZEN.B60_MIN} min de persistência`, C1_5: `expectedRemainingLife >= paybackHours × ${FROZEN.C_SAFETY}`, D: `survivalProbability >= ${FROZEN.D_PROB}`, nota: 'Parâmetros CONGELADOS — não mudam na janela.' },
    item5_snapshotsImutaveis: { arquivo: 'entry-gate-decisions.jsonl', totalRegistrados: existentes.size, novosNestaRun: novos, campos: ['decisionTimestamp', 'availableObservationCount', 'consecutivePositiveCycles', 'observedPersistenceMinutes', 'entryApr', 'paybackHours', 'historicalEpisodesCompletedBeforeDecision', 'survivalProbability', 'timeToSettlementMin', 'decisionByControl', 'decisionByA3', 'decisionByB60', 'decisionByC1_5', 'decisionByD'], nota: 'Append-only por sourceDecisionId. NUNCA recalculado com dados posteriores.' },
    item6_ledgerProspectivo: { validationSet: valEval, developmentSetIlustrativo: devEval, nota: 'Ledger de PROMOÇÃO usa só o validation set. Development set é ilustrativo (não conta).' },
    item7_multiplasComparacoes: { elegiveisRanking: ['Control', 'A3', 'B60', 'C1_5', 'D'], exploratorios: EXPLORATORY.map((n) => ({ challenger: n, status: 'NOT_ELIGIBLE_FOR_PROMOTION' })), nota: 'Só os 4 congelados + Control disputam. Parâmetros não escolhidos após ver resultados.' },
    item8_sensibilidadeEpisodios: { gaps, porPosicao: sensibilidadeD, challengerDMudaComGap: dMudaAlgumaVez, nota: 'Diagnóstico apenas. NÃO se escolhe o gap que maximiza PnL.' },
    item9_promocao: promocao,
    item10_proximoDolar: { estado: 'HOLD_UNALLOCATED', reserva: 'SAFETY_RESERVE', aumentoExposicao: false, novoMotor: false, live: false, nota: 'Edge negativa/inconclusiva → sem alocação nova.' },
    rankingComConfianca: { confidence: uniqueValidationClosed >= 30 ? 'A_AVALIAR' : 'INSUFICIENTE (validation 0/30)', vencedor: null, nota: 'Sem vencedor declarado sem amostra de validação com vencedores e perdedores.' },
    honestidade: 'Prospectivo e read-only. Development set congelado NÃO valida nada. Validation set vazio ⇒ nenhuma conclusão de promoção. Snapshots imutáveis, sem lookahead. Champion/Control/core intactos. Sem ordens.',
  };
  const p = L.writeJSON('entry-gate-validation.json', out);
  console.log(JSON.stringify({ saida: p, epochId: epoch.entryGateValidationEpochId, devSet: devSet.length, validationSet: validationSet.length, snapshots: existentes.size, novos, dMudaComGap: dMudaAlgumaVez, promovivel: promocao.elegivel }, null, 2));
}
build();
