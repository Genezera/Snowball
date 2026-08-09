#!/usr/bin/env node
'use strict';
/**
 * v1.6 — Processo live-paper FORWARD isolado, RESISTENTE A PERDA DE EVENTOS EM CRASH.
 *  - CHECKPOINT ATÔMICO: escreve .tmp, fsync, rename atômico p/ estado.json, mantém
 *    estado.prev.json. O checkpoint carrega tudo (cursor/byteOffset/recentEventIds/
 *    accumulatedEventHash/saldos/posições/funding/custos) numa transação.
 *  - WAL (wal.json): PREPARED antes de mutar; COMMITTED após o checkpoint. No restart,
 *    resume do byteOffset committado — reprocesso é IDEMPOTENTE (dedup por physicalEventId).
 *  - physicalEventId = hash(sourceFileId+byteStart+byteEnd+lineHash) (dedup) SEPARADO de
 *    logicalObservationHash = hash(ts+key+apr+spread+vol). Não dedup 2 linhas físicas por
 *    conteúdo igual.
 *  - LATE EVENTS: eventTime/ingestionTime/latenessMs/lateEvent/sourceOffset; ordem de
 *    ingestão; decisões finalizadas não são reordenadas.
 *  - SNAPSHOTS por watermark (snapshots.jsonl compacto).
 *  - Crash injection: env FORWARD_CRASH_AT ∈ {after_read, after_wal_prepared,
 *    during_tmp_write, after_fsync, before_rename, after_rename, before_wal_committed}.
 * NENHUMA ordem, NENHUM saldo real.
 *
 * Uso: node forward-lab.cjs --mode <trial|control> [--maxpos N] [--label X] [--intervalo 300] [--once]
 */
const L = require('./lib-progression.cjs');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const args = process.argv.slice(2);
const opt = (n, d) => (args.includes(n) ? args[args.indexOf(n) + 1] : d);
// ── item 10: SEGURANÇA DE TESTES — proíbe --label duplicado; em modo teste, exige TEST_ROOT temp ──
if (args.filter((a) => a === '--label').length > 1) { console.error('[forward-lab] FATAL: --label duplicado é proibido'); process.exit(2); }
const MODE = opt('--mode', 'trial'), ONCE = args.includes('--once');
const INTERVALO_S = Number(opt('--intervalo', 300));
const MAXPOS = args.includes('--maxpos') ? Number(opt('--maxpos', L.MAX_POSICOES)) : L.MAX_POSICOES;
const LABEL = opt('--label', MODE);
// --close-policy: scanner_stale (durabilidade, comportamento v1.7) | economic_inversion (econômico, item 6)
const CLOSE_POLICY = opt('--close-policy', 'scanner_stale');
// --exchanges bybit,bitget : override do par de exchanges (competidores 2-ex). Ausente = comportamento original.
const EXCHS_OVERRIDE = args.includes('--exchanges') ? String(opt('--exchanges', '')).split(',').map((s) => s.trim()).filter(Boolean) : null;
const EXCHS = (EXCHS_OVERRIDE && EXCHS_OVERRIDE.length) ? EXCHS_OVERRIDE : (MODE === 'control' ? L.EXCHANGES : ['bitget', 'bybit']);
// --persist-min N : só entra após a oportunidade ficar positive-EV por N min (filtro de persistência). 0 = desligado (default, comportamento original inalterado).
const PERSIST_MIN = args.includes('--persist-min') ? Number(opt('--persist-min', 0)) : 0;
// --reserva F : fração do capital mantida em reserva (não usada como margem). Default = L.RESERVA (0.30).
// Reduzir (ex.: 0.20) coloca mais capital ocioso pra trabalhar → mais posições → mais funding. Lever de UTILIZAÇÃO.
const RESERVA = args.includes('--reserva') ? Number(opt('--reserva', L.RESERVA)) : L.RESERVA;
// --stable-yield APR : rendimento anual sobre o capital LIVRE (reserva ociosa), tipo Earn/stablecoin do CEX.
// Neutro, sem risco de preço — o colchão rende enquanto espera. 0 = desligado. Ex.: 0.06 = 6%/ano.
const STABLE_YIELD = args.includes('--stable-yield') ? Number(opt('--stable-yield', 0)) : 0;
const CAP_POR_EX = L.ALVO_POR_EXCHANGE;
// --cost-model taker|maker : custo de execução. taker (default) = ordens a mercado (0,05%+slip).
// maker = ordens LIMITE (0,02%+slip mínimo, presets reais do src/config.ts) — 35,7% do custo taker.
const COST_MODEL = opt('--cost-model', 'taker');
const TAKER = COST_MODEL === 'maker' ? 0.0002 : 0.0005;
const SLIP = COST_MODEL === 'maker' ? 0.00005 : 0.0002;
const CUSTO_FRAC = 4 * TAKER + 4 * SLIP;
const NOTIONAL = L.ALVO_POR_EXCHANGE, MARGEM_PERNA = NOTIONAL / L.ALAVANCAGEM;
const STALE_CICLOS = 3, DEDUP_MAX = 20000, LATE_MS = 10 * 60000;
const INVERSION_CICLOS = 2;                // econômico: fecha após N ciclos com EV não-positivo (inversão), não por sumiço do scanner
const MAX_HOLDING_MS = 7 * 86400000;       // política de RISCO: não manter posição indefinidamente (maxHoldingExit)
const FUNDING_DETERIORATION_FRAC = 0.5;    // funding cai a <50% do apr de entrada por INVERSION_CICLOS → deterioração
const EVAL_STALE_MS = 30 * 60000;          // avaliação econômica considerada "velha" além disto
const BURST_GAP_MS = 120000, EPISODE_GAP_MS = 30 * 60000; // ranking cycle (scan burst) e episódio de oportunidade (causal, por contiguidade)
const SCHEMA_VERSION = 'forward.v1_8';                  // v1.8: identidade causal + close policy
const COMPAT_SCHEMAS = ['forward.v1_7', 'forward.v1_8']; // durabilitySoak v1.7 sobrevive a restart sob código v1.8
const ROT_TAIL = 24;                       // últimos N logicalObservationHash guardados p/ overlap de rotação

