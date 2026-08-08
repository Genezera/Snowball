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
const MODE = opt('--mode', 'trial'), ONCE = args.includes('--once');
const INTERVALO_S = Number(opt('--intervalo', 300));
const MAXPOS = args.includes('--maxpos') ? Number(opt('--maxpos', L.MAX_POSICOES)) : L.MAX_POSICOES;
const LABEL = opt('--label', MODE);
const EXCHS = MODE === 'control' ? L.EXCHANGES : ['bitget', 'bybit'];
const CAP_POR_EX = L.ALVO_POR_EXCHANGE;
const TAKER = 0.0005, SLIP = 0.0002, CUSTO_FRAC = 4 * TAKER + 4 * SLIP;
const NOTIONAL = L.ALVO_POR_EXCHANGE, MARGEM_PERNA = NOTIONAL / L.ALAVANCAGEM;
const STALE_CICLOS = 3, DEDUP_MAX = 20000, LATE_MS = 10 * 60000;

const BASE = path.join(L.ROOT, 'auditoria', 'progression', 'forward');
const DIR = path.join(BASE, LABEL); fs.mkdirSync(DIR, { recursive: true });
const F = { estado: path.join(DIR, 'estado.json'), prev: path.join(DIR, 'estado.prev.json'), wal: path.join(DIR, 'wal.json'), ledger: path.join(DIR, 'ledger.jsonl'), diario: path.join(DIR, 'diario.jsonl'), heartbeat: path.join(DIR, 'heartbeat.json'), lock: path.join(DIR, 'lock.json'), snapshots: path.join(DIR, 'snapshots.jsonl') };
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

// ── escrita ATÔMICA: prev backup, tmp, fsync, rename atômico (crash-injectável) ──
function escreverAtomico(p, obj, comCrash) {
  const tmp = p + '.tmp';
  try { if (fs.existsSync(p)) fs.copyFileSync(p, F.prev); } catch {}
  const fd = fs.openSync(tmp, 'w');
  fs.writeSync(fd, JSON.stringify(obj, null, 2));
  if (comCrash) crashIf('during_tmp_write');
  fs.fsyncSync(fd); fs.closeSync(fd);
  if (comCrash) crashIf('after_fsync');
  if (comCrash) crashIf('before_rename');
  fs.renameSync(tmp, p);                    // rename atômico (libuv usa MOVEFILE_REPLACE_EXISTING no Windows)
  if (comCrash) crashIf('after_rename');
}

function estadoInicial(epoch) {
  const saldos = {}; for (const e of EXCHS) saldos[e] = CAP_POR_EX;
  const fi = fileIdentity();
  return { modo: MODE, label: LABEL, maxPos: MAXPOS, iniciadoEm: now(), forwardEpochId: epoch ? epoch.forwardEpochId : null,
    cursor: { sourceFileId: OBS, fileIdentity: fi.id, byteOffset: epoch ? epoch.byteOffset : fi.size, lineNumber: epoch ? epoch.lineNumber : 0, lastCompleteLineHash: null, lastTimestamp: epoch ? epoch.timestamp : now(), lastOpportunityKey: null, partial: '' },
    saldosPorExchange: saldos, capitalInicial: EXCHS.length * CAP_POR_EX, virtuais: {}, fundingAcum: 0, custosAcum: 0,
    eventCount: 0, accumulatedEventHash: '', lastCycleId: 0, sourceStatus: 'OK', lateEvents: 0,
    contadores: { avaliadas: 0, abertas: 0, fechadas: 0, bloqueadas: 0, dedupIgnorados: 0 },
    bloqueios: { aggregateCapitalBlocked: 0, localBalanceBlocked: 0, reserveBlocked: 0, maxPositionsBlocked: 0, minOrderBlocked: 0, evNaoPositivo: 0 },
    recentEventIds: [] };
}

function carregarEstado() {
  const epoch = rd(EPOCH, null);
  let est = rd(F.estado, null); if (!est) est = rd(F.prev, null); // recupera do prev se checkpoint corrompido/ausente
  if (epoch && (!est || est.forwardEpochId !== epoch.forwardEpochId)) {
    if (est) { try { fs.writeFileSync(path.join(DIR, `warmup-${est.forwardEpochId || 'none'}.json`), JSON.stringify({ status: 'WARMUP_NOT_COMPARABLE', preservadoEm: now(), estado: est }, null, 2)); } catch {} }
    est = estadoInicial(epoch);
  } else if (!est) est = estadoInicial(epoch);
  if (!est.recentEventIds) est.recentEventIds = [];
  // recuperação via WAL: PREPARED sem COMMITTED = ciclo incompleto → resume do byteOffset (idempotente)
  const wal = rd(F.wal, null);
  est._recuperado = !!(wal && wal.status === 'PREPARED' && wal.cycleId > (est.lastCycleId || 0));
  return est;
}

