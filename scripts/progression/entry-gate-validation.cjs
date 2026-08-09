#!/usr/bin/env node
'use strict';
/**
 * v1.8 — PROSPECTIVE ENTRY GATE VALIDATION (FINAL / AUDITADO). READ-ONLY, SEM ordens, SEM promoção.
 *
 * Valida PROSPECTIVAMENTE 4 challengers CONGELADOS (A3, B60, C1.5, D) + Control em oportunidades
 * NOVAS, fora da amostra que os criou (ENTRY_GATE_DEVELOPMENT_SET, 4 posições, congeladas).
 *
 * Hardening desta versão (Final Prospective Capture Audit):
 *  - CAPTURA no momento da decisão: snapshots vêm de TODA decisão de entrada (eventos `abre`),
 *    não só de fechamentos. Posições abertas viram decisões com outcome censurado. Rejeições de
 *    capacidade (`bloqueada`) são contadas como oportunidades que nunca viraram posição.
 *  - DECISION vs OUTCOME separados: decision imutável (entry-gate-decisions.jsonl, append-only por
 *    sourceDecisionId); outcome anexado depois (entry-gate-outcomes.jsonl, só terminal, append-only).
 *    Features/decisões NUNCA recalculadas após o timestamp inicial.
 *  - DEVELOPMENT SET por IDs COMPLETOS + manifestHash validado a cada execução (aborta se mudar).
 *  - EPOCH DURÁVEL: checksum + escrita atômica + backup + sequence + detecção de truncamento +
 *    recuperação após reboot (primary→backup).
 *  - IMPLEMENTAÇÕES CONGELADAS: hash de Control/A3/B60/C1.5/D/segmentação/expectedRemainingLife/
 *    survivalProbability. Se algum mudar ⇒ validationStatus = INVALIDATED_IMPLEMENTATION_CHANGED.
 *
 * NÃO usa Git para métricas de runtime. NÃO altera Champion/Control/challengers/estratégia/custos/
 * capital/risco/close/reader/WAL/checkpoint/economicForwardEpochId. Emite entry-gate-validation.json.
 */
const L = require('./lib-progression.cjs');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const OUT = path.join(L.ROOT, 'auditoria', 'progression');
const ECON = path.join(OUT, 'economic');
const POL = ['policy', 'trial', 'observer-max3', 'observer-max4', 'observer-max5'];
const NOTIONAL = L.ALVO_POR_EXCHANGE, TAKER = 0.0005, SLIP = 0.0002;
const ROUND_TRIP = L.r4(NOTIONAL * (4 * TAKER + 4 * SLIP)); // $0,28
const CUSTO_FRAC = 4 * TAKER + 4 * SLIP;
const SETTLE_MS = 8 * 3600 * 1000;
const DEFAULT_GAP = 30 * 60000;
const sha = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');

// ── amostra de desenvolvimento CONGELADA (IDs COMPLETOS) — não pode validar os challengers ──
const DEVELOPMENT_SET = {
  '47f46a65f40280821ca7b650': '1000CAT/USDT:USDT|bingx|bybit',
  '26ad5eafe675f6f5c717356b': 'SIREN/USDT:USDT|bybit|bitget',
  '5660bbac719e3abaab2ef359': 'LA/USDT:USDT|bitget|bybit',
  '29836066334187a23736ae7c': 'LA/USDT:USDT|bingx|bybit',
};
const DEV_MANIFEST = Object.keys(DEVELOPMENT_SET).slice().sort();
const DEV_MANIFEST_HASH = sha(DEV_MANIFEST.join('|'));
const FROZEN = { A3_CYCLES: 3, B60_MIN: 60, C_SAFETY: 1.5, D_PROB: 0.5 };
const EXPLORATORY = ['A_consecutive_2', 'A_consecutive_4', 'B_persistence_15min', 'B_persistence_30min', 'B_persistence_120min', 'C_paybackSurvival_1x', 'C_paybackSurvival_1.25x', 'C_paybackSurvival_2x', 'E_settlementProximity_4h'];