// ── raiz: produção OU (modo teste) TEST_ROOT temporário; aborta se TEST_ROOT cair na produção ──
const PROD_FORWARD = path.resolve(path.join(L.ROOT, 'auditoria', 'progression', 'forward'));
const TEST_MODE = process.env.FORWARD_TEST_MODE === '1';
let BASE;
if (TEST_MODE) {
  const root = process.env.FORWARD_TEST_ROOT;
  if (!root) { console.error('[forward-lab] FATAL: FORWARD_TEST_MODE=1 exige FORWARD_TEST_ROOT'); process.exit(2); }
  const abs = path.resolve(root);
  // recusa a produção DESTE repo E qualquer árvore forward/economic real (segmentos de produção)
  const segs = abs.split(/[\\/]/);
  const temSegmentoForward = segs.some((s, i) => s === 'auditoria' && segs[i + 1] === 'progression' && (segs[i + 2] === 'forward' || segs[i + 2] === 'economic'));
  if (abs === PROD_FORWARD || abs.startsWith(PROD_FORWARD + path.sep) || temSegmentoForward) { console.error(`[forward-lab] FATAL: FORWARD_TEST_ROOT resolve p/ árvore de produção (${abs}) — recusado`); process.exit(2); }
  // exige diretório temporário: sob os.tmpdir() OU com 'tmp'/'temp' no caminho (case-insensitive)
  const tmpDir = path.resolve(require('node:os').tmpdir());
  const ehTemp = abs.startsWith(tmpDir + path.sep) || /tmp|temp/i.test(abs);
  if (!ehTemp) { console.error(`[forward-lab] FATAL: FORWARD_TEST_ROOT deve estar sob diretório temporário (${abs}) — recusado`); process.exit(2); }
  // exige que exista ANTES de qualquer escrita
  if (!fs.existsSync(abs)) { console.error(`[forward-lab] FATAL: FORWARD_TEST_ROOT não existe (${abs}) — recusado (crie o temp antes)`); process.exit(2); }
  BASE = abs;
} else if (process.env.FORWARD_ROOT) {
  BASE = path.resolve(process.env.FORWARD_ROOT);   // raiz de produção alternativa (ex.: economicSoak em auditoria/progression/economic), separada do durabilitySoak
} else {
  BASE = PROD_FORWARD;
}
const DIR = path.join(BASE, LABEL); fs.mkdirSync(DIR, { recursive: true });
const F = { estado: path.join(DIR, 'estado.json'), prev: path.join(DIR, 'estado.prev.json'), wal: path.join(DIR, 'wal.json'), ledger: path.join(DIR, 'ledger.jsonl'), diario: path.join(DIR, 'diario.jsonl'), heartbeat: path.join(DIR, 'heartbeat.json'), lock: path.join(DIR, 'lock.json'), snapshots: path.join(DIR, 'snapshots.jsonl'), recovery: path.join(DIR, 'recovery.json') };
const OBS = process.env.FORWARD_OBS || path.join(L.ROOT, 'vigilancia', 'arquivo-observacoes.jsonl');
const EPOCH = process.env.FORWARD_EPOCH || path.join(BASE, 'epoch.json');
const CRASH_AT = process.env.FORWARD_CRASH_AT || null;
const now = () => Date.now();
const rd = (p, d) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return d; } };
const append = (p, o) => { try { fs.appendFileSync(p, JSON.stringify(o) + '\n'); } catch {} };
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
const crashIf = (pt) => { if (CRASH_AT === pt) { try { fs.writeFileSync(path.join(DIR, 'crashed_at.txt'), pt); } catch {} process.exit(137); } };

function fileIdentity() { try { const st = fs.statSync(OBS); return { id: `${st.dev}:${st.ino || Math.round(st.birthtimeMs)}`, size: st.size, mtimeMs: st.mtimeMs }; } catch { return { id: null, size: 0, mtimeMs: 0 }; } }
function adquirirLock() { const c = rd(F.lock, null); if (c && c.heartbeat && now() - c.heartbeat < 90_000) return false; fs.writeFileSync(F.lock, JSON.stringify({ pid: process.pid, heartbeat: now() })); return true; }

// ── checksum + schemaVersion sobre o payload (canonical sem o campo checksum) ──
function comChecksum(obj) { const semChk = { ...obj, schemaVersion: SCHEMA_VERSION }; delete semChk.checksum; const checksum = sha(JSON.stringify(semChk)); return { ...semChk, checksum }; }
// lê + VERIFICA: reason ∈ MISSING/UNPARSEABLE/SCHEMA_MISMATCH/NO_CHECKSUM/CHECKSUM_INVALID/OK
function lerVerificado(p) {
  let raw; try { raw = fs.readFileSync(p, 'utf8'); } catch { return { ok: false, reason: 'MISSING', obj: null }; }
  let o; try { o = JSON.parse(raw); } catch { return { ok: false, reason: 'UNPARSEABLE', obj: null }; }  // vazio/parcial/truncado → JSON quebra
  if (o.schemaVersion && !COMPAT_SCHEMAS.includes(o.schemaVersion)) return { ok: false, reason: 'SCHEMA_MISMATCH', obj: o }; // v1.8 aceita v1_7 (durabilitySoak sobrevive)
  if (o.checksum == null) return { ok: false, reason: 'NO_CHECKSUM', obj: o };
  const semChk = { ...o }; delete semChk.checksum;
  if (sha(JSON.stringify(semChk)) !== o.checksum) return { ok: false, reason: 'CHECKSUM_INVALID', obj: o };
  return { ok: true, reason: 'OK', obj: o };
}
function fsyncDir() { try { const dfd = fs.openSync(DIR, 'r'); fs.fsyncSync(dfd); fs.closeSync(dfd); return true; } catch { return false; } } // metadados do diretório qdo suportado (posix); Windows não suporta → false

