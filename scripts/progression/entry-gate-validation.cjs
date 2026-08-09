#!/usr/bin/env node
'use strict';
/**
 * v1.8 — PROSPECTIVE ENTRY GATE VALIDATION (runtime supervisionado). READ-ONLY, SEM ordens, SEM
 * promoção. Mantém o capturador prospectivo continuamente ativo e acumula decisões novas.
 *
 * TAXONOMIA DE CAPTURA:
 *  - INLINE_NATIVE ............. capturada nativamente pelo reader no instante da decisão (o reader
 *                               congelado NÃO emite decisões de challenger ⇒ nunca ocorre aqui;
 *                               slot reservado).
 *  - EVENT_CAPTURED_FRESH ...... capturada do diário dentro da janela fresca (captureDelayMs <=
 *                               freshWindow) com outcome desconhecido. SÓ ESTA conta p/ validation.
 *  - CAPTURE_MISSED_DURING_DOWNTIME  decisão que ocorreu com o capturador parado. NÃO elegível.
 *  - POST_HOC_RECONSTRUCTION ... reconstruída do diário depois do fato. NÃO elegível.
 *
 * Single-instance (lock+heartbeat), auto-detecção de downtime (gap do próprio heartbeat na volta),
 * janela fresca CONGELADA na epoch. Decision imutável; outcome terminal anexado depois. Bloqueios de
 * capacidade separados (capacityBlockedUniqueKeysApprox — SEM identidade causal) e NUNCA usados no
 * ranking. Epoch durável só MONITORADA (sem testes destrutivos na epoch real). Implementações
 * congeladas por hash.
 *
 * NÃO altera Control/A3/B60/C1.5/D/parâmetros/segmentação/expectedRemainingLife/survivalProbability/
 * manifest/entryGateValidationEpochId/Champion/estratégia/custos/risco/capital/close/
 * economicForwardEpochId. Uso: node entry-gate-validation.cjs [--daemon] [--intervalo 120] [--once]
 */
const L = require('./lib-progression.cjs');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const OUT = path.join(L.ROOT, 'auditoria', 'progression');
const ECON = path.join(OUT, 'economic');
const CAPDIR = path.join(ECON, 'entry-gate-capturer');
const POL = ['policy', 'trial', 'observer-max3', 'observer-max4', 'observer-max5'];
const NOTIONAL = L.ALVO_POR_EXCHANGE, TAKER = 0.0005, SLIP = 0.0002;
const ROUND_TRIP = L.r4(NOTIONAL * (4 * TAKER + 4 * SLIP)); // $0,28
const CUSTO_FRAC = 4 * TAKER + 4 * SLIP;
const SETTLE_MS = 8 * 3600 * 1000;
const DEFAULT_GAP = 30 * 60000;
const FRESH_WINDOW_MS_DEFAULT = 5 * 60000; // fallback; o valor CONGELADO vem da epoch
const sha = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');
const args = process.argv.slice(2);
const optArg = (n, d) => (args.includes(n) ? args[args.indexOf(n) + 1] : d);
const DAEMON = args.includes('--daemon');
const ONCE = args.includes('--once');
const INTERVALO_S = Number(optArg('--intervalo', 120));
const DOWNTIME_THRESHOLD_MS = Math.max(4 * 60000, INTERVALO_S * 1000 * 2); // gap > 2 ciclos = downtime

