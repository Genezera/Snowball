#!/usr/bin/env node
'use strict';
/**
 * v1.8 — PROSPECTIVE ENTRY GATE VALIDATION (execução da coleta congelada). READ-ONLY, SEM ordens,
 * SEM promoção. Mantém a captura prospectiva funcionando e acumula decisões/outcomes novos.
 *
 * INLINE vs POST-HOC (o ponto central): uma decisão só conta p/ validation se foi capturada ANTES
 * do outcome (capturedAt < closedAt E outcomeAlreadyKnownAtCapture=false) e de forma FRESCA
 * (dentro de ~1 ciclo econômico do decisionTimestamp). Decisões reconstruídas do diário depois do
 * fato são marcadas POST_HOC_RECONSTRUCTION_NOT_VALIDATION_ELIGIBLE — HONESTO: hoje as 14 decisões
 * existentes são todas post-hoc ⇒ 0 elegíveis. O capturador (--daemon) roda em intervalo < ciclo
 * econômico e carimba capturas novas inline.
 *
 * Decision imutável (entry-gate-decisions.jsonl, append-only por sourceDecisionId, features nunca
 * recalculadas). Outcome terminal anexado depois (entry-gate-outcomes.jsonl). Rejeições de
 * capacidade NÃO viram oportunidades únicas (separadas em baldes). Epoch durável (checksum/atômico/
 * backup/sequence/truncamento/recovery) — SEM testes destrutivos na epoch real. Implementações
 * congeladas por hash; divergência ⇒ INVALIDATED_IMPLEMENTATION_CHANGED.
 *
 * NÃO altera Control/A3/B60/C1.5/D/segmentação/expectedRemainingLife/survivalProbability/manifest/
 * entryGateValidationEpochId/Champion/estratégia/custos/risco/capital/close/economicForwardEpochId.
 * Uso: node entry-gate-validation.cjs [--daemon] [--intervalo 120] [--once]
 * Emite auditoria/progression/entry-gate-validation.json (+ heartbeat próprio no modo daemon).
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
const FRESH_WINDOW_MS = 5 * 60000; // captura "inline" = dentro de ~1 ciclo econômico (5 min) da decisão
const sha = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');
const args = process.argv.slice(2);
const optArg = (n, d) => (args.includes(n) ? args[args.indexOf(n) + 1] : d);
const DAEMON = args.includes('--daemon');
const ONCE = args.includes('--once');
const INTERVALO_S = Number(optArg('--intervalo', 120));

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
  return {
    economia: sha(economia.toString()), Control: sha(controlDecide.toString()),
    A3: sha(a3Decide.toString()), B60: sha(b60Decide.toString()), C1_5: sha(c15Decide.toString()), D: sha(dDecide.toString()),
    episodeSegmentation: sha(segmentEpisodes.toString()), expectedRemainingLife: sha(expectedRemainingLife.toString()),
    survivalProbability: sha(survivalProbability.toString()), frozenParams: sha(JSON.stringify(FROZEN)),
  };
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
    expectedRemainingLifeH: expectedRemainingLife(vidasH), survivalProbability: survivalProbability(vidasH, pb),
    timeToSettlementMin: L.r2((SETTLE_MS - msInto) / 60000) };
}

// ═══ persistência DURÁVEL (checksum + atômico + backup redundante + sequence + truncamento + recovery) ═══
function escreverAtomicoDurable(fpath, body) {
  const tmp = fpath + '.tmp'; fs.writeFileSync(tmp, body);
  try { const fd = fs.openSync(tmp, 'r+'); fs.fsyncSync(fd); fs.closeSync(fd); } catch {}
  fs.renameSync(tmp, fpath);
  try { const dfd = fs.openSync(path.dirname(fpath), 'r'); fs.fsyncSync(dfd); fs.closeSync(dfd); } catch {}
}
function writeDurable(fpath, payload, sequence) {
  const rec = { schemaVersion: 'egv.durable.v1', sequence, payload, checksum: sha(JSON.stringify(payload)), escritoEm: new Date().toISOString() };
  const body = JSON.stringify(rec, null, 2);
  escreverAtomicoDurable(fpath, body); escreverAtomicoDurable(fpath + '.bak', body);
  return rec;
}
function readDurable(fpath) {
  for (const [cand, src] of [[fpath, 'PRIMARY'], [fpath + '.bak', 'BACKUP']]) {
    try { const rec = JSON.parse(fs.readFileSync(cand, 'utf8')); if (rec && rec.checksum && rec.checksum === sha(JSON.stringify(rec.payload))) return { rec, source: src }; } catch {}
  }
  return null;
}
function lerLegado(fpath) { try { const o = JSON.parse(fs.readFileSync(fpath, 'utf8')); if (o && o.entryGateValidationEpochId) return o; } catch {} return null; }

function lerDiario(l) { try { return fs.readFileSync(path.join(ECON, l, 'diario.jsonl'), 'utf8').split('\n').filter(Boolean).map(JSON.parse); } catch { return []; } }
function appendJSONL(fpath, obj) { fs.appendFileSync(fpath, JSON.stringify(obj) + '\n'); }
function loadJSONL(fpath, key) { const m = new Map(); try { fs.readFileSync(fpath, 'utf8').split('\n').filter(Boolean).forEach((ln) => { const o = JSON.parse(ln); m.set(o[key], o); }); } catch {} return m; }

// ── epoch durável (migra legado preservando id; repara primary a partir do backup) ──
function carregarEpoch(asOf, IMPL) {
  const epochPath = path.join(OUT, 'entry-gate-validation-epoch.json');
  let dur = readDurable(epochPath); let recovery = 'CREATED', sequence = dur ? dur.rec.sequence : 0;
  let epoch = dur ? dur.rec.payload : null; let manifestStatus = 'OK', validationStatus = 'ACTIVE', implChanged = [];
  if (epoch) { recovery = dur.source === 'PRIMARY' ? 'RECOVERED_FROM_PRIMARY' : 'RECOVERED_FROM_BACKUP';
    if (dur.source === 'BACKUP') { writeDurable(epochPath, epoch, sequence); recovery = 'RECOVERED_FROM_BACKUP'; } }
  if (!epoch) {
    const legado = lerLegado(epochPath) || lerLegado(epochPath + '.bak');
    epoch = { entryGateValidationEpochId: legado ? legado.entryGateValidationEpochId : 'egv_' + asOf, epochStartedAt: legado ? (legado.epochStartedAt || legado.validationEpochStartMs || asOf) : asOf,
      developmentManifest: DEV_MANIFEST, developmentManifestHash: DEV_MANIFEST_HASH, implementationHashes: IMPL, economicForwardEpochIdPreservado: true, criadoEm: new Date(asOf || 0).toISOString() };
    dur = { rec: writeDurable(epochPath, epoch, ++sequence) }; recovery = legado ? 'MIGRATED_FROM_LEGACY' : 'CREATED';
  } else {
    if (epoch.developmentManifestHash !== DEV_MANIFEST_HASH) manifestStatus = 'ABORTED_DEVELOPMENT_MANIFEST_CHANGED';
    else { const base = epoch.implementationHashes || {}; for (const k of Object.keys(IMPL)) if (base[k] && base[k] !== IMPL[k]) implChanged.push(k);
      if (implChanged.length) validationStatus = 'INVALIDATED_IMPLEMENTATION_CHANGED';
      else if (!epoch.implementationHashes) { epoch.implementationHashes = IMPL; writeDurable(epochPath, epoch, ++sequence); } }
  }
  return { epochPath, epoch, recovery, sequence, manifestStatus, validationStatus, implChanged, checksum: dur.rec ? dur.rec.checksum : sha(JSON.stringify(epoch)) };
}

// ── captura (append-only, imutável) com PROVENIÊNCIA inline vs post-hoc ──
function capturar(epoch, obsCache) {
  const decPath = path.join(OUT, 'entry-gate-decisions.jsonl');
  const outPath = path.join(OUT, 'entry-gate-outcomes.jsonl');
  const decExist = loadJSONL(decPath, 'sourceDecisionId');
  const outExist = loadJSONL(outPath, 'sourceDecisionId');

  // eventos: abre (decisão) / fecha (outcome terminal) / bloqueada (rejeição — baldes separados)
  const abre = new Map(); const fechaPorPos = new Map();
  const cap = { raw: {}, uniqueK: {} }; // rejeições por motivo
  for (const l of POL) for (const e of lerDiario(l)) {
    if (e.evento === 'abre') { if (e.sourceDecisionId && !abre.has(e.sourceDecisionId)) abre.set(e.sourceDecisionId, { policy: l, ...e }); }
    else if (e.evento === 'fecha') { if (!fechaPorPos.has(e.sourcePositionId)) fechaPorPos.set(e.sourcePositionId, e); }
    else if (e.evento === 'bloqueada') { const mv = e.motivo || 'desconhecido'; cap.raw[mv] = (cap.raw[mv] || 0) + 1; (cap.uniqueK[mv] = cap.uniqueK[mv] || new Set()).add(e.k); }
  }
  // obs do feed p/ chaves de decisão (cache entre ciclos do daemon)
  const chaves = new Set([...abre.values()].map((d) => d.k));
  for (const k of chaves) if (!obsCache[k]) obsCache[k] = null;
  const precisaFeed = [...chaves].some((k) => obsCache[k] == null);
  if (precisaFeed) { for (const k of chaves) obsCache[k] = obsCache[k] || [];
    try { for (const ln of fs.readFileSync(path.join(L.ROOT, 'vigilancia', 'arquivo-observacoes.jsonl'), 'utf8').split('\n')) { if (!ln) continue; let o; try { o = JSON.parse(ln); } catch { continue; } if (chaves.has(o.k)) obsCache[o.k].push({ ts: o.ts, apr: o.apr, spread: o.spread || 0 }); } } catch {}
    for (const k of chaves) if (obsCache[k]) obsCache[k].sort((a, b) => a.ts - b.ts); }

  let novasDecisoes = 0, novosOutcomes = 0;
  for (const [did, d] of abre) {
    const pos = { k: d.k, symbol: (d.k || '').split('|')[0], sourceDecisionId: did, sourcePositionId: d.sourcePositionId, entryApr: d.apr, entrySpread: 0.0003, openedAt: d.ts };
    const classe = DEVELOPMENT_SET[pos.sourcePositionId] ? 'ENTRY_GATE_DEVELOPMENT_SET' : (pos.openedAt >= epoch.epochStartedAt ? 'ENTRY_GATE_VALIDATION_SET' : 'PRE_EPOCH_UNCLASSIFIED');
    if (!decExist.has(did)) {
      const capturedAt = Date.now(); // relógio REAL de captura (não asOf) — base da proveniência
      const fe = fechaPorPos.get(pos.sourcePositionId);
      const closedAt = fe ? fe.positionClosedAt : null;
      const outcomeKnown = closedAt != null && closedAt <= capturedAt;
      const fresca = (capturedAt - pos.openedAt) <= FRESH_WINDOW_MS;
      const captureMode = (fresca && !outcomeKnown) ? 'INLINE' : 'POST_HOC_RECONSTRUCTION_NOT_VALIDATION_ELIGIBLE';
      const m = features(pos, obsCache[pos.k] || [], DEFAULT_GAP);
      const snap = { sourceDecisionId: did, sourcePositionId: pos.sourcePositionId, symbol: pos.symbol, exchangePair: pos.k, set: classe,
        decisionTimestamp: pos.openedAt, capturedAt, captureMode, outcomeAlreadyKnownAtCapture: outcomeKnown,
        validationEligible: captureMode === 'INLINE', epochId: epoch.entryGateValidationEpochId, ...m,
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
    entryGateDecisions: abre.size,
    capacityBlockedRawEvents: cap.raw.maxPositionsBlocked || 0,
    capacityBlockedUniqueDecisions: cap.uniqueK.maxPositionsBlocked ? cap.uniqueK.maxPositionsBlocked.size : 0,
    balanceBlockedDecisions: cap.uniqueK.localBalanceBlocked ? cap.uniqueK.localBalanceBlocked.size : 0,
    evRejectedDecisions: Object.keys(cap.raw).filter((mv) => /ev|apr|economia/i.test(mv)).reduce((s, mv) => s + (cap.uniqueK[mv] ? cap.uniqueK[mv].size : 0), 0),
    rawByMotivo: cap.raw,
  };
  return { decExist, outExist, fechaPorPos, novasDecisoes, novosOutcomes, capacityBuckets, obsCache };
}

// ── outcome state por decisão (item 4) ──
function outcomeState(rec, outExist, validationStatus) {
  if (validationStatus !== 'ACTIVE') return 'INVALIDATED';
  if (!rec.captureMode || rec.captureMode !== 'INLINE') return 'POST_HOC_RECONSTRUCTION';
  return outExist.has(rec.sourceDecisionId) ? 'CLOSED' : 'RIGHT_CENSORED'; // aberta e não terminal = censurada
}

function gerarRelatorio(asOf) {
  const IMPL = implementationHashes();
  const E = carregarEpoch(asOf, IMPL);
  if (E.manifestStatus !== 'OK') { const o = { schema: 'snowball.entry-gate-validation.v1_8', geradoEm: new Date(asOf || 0).toISOString(), asOfMs: asOf, ABORTED: true, motivo: E.manifestStatus, honestidade: 'Development manifest mudou — auditoria abortada.' }; L.writeJSON('entry-gate-validation.json', o); return { aborted: E.manifestStatus }; }
  const cap = capturar(E.epoch, gerarRelatorio._obs || (gerarRelatorio._obs = {}));
  const decs = [...cap.decExist.values()];
  const outs = cap.outExist;

  // classificação inline vs post-hoc
  const marca = (r) => (r.captureMode === 'INLINE') ? 'INLINE' : 'POST_HOC_RECONSTRUCTION_NOT_VALIDATION_ELIGIBLE';
  const elegiveis = decs.filter((r) => marca(r) === 'INLINE' && r.set === 'ENTRY_GATE_VALIDATION_SET' && !r.outcomeAlreadyKnownAtCapture);
  const postHoc = decs.filter((r) => marca(r) !== 'INLINE');

  // contadores sobre ELEGÍVEIS (validation) + estados de outcome
  const estados = { OPEN: 0, CLOSED: 0, RIGHT_CENSORED: 0, INVALIDATED: 0, POST_HOC_RECONSTRUCTION: 0 };
  for (const r of decs) { const s = outcomeState(r, outs, E.validationStatus); estados[s === 'RIGHT_CENSORED' ? 'RIGHT_CENSORED' : s]++; if (s === 'RIGHT_CENSORED') estados.OPEN++; }
  const contaElig = (f) => elegiveis.filter((r) => r[f]).length;
  const eligClosed = elegiveis.filter((r) => outs.has(r.sourceDecisionId));
  const eligWinners = eligClosed.filter((r) => outs.get(r.sourceDecisionId).winner).length;
  const eligLosers = eligClosed.filter((r) => outs.get(r.sourceDecisionId).loser).length;

  // PnL por filtro + capitalHours (sobre elegíveis fechados; hoje 0)
  const FILTROS = ['Control', 'A3', 'B60', 'C1_5', 'D']; const campo = { Control: 'decisionByControl', A3: 'decisionByA3', B60: 'decisionByB60', C1_5: 'decisionByC1_5', D: 'decisionByD' };
  const porFiltro = {};
  for (const f of FILTROS) { const acc = eligClosed.filter((r) => r[campo[f]]); const rej = eligClosed.filter((r) => !r[campo[f]]);
    const pnl = L.r4(acc.reduce((s, r) => s + (outs.get(r.sourceDecisionId).realizedNetPnL || 0), 0));
    const capH = L.r2(acc.reduce((s, r) => { const oc = outs.get(r.sourceDecisionId); return s + Math.max(0, (oc.closedAt - r.decisionTimestamp) / 3.6e6) * 2 * NOTIONAL; }, 0));
    const winnersTot = eligClosed.filter((r) => outs.get(r.sourceDecisionId).winner).length;
    const winnersRej = rej.filter((r) => outs.get(r.sourceDecisionId).winner).length;
    const lossesAvoided = rej.filter((r) => outs.get(r.sourceDecisionId).loser).length;
    porFiltro[f] = { accepted: acc.length, rejected: rej.length, realizedNetPnL: pnl, capitalHours: capH, lossesAvoided, winnersRejected: winnersRej,
      winnerRetention: winnersTot > 0 ? L.r2((winnersTot - winnersRej) / winnersTot) : null, rejectionPrecision: rej.length ? L.r2(lossesAvoided / rej.length) : null }; }

  const relatorioDiario = {
    validationDecisionsObserved: elegiveis.length,
    controlAccepted: contaElig('decisionByControl'), a3Accepted: contaElig('decisionByA3'), b60Accepted: contaElig('decisionByB60'), c15Accepted: contaElig('decisionByC1_5'), dAccepted: contaElig('decisionByD'),
    openOutcomes: estados.OPEN, closedOutcomes: eligClosed.length, rightCensored: elegiveis.length - eligClosed.length,
    winners: eligWinners, losers: eligLosers,
    lossesAvoided: { A3: porFiltro.A3.lossesAvoided, B60: porFiltro.B60.lossesAvoided, C1_5: porFiltro.C1_5.lossesAvoided, D: porFiltro.D.lossesAvoided },
    winnersRejected: { A3: porFiltro.A3.winnersRejected, B60: porFiltro.B60.winnersRejected, C1_5: porFiltro.C1_5.winnersRejected, D: porFiltro.D.winnersRejected },
    winnerRetention: { A3: porFiltro.A3.winnerRetention, B60: porFiltro.B60.winnerRetention, C1_5: porFiltro.C1_5.winnerRetention, D: porFiltro.D.winnerRetention },
    rejectionPrecision: { A3: porFiltro.A3.rejectionPrecision, B60: porFiltro.B60.rejectionPrecision, C1_5: porFiltro.C1_5.rejectionPrecision, D: porFiltro.D.rejectionPrecision },
    pnlPorFiltro: Object.fromEntries(FILTROS.map((f) => [f, porFiltro[f].realizedNetPnL])),
    capitalHoursPorFiltro: Object.fromEntries(FILTROS.map((f) => [f, porFiltro[f].capitalHours])),
    validationProgress: `${eligClosed.length}/30`,
  };

  // heartbeat do capturador (modo daemon)
  const hbPath = path.join(ECON, 'entry-gate-capturer', 'heartbeat.json');
  const hb = L.rd(hbPath, null);

  const elegivelPromo = eligClosed.length >= 30 && eligWinners > 0 && eligLosers > 0;
  const out = {
    schema: 'snowball.entry-gate-validation.v1_8', geradoEm: new Date(asOf || 0).toISOString(), asOfMs: asOf,
    validationStatus: E.validationStatus, manifestStatus: E.manifestStatus, implementationChanged: E.implChanged,
    item1_capturaProspectiva: { fresca_window_min: FRESH_WINDOW_MS / 60000, campos: ['decisionTimestamp', 'capturedAt', 'captureMode', 'outcomeAlreadyKnownAtCapture', 'sourceDecisionId', 'sourcePositionId', 'featuresCongeladas', 'decisoes Control/A3/B60/C1.5/D'],
      totalDecisions: decs.length, inlineEligible: elegiveis.length, postHocReconstruction: postHoc.length, novasNestaRun: cap.novasDecisoes,
      nota: 'Só INLINE (capturedAt<closedAt e outcome desconhecido, dentro de ~1 ciclo da decisão) conta p/ validation. As decisões atuais foram reconstruídas do diário depois do fato ⇒ POST_HOC (0 elegíveis).' },
    item2_processoContinuo: { capturador: 'entry-gate-validation.cjs --daemon', intervaloS: INTERVALO_S, cicloEconomicoAprox_s: 300, heartbeat: hb ? { pid: hb.pid, ultimoCiclo: hb.ultimoCiclo, idadeS: hb.ultimoCiclo ? Math.round((Date.now() - hb.ultimoCiclo) / 1000) : null, vivo: !!(hb && hb.ultimoCiclo && Date.now() - hb.ultimoCiclo < 15 * 60000) } : 'sem heartbeat (daemon não iniciado nesta sessão)', naoReconstroiSilenciosamente: true },
    item3_baldesRejeicao: cap.capacityBuckets,
    item4_decisionOutcome: { decisionsImutaveis: cap.decExist.size, outcomesTerminais: cap.outExist.size, novosOutcomes: cap.novosOutcomes, estados },
    item5_relatorioDiario: relatorioDiario,
    item6_durabilidade: { entryGateValidationEpochId: E.epoch.entryGateValidationEpochId, epochStartedAt: E.epoch.epochStartedAt, checksum: E.checksum, sequence: E.sequence, recoverySource: E.recovery, manifestHash: E.epoch.developmentManifestHash, implementationHashes: IMPL, testesDestrutivos: 'NUNCA na epoch real — só em cópia temporária', monitorApenas: true },
    item7_gate: { elegivelPromo, criterios: { min30OutcomesElegiveis: eligClosed.length >= 30, vencedoresEPerdedores: eligWinners > 0 && eligLosers > 0, pnlSuperiorControl: false, winnerRetentionAceitavel: false, segundaJanela: false, outroRegime: false, stressCustos: false, concentracao: false, aprovacaoHumana: false }, veredito: E.validationStatus !== 'ACTIVE' ? E.validationStatus : `Sem promoção — ${eligClosed.length}/30 outcomes elegíveis (todos atuais são POST_HOC).` },
    multiplasComparacoes: { elegiveis: FILTROS, exploratorios: EXPLORATORY.map((n) => ({ challenger: n, status: 'NOT_ELIGIBLE_FOR_PROMOTION' })) },
    proximoDolar: { estado: 'HOLD_UNALLOCATED', reserva: 'SAFETY_RESERVE', aumentoExposicao: false, novoMotor: false, live: false },
    honestidade: `Coleta prospectiva. ${elegiveis.length} decisões inline-elegíveis, ${postHoc.length} post-hoc (não elegíveis). validation ${eligClosed.length}/30 ⇒ sem promoção. Rejeições de capacidade separadas (2742 brutas ≠ oportunidades únicas). Champion/Control/core intactos. Sem ordens.`,
  };
  L.writeJSON('entry-gate-validation.json', out);
  return { validationStatus: E.validationStatus, manifestStatus: E.manifestStatus, recovery: E.recovery, decisionsObserved: decs.length, inlineEligible: elegiveis.length, postHoc: postHoc.length, novasDecisoes: cap.novasDecisoes, validationProgress: relatorioDiario.validationProgress };
}

function heartbeat(r) {
  const dir = path.join(ECON, 'entry-gate-capturer'); try { fs.mkdirSync(dir, { recursive: true }); } catch {}
  const body = { pid: process.pid, label: 'entry-gate-capturer', modo: 'inline-capture', ultimoCiclo: Date.now(), intervaloS: INTERVALO_S,
    decisionsObserved: r.decisionsObserved, inlineEligible: r.inlineEligible, postHoc: r.postHoc, novasDecisoes: r.novasDecisoes, validationProgress: r.validationProgress, validationStatus: r.validationStatus };
  try { escreverAtomicoDurable(path.join(dir, 'heartbeat.json'), JSON.stringify(body, null, 2)); } catch {}
}

async function main() {
  const asOf = () => { const { asOf } = L.loadChampion(); return asOf; };
  if (DAEMON) {
    process.stdout.write(JSON.stringify({ daemon: true, intervaloS: INTERVALO_S, pid: process.pid }) + '\n');
    for (;;) { const r = gerarRelatorio(asOf()); heartbeat(r); if (ONCE) break; await new Promise((res) => setTimeout(res, INTERVALO_S * 1000)); }
    return;
  }
  const r = gerarRelatorio(asOf());
  console.log(JSON.stringify(r, null, 2));
}
main();