// ── escrita ATÔMICA DURÁVEL: prev backup, checksum, tmp, fsync, rename atômico, dir fsync ──
function escreverAtomico(p, obj, comCrash) {
  const tmp = p + '.tmp';
  // backup prev SÓ para o checkpoint principal (nunca sobrescrever o prev com o WAL)
  try { if (p === F.estado && fs.existsSync(p)) fs.copyFileSync(p, F.prev); } catch {}
  const payload = comChecksum(obj);
  const fd = fs.openSync(tmp, 'w');
  fs.writeSync(fd, JSON.stringify(payload, null, 2));
  if (comCrash) crashIf('during_tmp_write');
  fs.fsyncSync(fd); fs.closeSync(fd);
  if (comCrash) crashIf('after_fsync');
  if (comCrash) crashIf('before_rename');
  fs.renameSync(tmp, p);                    // rename atômico (libuv usa MOVEFILE_REPLACE_EXISTING no Windows)
  fsyncDir();                               // persiste metadados do diretório qdo o SO suporta
  if (comCrash) crashIf('after_rename');
}

function estadoInicial(epoch) {
  const saldos = {}; for (const e of EXCHS) saldos[e] = CAP_POR_EX;
  const fi = fileIdentity();
  return { modo: MODE, label: LABEL, maxPos: MAXPOS, closePolicy: CLOSE_POLICY, iniciadoEm: now(), forwardEpochId: epoch ? epoch.forwardEpochId : null,
    cursor: { sourceFileId: OBS, fileIdentity: fi.id, byteOffset: epoch ? epoch.byteOffset : fi.size, lineNumber: epoch ? epoch.lineNumber : 0, lastCompleteLineHash: null, lastTimestamp: epoch ? epoch.timestamp : now(), lastOpportunityKey: null, partial: '', tailLogicalHashes: [], lastGlobalTs: null, burstAnchorId: null },
    saldosPorExchange: saldos, capitalInicial: EXCHS.length * CAP_POR_EX, virtuais: {}, fundingAcum: 0, custosAcum: 0, yieldAcum: 0,
    episodios: {},   // v1.8 identidade causal: por chave { episodeSeq, anchorObsId, episodeId, lastTs }
    eventCount: 0, accumulatedEventHash: '', lastCycleId: 0, walSequence: 0, sourceStatus: 'OK', lateEvents: 0,
    contadores: { avaliadas: 0, abertas: 0, fechadas: 0, bloqueadas: 0, dedupIgnorados: 0, rotationOverlapSkipped: 0 },
    bloqueios: { aggregateCapitalBlocked: 0, localBalanceBlocked: 0, reserveBlocked: 0, maxPositionsBlocked: 0, minOrderBlocked: 0, evNaoPositivo: 0 },
    recentEventIds: [] };
}

// ── RECOVERY MATRIX (item 3): classifica o boot; NUNCA começa do zero silenciosamente ──
// Estados: FRESH_START / RESET_NEW_EPOCH / RECOVERED_FROM_PRIMARY / RECOVERED_FROM_PREVIOUS /
//          REPLAYED_PREPARED_CYCLE / SUSPENDED_CHECKPOINT_CORRUPTION / SUSPENDED_WAL_CORRUPTION /
//          SUSPENDED_SCHEMA_MISMATCH
function recuperar() {
  const epoch = rd(EPOCH, null);
  const prim = lerVerificado(F.estado);
  const prev = lerVerificado(F.prev);
  const walV = lerVerificado(F.wal);
  const existePrim = prim.reason !== 'MISSING', existePrev = prev.reason !== 'MISSING', existeWal = walV.reason !== 'MISSING';
  const suspenso = (recoveryState, detalhe) => ({ suspenso: true, recoveryState, detalhe, est: null });

  // schema incompatível em qualquer checkpoint presente → SUSPENDER (migração é decisão explícita)
  if (prim.reason === 'SCHEMA_MISMATCH' || prev.reason === 'SCHEMA_MISMATCH')
    return suspenso('SUSPENDED_SCHEMA_MISMATCH', { primario: prim.reason, anterior: prev.reason, esperado: SCHEMA_VERSION });
  // WAL presente porém corrompido → não dá p/ confiar na recuperação
  if (existeWal && (walV.reason === 'UNPARSEABLE' || walV.reason === 'CHECKSUM_INVALID'))
    return suspenso('SUSPENDED_WAL_CORRUPTION', { wal: walV.reason });

  // primeiro boot legítimo (nada persistido) → começar do epoch NÃO é "do zero silencioso"
  if (!existePrim && !existePrev) return { suspenso: false, recoveryState: 'FRESH_START', est: estadoInicial(epoch) };

  // escolher a melhor base íntegra
  let base = null, recoveryState = null;
  if (prim.ok) { base = prim.obj; recoveryState = 'RECOVERED_FROM_PRIMARY'; }
  else if (prev.ok) { base = prev.obj; recoveryState = 'RECOVERED_FROM_PREVIOUS'; }        // primário corrompido/ausente, anterior íntegro
  else return suspenso('SUSPENDED_CHECKPOINT_CORRUPTION', { primario: prim.reason, anterior: prev.reason });

  // COMMITTED com checkpoint ausente/corrompido do MESMO ciclo já cai em RECOVERED_FROM_PREVIOUS acima.
  // troca de epoch → reset explícito com preservação de warmup (não é do-zero silencioso)
  if (epoch && base.forwardEpochId !== epoch.forwardEpochId) {
    try { fs.writeFileSync(path.join(DIR, `warmup-${base.forwardEpochId || 'none'}.json`), JSON.stringify({ status: 'WARMUP_NOT_COMPARABLE', preservadoEm: now(), estado: base }, null, 2)); } catch {}
    return { suspenso: false, recoveryState: 'RESET_NEW_EPOCH', est: estadoInicial(epoch) };
  }

  const est = base; if (!est.recentEventIds) est.recentEventIds = [];
  if (!est.cursor.tailLogicalHashes) est.cursor.tailLogicalHashes = [];
  if (!est.episodios) est.episodios = {};   // v1.8: default p/ checkpoints v1_7 (durabilitySoak)
  if (est.walSequence == null) est.walSequence = 0;
  if (est.contadores && est.contadores.rotationOverlapSkipped == null) est.contadores.rotationOverlapSkipped = 0;
  // WAL PREPARED sem COMMITTED de ciclo > lastCycleId = ciclo em voo → reaplicar é idempotente (byteOffset + physicalEventId)
  if (walV.ok && walV.obj.status === 'PREPARED' && walV.obj.cycleId > (est.lastCycleId || 0)) {
    est._recuperado = true; recoveryState = 'REPLAYED_PREPARED_CYCLE';
  }
  return { suspenso: false, recoveryState, est };
}

