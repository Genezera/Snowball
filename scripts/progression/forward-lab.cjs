#!/usr/bin/env node
'use strict';
/**
 * v1.5 — Processo live-paper FORWARD isolado e RESISTENTE A PERDA DE EVENTOS.
 * Roda como trial (Bitget+Bybit) ou control/observer-maxN (6 exchanges).
 *
 * Leitor resiliente:
 *  - CURSOR por BYTE OFFSET (não só tempo): sourceFileId, fileIdentity (dev:ino/
 *    birthtime), byteOffset, lineNumber, lastCompleteLineHash, lastTimestamp,
 *    lastOpportunityKey, partial (buffer da linha incompleta).
 *  - BUFFER de linha parcial persistente: processa só linhas completas; guarda o
 *    resto; concatena no próximo ciclo; processa quando o JSON fecha (exatamente 1×).
 *  - ROTAÇÃO/TRUNCAMENTO: size<offset ou identidade mudou => SOURCE_TRUNCATED/
 *    SOURCE_ROTATED/SOURCE_IDENTITY_CHANGED, SUSPENDE (não reinicia do zero).
 *  - observationEventId determinístico (hash de ts|key|apr|spread|vol|cycle|linha)
 *    + dedup por ele (não só por timestamp).
 *  - ORDEM (ts, offset, key) e RANKING (score desc, EV desc, key asc) determinísticos.
 *  - forwardEpochId comum: se mudar, preserva estado antigo como WARMUP_NOT_COMPARABLE.
 * NENHUMA ordem, NENHUM saldo real.
 *
 * Uso: node forward-lab.cjs --mode <trial|control> [--maxpos N] [--label X]
 *      [--intervalo 300] [--once]
 */
const L = require('./lib-progression.cjs');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const args = process.argv.slice(2);
const opt = (n, d) => (args.includes(n) ? args[args.indexOf(n) + 1] : d);
const MODE = opt('--mode', 'trial');
const ONCE = args.includes('--once');
const INTERVALO_S = Number(opt('--intervalo', 300));
const MAXPOS = args.includes('--maxpos') ? Number(opt('--maxpos', L.MAX_POSICOES)) : L.MAX_POSICOES;
const LABEL = opt('--label', MODE);
const EXCHS = MODE === 'control' ? L.EXCHANGES : ['bitget', 'bybit'];
const CAP_POR_EX = L.ALVO_POR_EXCHANGE;
const TAKER = 0.0005, SLIP = 0.0002, CUSTO_FRAC = 4 * TAKER + 4 * SLIP;
const NOTIONAL = L.ALVO_POR_EXCHANGE, MARGEM_PERNA = NOTIONAL / L.ALAVANCAGEM;
const STALE_CICLOS = 3, DEDUP_MAX = 20000;

const BASE = path.join(L.ROOT, 'auditoria', 'progression', 'forward');
const DIR = path.join(BASE, LABEL);
fs.mkdirSync(DIR, { recursive: true });
const F = { estado: path.join(DIR, 'estado.json'), ledger: path.join(DIR, 'ledger.jsonl'), diario: path.join(DIR, 'diario.jsonl'), heartbeat: path.join(DIR, 'heartbeat.json'), lock: path.join(DIR, 'lock.json') };
const OBS = process.env.FORWARD_OBS || path.join(L.ROOT, 'vigilancia', 'arquivo-observacoes.jsonl');
const EPOCH = process.env.FORWARD_EPOCH || path.join(BASE, 'epoch.json');
const now = () => Date.now();
const rd = (p, d) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return d; } };
const append = (p, o) => { try { fs.appendFileSync(p, JSON.stringify(o) + '\n'); } catch {} };
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');

function fileIdentity() { try { const st = fs.statSync(OBS); return { id: `${st.dev}:${st.ino || Math.round(st.birthtimeMs)}`, size: st.size }; } catch { return { id: null, size: 0 }; } }

function adquirirLock() { const c = rd(F.lock, null); if (c && c.heartbeat && now() - c.heartbeat < 90_000) return false; fs.writeFileSync(F.lock, JSON.stringify({ pid: process.pid, heartbeat: now() })); return true; }