// ── amostra de desenvolvimento CONGELADA (IDs COMPLETOS) ──
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
  return { economia: sha(economia.toString()), Control: sha(controlDecide.toString()), A3: sha(a3Decide.toString()), B60: sha(b60Decide.toString()), C1_5: sha(c15Decide.toString()), D: sha(dDecide.toString()),
    episodeSegmentation: sha(segmentEpisodes.toString()), expectedRemainingLife: sha(expectedRemainingLife.toString()), survivalProbability: sha(survivalProbability.toString()), frozenParams: sha(JSON.stringify(FROZEN)) };
}
function features(pos, obs, gapMs) {
  const antes = obs.filter((o) => o.ts <= pos.openedAt);
  let persistMin = 0, consecEV = 0;
  for (let i = antes.length - 1; i >= 1; i--) { const c = antes[i], p = antes[i - 1];
    if (c.ts - p.ts > DEFAULT_GAP) break; if (economia(p.apr, p.spread) > 0) { consecEV++; persistMin = (pos.openedAt - p.ts) / 60000; } else break; }
  const eps = segmentEpisodes(obs, gapMs).filter((e) => e.last < pos.openedAt);
  const vidasH = eps.map((e) => (e.last - e.first) / 3.6e6);
  const pb = paybackHours(pos.entryApr);
  const msInto = ((pos.openedAt % SETTLE_MS) + SETTLE_MS) % SETTLE_MS;
  return { availableObservationCount: antes.length, consecutivePositiveCycles: consecEV, observedPersistenceMinutes: L.r2(persistMin),
    entryApr: pos.entryApr, paybackHours: pb, historicalEpisodesCompletedBeforeDecision: eps.length,
    expectedRemainingLifeH: expectedRemainingLife(vidasH), survivalProbability: survivalProbability(vidasH, pb), timeToSettlementMin: L.r2((SETTLE_MS - msInto) / 60000) };
}

// ═══ persistência DURÁVEL ═══
function escreverAtomicoDurable(fpath, body) { const tmp = fpath + '.tmp'; fs.writeFileSync(tmp, body);
  try { const fd = fs.openSync(tmp, 'r+'); fs.fsyncSync(fd); fs.closeSync(fd); } catch {} fs.renameSync(tmp, fpath);
  try { const dfd = fs.openSync(path.dirname(fpath), 'r'); fs.fsyncSync(dfd); fs.closeSync(dfd); } catch {} }
function writeDurable(fpath, payload, sequence) { const rec = { schemaVersion: 'egv.durable.v1', sequence, payload, checksum: sha(JSON.stringify(payload)), escritoEm: new Date().toISOString() };
  const body = JSON.stringify(rec, null, 2); escreverAtomicoDurable(fpath, body); escreverAtomicoDurable(fpath + '.bak', body); return rec; }
function readDurable(fpath) { for (const [cand, src] of [[fpath, 'PRIMARY'], [fpath + '.bak', 'BACKUP']]) {
    try { const rec = JSON.parse(fs.readFileSync(cand, 'utf8')); if (rec && rec.checksum && rec.checksum === sha(JSON.stringify(rec.payload))) return { rec, source: src }; } catch {} } return null; }
function lerLegado(fpath) { try { const o = JSON.parse(fs.readFileSync(fpath, 'utf8')); if (o && o.entryGateValidationEpochId) return o; } catch {} return null; }
function lerDiario(l) { try { return fs.readFileSync(path.join(ECON, l, 'diario.jsonl'), 'utf8').split('\n').filter(Boolean).map(JSON.parse); } catch { return []; } }
function appendJSONL(fpath, obj) { fs.appendFileSync(fpath, JSON.stringify(obj) + '\n'); }
function loadJSONL(fpath, key) { const m = new Map(); try { fs.readFileSync(fpath, 'utf8').split('\n').filter(Boolean).forEach((ln) => { const o = JSON.parse(ln); if (key) m.set(o[key], o); }); } catch {} return m; }
function loadJSONLArr(fpath) { try { return fs.readFileSync(fpath, 'utf8').split('\n').filter(Boolean).map(JSON.parse); } catch { return []; } }