// ═══ implementações CONGELADAS (funções nomeadas p/ hashing individual) ═══
const economia = (apr, spread) => apr * 24 / 8760 - (CUSTO_FRAC + Math.max(0, spread || 0));
const paybackHours = (apr) => apr > 0 ? L.r2(ROUND_TRIP / (NOTIONAL * apr / 8760)) : Infinity;
function segmentEpisodes(obs, gapMs) { const eps = []; let cur = null; for (const o of obs) { if (!cur || o.ts - cur.last > gapMs) { if (cur) eps.push(cur); cur = { first: o.ts, last: o.ts }; } cur.last = o.ts; } if (cur) eps.push(cur); return eps; }
function expectedRemainingLife(vidasH) { return vidasH.length ? L.r2(vidasH.slice().sort((a, b) => a - b)[Math.floor(vidasH.length / 2)]) : 0; }
function survivalProbability(vidasH, pb) { return vidasH.length ? L.r2(vidasH.filter((v) => v >= pb).length / vidasH.length) : 0; }
function controlDecide(m, spread) { return economia(m.entryApr, spread) > 0; }
function a3Decide(m) { return m.consecutivePositiveCycles >= FROZEN.A3_CYCLES; }
function b60Decide(m) { return m.observedPersistenceMinutes >= FROZEN.B60_MIN; }
function c15Decide(m) { return m.expectedRemainingLifeH >= m.paybackHours * FROZEN.C_SAFETY; }
function dDecide(m) { return m.survivalProbability >= FROZEN.D_PROB; }
function implementationHashes() {
  return {
    economia: sha(economia.toString()), Control: sha(controlDecide.toString()),
    A3: sha(a3Decide.toString()), B60: sha(b60Decide.toString()), C1_5: sha(c15Decide.toString()), D: sha(dDecide.toString()),
    episodeSegmentation: sha(segmentEpisodes.toString()), expectedRemainingLife: sha(expectedRemainingLife.toString()),
    survivalProbability: sha(survivalProbability.toString()), frozenParams: sha(JSON.stringify(FROZEN)),
  };
}

// features de decisão (SEM lookahead) no timestamp openedAt
function features(pos, obs, gapMs) {
  const antes = obs.filter((o) => o.ts <= pos.openedAt);
  let persistMin = 0, consecEV = 0;
  for (let i = antes.length - 1; i >= 1; i--) { const c = antes[i], p = antes[i - 1];
    if (c.ts - p.ts > DEFAULT_GAP) break; if (economia(p.apr, p.spread) > 0) { consecEV++; persistMin = (pos.openedAt - p.ts) / 60000; } else break; }
  const eps = segmentEpisodes(obs, gapMs).filter((e) => e.last < pos.openedAt); // só histórico completo antes da decisão
  const vidasH = eps.map((e) => (e.last - e.first) / 3.6e6);
  const pb = paybackHours(pos.entryApr);
  const msInto = ((pos.openedAt % SETTLE_MS) + SETTLE_MS) % SETTLE_MS;
  return { availableObservationCount: antes.length, consecutivePositiveCycles: consecEV, observedPersistenceMinutes: L.r2(persistMin),
    entryApr: pos.entryApr, paybackHours: pb, historicalEpisodesCompletedBeforeDecision: eps.length,
    expectedRemainingLifeH: expectedRemainingLife(vidasH), survivalProbability: survivalProbability(vidasH, pb),
    timeToSettlementMin: L.r2((SETTLE_MS - msInto) / 60000) };
}