function estadoInicial(epoch) {
  const saldos = {}; for (const e of EXCHS) saldos[e] = CAP_POR_EX;
  const fi = fileIdentity();
  return {
    modo: MODE, label: LABEL, maxPos: MAXPOS, iniciadoEm: now(),
    forwardEpochId: epoch ? epoch.forwardEpochId : null,
    cursor: { sourceFileId: OBS, fileIdentity: fi.id, byteOffset: epoch ? epoch.byteOffset : fi.size, lineNumber: epoch ? epoch.lineNumber : 0, lastCompleteLineHash: null, lastTimestamp: epoch ? epoch.timestamp : now(), lastOpportunityKey: null, partial: '' },
    saldosPorExchange: saldos, capitalInicial: EXCHS.length * CAP_POR_EX,
    virtuais: {}, fundingAcum: 0, custosAcum: 0, eventCount: 0, accumulatedEventHash: '',
    sourceStatus: 'OK',
    contadores: { avaliadas: 0, abertas: 0, fechadas: 0, bloqueadas: 0, dedupIgnorados: 0 },
    bloqueios: { aggregateCapitalBlocked: 0, localBalanceBlocked: 0, reserveBlocked: 0, maxPositionsBlocked: 0, minOrderBlocked: 0, evNaoPositivo: 0 },
    dedup: [],
  };
}

function carregarEstado() {
  const epoch = rd(EPOCH, null);
  let est = rd(F.estado, null);
  // WARMUP: se não há epoch no estado ou difere do epoch atual, preserva o antigo e recomeça
  if (epoch && (!est || est.forwardEpochId !== epoch.forwardEpochId)) {
    if (est) { try { fs.writeFileSync(path.join(DIR, `warmup-${est.forwardEpochId || 'none'}.json`), JSON.stringify({ status: 'WARMUP_NOT_COMPARABLE', preservadoEm: now(), estado: est }, null, 2)); } catch {} }
    est = estadoInicial(epoch);
  } else if (!est) est = estadoInicial(epoch);
  if (!est.dedup) est.dedup = [];
  return est;
}

function economia(apr, spread) { const c = CUSTO_FRAC + Math.max(0, spread || 0); return apr * 24 / 8760 - c; } // EV 24h/notional (score)
function margemLivre(est, ex) { return (est.saldosPorExchange[ex] || 0) * (1 - L.RESERVA); }