// ── epoch durável + freshness CONGELADA + manifest + impl hashes ──
function carregarEpoch(asOf, IMPL) {
  const epochPath = path.join(OUT, 'entry-gate-validation-epoch.json');
  let dur = readDurable(epochPath); let recovery = 'CREATED', sequence = dur ? dur.rec.sequence : 0;
  let epoch = dur ? dur.rec.payload : null; let manifestStatus = 'OK', validationStatus = 'ACTIVE', implChanged = [];
  if (epoch) { recovery = dur.source === 'PRIMARY' ? 'RECOVERED_FROM_PRIMARY' : 'RECOVERED_FROM_BACKUP';
    if (dur.source === 'BACKUP') { writeDurable(epochPath, epoch, sequence); recovery = 'RECOVERED_FROM_BACKUP'; } }
  if (!epoch) { const legado = lerLegado(epochPath) || lerLegado(epochPath + '.bak');
    epoch = { entryGateValidationEpochId: legado ? legado.entryGateValidationEpochId : 'egv_' + asOf, epochStartedAt: legado ? (legado.epochStartedAt || legado.validationEpochStartMs || asOf) : asOf,
      developmentManifest: DEV_MANIFEST, developmentManifestHash: DEV_MANIFEST_HASH, implementationHashes: IMPL, freshnessWindowMs: FRESH_WINDOW_MS_DEFAULT, economicForwardEpochIdPreservado: true, criadoEm: new Date(asOf || 0).toISOString() };
    dur = { rec: writeDurable(epochPath, epoch, ++sequence) }; recovery = legado ? 'MIGRATED_FROM_LEGACY' : 'CREATED';
  } else {
    if (epoch.developmentManifestHash !== DEV_MANIFEST_HASH) manifestStatus = 'ABORTED_DEVELOPMENT_MANIFEST_CHANGED';
    else { const base = epoch.implementationHashes || {}; for (const k of Object.keys(IMPL)) if (base[k] && base[k] !== IMPL[k]) implChanged.push(k);
      if (implChanged.length) validationStatus = 'INVALIDATED_IMPLEMENTATION_CHANGED';
      else { let mudou = false; if (!epoch.implementationHashes) { epoch.implementationHashes = IMPL; mudou = true; }
        if (epoch.freshnessWindowMs == null) { epoch.freshnessWindowMs = FRESH_WINDOW_MS_DEFAULT; mudou = true; } // congela a janela fresca UMA vez
        if (mudou) writeDurable(epochPath, epoch, ++sequence); } }
  }
  return { epochPath, epoch, recovery, sequence, manifestStatus, validationStatus, implChanged, checksum: dur.rec ? dur.rec.checksum : sha(JSON.stringify(epoch)), freshWindow: epoch.freshnessWindowMs || FRESH_WINDOW_MS_DEFAULT };
}