function economia(apr, spread) { const c = CUSTO_FRAC + Math.max(0, spread || 0); return apr * 24 / 8760 - c; }
function margemLivre(est, ex) { return (est.saldosPorExchange[ex] || 0) * (1 - L.RESERVA); }
function stateHash(est) { return sha(JSON.stringify({ so: est.cursor.byteOffset, ec: est.eventCount, aeh: est.accumulatedEventHash, sal: est.saldosPorExchange, vi: Object.keys(est.virtuais).sort(), fu: L.r4(est.fundingAcum), cu: L.r4(est.custosAcum) })).slice(0, 24); }

function umCiclo() {
  const est = carregarEstado();
  const cur = est.cursor; const fi = fileIdentity();
  if (fi.id == null) { est.sourceStatus = 'SOURCE_UNAVAILABLE'; persistir(est); return; }
  if (cur.fileIdentity && fi.id !== cur.fileIdentity) { est.sourceStatus = 'SOURCE_IDENTITY_CHANGED'; append(F.diario, { ts: now(), evento: 'source_status', status: 'SOURCE_IDENTITY_CHANGED', de: cur.fileIdentity, para: fi.id }); persistir(est); return; }
  if (fi.size < cur.byteOffset) { est.sourceStatus = 'SOURCE_TRUNCATED'; append(F.diario, { ts: now(), evento: 'source_status', status: 'SOURCE_TRUNCATED', size: fi.size, byteOffset: cur.byteOffset }); persistir(est); return; }
  est.sourceStatus = 'OK'; cur.fileIdentity = fi.id;

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
    const [sym, long, short] = o.k.split('|');
    const ingestionTime = now(), latenessMs = ingestionTime - o.ts, lateEvent = latenessMs > LATE_MS;
    if (lateEvent) est.lateEvents++;
    batch.push({ physicalEventId, logicalObservationHash, ts: o.ts, ingestionTime, latenessMs, lateEvent, sourceOffset: byteStart, k: o.k, sym, long, short, apr: o.apr, spread: o.spread || 0, vol: o.vol || 0 });
    cur.lastCompleteLineHash = lineHash; cur.lastTimestamp = o.ts; cur.lastOpportunityKey = o.k;
    est.accumulatedEventHash = sha(est.accumulatedEventHash + physicalEventId).slice(0, 32); est.eventCount++;
  }
  est.recentEventIds = [...dedupSet].slice(-DEDUP_MAX);

  // ── WAL PREPARED ────────────────────────────────────────────────────────────
  const cycleId = (est.lastCycleId || 0) + 1;
  const stateHashBefore = stateHash(est);
  const wal = { cycleId, inputStartOffset: startOffset, inputEndOffset: cur.byteOffset, eventIds: batch.map((b) => b.physicalEventId), stateHashBefore, decisoes: [], stateHashAfter: null, status: 'PREPARED', ts: now() };
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
    if (est.virtuais[c.k]) { const vp = est.virtuais[c.k]; const inc = NOTIONAL * (c.apr / 8760) * (INTERVALO_S / 3600); vp.fundingAcum += inc; vp.ultimoApr = c.apr; vp.ciclosSemVer = 0; vp.scannerEpisodeLastSeen = c.ts; est.fundingAcum += inc; virtSemVer.delete(c.k); continue; }
    if (c.apr <= 0 || c.score <= 0) { est.contadores.bloqueadas++; est.bloqueios.evNaoPositivo++; continue; }
    const livreLong = margemLivre(est, c.long), livreShort = margemLivre(est, c.short); const abertas = Object.keys(est.virtuais).length; let motivo = null;
    if (abertas >= MAXPOS) motivo = 'maxPositionsBlocked';
    else if (MARGEM_PERNA > livreLong || MARGEM_PERNA > livreShort) motivo = 'localBalanceBlocked';
    else if (est.saldosPorExchange[c.long] < CAP_POR_EX * L.RESERVA || est.saldosPorExchange[c.short] < CAP_POR_EX * L.RESERVA) motivo = 'reserveBlocked';
    else if (2 * MARGEM_PERNA > EXCHS.reduce((s, e) => s + margemLivre(est, e), 0)) motivo = 'aggregateCapitalBlocked';
    if (motivo) { est.contadores.bloqueadas++; est.bloqueios[motivo]++; append(F.diario, { ts: now(), evento: 'bloqueada', k: c.k, exchangeLong: c.long, exchangeShort: c.short, saldoLong: L.r2(est.saldosPorExchange[c.long]), saldoShort: L.r2(est.saldosPorExchange[c.short]), margemLivreLong: L.r2(livreLong), margemLivreShort: L.r2(livreShort), motivo }); decisoes.push({ k: c.k, acao: 'bloqueada', motivo }); continue; }
    const custoEntrada = NOTIONAL * (2 * TAKER + 2 * SLIP);
    est.saldosPorExchange[c.long] -= MARGEM_PERNA; est.saldosPorExchange[c.short] -= MARGEM_PERNA; est.custosAcum += custoEntrada;
    est.virtuais[c.k] = { k: c.k, sym: c.sym, long: c.long, short: c.short, notional: NOTIONAL, margemPorPerna: MARGEM_PERNA, fundingAcum: 0, custoEntrada, ultimoApr: c.apr, ciclosSemVer: 0, scannerEpisodeFirstSeen: c.ts, scannerEpisodeLastSeen: c.ts, economicPositiveFirstSeen: c.ts, positionOpenedAt: now() };
    est.contadores.abertas++; virtSemVer.delete(c.k); decisoes.push({ k: c.k, acao: 'abre', physicalEventId: c.physicalEventId });
    append(F.diario, { ts: now(), evento: 'abre', k: c.k, apr: L.r4(c.apr), custoEntrada: L.r4(custoEntrada) });
    append(F.ledger, { ts: now(), tipo: 'abre', k: c.k, saldoLong: L.r2(est.saldosPorExchange[c.long]), saldoShort: L.r2(est.saldosPorExchange[c.short]) });
  }
  if (feedAtivo) for (const k of virtSemVer) { const vp = est.virtuais[k]; vp.ciclosSemVer = (vp.ciclosSemVer || 0) + 1;
    if (vp.ciclosSemVer >= STALE_CICLOS || (vp.ultimoApr || 0) <= 0) { const custoSaida = vp.notional * (2 * TAKER + 2 * SLIP);
      est.saldosPorExchange[vp.long] += vp.margemPorPerna; est.saldosPorExchange[vp.short] += vp.margemPorPerna; est.custosAcum += custoSaida; est.contadores.fechadas++;
      const pnl = vp.fundingAcum - vp.custoEntrada - custoSaida;
      append(F.diario, { ts: now(), evento: 'fecha', k, funding: L.r4(vp.fundingAcum), pnl: L.r4(pnl), positionOpenedAt: vp.positionOpenedAt, positionClosedAt: now(), scannerEpisodeLastSeen: vp.scannerEpisodeLastSeen });
      decisoes.push({ k, acao: 'fecha', pnl: L.r4(pnl) }); delete est.virtuais[k]; } }

  est.lastCycleId = cycleId;
  // ── CHECKPOINT ATÔMICO (com crash injection) ────────────────────────────────
  persistir(est, true);
  crashIf('before_wal_committed');
  // ── WAL COMMITTED ───────────────────────────────────────────────────────────
  wal.status = 'COMMITTED'; wal.stateHashAfter = stateHash(est); wal.decisoes = decisoes; escreverAtomico(F.wal, wal);
  // ── snapshot por watermark ──────────────────────────────────────────────────
  append(F.snapshots, { committedOffset: cur.byteOffset, eventCount: est.eventCount, accumulatedHash: est.accumulatedEventHash, capital: L.r4(est.capitalInicial + est.fundingAcum - est.custosAcum), saldos: est.saldosPorExchange, posicoes: Object.keys(est.virtuais).length, pnl: L.r4(est.fundingAcum - est.custosAcum), custos: L.r4(est.custosAcum), funding: L.r4(est.fundingAcum), stateHash: stateHash(est) });
}

function persistir(est, comCrash) {
  const capitalAtual = est.capitalInicial + est.fundingAcum - est.custosAcum;
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