// ═══ persistência DURÁVEL (checksum + atômico + backup + sequence + truncamento + recovery) ═══
// primary e .bak recebem AMBOS o mesmo registro durável válido (cópias redundantes) — assim uma
// corrupção/truncamento de qualquer um dos dois é recuperável pelo outro.
function escreverAtomicoDurable(fpath, body) {
  const tmp = fpath + '.tmp'; fs.writeFileSync(tmp, body);
  try { const fd = fs.openSync(tmp, 'r+'); fs.fsyncSync(fd); fs.closeSync(fd); } catch {}
  fs.renameSync(tmp, fpath);
  try { const dfd = fs.openSync(path.dirname(fpath), 'r'); fs.fsyncSync(dfd); fs.closeSync(dfd); } catch {}
}
function writeDurable(fpath, payload, sequence) {
  const rec = { schemaVersion: 'egv.durable.v1', sequence, payload, checksum: sha(JSON.stringify(payload)), escritoEm: new Date().toISOString() };
  const body = JSON.stringify(rec, null, 2);
  escreverAtomicoDurable(fpath, body);          // primary
  escreverAtomicoDurable(fpath + '.bak', body); // backup redundante VÁLIDO
  return rec;
}
function readDurable(fpath) {
  for (const [cand, src] of [[fpath, 'PRIMARY'], [fpath + '.bak', 'BACKUP']]) {
    try { const rec = JSON.parse(fs.readFileSync(cand, 'utf8')); // JSON.parse falha => truncado
      if (rec && rec.checksum && rec.checksum === sha(JSON.stringify(rec.payload))) return { rec, source: src };
    } catch {}
  }
  return null;
}
function lerLegado(fpath) { // formato plano antigo (sem checksum) — só p/ preservar o epochId na migração
  try { const o = JSON.parse(fs.readFileSync(fpath, 'utf8')); if (o && o.entryGateValidationEpochId) return o; } catch {}
  return null;
}

function lerDiario(l) { try { return fs.readFileSync(path.join(ECON, l, 'diario.jsonl'), 'utf8').split('\n').filter(Boolean).map(JSON.parse); } catch { return []; } }
function appendJSONL(fpath, obj) { fs.appendFileSync(fpath, JSON.stringify(obj) + '\n'); }
function loadJSONL(fpath, key) { const m = new Map(); try { fs.readFileSync(fpath, 'utf8').split('\n').filter(Boolean).forEach((ln) => { const o = JSON.parse(ln); m.set(o[key], o); }); } catch {} return m; }