// ── captura (append-only, imutável) com TAXONOMIA + downtime ──
function capturar(epoch, freshWindow, downtimes, obsCache) {
  const decPath = path.join(OUT, 'entry-gate-decisions.jsonl');
  const outPath = path.join(OUT, 'entry-gate-outcomes.jsonl');
  const decExist = loadJSONL(decPath, 'sourceDecisionId');
  const outExist = loadJSONL(outPath, 'sourceDecisionId');
  const abre = new Map(); const fechaPorPos = new Map();
  const cap = { raw: {}, uniqueK: {} };
  for (const l of POL) for (const e of lerDiario(l)) {
    if (e.evento === 'abre') { if (e.sourceDecisionId && !abre.has(e.sourceDecisionId)) abre.set(e.sourceDecisionId, { policy: l, ...e }); }
    else if (e.evento === 'fecha') { if (!fechaPorPos.has(e.sourcePositionId)) fechaPorPos.set(e.sourcePositionId, e); }
    else if (e.evento === 'bloqueada') { const mv = e.motivo || 'desconhecido'; cap.raw[mv] = (cap.raw[mv] || 0) + 1; (cap.uniqueK[mv] = cap.uniqueK[mv] || new Set()).add(e.k); }
  }
  const chaves = new Set([...abre.values()].map((d) => d.k));
  const precisaFeed = [...chaves].some((k) => obsCache[k] == null);
  if (precisaFeed) { for (const k of chaves) obsCache[k] = obsCache[k] || [];
    try { for (const ln of fs.readFileSync(path.join(L.ROOT, 'vigilancia', 'arquivo-observacoes.jsonl'), 'utf8').split('\n')) { if (!ln) continue; let o; try { o = JSON.parse(ln); } catch { continue; } if (chaves.has(o.k)) obsCache[o.k].push({ ts: o.ts, apr: o.apr, spread: o.spread || 0 }); } } catch {}
    for (const k of chaves) if (obsCache[k]) obsCache[k].sort((a, b) => a.ts - b.ts); }

  const emDowntime = (t) => downtimes.some((d) => t >= d.downtimeStartMs && t <= d.restartedAtMs);
  let novasDecisoes = 0, novosOutcomes = 0;
  for (const [did, d] of abre) {
    const pos = { k: d.k, symbol: (d.k || '').split('|')[0], sourceDecisionId: did, sourcePositionId: d.sourcePositionId, entryApr: d.apr, entrySpread: 0.0003, openedAt: d.ts };
    const classe = DEVELOPMENT_SET[pos.sourcePositionId] ? 'ENTRY_GATE_DEVELOPMENT_SET' : (pos.openedAt >= epoch.epochStartedAt ? 'ENTRY_GATE_VALIDATION_SET' : 'PRE_EPOCH_UNCLASSIFIED');
    if (!decExist.has(did)) {
      const capturedAt = Date.now();
      const eventWrittenAt = d.ts;               // o diário só carrega ts (== decisão == escrita do evento)
      const captureDelayMs = capturedAt - eventWrittenAt;
      const fe = fechaPorPos.get(pos.sourcePositionId); const closedAt = fe ? fe.positionClosedAt : null;
      const outcomeKnown = closedAt != null && closedAt <= capturedAt;
      let captureMode;
      if (captureDelayMs <= freshWindow && !outcomeKnown) captureMode = 'EVENT_CAPTURED_FRESH';
      else if (emDowntime(eventWrittenAt)) captureMode = 'CAPTURE_MISSED_DURING_DOWNTIME';
      else captureMode = 'POST_HOC_RECONSTRUCTION';
      const m = features(pos, obsCache[pos.k] || [], DEFAULT_GAP);
      const snap = { sourceDecisionId: did, sourcePositionId: pos.sourcePositionId, symbol: pos.symbol, exchangePair: pos.k, set: classe,
        decisionTimestamp: pos.openedAt, eventWrittenAt, capturedAt, captureDelayMs, captureMode, outcomeAlreadyKnownAtCapture: outcomeKnown,
        validationEligible: captureMode === 'EVENT_CAPTURED_FRESH', epochId: epoch.entryGateValidationEpochId, ...m,
        decisionByControl: controlDecide(m, pos.entrySpread), decisionByA3: a3Decide(m), decisionByB60: b60Decide(m), decisionByC1_5: c15Decide(m), decisionByD: dDecide(m),
        frozenParams: FROZEN, immutable: true };
      appendJSONL(decPath, snap); decExist.set(did, snap); novasDecisoes++;
    }
    const fe = fechaPorPos.get(pos.sourcePositionId);
    if (fe && !outExist.has(did)) { const oc = { sourceDecisionId: did, sourcePositionId: pos.sourcePositionId, outcomeType: 'CLOSED', funding: L.r4(fe.funding || 0), realizedNetPnL: L.r4(fe.pnl || 0),
        breakEvenReached: (fe.funding || 0) >= ROUND_TRIP, winner: (fe.pnl || 0) > 0, loser: (fe.pnl || 0) < 0, closedAt: fe.positionClosedAt, closeReason: fe.closeReason };
      appendJSONL(outPath, oc); outExist.set(did, oc); novosOutcomes++; }
  }
  const capacityBuckets = {
    entryGateValidationDecisions: [...decExist.values()].filter((r) => r.set === 'ENTRY_GATE_VALIDATION_SET').length,
    capacityBlockedRawEvents: cap.raw.maxPositionsBlocked || 0,
    capacityBlockedUniqueKeysApprox: cap.uniqueK.maxPositionsBlocked ? cap.uniqueK.maxPositionsBlocked.size : 0, // SEM identidade causal — só chaves únicas
    balanceBlockedKeysApprox: cap.uniqueK.localBalanceBlocked ? cap.uniqueK.localBalanceBlocked.size : 0,
    evRejectedKeysApprox: Object.keys(cap.raw).filter((mv) => /ev|apr|economia/i.test(mv)).reduce((s, mv) => s + (cap.uniqueK[mv] ? cap.uniqueK[mv].size : 0), 0),
    rawByMotivo: cap.raw, nota: 'Bloqueios de capacidade NÃO têm sourceDecisionId (aprox por chave). NUNCA entram no ranking dos filtros.',
  };
  return { decExist, outExist, novasDecisoes, novosOutcomes, capacityBuckets };
}

