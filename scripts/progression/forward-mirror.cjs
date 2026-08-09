#!/usr/bin/env node
'use strict';
/**
 * v1.8 — ITEM 2. MIRROR CONTROL. Espelho do Champion. O Champion NÃO expõe um log append-only de
 * eventos de posição (só o snapshot estado.json com posicoes[] + agregados). Portanto este Mirror é
 * honestamente declarado **SNAPSHOT_MIRROR_INCOMPLETE**: DERIVA eventos do DIFF de snapshots
 * (OPEN / SCALE / FUNDING_SETTLED / COST_APPLIED / CLOSE) — não consome eventos nativos. Isso significa:
 *   - reconciliação FINANCEIRA (capital/funding/custos ≤US$0,01) é provável na granularidade do snapshot;
 *   - "zero evento perdido" a nível de evento NÃO é provável (eventos intra-ciclo do Champion podem
 *     não deixar rastro no snapshot). Não finge fidelidade event-level.
 * Cada evento derivado: championEventId (SINTÉTICO, prefixo synth_), championPositionId, cycleId,
 * timestamp, payload, stateHashAfter. Idempotente: reprocessar o mesmo snapshot não duplica (dedup por
 * championEventId). READ-ONLY quanto ao Champion; nenhuma ordem.
 * Uso: node forward-mirror.cjs [--intervalo 300] [--once]
 */
const L = require('./lib-progression.cjs');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const args = process.argv.slice(2);
const opt = (n, d) => (args.includes(n) ? args[args.indexOf(n) + 1] : d);
const ONCE = args.includes('--once');
const INTERVALO_S = Number(opt('--intervalo', 300));
const BASE = path.join(L.ROOT, 'auditoria', 'progression', 'economic', 'mirror');
fs.mkdirSync(BASE, { recursive: true });
const F = { estado: path.join(BASE, 'estado.json'), tmp: path.join(BASE, 'estado.json.tmp'), eventos: path.join(BASE, 'eventos.jsonl'), ledger: path.join(BASE, 'ledger.jsonl'), diario: path.join(BASE, 'diario.jsonl'), heartbeat: path.join(BASE, 'heartbeat.json'), lock: path.join(BASE, 'lock.json') };
const EPOCH = path.join(L.ROOT, 'auditoria', 'progression', 'economic', 'epoch.json');
const TAKER = 0.0005, SLIP = 0.0002, CUSTO_PERNA_FRAC = 2 * TAKER + 2 * SLIP;
const DEDUP_MAX = 50000;
const now = () => Date.now();
const rd = (p, d) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return d; } };
const append = (p, o) => { try { fs.appendFileSync(p, JSON.stringify(o) + '\n'); } catch {} };
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
function escreverAtomico(p, obj) { const fd = fs.openSync(F.tmp, 'w'); fs.writeSync(fd, JSON.stringify(obj, null, 2)); fs.fsyncSync(fd); fs.closeSync(fd); fs.renameSync(F.tmp, p); }
function adquirirLock() { const c = rd(F.lock, null); if (c && c.heartbeat && now() - c.heartbeat < 90_000) return false; fs.writeFileSync(F.lock, JSON.stringify({ pid: process.pid, heartbeat: now() })); return true; }
const chaveChampion = (p) => `${p.symbol}:${p.abertaEm}`;
function epochId() { const e = rd(EPOCH, null); return e ? e.economicForwardEpochId : 'no-epoch'; }
function stateHash(est) { return sha(JSON.stringify({ ab: Object.keys(est.aberturas).sort().map((k) => [k, L.r4(est.aberturas[k].fundingMirror), est.aberturas[k].estagio]), fr: L.r4(est.fundingRealizado), cr: L.r4(est.custosRealizados), fe: est.fechadas })).slice(0, 24); }

