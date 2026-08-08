#!/usr/bin/env node
'use strict';
/**
 * v1.8 — ITEM 4. MIRROR CONTROL: espelho PURO do Champion. NÃO decide pelo feed — segue os
 * eventos do Champion: abre só quando o Champion abre, escala só quando o Champion escala,
 * recebe funding só quando o Champion recebe, fecha só quando o Champion fecha. Objetivo:
 * fidelidade contábil e operacional EXATA. READ-ONLY quanto ao Champion; nenhuma ordem.
 *
 * Escreve auditoria/progression/economic/mirror/{estado,ledger,diario,heartbeat}. Isolado do
 * durabilitySoak (auditoria/progression/forward). Registra por evento: sourceEventId,
 * sourcePositionId, mirrorPositionId, championPositionId, evento Champion/Mirror, ts, cycleId,
 * exchanges, notional, funding, custo, saldo, PnL.
 *
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
const F = { estado: path.join(BASE, 'estado.json'), tmp: path.join(BASE, 'estado.json.tmp'), ledger: path.join(BASE, 'ledger.jsonl'), diario: path.join(BASE, 'diario.jsonl'), heartbeat: path.join(BASE, 'heartbeat.json'), lock: path.join(BASE, 'lock.json') };
const EPOCH = path.join(L.ROOT, 'auditoria', 'progression', 'economic', 'epoch.json');
const TAKER = 0.0005, SLIP = 0.0002, CUSTO_ENTRADA_FRAC = 2 * TAKER + 2 * SLIP;
const now = () => Date.now();
const rd = (p, d) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return d; } };
const append = (p, o) => { try { fs.appendFileSync(p, JSON.stringify(o) + '\n'); } catch {} };
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
function escreverAtomico(p, obj) { const fd = fs.openSync(F.tmp, 'w'); fs.writeSync(fd, JSON.stringify(obj, null, 2)); fs.fsyncSync(fd); fs.closeSync(fd); fs.renameSync(F.tmp, p); }
function adquirirLock() { const c = rd(F.lock, null); if (c && c.heartbeat && now() - c.heartbeat < 90_000) return false; fs.writeFileSync(F.lock, JSON.stringify({ pid: process.pid, heartbeat: now() })); return true; }

const chaveChampion = (p) => `${p.symbol}:${p.abertaEm}`;
function epochId() { const e = rd(EPOCH, null); return e ? e.economicForwardEpochId : 'no-epoch'; }

function umCiclo() {
  const { estado: champ, asOf } = L.loadChampion();
  if (!champ) { append(F.diario, { ts: now(), evento: 'source_status', status: 'CHAMPION_UNAVAILABLE' }); return; }
  const eid = epochId();
  const est = rd(F.estado, null) || { schema: 'snowball.mirror.v1_8', economicForwardEpochId: eid, iniciadoEm: now(), aberturas: {}, cycleId: 0, fechadas: 0, fundingRealizado: 0, custosRealizados: 0, eventos: 0 };
  est.cycleId++;
  const abertasChampion = (champ.posicoes || []);
  const vistas = new Set();

  for (const p of abertasChampion) {
    const ck = chaveChampion(p); vistas.add(ck);
    const championPositionId = ck;
    const sourcePositionId = sha(`${eid}|champion:${ck}`).slice(0, 24);
    const exch = [p.exchangeLong, p.exchangeShort];
    const notional = L.r4(p.notionalPorPerna || 0);
    const fundingAtual = L.r4(p.fundingAcumulado || 0);
    let m = est.aberturas[ck];
    if (!m) {
      // Champion ABRIU → Mirror abre (custo de entrada espelhado)
      const custoEntrada = L.r4(notional * CUSTO_ENTRADA_FRAC);
      m = est.aberturas[ck] = { mirrorPositionId: sha(`${eid}|mirror:${ck}`).slice(0, 24), sourcePositionId, championPositionId, exchanges: exch, notional, estagio: p.estagio || 1, fundingMirror: fundingAtual, custoEntrada, abertoEm: now(), championAbertaEm: p.abertaEm };
      est.custosRealizados = L.r4(est.custosRealizados + custoEntrada);
      const ev = { ts: now(), cycleId: est.cycleId, evento: 'mirror_open', championEvento: 'open', sourceEventId: sha(`${eid}|open:${ck}`).slice(0, 20), sourcePositionId, mirrorPositionId: m.mirrorPositionId, championPositionId, exchanges: exch, notional, funding: fundingAtual, custo: custoEntrada, saldo: L.r4(champ.capital), pnl: L.r4(fundingAtual - custoEntrada) };
      append(F.diario, ev); append(F.ledger, ev); est.eventos++;
    } else {
      // escalonamento e funding: espelha exatamente o Champion
      if ((p.estagio || 1) !== m.estagio) { const ev = { ts: now(), cycleId: est.cycleId, evento: 'mirror_scale', championEvento: 'scale', sourcePositionId, mirrorPositionId: m.mirrorPositionId, championPositionId, deEstagio: m.estagio, paraEstagio: p.estagio, exchanges: exch, notional, funding: fundingAtual }; append(F.diario, ev); m.estagio = p.estagio; est.eventos++; }
      if (fundingAtual !== m.fundingMirror) { const delta = L.r4(fundingAtual - m.fundingMirror); const ev = { ts: now(), cycleId: est.cycleId, evento: 'mirror_funding', championEvento: 'funding', sourcePositionId, mirrorPositionId: m.mirrorPositionId, championPositionId, deltaFunding: delta, funding: fundingAtual, exchanges: exch, notional }; append(F.diario, ev); m.fundingMirror = fundingAtual; est.eventos++; }
    }
  }
  // Champion FECHOU (posição sumiu) → Mirror fecha
  for (const ck of Object.keys(est.aberturas)) {
    if (vistas.has(ck)) continue;
    const m = est.aberturas[ck]; const custoSaida = L.r4(m.notional * CUSTO_ENTRADA_FRAC);
    est.custosRealizados = L.r4(est.custosRealizados + custoSaida); est.fundingRealizado = L.r4(est.fundingRealizado + m.fundingMirror); est.fechadas++;
    const pnl = L.r4(m.fundingMirror - m.custoEntrada - custoSaida);
    const ev = { ts: now(), cycleId: est.cycleId, evento: 'mirror_close', championEvento: 'close', sourceEventId: sha(`${eid}|close:${ck}`).slice(0, 20), sourcePositionId: m.sourcePositionId, mirrorPositionId: m.mirrorPositionId, championPositionId: m.championPositionId, exchanges: m.exchanges, notional: m.notional, funding: m.fundingMirror, custo: custoSaida, saldo: L.r4(champ.capital), pnl };
    append(F.diario, ev); append(F.ledger, ev); est.eventos++; delete est.aberturas[ck];
  }

  // reconciliação com o Champion (fidelidade contábil): capital espelhado
  est.abertasCount = Object.keys(est.aberturas).length;
  est.championCapital = L.r4(champ.capital); est.championFundingTotal = L.r4(champ.fundingTotal); est.championCustosTotal = L.r4(champ.custosTotal);
  est.asOf = asOf;
  escreverAtomico(F.estado, est);
  fs.writeFileSync(F.heartbeat, JSON.stringify({ pid: process.pid, label: 'mirror', ultimoCiclo: now(), abertas: est.abertasCount, fechadas: est.fechadas, eventos: est.eventos, championCapital: est.championCapital }, null, 2));
  try { const l = rd(F.lock, {}); l.heartbeat = now(); fs.writeFileSync(F.lock, JSON.stringify(l)); } catch {}
  console.log(`[mirror] ciclo ${est.cycleId} — abertas ${est.abertasCount} fechadas ${est.fechadas} eventos ${est.eventos} championCapital ${est.championCapital}`);
}

if (!adquirirLock()) { console.log('[mirror] outra instância viva — saindo'); process.exit(0); }
process.on('SIGINT', () => { try { fs.unlinkSync(F.lock); } catch {} process.exit(0); });
process.on('SIGTERM', () => { try { fs.unlinkSync(F.lock); } catch {} process.exit(0); });
console.log('[mirror] iniciado — espelho do Champion, FORWARD, NENHUMA ORDEM');
umCiclo();
if (!ONCE) setInterval(umCiclo, INTERVALO_S * 1000);