function outcomeState(rec, outExist, validationStatus) {
  if (validationStatus !== 'ACTIVE') return 'INVALIDATED';
  const fresh = rec.captureMode === 'EVENT_CAPTURED_FRESH' || rec.captureMode === 'INLINE'; // compat legado 'INLINE'
  if (rec.captureMode === 'CAPTURE_MISSED_DURING_DOWNTIME') return 'CAPTURE_MISSED_DURING_DOWNTIME';
  if (!fresh) return 'POST_HOC_RECONSTRUCTION';
  return outExist.has(rec.sourceDecisionId) ? 'CLOSED' : 'RIGHT_CENSORED';
}
const pct = (arr, p) => { if (!arr.length) return null; const s = arr.slice().sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(p / 100 * s.length))]; };

// ── runtime do capturador (heartbeat, downtime, restarts do supervisor) ──
function lerHeartbeat() { return L.rd(path.join(CAPDIR, 'heartbeat.json'), null); }
function registrarDowntimeNaVolta() { // auto-detecção: gap do próprio heartbeat > threshold ⇒ estivemos parados
  const prev = lerHeartbeat(); const agora = Date.now();
  if (prev && prev.ultimoCiclo && (agora - prev.ultimoCiclo) > DOWNTIME_THRESHOLD_MS) {
    try { fs.mkdirSync(CAPDIR, { recursive: true }); } catch {}
    appendJSONL(path.join(CAPDIR, 'downtime.jsonl'), { downtimeStartMs: prev.ultimoCiclo, restartedAtMs: agora, downtimeMs: agora - prev.ultimoCiclo, detectedBy: 'capturer-restart-gap' });
  }
}
function runtimeCapturador(validationStatus) {
  const hb = lerHeartbeat(); const downtimes = loadJSONLArr(path.join(CAPDIR, 'downtime.jsonl'));
  const sup = L.rd(path.join(ECON, 'supervisor-economic-status.json'), null);
  const supCap = sup && sup.processos ? sup.processos.capturer : null;
  const idadeS = hb && hb.ultimoCiclo ? Math.round((Date.now() - hb.ultimoCiclo) / 1000) : null;
  return { capturerState: supCap ? supCap.estado : (hb && idadeS != null && idadeS < 900 ? 'HEALTHY' : (hb ? 'STALE' : 'NOT_RUNNING')),
    capturerUptimeMin: hb && hb.startedAt ? Math.round((Date.now() - hb.startedAt) / 60000) : null,
    capturerRestarts: supCap ? supCap.restarts : null,
    captureDowntime: { janelas: downtimes.length, totalMs: downtimes.reduce((s, d) => s + (d.downtimeMs || 0), 0), ultimas: downtimes.slice(-3) },
    heartbeat: hb ? { pid: hb.pid, idadeS, vivo: idadeS != null && idadeS < 900 } : null, downtimes };
}