function umCiclo() {
  const est = carregarEstado();
  const cur = est.cursor;
  const fi = fileIdentity();

  // ── rotação / truncamento / mudança de identidade ──────────────────────────
  if (fi.id == null) { est.sourceStatus = 'SOURCE_UNAVAILABLE'; persistir(est); return; }
  if (cur.fileIdentity && fi.id !== cur.fileIdentity) { est.sourceStatus = 'SOURCE_IDENTITY_CHANGED'; append(F.diario, { ts: now(), evento: 'source_status', status: 'SOURCE_IDENTITY_CHANGED', de: cur.fileIdentity, para: fi.id }); persistir(est); return; }
  if (fi.size < cur.byteOffset) { est.sourceStatus = 'SOURCE_TRUNCATED'; append(F.diario, { ts: now(), evento: 'source_status', status: 'SOURCE_TRUNCATED', size: fi.size, byteOffset: cur.byteOffset }); persistir(est); return; }
  est.sourceStatus = 'OK'; cur.fileIdentity = fi.id;

  // ── lê [byteOffset, size), concatena partial, processa só linhas completas ──
  let bloco = '';
  if (fi.size > cur.byteOffset) { const fd = fs.openSync(OBS, 'r'); const buf = Buffer.alloc(fi.size - cur.byteOffset); fs.readSync(fd, buf, 0, buf.length, cur.byteOffset); fs.closeSync(fd); bloco = buf.toString('utf8'); }
  const content = (cur.partial || '') + bloco;
  const lastNL = content.lastIndexOf('\n');
  const completo = lastNL >= 0 ? content.slice(0, lastNL + 1) : '';
  cur.partial = lastNL >= 0 ? content.slice(lastNL + 1) : content;   // buffer da linha incompleta
  cur.byteOffset = fi.size;                                          // todos os bytes lidos p/ o buffer

  const dedupSet = new Set(est.dedup);
  const batch = [];
  for (const linha of completo.split('\n')) {
    if (!linha) continue; cur.lineNumber++;
    let o; try { o = JSON.parse(linha); } catch { continue; } // linha corrompida: pula
    if (!o.k || o.apr == null) continue;
    const eventId = sha(`${o.ts}|${o.k}|${o.apr}|${o.spread || 0}|${o.vol || 0}|${o.cycle || ''}|${sha(linha).slice(0, 12)}`).slice(0, 20);
    if (dedupSet.has(eventId)) { est.contadores.dedupIgnorados++; continue; } // dedup por observationEventId
    dedupSet.add(eventId);
    const [sym, long, short] = o.k.split('|');
    batch.push({ eventId, ts: o.ts, k: o.k, sym, long, short, apr: o.apr, spread: o.spread || 0, vol: o.vol || 0 });
    cur.lastCompleteLineHash = sha(linha).slice(0, 16); cur.lastTimestamp = o.ts; cur.lastOpportunityKey = o.k;
    est.accumulatedEventHash = sha(est.accumulatedEventHash + eventId).slice(0, 32); est.eventCount++;
  }
  est.dedup = [...dedupSet].slice(-DEDUP_MAX);

  // ── ordem determinística (ts, offset(=ordem de leitura), key) + só exchanges do modo ──
  batch.forEach((b, i) => { b.ordem = i; });
  batch.sort((a, b) => a.ts - b.ts || a.ordem - b.ordem || (a.k < b.k ? -1 : a.k > b.k ? 1 : 0));
  const candidatas = batch.filter((b) => EXCHS.includes(b.long) && EXCHS.includes(b.short));
  // ranking determinístico: score desc, EV desc, key asc
  candidatas.forEach((c) => { c.score = economia(c.apr, c.spread); c.ev = c.score * NOTIONAL; });
  candidatas.sort((a, b) => b.score - a.score || b.ev - a.ev || (a.k < b.k ? -1 : a.k > b.k ? 1 : 0));

  const virtSemVer = new Set(Object.keys(est.virtuais));
  for (const c of candidatas) {
    est.contadores.avaliadas++;
    if (est.virtuais[c.k]) { const vp = est.virtuais[c.k]; const inc = NOTIONAL * (c.apr / 8760) * (INTERVALO_S / 3600); vp.fundingAcum += inc; vp.ultimoApr = c.apr; vp.ciclosSemVer = 0; vp.scannerEpisodeLastSeen = c.ts; est.fundingAcum += inc; virtSemVer.delete(c.k); continue; }
    if (c.apr <= 0 || c.score <= 0) { est.contadores.bloqueadas++; est.bloqueios.evNaoPositivo++; continue; }
    if (NOTIONAL < L.MIN_NOTIONAL) { est.contadores.bloqueadas++; est.bloqueios.minOrderBlocked++; continue; }
    const livreLong = margemLivre(est, c.long), livreShort = margemLivre(est, c.short);
    const abertas = Object.keys(est.virtuais).length; let motivo = null;
    if (abertas >= MAXPOS) motivo = 'maxPositionsBlocked';
    else if (MARGEM_PERNA > livreLong || MARGEM_PERNA > livreShort) motivo = 'localBalanceBlocked';
    else if (est.saldosPorExchange[c.long] < CAP_POR_EX * L.RESERVA || est.saldosPorExchange[c.short] < CAP_POR_EX * L.RESERVA) motivo = 'reserveBlocked';
    else if (2 * MARGEM_PERNA > EXCHS.reduce((s, e) => s + margemLivre(est, e), 0)) motivo = 'aggregateCapitalBlocked';
    if (motivo) { est.contadores.bloqueadas++; est.bloqueios[motivo]++; append(F.diario, { ts: now(), evento: 'bloqueada', k: c.k, sym: c.sym, exchangeLong: c.long, exchangeShort: c.short, saldoLong: L.r2(est.saldosPorExchange[c.long]), saldoShort: L.r2(est.saldosPorExchange[c.short]), margemLivreLong: L.r2(livreLong), margemLivreShort: L.r2(livreShort), reservaLocal: L.r2(CAP_POR_EX * L.RESERVA), capitalPorPerna: L.r2(MARGEM_PERNA), motivo }); continue; }
    const custoEntrada = NOTIONAL * (2 * TAKER + 2 * SLIP);
    est.saldosPorExchange[c.long] -= MARGEM_PERNA; est.saldosPorExchange[c.short] -= MARGEM_PERNA; est.custosAcum += custoEntrada;
    est.virtuais[c.k] = { k: c.k, sym: c.sym, long: c.long, short: c.short, notional: NOTIONAL, margemPorPerna: MARGEM_PERNA, fundingAcum: 0, custoEntrada, ultimoApr: c.apr, ciclosSemVer: 0,
      scannerEpisodeFirstSeen: c.ts, scannerEpisodeLastSeen: c.ts, economicPositiveFirstSeen: c.ts, positionOpenedAt: now() };
    est.contadores.abertas++; virtSemVer.delete(c.k);
    append(F.diario, { ts: now(), evento: 'abre', k: c.k, sym: c.sym, apr: L.r4(c.apr), custoEntrada: L.r4(custoEntrada) });
    append(F.ledger, { ts: now(), tipo: 'abre', k: c.k, saldoLong: L.r2(est.saldosPorExchange[c.long]), saldoShort: L.r2(est.saldosPorExchange[c.short]) });
  }
  // item 8: distingue opportunityAbsent (feed ativo, chave sumiu) de feedUnavailable
  // (ciclo SEM nenhum evento = collector/feed parado) — NÃO encerra durante indisponibilidade global.
  const feedAtivo = batch.length > 0;
  if (!feedAtivo) { if (bloco.length === 0) est.sourceStatus = 'FEED_UNAVAILABLE_NO_EVENTS'; persistir(est); return; }
  for (const k of virtSemVer) { const vp = est.virtuais[k]; vp.ciclosSemVer = (vp.ciclosSemVer || 0) + 1;
    if (vp.ciclosSemVer >= STALE_CICLOS || (vp.ultimoApr || 0) <= 0) {
      const custoSaida = vp.notional * (2 * TAKER + 2 * SLIP);
      est.saldosPorExchange[vp.long] += vp.margemPorPerna; est.saldosPorExchange[vp.short] += vp.margemPorPerna; est.custosAcum += custoSaida; est.contadores.fechadas++;
      const pnl = vp.fundingAcum - vp.custoEntrada - custoSaida;
      append(F.diario, { ts: now(), evento: 'fecha', k, sym: vp.sym, funding: L.r4(vp.fundingAcum), pnl: L.r4(pnl), positionOpenedAt: vp.positionOpenedAt, positionClosedAt: now(), scannerEpisodeLastSeen: vp.scannerEpisodeLastSeen, motivo: vp.ciclosSemVer >= STALE_CICLOS ? 'desapareceu' : 'apr<=0' });
      delete est.virtuais[k];
    }
  }
  persistir(est);
}