function build() {
  const { asOf } = L.loadChampion();
  const IMPL = implementationHashes();

  // ── item 4/3: epoch DURÁVEL + manifest hash (migra o epoch antigo preservando id/start) ──
  const epochPath = path.join(OUT, 'entry-gate-validation-epoch.json');
  let dur = readDurable(epochPath); let recovery = 'CREATED', sequence = dur ? dur.rec.sequence : 0;
  let epoch = dur ? dur.rec.payload : null;
  let manifestStatus = 'OK', validationStatus = 'ACTIVE', implChanged = [];
  if (epoch) {
    recovery = dur.source === 'PRIMARY' ? 'RECOVERED_FROM_PRIMARY' : 'RECOVERED_FROM_BACKUP';
    if (dur.source === 'BACKUP') { writeDurable(epochPath, epoch, sequence); recovery = 'RECOVERED_FROM_BACKUP'; } // repara o primary a partir do backup
  }
  if (!epoch) {
    // migração de epoch antigo (formato plano) OU criação nova — PRESERVA o epochId (primary ou .bak)
    const legado = lerLegado(epochPath) || lerLegado(epochPath + '.bak');
    const startedAt = legado ? (legado.epochStartedAt || legado.validationEpochStartMs || asOf) : asOf;
    const epochId = legado ? legado.entryGateValidationEpochId : 'egv_' + asOf;
    epoch = { entryGateValidationEpochId: epochId, epochStartedAt: startedAt, developmentManifest: DEV_MANIFEST, developmentManifestHash: DEV_MANIFEST_HASH,
      implementationHashes: IMPL, economicForwardEpochIdPreservado: true, criadoEm: new Date(asOf || 0).toISOString(),
      nota: 'Janela prospectiva. NÃO reinicia economicForwardEpochId. Decisões após epochStartedAt = ENTRY_GATE_VALIDATION_SET.' };
    dur = { rec: writeDurable(epochPath, epoch, ++sequence) }; recovery = legado ? 'MIGRATED_FROM_LEGACY' : 'CREATED';
  } else {
    // item 3: validar manifest a cada execução — ABORTAR se mudou
    if (epoch.developmentManifestHash !== DEV_MANIFEST_HASH) {
      manifestStatus = 'ABORTED_DEVELOPMENT_MANIFEST_CHANGED';
      const outAbort = { schema: 'snowball.entry-gate-validation.v1_8', geradoEm: new Date(asOf || 0).toISOString(), asOfMs: asOf, ABORTED: true, motivo: manifestStatus, esperado: epoch.developmentManifestHash, atual: DEV_MANIFEST_HASH, honestidade: 'Development manifest mudou — auditoria abortada p/ preservar integridade da amostra congelada.' };
      L.writeJSON('entry-gate-validation.json', outAbort); console.log(JSON.stringify({ ABORTED: manifestStatus })); return;
    }
    // item 5: congelar implementações — se algum hash mudou ⇒ INVALIDATED
    const base = epoch.implementationHashes || {};
    for (const k of Object.keys(IMPL)) if (base[k] && base[k] !== IMPL[k]) implChanged.push(k);
    if (implChanged.length) validationStatus = 'INVALIDATED_IMPLEMENTATION_CHANGED';
    else if (!epoch.implementationHashes) { epoch.implementationHashes = IMPL; writeDurable(epochPath, epoch, ++sequence); } // estabelece baseline uma vez
  }

  // ── coletar DECISÕES (eventos `abre`) e REJEIÇÕES (`bloqueada`) ──
  const decisoesAbre = new Map(); // por sourceDecisionId (dedup entre políticas)
  const rejeicoesPorMotivo = {}; let rejeicoesTotal = 0;
  const fechaPorPos = new Map(); // sourcePositionId -> fecha event
  for (const l of POL) { for (const e of lerDiario(l)) {
    if (e.evento === 'abre') { if (e.sourceDecisionId && !decisoesAbre.has(e.sourceDecisionId)) decisoesAbre.set(e.sourceDecisionId, { policy: l, ...e }); }
    else if (e.evento === 'fecha') { if (!fechaPorPos.has(e.sourcePositionId)) fechaPorPos.set(e.sourcePositionId, e); }
    else if (e.evento === 'bloqueada') { rejeicoesTotal++; const mv = e.motivo || 'desconhecido'; rejeicoesPorMotivo[mv] = (rejeicoesPorMotivo[mv] || 0) + 1; } } }

  // obs do feed p/ as chaves das decisões
  const chaves = new Set([...decisoesAbre.values()].map((d) => d.k));
  const obsPorChave = {}; for (const k of chaves) obsPorChave[k] = [];
  try { for (const ln of fs.readFileSync(path.join(L.ROOT, 'vigilancia', 'arquivo-observacoes.jsonl'), 'utf8').split('\n')) { if (!ln) continue; let o; try { o = JSON.parse(ln); } catch { continue; } if (chaves.has(o.k)) obsPorChave[o.k].push({ ts: o.ts, apr: o.apr, spread: o.spread || 0 }); } } catch {}
  for (const k of chaves) obsPorChave[k].sort((a, b) => a.ts - b.ts);

  // ── item 1/2: snapshots IMUTÁVEIS de decisão (append-only), capturados na ENTRADA (não no fecho) ──
  const decPath = path.join(OUT, 'entry-gate-decisions.jsonl');
  const outPath = path.join(OUT, 'entry-gate-outcomes.jsonl');
  const decExist = loadJSONL(decPath, 'sourceDecisionId');
  const outExist = loadJSONL(outPath, 'sourceDecisionId');
  let novasDecisoes = 0, novosOutcomes = 0;

  for (const [did, d] of decisoesAbre) {
    const pos = { k: d.k, symbol: (d.k || '').split('|')[0], sourceDecisionId: did, sourcePositionId: d.sourcePositionId, entryApr: d.apr, entrySpread: 0.0003, openedAt: d.ts };
    const classe = DEVELOPMENT_SET[pos.sourcePositionId] ? 'ENTRY_GATE_DEVELOPMENT_SET' : (pos.openedAt >= epoch.epochStartedAt ? 'ENTRY_GATE_VALIDATION_SET' : 'PRE_EPOCH_UNCLASSIFIED');
    if (!decExist.has(did)) { // IMUTÁVEL: escreve uma vez, no momento em que a decisão é observada
      const m = features(pos, obsPorChave[pos.k] || [], DEFAULT_GAP);
      const snap = { sourceDecisionId: did, sourcePositionId: pos.sourcePositionId, symbol: pos.symbol, exchangePair: pos.k, set: classe,
        decisionTimestamp: pos.openedAt, capturedFrom: 'ABRE_EVENT', epochId: epoch.entryGateValidationEpochId, ...m,
        decisionByControl: controlDecide(m, pos.entrySpread), decisionByA3: a3Decide(m), decisionByB60: b60Decide(m), decisionByC1_5: c15Decide(m), decisionByD: dDecide(m),
        frozenParams: FROZEN, immutable: true, capturadoEm: new Date(asOf || 0).toISOString() };
      appendJSONL(decPath, snap); decExist.set(did, snap); novasDecisoes++;
    }
    // OUTCOME separado — anexado só quando TERMINAL (fecha). Aberto = ainda censurado (sem outcome).
    const fe = fechaPorPos.get(pos.sourcePositionId);
    if (fe && !outExist.has(did)) { const be = (fe.funding || 0) >= ROUND_TRIP;
      const oc = { sourceDecisionId: did, sourcePositionId: pos.sourcePositionId, outcomeType: 'CLOSED', funding: L.r4(fe.funding || 0), realizedNetPnL: L.r4(fe.pnl || 0),
        breakEvenReached: be, winner: (fe.pnl || 0) > 0, loser: (fe.pnl || 0) < 0, closedAt: fe.positionClosedAt, closeReason: fe.closeReason, anexadoEm: new Date(asOf || 0).toISOString() };
      appendJSONL(outPath, oc); outExist.set(did, oc); novosOutcomes++;
    }
  }

  // ── item 6: contadores prospectivos ──
  const decs = [...decExist.values()];
  const conta = (f) => decs.filter((d) => d[f]).length;
  const outcomes = [...outExist.values()];
  const openDecisions = decs.filter((d) => !outExist.has(d.sourceDecisionId)); // sem outcome terminal = aberta/censurada
  const validationDecs = decs.filter((d) => d.set === 'ENTRY_GATE_VALIDATION_SET');
  const validationClosed = validationDecs.filter((d) => outExist.has(d.sourceDecisionId));
  const contadores = {
    decisionsObserved: decs.length,
    controlAccepted: conta('decisionByControl'), a3Accepted: conta('decisionByA3'), b60Accepted: conta('decisionByB60'), c15Accepted: conta('decisionByC1_5'), dAccepted: conta('decisionByD'),
    closedOutcomes: outcomes.length, openOutcomes: openDecisions.length, rightCensored: openDecisions.length,
    winners: outcomes.filter((o) => o.winner).length, losers: outcomes.filter((o) => o.loser).length,
    rejectedNeverPositioned: rejeicoesTotal, rejectedByMotivo: rejeicoesPorMotivo,
    validationProgress: `${validationClosed.length}/30`,
  };

  // ── item 8 (shadow prévio): sensibilidade de gap p/ Challenger D no development set (diagnóstico) ──
  const gaps = [15, 30, 45, 60];
  const devDecs = decs.filter((d) => d.set === 'ENTRY_GATE_DEVELOPMENT_SET');
  const sensibilidadeD = devDecs.map((d) => { const pos = { k: d.exchangePair, openedAt: d.decisionTimestamp, entryApr: d.entryApr, entrySpread: 0.0003 }; const linha = { symbol: d.symbol, spId: d.sourcePositionId.slice(0, 8), porGap: {} };
    for (const g of gaps) { const m = features(pos, obsPorChave[d.exchangePair] || [], g * 60000); linha.porGap['gap' + g] = { survivalProbability: m.survivalProbability, decisionByD: dDecide(m) }; }
    linha.decisaoMudaComGap = new Set(gaps.map((g) => linha.porGap['gap' + g].decisionByD)).size > 1; return linha; });
  const dMudaAlgumaVez = sensibilidadeD.some((l) => l.decisaoMudaComGap);

  // ── promoção (checklist honesto) ──
  const temVencEPerd = validationClosed.some((d) => outExist.get(d.sourceDecisionId).winner) && validationClosed.some((d) => outExist.get(d.sourceDecisionId).loser);
  const promocao = { elegivel: false, criterios: {
      min30Validation: { atual: validationClosed.length, exigido: 30, ok: validationClosed.length >= 30 },
      vencedoresEPerdedores: { ok: temVencEPerd }, pnlLiquidoPositivo: { ok: false }, melhoriaVsControl: { ok: false },
      winnerRetentionAceitavel: { ok: false }, segundaJanela: { ok: false }, outroRegime: { ok: false }, stressCustos: { ok: false }, concentracao: { ok: false }, aprovacaoHumana: { ok: false } },
    veredito: validationStatus !== 'ACTIVE' ? validationStatus : `Nenhum challenger promovível — validation ${validationClosed.length}/30.` };

  const out = {
    schema: 'snowball.entry-gate-validation.v1_8', geradoEm: new Date(asOf || 0).toISOString(), asOfMs: asOf,
    validationStatus, implementationChanged: implChanged, manifestStatus,
    item1_capturaNoMomentoDaDecisao: { fonte: 'eventos ABRE (não fechamentos)', novasDecisoesNestaRun: novasDecisoes, tiposCapturados: ['aceitas (abre)', 'rejeitadas/never-positioned (bloqueada, por motivo)', 'abertas (censuradas)', 'fechadas (outcome)'], rejeicoesNeverPositioned: rejeicoesTotal, nota: 'Decisão gravada quando o sourceDecisionId é observado (abre), antes do outcome. Rejeições de capacidade contadas por motivo.' },
    item2_decisionOutcomeSeparados: { decisionsFile: 'entry-gate-decisions.jsonl (imutável, append-only)', outcomesFile: 'entry-gate-outcomes.jsonl (terminal, append-only)', decisionsTotal: decExist.size, outcomesTotal: outExist.size, novosOutcomes, nota: 'Decision nunca recalculada. Outcome anexado por sourceDecisionId quando terminal.' },
    item3_developmentManifest: { ids: DEV_MANIFEST, manifestHash: DEV_MANIFEST_HASH, status: manifestStatus, validadoACadaRun: true, abortaSeMudar: true },
    item4_epochDurabilidade: { entryGateValidationEpochId: epoch.entryGateValidationEpochId, epochStartedAt: epoch.epochStartedAt, recovery, sequence, checksum: dur.rec ? dur.rec.checksum : sha(JSON.stringify(epoch)), protecoes: ['checksum', 'escrita_atomica', 'backup(.bak)', 'sequence', 'deteccao_truncamento(JSON.parse)', 'recuperacao_reboot(primary->backup)'], economicForwardEpochIdPreservado: true },
    item5_implementationHashes: { atual: IMPL, baseline: epoch.implementationHashes || IMPL, changed: implChanged, validationStatus },
    item6_contadores: contadores,
    item7_multiplasComparacoes: { elegiveis: ['Control', 'A3', 'B60', 'C1_5', 'D'], exploratorios: EXPLORATORY.map((n) => ({ challenger: n, status: 'NOT_ELIGIBLE_FOR_PROMOTION' })) },
    item8_sensibilidadeEpisodios: { gaps, porPosicao: sensibilidadeD, challengerDMudaComGap: dMudaAlgumaVez, nota: 'Diagnóstico. Não se escolhe o gap que maximiza PnL.' },
    promocao,
    proximoDolar: { estado: 'HOLD_UNALLOCATED', reserva: 'SAFETY_RESERVE', aumentoExposicao: false, novoMotor: false, live: false },
    codigoCongelado: { congelado: true, nota: 'Após esta auditoria o código está congelado — sem novos filtros. A validação prospectiva coleta oportunidades novas.' },
    honestidade: `Read-only. Captura na decisão (abre), decision/outcome separados e imutáveis, sem lookahead. Development set congelado por manifestHash. Epoch durável. Implementações hasheadas. validation ${validationClosed.length}/30 ⇒ sem promoção. Champion/Control/core intactos. Sem ordens.`,
  };
  const p = L.writeJSON('entry-gate-validation.json', out);
  console.log(JSON.stringify({ saida: p, validationStatus, manifestStatus, recovery, sequence, contadores, novasDecisoes, novosOutcomes, dMudaComGap: dMudaAlgumaVez }, null, 2));
}
build();