function gerarRelatorio(asOf) {
  const IMPL = implementationHashes();
  const E = carregarEpoch(asOf, IMPL);
  if (E.manifestStatus !== 'OK') { const o = { schema: 'snowball.entry-gate-validation.v1_8', geradoEm: new Date(asOf || 0).toISOString(), asOfMs: asOf, ABORTED: true, motivo: E.manifestStatus, honestidade: 'Development manifest mudou — auditoria abortada.' }; L.writeJSON('entry-gate-validation.json', o); return { aborted: E.manifestStatus }; }
  const rt = runtimeCapturador(E.validationStatus);
  const cap = capturar(E.epoch, E.freshWindow, rt.downtimes, gerarRelatorio._obs || (gerarRelatorio._obs = {}));
  const decs = [...cap.decExist.values()]; const outs = cap.outExist;
  const isFresh = (r) => r.captureMode === 'EVENT_CAPTURED_FRESH' || r.captureMode === 'INLINE';

  const elegiveis = decs.filter((r) => isFresh(r) && r.set === 'ENTRY_GATE_VALIDATION_SET' && !r.outcomeAlreadyKnownAtCapture);
  const postHoc = decs.filter((r) => !isFresh(r) && r.captureMode !== 'CAPTURE_MISSED_DURING_DOWNTIME');
  const missed = decs.filter((r) => r.captureMode === 'CAPTURE_MISSED_DURING_DOWNTIME');
  const freshDecisions = decs.filter(isFresh);

  const estados = { OPEN: 0, CLOSED: 0, RIGHT_CENSORED: 0, INVALIDATED: 0, POST_HOC_RECONSTRUCTION: 0, CAPTURE_MISSED_DURING_DOWNTIME: 0 };
  for (const r of decs) { const s = outcomeState(r, outs, E.validationStatus); estados[s]++; if (s === 'RIGHT_CENSORED') estados.OPEN++; }

  const eligClosed = elegiveis.filter((r) => outs.has(r.sourceDecisionId));
  const eligWinners = eligClosed.filter((r) => outs.get(r.sourceDecisionId).winner).length;
  const eligLosers = eligClosed.filter((r) => outs.get(r.sourceDecisionId).loser).length;
  const FILTROS = ['Control', 'A3', 'B60', 'C1_5', 'D']; const campo = { Control: 'decisionByControl', A3: 'decisionByA3', B60: 'decisionByB60', C1_5: 'decisionByC1_5', D: 'decisionByD' };
  const porFiltro = {};
  for (const f of FILTROS) { const acc = eligClosed.filter((r) => r[campo[f]]); const rej = eligClosed.filter((r) => !r[campo[f]]);
    const pnl = L.r4(acc.reduce((s, r) => s + (outs.get(r.sourceDecisionId).realizedNetPnL || 0), 0));
    const capH = L.r2(acc.reduce((s, r) => { const oc = outs.get(r.sourceDecisionId); return s + Math.max(0, (oc.closedAt - r.decisionTimestamp) / 3.6e6) * 2 * NOTIONAL; }, 0));
    const winnersTot = eligWinners; const winnersRej = rej.filter((r) => outs.get(r.sourceDecisionId).winner).length; const lossesAvoided = rej.filter((r) => outs.get(r.sourceDecisionId).loser).length;
    porFiltro[f] = { realizedNetPnL: pnl, capitalHours: capH, lossesAvoided, winnersRejected: winnersRej, winnerRetention: winnersTot > 0 ? L.r2((winnersTot - winnersRej) / winnersTot) : null, rejectionPrecision: rej.length ? L.r2(lossesAvoided / rej.length) : null }; }
  const delays = freshDecisions.map((r) => r.captureDelayMs).filter((x) => x != null);

  const relatorioDiario = {
    capturerState: rt.capturerState, capturerUptimeMin: rt.capturerUptimeMin, capturerRestarts: rt.capturerRestarts, captureDowntime: rt.captureDowntime,
    newFreshDecisions: freshDecisions.length, postHocDecisions: postHoc.length, missedDuringDowntime: missed.length,
    captureDelayP50Ms: pct(delays, 50), captureDelayP95Ms: pct(delays, 95),
    validationDecisionsObserved: elegiveis.length,
    controlAccepted: elegiveis.filter((r) => r.decisionByControl).length, a3Accepted: elegiveis.filter((r) => r.decisionByA3).length, b60Accepted: elegiveis.filter((r) => r.decisionByB60).length, c15Accepted: elegiveis.filter((r) => r.decisionByC1_5).length, dAccepted: elegiveis.filter((r) => r.decisionByD).length,
    openValidationOutcomes: elegiveis.length - eligClosed.length, closedValidationOutcomes: eligClosed.length, winners: eligWinners, losers: eligLosers,
    pnlPorFiltro: Object.fromEntries(FILTROS.map((f) => [f, porFiltro[f].realizedNetPnL])), capitalHoursPorFiltro: Object.fromEntries(FILTROS.map((f) => [f, porFiltro[f].capitalHours])),
    winnerRetention: Object.fromEntries(FILTROS.map((f) => [f, porFiltro[f].winnerRetention])), rejectionPrecision: Object.fromEntries(FILTROS.map((f) => [f, porFiltro[f].rejectionPrecision])),
    validationProgress: `${eligClosed.length}/30`,
  };

  const out = {
    schema: 'snowball.entry-gate-validation.v1_8', geradoEm: new Date(asOf || 0).toISOString(), asOfMs: asOf,
    validationStatus: E.validationStatus, manifestStatus: E.manifestStatus, implementationChanged: E.implChanged,
    item1_supervisao: { supervisor: 'supervisor-economic (worker `capturer`)', capturerState: rt.capturerState, restarts: rt.capturerRestarts, heartbeat: rt.heartbeat, singleInstance: true, staleDetection: true, backoff: true, duplicateDetection: true, downtimeRegistrado: rt.captureDowntime },
    item2_taxonomia: { modos: ['INLINE_NATIVE', 'EVENT_CAPTURED_FRESH', 'CAPTURE_MISSED_DURING_DOWNTIME', 'POST_HOC_RECONSTRUCTION'], soContaValidation: 'EVENT_CAPTURED_FRESH com outcome desconhecido', totalDecisions: decs.length, freshEligible: elegiveis.length, postHoc: postHoc.length, missedDuringDowntime: missed.length, novasNestaRun: cap.novasDecisoes, nota: 'INLINE_NATIVE reservado (reader congelado não emite decisões de challenger). As atuais são POST_HOC.' },
    item3_janelaFresca: { freshnessWindowMsCongelada: E.freshWindow, campos: ['decisionTimestamp', 'eventWrittenAt', 'capturedAt', 'captureDelayMs', 'outcomeAlreadyKnownAtCapture'], congeladaNaEpoch: true, naoModificarNaJanela: true },
    item4_downtime: { janelas: rt.captureDowntime.janelas, totalMs: rt.captureDowntime.totalMs, missedDuringDowntime: missed.map((r) => ({ sourceDecisionId: r.sourceDecisionId, atrasoMs: r.captureDelayMs, set: r.set })), regra: 'CAPTURE_MISSED_DURING_DOWNTIME nunca é reconstruído como elegível; excluído da validação.' },
    item5_bloqueios: cap.capacityBuckets,
    item6_relatorioDiario: relatorioDiario,
    item7_gate: { elegivelPromo: eligClosed.length >= 30 && eligWinners > 0 && eligLosers > 0, criterios: { min30OutcomesFechados: eligClosed.length >= 30, vencedoresEPerdedores: eligWinners > 0 && eligLosers > 0, pnlSuperiorControl: false, retencaoAceitavel: false, segundaJanela: false, outroRegime: false, stress: false, concentracao: false, aprovacaoHumana: false }, veredito: E.validationStatus !== 'ACTIVE' ? E.validationStatus : `Sem promoção — ${eligClosed.length}/30 outcomes prospectivos fechados.` },
    durabilidade: { entryGateValidationEpochId: E.epoch.entryGateValidationEpochId, epochStartedAt: E.epoch.epochStartedAt, checksum: E.checksum, sequence: E.sequence, recoverySource: E.recovery, manifestHash: E.epoch.developmentManifestHash, implementationHashes: IMPL, freshnessWindowMsCongelada: E.freshWindow, monitorApenas: true, testesDestrutivos: 'só em cópia temporária — NUNCA na epoch real' },
    multiplasComparacoes: { elegiveis: FILTROS, exploratorios: EXPLORATORY.map((n) => ({ challenger: n, status: 'NOT_ELIGIBLE_FOR_PROMOTION' })) },
    proximoDolar: { estado: 'HOLD_UNALLOCATED', reserva: 'SAFETY_RESERVE', aumentoExposicao: false, novoMotor: false, live: false },
    honestidade: `Capturador supervisionado. ${elegiveis.length} decisões EVENT_CAPTURED_FRESH elegíveis, ${postHoc.length} post-hoc, ${missed.length} missed-during-downtime. validation ${eligClosed.length}/30 ⇒ sem promoção. Bloqueios de capacidade separados (aprox por chave, fora do ranking). Champion/Control/core intactos. Sem ordens.`,
  };
  L.writeJSON('entry-gate-validation.json', out);
  return { validationStatus: E.validationStatus, manifestStatus: E.manifestStatus, recovery: E.recovery, decisionsObserved: decs.length, freshEligible: elegiveis.length, postHoc: postHoc.length, missed: missed.length, novasDecisoes: cap.novasDecisoes, validationProgress: relatorioDiario.validationProgress, capturerState: rt.capturerState };
}