function persistir(est) {
  const capitalAtual = est.capitalInicial + est.fundingAcum - est.custosAcum;
  fs.writeFileSync(F.estado, JSON.stringify({ ...est, capitalAtual: L.r4(capitalAtual) }, null, 2));
  fs.writeFileSync(F.heartbeat, JSON.stringify({ pid: process.pid, modo: MODE, label: LABEL, maxPos: MAXPOS, forwardEpochId: est.forwardEpochId, ultimoCiclo: now(), sourceStatus: est.sourceStatus, byteOffset: est.cursor.byteOffset, eventCount: est.eventCount, accumulatedEventHash: est.accumulatedEventHash, abertas: Object.keys(est.virtuais).length, fechadas: est.contadores.fechadas, capital: L.r4(capitalAtual) }, null, 2));
  try { const l = rd(F.lock, {}); l.heartbeat = now(); fs.writeFileSync(F.lock, JSON.stringify(l)); } catch {}
}

if (!adquirirLock()) { console.log(`[forward-lab ${LABEL}] outra instância viva — saindo`); process.exit(0); }
process.on('SIGINT', () => { try { fs.unlinkSync(F.lock); } catch {} process.exit(0); });
process.on('SIGTERM', () => { try { fs.unlinkSync(F.lock); } catch {} process.exit(0); });
console.log(`[forward-lab ${LABEL}] iniciado — mode ${MODE} ${EXCHS.join('+')} US$${EXCHS.length * CAP_POR_EX} maxPos ${MAXPOS} (byte-offset cursor), FORWARD, NENHUMA ORDEM`);
umCiclo();
if (!ONCE) setInterval(umCiclo, INTERVALO_S * 1000);