function registrarRecovery(r, extra) {
  try { fs.writeFileSync(F.recovery, JSON.stringify({ recoveryState: r.recoveryState, suspenso: !!r.suspenso, detalhe: r.detalhe || null, schemaVersion: SCHEMA_VERSION, walSequence: r.est ? r.est.walSequence : null, ts: now(), ...extra }, null, 2)); } catch {}
}

// ── detecta cópia de cauda numa rotação: os 1ºs logicalObservationHash do novo arquivo
// coincidem com a cauda do antigo → devolve quantas linhas pular p/ não contar em dobro ──
function logicalHashDeLinha(linha) { let o; try { o = JSON.parse(linha); } catch { return null; } if (!o.k || o.apr == null) return null; return sha(`${o.ts}|${o.k}|${o.apr}|${o.spread || 0}|${o.vol || 0}`).slice(0, 16); }
function detectarOverlapRotacao(fi, tail) {
  let head = ''; try { const fd = fs.openSync(OBS, 'r'); const n = Math.min(fi.size, 262144); const buf = Buffer.alloc(n); fs.readSync(fd, buf, 0, n, 0); fs.closeSync(fd); head = buf.toString('utf8'); } catch {}
  const linhas = head.split('\n'); const seq = []; let cum = 0;
  for (let i = 0; i < linhas.length - 1; i++) { const lb = Buffer.byteLength(linhas[i] + '\n', 'utf8'); cum += lb; const h = logicalHashDeLinha(linhas[i]); if (h) seq.push({ hash: h, cumBytes: cum }); }
  const t = tail || [];
  for (let k = Math.min(seq.length, t.length); k >= 1; k--) {
    let match = true; for (let j = 0; j < k; j++) { if (seq[j].hash !== t[t.length - k + j]) { match = false; break; } }
    if (match) return { status: 'SOURCE_ROTATED_TAILCOPY', overlapLinhas: k, novoByteOffset: seq[k - 1].cumBytes };
  }
  return { status: 'SOURCE_IDENTITY_CHANGED_NO_OVERLAP', overlapLinhas: 0, novoByteOffset: null };
}

// ── IDENTIDADE CAUSAL (item 2): IDs derivados da CAUSA (episódio/scan burst na fonte), nunca de
// símbolo+hora nem timestamp arredondado. sourceDecisionId é COMUM entre políticas que veem a
// mesma oportunidade no mesmo scan burst (partindo do mesmo epoch/offset). ──
function computeCausal(est, epochId, physicalEventId, ts, k, sym, long, short) {
  const cur = est.cursor;
  // ranking cycle = scan burst global: novo quando há gap > BURST_GAP_MS na fonte
  const gapGlobal = cur.lastGlobalTs == null ? Infinity : (ts - cur.lastGlobalTs);
  if (gapGlobal > BURST_GAP_MS) cur.burstAnchorId = physicalEventId;
  if (cur.lastGlobalTs == null || ts > cur.lastGlobalTs) cur.lastGlobalTs = ts;
  // PROVENANCE: o feed NÃO tem collectorCycleId/scanCycleId nativo — o ranking cycle é INFERIDO do
  // timing da fonte (gap de burst). Prefixo 'inf_' impede confundir com ID nativo (item 1).
  const sourceRankingCycleId = 'inf_' + sha(`${epochId}|${cur.burstAnchorId}`).slice(0, 16);
  // episódio de oportunidade = contiguidade da MESMA chave: novo quando ausente > EPISODE_GAP_MS
  let st = est.episodios[k];
  if (!st || (ts - st.lastTs) > EPISODE_GAP_MS) { const seq = st ? st.episodeSeq + 1 : 0; st = { episodeSeq: seq, anchorObsId: physicalEventId, episodeId: sha(`${epochId}|${k}|${seq}|${physicalEventId}`).slice(0, 20), lastTs: ts }; est.episodios[k] = st; }
  else st.lastTs = ts;
  const sourceOpportunityEpisodeId = st.episodeId;
  const sourceDecisionId = sha(`${epochId}|${sourceRankingCycleId}|${sourceOpportunityEpisodeId}|${sym}|${long}|${short}`).slice(0, 24);
  const sourcePositionId = sha(`${epochId}|${sourceOpportunityEpisodeId}`).slice(0, 24); // uma posição-fonte por episódio (comum entre políticas)
  return { sourceObservationEventId: physicalEventId, sourceRankingCycleId, sourceRankingCycleProvenance: 'INFERRED_FROM_SOURCE_TIMING', sourceRankingCycleGapMs: BURST_GAP_MS, sourceOpportunityEpisodeId, sourceDecisionId, sourcePositionId };
}

function economia(apr, spread) { const c = CUSTO_FRAC + Math.max(0, spread || 0); return apr * 24 / 8760 - c; }
function margemLivre(est, ex) { return (est.saldosPorExchange[ex] || 0) * (1 - RESERVA); }
function stateHash(est) { return sha(JSON.stringify({ so: est.cursor.byteOffset, ec: est.eventCount, aeh: est.accumulatedEventHash, sal: est.saldosPorExchange, vi: Object.keys(est.virtuais).sort(), fu: L.r4(est.fundingAcum), cu: L.r4(est.custosAcum) })).slice(0, 24); }