function heartbeat(r, startedAt) { try { fs.mkdirSync(CAPDIR, { recursive: true }); } catch {}
  const body = { pid: process.pid, label: 'entry-gate-capturer', modo: 'event-captured-fresh', startedAt, ultimoCiclo: Date.now(), intervaloS: INTERVALO_S,
    decisionsObserved: r.decisionsObserved, freshEligible: r.freshEligible, postHoc: r.postHoc, missed: r.missed, novasDecisoes: r.novasDecisoes, validationProgress: r.validationProgress, validationStatus: r.validationStatus };
  try { escreverAtomicoDurable(path.join(CAPDIR, 'heartbeat.json'), JSON.stringify(body, null, 2)); } catch {} }

// single-instance: heartbeat fresco (< 90s) E pid REALMENTE vivo. Verificar o pid evita falso
// "duplicate" após crash (heartbeat ainda fresco, processo morto) que bloquearia o auto-restart.
function pidVivo(pid) { if (!pid || pid === process.pid) return false; try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } }
function outraInstanciaViva() { const hb = lerHeartbeat(); return !!(hb && hb.ultimoCiclo && hb.pid !== process.pid && (Date.now() - hb.ultimoCiclo) < 90000 && pidVivo(hb.pid)); }

async function main() {
  const asOf = () => { const { asOf } = L.loadChampion(); return asOf; };
  if (DAEMON) {
    if (outraInstanciaViva()) { process.stdout.write(JSON.stringify({ daemon: false, motivo: 'DUPLICATE_INSTANCE — outro capturador vivo, saindo' }) + '\n'); return; }
    registrarDowntimeNaVolta(); // auto-detecta se ficamos parados desde o último heartbeat
    const startedAt = Date.now();
    process.stdout.write(JSON.stringify({ daemon: true, intervaloS: INTERVALO_S, pid: process.pid, startedAt }) + '\n');
    for (;;) { const r = gerarRelatorio(asOf()); heartbeat(r, startedAt); if (ONCE) break; await new Promise((res) => setTimeout(res, INTERVALO_S * 1000)); }
    return;
  }
  console.log(JSON.stringify(gerarRelatorio(asOf()), null, 2));
}
main();