function umCiclo() {
  const { estado: champ, asOf } = L.loadChampion();
  if (!champ) { append(F.diario, { ts: now(), evento: 'source_status', status: 'CHAMPION_UNAVAILABLE' }); return; }
  const eid = epochId();
  const est = rd(F.estado, null) || { schema: 'snowball.mirror.v1_8', mirrorMode: 'SNAPSHOT_MIRROR_INCOMPLETE', economicForwardEpochId: eid, iniciadoEm: now(), aberturas: {}, processedEventIds: [], cycleId: 0, fechadas: 0, fundingRealizado: 0, custosRealizados: 0, eventos: 0, eventosDuplicadosIgnorados: 0 };
  est.mirrorMode = 'SNAPSHOT_MIRROR_INCOMPLETE';
  est.cycleId++;
  const dedup = new Set(est.processedEventIds || []);
  // emite um evento derivado (idempotente por championEventId sintético)
  const emit = (type, ck, championPositionId, payload) => {
    const disc = type === 'FUNDING_SETTLED' ? `f${payload.fundingCumulativo}` : type === 'SCALE' ? `s${payload.paraEstagio}` : type === 'COST_APPLIED' ? `c${payload.fase}` : type;
    const championEventId = 'synth_' + sha(`${eid}|${championPositionId}|${type}|${disc}`).slice(0, 20);
    if (dedup.has(championEventId)) { est.eventosDuplicadosIgnorados++; return false; }
    dedup.add(championEventId);
    const stateHashAfter = stateHash(est);
    const ev = { championEventId, championEventIdSintetico: true, type, championPositionId, sourcePositionId: sha(`${eid}|champion:${ck}`).slice(0, 24), mirrorPositionId: (est.aberturas[ck] || {}).mirrorPositionId || sha(`${eid}|mirror:${ck}`).slice(0, 24), cycleId: est.cycleId, timestamp: now(), payload, stateHashAfter };
    append(F.eventos, ev); append(F.ledger, ev); est.eventos++;
    return true;
  };

  const abertasChampion = (champ.posicoes || []);
  const vistas = new Set();
  for (const p of abertasChampion) {
    const ck = chaveChampion(p); vistas.add(ck);
    const championPositionId = ck; const exch = [p.exchangeLong, p.exchangeShort];
    const notional = L.r4(p.notionalPorPerna || 0); const fundingAtual = L.r4(p.fundingAcumulado || 0);
    let m = est.aberturas[ck];
    if (!m) {
      const custoEntrada = L.r4(notional * CUSTO_PERNA_FRAC);
      m = est.aberturas[ck] = { mirrorPositionId: sha(`${eid}|mirror:${ck}`).slice(0, 24), sourcePositionId: sha(`${eid}|champion:${ck}`).slice(0, 24), championPositionId, exchanges: exch, notional, estagio: p.estagio || 1, fundingMirror: 0, custoEntrada, abertoEm: now(), championAbertaEm: p.abertaEm };
      emit('OPEN', ck, championPositionId, { exchanges: exch, notional, estagio: m.estagio, championAbertaEm: p.abertaEm });
      est.custosRealizados = L.r4(est.custosRealizados + custoEntrada);
      emit('COST_APPLIED', ck, championPositionId, { fase: 'entry', custo: custoEntrada });
      // catch-up de funding acumulado (snapshot): warmup pode já ter fundingAcumulado>0 no Champion
      if (fundingAtual !== m.fundingMirror) { emit('FUNDING_SETTLED', ck, championPositionId, { deltaFunding: fundingAtual, fundingCumulativo: fundingAtual, catchUp: true }); m.fundingMirror = fundingAtual; }
    } else {
      if ((p.estagio || 1) !== m.estagio) { emit('SCALE', ck, championPositionId, { deEstagio: m.estagio, paraEstagio: p.estagio || 1, notional }); m.estagio = p.estagio || 1; }
      if (fundingAtual !== m.fundingMirror) { const delta = L.r4(fundingAtual - m.fundingMirror); emit('FUNDING_SETTLED', ck, championPositionId, { deltaFunding: delta, fundingCumulativo: fundingAtual }); m.fundingMirror = fundingAtual; }
    }
  }
  for (const ck of Object.keys(est.aberturas)) {
    if (vistas.has(ck)) continue;
    const m = est.aberturas[ck]; const custoSaida = L.r4(m.notional * CUSTO_PERNA_FRAC);
    emit('COST_APPLIED', ck, m.championPositionId, { fase: 'exit', custo: custoSaida });
    est.custosRealizados = L.r4(est.custosRealizados + custoSaida); est.fundingRealizado = L.r4(est.fundingRealizado + m.fundingMirror); est.fechadas++;
    const pnl = L.r4(m.fundingMirror - m.custoEntrada - custoSaida);
    emit('CLOSE', ck, m.championPositionId, { funding: m.fundingMirror, custoSaida, pnl });
    delete est.aberturas[ck];
  }

  est.processedEventIds = [...dedup].slice(-DEDUP_MAX);
  est.abertasCount = Object.keys(est.aberturas).length;
  est.stateHash = stateHash(est);
  est.championCapital = L.r4(champ.capital); est.championFundingTotal = L.r4(champ.fundingTotal); est.championCustosTotal = L.r4(champ.custosTotal); est.asOf = asOf;
  escreverAtomico(F.estado, est);
  fs.writeFileSync(F.heartbeat, JSON.stringify({ pid: process.pid, label: 'mirror', mirrorMode: est.mirrorMode, ultimoCiclo: now(), abertas: est.abertasCount, fechadas: est.fechadas, eventos: est.eventos, dupIgnorados: est.eventosDuplicadosIgnorados, stateHash: est.stateHash, championCapital: est.championCapital }, null, 2));
  try { const l = rd(F.lock, {}); l.heartbeat = now(); fs.writeFileSync(F.lock, JSON.stringify(l)); } catch {}
  console.log(`[mirror] ${est.mirrorMode} ciclo ${est.cycleId} — abertas ${est.abertasCount} fechadas ${est.fechadas} eventos ${est.eventos} dupIgn ${est.eventosDuplicadosIgnorados} stateHash ${est.stateHash}`);
}

if (!adquirirLock()) { console.log('[mirror] outra instância viva — saindo'); process.exit(0); }
process.on('SIGINT', () => { try { fs.unlinkSync(F.lock); } catch {} process.exit(0); });
process.on('SIGTERM', () => { try { fs.unlinkSync(F.lock); } catch {} process.exit(0); });
console.log('[mirror] iniciado — SNAPSHOT_MIRROR_INCOMPLETE (Champion sem event log nativo), FORWARD, NENHUMA ORDEM');
umCiclo();
if (!ONCE) setInterval(umCiclo, INTERVALO_S * 1000);