// ── TELEGRAM (opcional) ──────────────────────────────────────────────────────
// Avisa o usuário quando ESTE competidor abre/fecha posição. Mensagens amigáveis,
// rotuladas pelo par de exchanges. Token/chat vêm SÓ do .env (nunca commitados).
// Anti-replay: o ciclo de LARGADA (catch-up do feed no start/restart) é silencioso;
// só ciclos ao vivo notificam. NUNCA emite ordem — só manda texto.
const _envTG = {};
try { fs.readFileSync(path.join(L.ROOT, '.env'), 'utf8').split('\n').forEach((l) => { const m = l.match(/^\s*([A-Z_]+)\s*=\s*(.*)\s*$/); if (m) _envTG[m[1]] = m[2].replace(/^["']|["']$/g, ''); }); } catch {}
const TG_TOKEN = process.env.TELEGRAM_BOT_TOKEN || _envTG.TELEGRAM_BOT_TOKEN;
const TG_CHAT = process.env.TELEGRAM_CHAT_ID || _envTG.TELEGRAM_CHAT_ID;
const TG_ON = !!(TG_TOKEN && TG_CHAT);
const TG_LINHA = '━━━━━━━━━━━━━━━━━━━';
const TG_TAG = `🤖 <b>${EXCHS.join(' + ')}</b> <i>(competidor · paper)</i>`;
let tgLargadaFeita = false; // primeiro ciclo (catch-up) fica silencioso
const tgUsd = (n, c = 2) => 'US$ ' + Number(n).toLocaleString('pt-BR', { minimumFractionDigits: c, maximumFractionDigits: c });
const tgSym = (k, sym) => String(sym || k || '').replace('/USDT:USDT', '').replace(/\|.*$/, '');
const TG_MOTIVOS = { economic_inversion: 'a taxa virou contra (não valia mais a pena)', funding_deterioration: 'o funding caiu demais', scanner_stale: 'a oportunidade sumiu do mercado', apr_nonpositive: 'a taxa zerou / ficou negativa', max_holding_exit: 'tempo máximo de posição atingido (segurança)', exchange_failure: 'instabilidade na exchange (segurança)' };
async function tgEnviar(texto) {
  if (!TG_ON) return;
  try { await fetch(`https://api.telegram.org/bot${TG_TOKEN}/sendMessage`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ chat_id: TG_CHAT, text: texto, parse_mode: 'HTML' }), signal: AbortSignal.timeout(8000) }); } catch {}
}
function tgAbre(d, capital) {
  return tgEnviar(`🟢 <b>NOVA OPERAÇÃO ABERTA</b>\n${TG_TAG}\n${TG_LINHA}\n` +
    `🪙 <b>Moeda:</b> ${tgSym(d.k, d.sym)}\n🔄 <b>Comprado em:</b> ${d.long}\n🔄 <b>Vendido em:</b> ${d.short}\n` +
    `💵 <b>Valor operado:</b> ${tgUsd(NOTIONAL, 0)}\n📊 <b>Taxa (APR):</b> ${(d.apr * 100).toFixed(1)}%\n💼 <b>Capital do competidor:</b> ${tgUsd(capital)}\n${TG_LINHA}\n` +
    `ℹ️ Operação <b>neutra</b>: compra numa corretora e vende na outra ao mesmo tempo. O lucro vem da <b>taxa de funding</b> — sem apostar se o preço sobe ou cai. 🛡️`);
}
function tgFecha(d, capital) {
  const lucro = d.pnl >= 0;
  return tgEnviar(`${lucro ? '✅' : '⚠️'} <b>OPERAÇÃO FECHADA — ${lucro ? 'LUCRO' : 'PREJUÍZO'}</b>\n${TG_TAG}\n${TG_LINHA}\n` +
    `🪙 <b>Moeda:</b> ${tgSym(d.k, d.sym)}\n💰 <b>Recebido (funding):</b> +${tgUsd(d.funding, 4)}\n💸 <b>Custo (taxas):</b> −${tgUsd(d.custo, 4)}\n` +
    `${lucro ? '📈' : '📉'} <b>Resultado:</b> ${lucro ? '+' : '−'}${tgUsd(Math.abs(d.pnl), 4)}\n📝 <b>Por que fechou:</b> ${TG_MOTIVOS[d.closeReason] || d.closeReason || 'critério de saída'}\n💼 <b>Capital do competidor:</b> ${tgUsd(capital)}\n${TG_LINHA}\n` +
    `ℹ️ Tudo automático e em <b>paper</b> (sem dinheiro real). O robô segue operando sozinho. 😴`);
}

function umCiclo() {
  const r = recuperar();
  if (r.suspenso) { registrarRecovery(r); append(F.diario, { ts: now(), evento: 'recovery', recoveryState: r.recoveryState, detalhe: r.detalhe }); console.log(`[forward-lab ${LABEL}] ${r.recoveryState} — SUSPENSO (não processa; não zera)`); return; }
  const est = r.est; registrarRecovery(r);
  if (r.recoveryState === 'REPLAYED_PREPARED_CYCLE') append(F.diario, { ts: now(), evento: 'recovery', recoveryState: r.recoveryState, cycleId: (est.lastCycleId || 0) + 1 });
  const cur = est.cursor; const fi = fileIdentity(); let rotouTailcopy = false;
  if (fi.id == null) { est.sourceStatus = 'SOURCE_UNAVAILABLE'; persistir(est); return; }
  if (cur.fileIdentity && fi.id !== cur.fileIdentity) {
    // ── ROTATION OVERLAP (item 4): o novo arquivo pode começar com uma CÓPIA da cauda do antigo.
    // Compara os primeiros logicalObservationHash do novo arquivo com a cauda guardada; se houver
    // sobreposição, avança o byteOffset para PULAR as linhas copiadas → impede dupla contagem.
    const rot = detectarOverlapRotacao(fi, cur.tailLogicalHashes || []);
    append(F.diario, { ts: now(), evento: 'source_status', status: rot.status, de: cur.fileIdentity, para: fi.id, overlapLinhas: rot.overlapLinhas, novoByteOffset: rot.novoByteOffset });
    est.sourceStatus = rot.status;
    if (rot.status === 'SOURCE_IDENTITY_CHANGED_NO_OVERLAP') { persistir(est); return; } // sem prova de continuidade → suspende avanço (não zera)
    cur.fileIdentity = fi.id; cur.byteOffset = rot.novoByteOffset; cur.partial = '';   // pula as linhas copiadas da cauda
    est.contadores.rotationOverlapSkipped += rot.overlapLinhas; rotouTailcopy = true;
  }
  if (fi.size < cur.byteOffset) { est.sourceStatus = 'SOURCE_TRUNCATED'; append(F.diario, { ts: now(), evento: 'source_status', status: 'SOURCE_TRUNCATED', size: fi.size, byteOffset: cur.byteOffset }); persistir(est); return; }
  est.sourceStatus = rotouTailcopy ? 'SOURCE_ROTATED_TAILCOPY' : 'OK'; cur.fileIdentity = fi.id;
  const tailHashes = cur.tailLogicalHashes || (cur.tailLogicalHashes = []);

  const prevPartial = cur.partial || '';
  const prevPartialLen = Buffer.byteLength(prevPartial, 'utf8');
  const startOffset = cur.byteOffset;
  let bloco = '';
  if (fi.size > cur.byteOffset) { const fd = fs.openSync(OBS, 'r'); const buf = Buffer.alloc(fi.size - cur.byteOffset); fs.readSync(fd, buf, 0, buf.length, cur.byteOffset); fs.closeSync(fd); bloco = buf.toString('utf8'); }
  const content = prevPartial + bloco;                    // partial anterior + bytes novos = faixa contígua
  const lastNL = content.lastIndexOf('\n');
  const completo = lastNL >= 0 ? content.slice(0, lastNL + 1) : '';
  cur.partial = lastNL >= 0 ? content.slice(lastNL + 1) : content;
  // a faixa content mapeia para os bytes [startOffset - prevPartialLen, fi.size) do arquivo
  let bytePos = startOffset - prevPartialLen;
  cur.byteOffset = fi.size;
  crashIf('after_read');

  const dedupSet = new Set(est.recentEventIds); const batch = [];
  for (const linha of completo.split('\n')) {
    const lb = Buffer.byteLength(linha + '\n', 'utf8'); const byteStart = bytePos; const byteEnd = bytePos + lb; bytePos = byteEnd;
    if (!linha) continue; cur.lineNumber++;
    let o; try { o = JSON.parse(linha); } catch { continue; }
    if (!o.k || o.apr == null) continue;
    const lineHash = sha(linha).slice(0, 12);
    const physicalEventId = sha(`${OBS}|${byteStart}|${byteEnd}|${lineHash}`).slice(0, 20);
    if (dedupSet.has(physicalEventId)) { est.contadores.dedupIgnorados++; continue; } // dedup FÍSICO (não por conteúdo)
    dedupSet.add(physicalEventId);
    const logicalObservationHash = sha(`${o.ts}|${o.k}|${o.apr}|${o.spread || 0}|${o.vol || 0}`).slice(0, 16);
    tailHashes.push(logicalObservationHash); if (tailHashes.length > ROT_TAIL) tailHashes.shift(); // cauda p/ overlap de rotação
    const [sym, long, short] = o.k.split('|');
    const ingestionTime = now(), latenessMs = ingestionTime - o.ts, lateEvent = latenessMs > LATE_MS;
    if (lateEvent) est.lateEvents++;
    const causal = computeCausal(est, est.forwardEpochId || '', physicalEventId, o.ts, o.k, sym, long, short);
    if (process.env.FORWARD_EMIT_CAUSAL === '1') append(path.join(DIR, 'causal.jsonl'), { ts: o.ts, k: o.k, sym, long, short, ...causal }); // hook de teste de identidade
    batch.push({ physicalEventId, logicalObservationHash, ts: o.ts, ingestionTime, latenessMs, lateEvent, sourceOffset: byteStart, k: o.k, sym, long, short, apr: o.apr, spread: o.spread || 0, vol: o.vol || 0, ...causal });
    cur.lastCompleteLineHash = lineHash; cur.lastTimestamp = o.ts; cur.lastOpportunityKey = o.k;
    est.accumulatedEventHash = sha(est.accumulatedEventHash + physicalEventId).slice(0, 32); est.eventCount++;
  }
  est.recentEventIds = [...dedupSet].slice(-DEDUP_MAX);

  // ── WAL PREPARED ────────────────────────────────────────────────────────────
  const cycleId = (est.lastCycleId || 0) + 1;
  est.walSequence = (est.walSequence || 0) + 1;
  const stateHashBefore = stateHash(est);
  const wal = { schemaVersion: SCHEMA_VERSION, walSequence: est.walSequence, cycleId, inputStartOffset: startOffset, inputEndOffset: cur.byteOffset, eventIds: batch.map((b) => b.physicalEventId), stateHashBefore, decisoes: [], stateHashAfter: null, status: 'PREPARED', ts: now() };
  escreverAtomico(F.wal, wal);
  crashIf('after_wal_prepared');

  // ── ordem de INGESTÃO (sourceOffset), ranking determinístico p/ abrir ───────
  batch.sort((a, b) => a.sourceOffset - b.sourceOffset);
  const feedAtivo = batch.length > 0;
  const candidatas = batch.filter((b) => EXCHS.includes(b.long) && EXCHS.includes(b.short));
  candidatas.forEach((c) => { c.score = economia(c.apr, c.spread); c.ev = c.score * NOTIONAL; });
  candidatas.sort((a, b) => b.score - a.score || b.ev - a.ev || (a.k < b.k ? -1 : a.k > b.k ? 1 : 0));

  const virtSemVer = new Set(Object.keys(est.virtuais)); const decisoes = [];
  for (const c of candidatas) {
    est.contadores.avaliadas++;
    if (est.virtuais[c.k]) { const vp = est.virtuais[c.k]; const inc = NOTIONAL * (c.apr / 8760) * (INTERVALO_S / 3600); vp.fundingAcum += inc; vp.ultimoApr = c.apr; vp.ciclosSemVer = 0; vp.scannerEpisodeLastSeen = c.ts; vp.scannerLastSeen = c.ts; vp.scannerVisible = true; vp.economicEV = L.r4(economia(c.apr, c.spread)); vp.latestEconomicEvaluationTs = now(); vp.ciclosInversao = vp.economicEV <= 0 ? (vp.ciclosInversao || 0) + 1 : 0;
      vp.ciclosFundingDeteriorado = (c.apr < (vp.aprEntrada || c.apr) * FUNDING_DETERIORATION_FRAC) ? (vp.ciclosFundingDeteriorado || 0) + 1 : 0; est.fundingAcum += inc; virtSemVer.delete(c.k); continue; }
    if (c.apr <= 0 || c.score <= 0) { est.contadores.bloqueadas++; est.bloqueios.evNaoPositivo++; if (PERSIST_MIN > 0 && est.candidatoPositivoDesde) delete est.candidatoPositivoDesde[c.k]; continue; }
    // filtro de persistência (só quando ligado): exige N min de EV positivo contínuo antes de entrar.
    if (PERSIST_MIN > 0) { est.candidatoPositivoDesde = est.candidatoPositivoDesde || {};
      if (!est.candidatoPositivoDesde[c.k]) est.candidatoPositivoDesde[c.k] = c.ts;
      if ((c.ts - est.candidatoPositivoDesde[c.k]) < PERSIST_MIN * 60000) { est.contadores.bloqueadas++; est.bloqueios.persistencePending = (est.bloqueios.persistencePending || 0) + 1;
        append(F.diario, { ts: now(), evento: 'bloqueada', k: c.k, exchangeLong: c.long, exchangeShort: c.short, motivo: 'persistencePending', persistidoMs: c.ts - est.candidatoPositivoDesde[c.k] });
        decisoes.push({ k: c.k, acao: 'bloqueada', motivo: 'persistencePending' }); continue; } }
    const livreLong = margemLivre(est, c.long), livreShort = margemLivre(est, c.short); const abertas = Object.keys(est.virtuais).length; let motivo = null;
    if (abertas >= MAXPOS) motivo = 'maxPositionsBlocked';
    else if (MARGEM_PERNA > livreLong || MARGEM_PERNA > livreShort) motivo = 'localBalanceBlocked';
    else if (est.saldosPorExchange[c.long] < CAP_POR_EX * RESERVA || est.saldosPorExchange[c.short] < CAP_POR_EX * RESERVA) motivo = 'reserveBlocked';
    else if (2 * MARGEM_PERNA > EXCHS.reduce((s, e) => s + margemLivre(est, e), 0)) motivo = 'aggregateCapitalBlocked';
    if (motivo) { est.contadores.bloqueadas++; est.bloqueios[motivo]++; append(F.diario, { ts: now(), evento: 'bloqueada', k: c.k, exchangeLong: c.long, exchangeShort: c.short, saldoLong: L.r2(est.saldosPorExchange[c.long]), saldoShort: L.r2(est.saldosPorExchange[c.short]), margemLivreLong: L.r2(livreLong), margemLivreShort: L.r2(livreShort), motivo }); decisoes.push({ k: c.k, acao: 'bloqueada', motivo }); continue; }
    const custoEntrada = NOTIONAL * (2 * TAKER + 2 * SLIP);
    est.saldosPorExchange[c.long] -= MARGEM_PERNA; est.saldosPorExchange[c.short] -= MARGEM_PERNA; est.custosAcum += custoEntrada;
    est.virtuais[c.k] = { k: c.k, sym: c.sym, long: c.long, short: c.short, notional: NOTIONAL, margemPorPerna: MARGEM_PERNA, fundingAcum: 0, custoEntrada, aprEntrada: c.apr, ultimoApr: c.apr, ciclosSemVer: 0, ciclosInversao: 0, ciclosFundingDeteriorado: 0, economicEV: L.r4(c.score), latestEconomicEvaluationTs: now(), scannerVisible: true, scannerLastSeen: c.ts, scannerEpisodeFirstSeen: c.ts, scannerEpisodeLastSeen: c.ts, economicPositiveFirstSeen: c.ts, positionOpenedAt: now(),
      sourceObservationEventId: c.sourceObservationEventId, sourceRankingCycleId: c.sourceRankingCycleId, sourceOpportunityEpisodeId: c.sourceOpportunityEpisodeId, sourceDecisionId: c.sourceDecisionId, sourcePositionId: c.sourcePositionId, entryCycle: cycleId };
    est.contadores.abertas++; virtSemVer.delete(c.k); if (PERSIST_MIN > 0 && est.candidatoPositivoDesde) delete est.candidatoPositivoDesde[c.k]; decisoes.push({ k: c.k, acao: 'abre', sym: c.sym, long: c.long, short: c.short, apr: L.r4(c.apr), physicalEventId: c.physicalEventId, sourceDecisionId: c.sourceDecisionId, sourcePositionId: c.sourcePositionId });
    append(F.diario, { ts: now(), evento: 'abre', k: c.k, apr: L.r4(c.apr), custoEntrada: L.r4(custoEntrada), entryCycle: cycleId, sourceObservationEventId: c.sourceObservationEventId, sourceRankingCycleId: c.sourceRankingCycleId, sourceOpportunityEpisodeId: c.sourceOpportunityEpisodeId, sourceDecisionId: c.sourceDecisionId, sourcePositionId: c.sourcePositionId });
    append(F.ledger, { ts: now(), tipo: 'abre', k: c.k, sourcePositionId: c.sourcePositionId, saldoLong: L.r2(est.saldosPorExchange[c.long]), saldoShort: L.r2(est.saldosPorExchange[c.short]) });
  }
  // ── FECHAMENTO por POLÍTICA PRÉ-REGISTRADA (item 6). scannerLastSeen é FEATURE, nunca gatilho
  // implícito. scanner_stale = comportamento durabilidade (v1.7). economic_inversion = fecha só na
  // inversão econômica sustentada — NÃO por sumiço do scanner. ──
  if (feedAtivo) for (const k of [...virtSemVer]) { const vp = est.virtuais[k]; vp.ciclosSemVer = (vp.ciclosSemVer || 0) + 1; vp.scannerVisible = false; }
  const agora = now();
  // exchangeFailure é um HOOK declarado: a saúde por exchange vive no builder source-health, não no
  // reader. Aqui fica null (nunca dispara sozinho) — honesto, sem fingir detecção que o reader não faz.
  const sourceHealthPorExchange = null;
  for (const k of Object.keys(est.virtuais)) {
    const vp = est.virtuais[k];
    // ── sinais de fechamento (item 4): registrados SEMPRE; nenhum implícito por scanner ──
    const scannerStale = (vp.ciclosSemVer || 0) >= STALE_CICLOS;
    const inversion = (vp.ciclosInversao || 0) >= INVERSION_CICLOS;
    const aprNaoPositivo = (vp.ultimoApr || 0) <= 0;
    const maxHoldingExit = (agora - (vp.positionOpenedAt || agora)) >= MAX_HOLDING_MS;   // política de RISCO
    const fundingDeterioration = (vp.ciclosFundingDeteriorado || 0) >= INVERSION_CICLOS;
    const exchangeFailure = !!(sourceHealthPorExchange && (sourceHealthPorExchange[vp.long] === 'EXCHANGE_UNAVAILABLE' || sourceHealthPorExchange[vp.short] === 'EXCHANGE_UNAVAILABLE'));
    const latestEconomicEvaluationAgeMs = agora - (vp.latestEconomicEvaluationTs || agora);
    let closeReason = null, riskExit = false;
    if (CLOSE_POLICY === 'scanner_stale') { if (scannerStale) closeReason = 'scanner_stale'; else if (aprNaoPositivo) closeReason = 'apr_nonpositive'; }
    else if (CLOSE_POLICY === 'economic_inversion') {
      // NÃO fecha por scanner stale. Fecha por economia/risco EXPLÍCITO.
      if (inversion) closeReason = 'economic_inversion';
      else if (fundingDeterioration) closeReason = 'funding_deterioration';
      else if (exchangeFailure) { closeReason = 'exchange_failure'; riskExit = true; }
      else if (maxHoldingExit) { closeReason = 'max_holding_exit'; riskExit = true; }
    }
    if (!closeReason) continue;
    const custoSaida = vp.notional * (2 * TAKER + 2 * SLIP);
    est.saldosPorExchange[vp.long] += vp.margemPorPerna; est.saldosPorExchange[vp.short] += vp.margemPorPerna; est.custosAcum += custoSaida; est.contadores.fechadas++;
    const pnl = vp.fundingAcum - vp.custoEntrada - custoSaida;
    append(F.diario, { ts: agora, evento: 'fecha', k, funding: L.r4(vp.fundingAcum), pnl: L.r4(pnl), positionOpenedAt: vp.positionOpenedAt, positionClosedAt: agora, closeCycle: cycleId, closeReason, closePolicy: CLOSE_POLICY,
      scannerVisible: !!vp.scannerVisible, scannerLastSeen: vp.scannerLastSeen || vp.scannerEpisodeLastSeen,
      latestEconomicEvaluation: vp.economicEV, latestEconomicEvaluationAgeMs, evalStale: latestEconomicEvaluationAgeMs > EVAL_STALE_MS,
      inversion, riskExit, maxHoldingExit, fundingDeterioration, exchangeFailure, sourceChampionClose: false, policyClose: true, policyCloseReason: closeReason,
      sourceDecisionId: vp.sourceDecisionId, sourcePositionId: vp.sourcePositionId, sourceOpportunityEpisodeId: vp.sourceOpportunityEpisodeId });
    decisoes.push({ k, acao: 'fecha', sym: vp.sym, long: vp.long, short: vp.short, funding: L.r4(vp.fundingAcum), custo: L.r4(vp.custoEntrada + custoSaida), pnl: L.r4(pnl), closeReason, sourcePositionId: vp.sourcePositionId }); delete est.virtuais[k];
  }

  // ── rendimento da reserva ociosa (stablecoin yield) — neutro, sem risco de preço ──
  if (STABLE_YIELD > 0) { const idle = EXCHS.reduce((s, e) => s + (est.saldosPorExchange[e] || 0), 0); est.yieldAcum = (est.yieldAcum || 0) + idle * (STABLE_YIELD / 8760) * (INTERVALO_S / 3600); }
  est.lastCycleId = cycleId;
  // ── CHECKPOINT ATÔMICO (com crash injection) ────────────────────────────────
  persistir(est, true);
  crashIf('before_wal_committed');
  // ── WAL COMMITTED ───────────────────────────────────────────────────────────
  wal.status = 'COMMITTED'; wal.stateHashAfter = stateHash(est); wal.decisoes = decisoes; escreverAtomico(F.wal, wal);
  // ── snapshot por watermark ──────────────────────────────────────────────────
  append(F.snapshots, { committedOffset: cur.byteOffset, eventCount: est.eventCount, accumulatedHash: est.accumulatedEventHash, capital: L.r4(est.capitalInicial + est.fundingAcum + (est.yieldAcum || 0) - est.custosAcum), saldos: est.saldosPorExchange, posicoes: Object.keys(est.virtuais).length, pnl: L.r4(est.fundingAcum + (est.yieldAcum || 0) - est.custosAcum), custos: L.r4(est.custosAcum), funding: L.r4(est.fundingAcum), yield: L.r4(est.yieldAcum || 0), stateHash: stateHash(est) });
  // ── avisos ao Telegram (só ciclos ao vivo; largada é silenciosa) ──
  if (TG_ON && tgLargadaFeita) {
    const capital = est.capitalInicial + est.fundingAcum + (est.yieldAcum || 0) - est.custosAcum;
    for (const d of decisoes) { if (d.acao === 'abre') tgAbre(d, capital); else if (d.acao === 'fecha') tgFecha(d, capital); }
  }
  tgLargadaFeita = true;
}

function persistir(est, comCrash) {
  const capitalAtual = est.capitalInicial + est.fundingAcum + (est.yieldAcum || 0) - est.custosAcum;
  const ck = { ...est, capitalAtual: L.r4(capitalAtual) }; delete ck._recuperado; delete ck._partialAnterior;
  escreverAtomico(F.estado, ck, comCrash);
  fs.writeFileSync(F.heartbeat, JSON.stringify({ pid: process.pid, modo: MODE, label: LABEL, maxPos: MAXPOS, forwardEpochId: est.forwardEpochId, ultimoCiclo: now(), sourceStatus: est.sourceStatus, byteOffset: est.cursor.byteOffset, eventCount: est.eventCount, accumulatedEventHash: est.accumulatedEventHash, lastCycleId: est.lastCycleId, abertas: Object.keys(est.virtuais).length, fechadas: est.contadores.fechadas, capital: L.r4(capitalAtual) }, null, 2));
  try { const l = rd(F.lock, {}); l.heartbeat = now(); fs.writeFileSync(F.lock, JSON.stringify(l)); } catch {}
}

if (!adquirirLock()) { console.log(`[forward-lab ${LABEL}] outra instância viva — saindo`); process.exit(0); }
process.on('SIGINT', () => { try { fs.unlinkSync(F.lock); } catch {} process.exit(0); });
process.on('SIGTERM', () => { try { fs.unlinkSync(F.lock); } catch {} process.exit(0); });
console.log(`[forward-lab ${LABEL}] iniciado — mode ${MODE} ${EXCHS.join('+')} maxPos ${MAXPOS} (checkpoint atômico + WAL), FORWARD, NENHUMA ORDEM`);
umCiclo();
if (!ONCE) setInterval(umCiclo, INTERVALO_S * 1000);
