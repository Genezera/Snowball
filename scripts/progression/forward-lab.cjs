#!/usr/bin/env node
'use strict';
/**
 * v1.3 — PARTES 3,4,5. Processo live-paper FORWARD isolado. Roda como TRIAL
 * (Bitget+Bybit) ou CONTROL (6 exchanges). Analisa NOVAS oportunidades a partir do
 * início do processo (forward — não replaya histórico), rastreando capital LOCAL
 * por exchange e a decomposição de bloqueio. Estado/ledger/diário/heartbeat/lock
 * próprios. NENHUMA ordem, NENHUM saldo real movido.
 *
 * Uso: node forward-lab.cjs --mode <trial|control> [--intervalo 300] [--once]
 */
const L = require('./lib-progression.cjs');
const fs = require('node:fs');
const path = require('node:path');

const args = process.argv.slice(2);
const MODE = args[args.indexOf('--mode') + 1] || 'trial';
const ONCE = args.includes('--once');
const INTERVALO_S = Number(args[args.indexOf('--intervalo') + 1]) || 300;
const EXCHS = MODE === 'control' ? L.EXCHANGES : ['bitget', 'bybit'];
const CAP_POR_EX = L.ALVO_POR_EXCHANGE;      // US$100 virtual por exchange
const TAKER = 0.0005, SLIP = 0.0002, CUSTO_FRAC = 4 * TAKER + 4 * SLIP;
const NOTIONAL = L.ALVO_POR_EXCHANGE, MARGEM = 2 * NOTIONAL / L.ALAVANCAGEM; // 40
const STALE_CICLOS = 3; // fecha virtual se a oportunidade some por N ciclos

const DIR = path.join(L.ROOT, 'auditoria', 'progression', 'forward', MODE);
fs.mkdirSync(DIR, { recursive: true });
const F = { estado: path.join(DIR, 'estado.json'), ledger: path.join(DIR, 'ledger.jsonl'), diario: path.join(DIR, 'diario.jsonl'), heartbeat: path.join(DIR, 'heartbeat.json'), lock: path.join(DIR, 'lock.json') };
const OBS = path.join(L.ROOT, 'vigilancia', 'arquivo-observacoes.jsonl');
const now = () => Date.now();
const rd = (p, d) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return d; } };
const append = (p, o) => { try { fs.appendFileSync(p, JSON.stringify(o) + '\n'); } catch {} };

function adquirirLock() {
  const cur = rd(F.lock, null);
  if (cur && cur.heartbeat && now() - cur.heartbeat < 90_000) return false;
  fs.writeFileSync(F.lock, JSON.stringify({ pid: process.pid, heartbeat: now() }));
  return true;
}

function ultimoTsObservado() {
  // cursor inicial = último ts JÁ presente nas observações; assim o forward só
  // processa o que a vigilância APPENDAR daqui pra frente (observações têm ts que
  // fica atrás do relógio de parede — usar now() faria o cursor nunca casar).
  try { const l = fs.readFileSync(OBS, 'utf8').split('\n'); for (let i = l.length - 1; i >= 0; i--) { if (!l[i]) continue; try { const o = JSON.parse(l[i]); if (typeof o.ts === 'number') return o.ts; } catch {} } } catch {}
  return now();
}
function estadoInicial() {
  const saldos = {}; for (const e of EXCHS) saldos[e] = CAP_POR_EX;
  return { modo: MODE, iniciadoEm: now(), cursorTs: ultimoTsObservado(), saldosPorExchange: saldos, capitalInicial: EXCHS.length * CAP_POR_EX,
    virtuais: {}, fundingAcum: 0, custosAcum: 0, contadores: { avaliadas: 0, abertas: 0, fechadas: 0, bloqueadas: 0 },
    bloqueios: { aggregateCapitalBlocked: 0, exchangeLocalBalanceBlocked: 0, reserveBlocked: 0, maxPositionsBlocked: 0, minOrderBlocked: 0, evNaoPositivo: 0 } };
}

function margemLivre(est, ex) { return (est.saldosPorExchange[ex] || 0) * (1 - L.RESERVA); }

function umCiclo() {
  const est = rd(F.estado, null) || estadoInicial();
  // lê observações NOVAS (forward: ts > cursorTs)
  let linhas = []; try { linhas = fs.readFileSync(OBS, 'utf8').split('\n'); } catch {}
  const novas = new Map(); let maxTs = est.cursorTs;
  for (const ln of linhas) {
    if (!ln) continue; let o; try { o = JSON.parse(ln); } catch { continue; }
    if (!o.k || o.apr == null || o.ts <= est.cursorTs) continue;
    const [sym, long, short] = o.k.split('|');
    if (!EXCHS.includes(long) || !EXCHS.includes(short)) continue;
    novas.set(o.k, o); if (o.ts > maxTs) maxTs = o.ts;
  }
  const virtSemAtualizar = new Set(Object.keys(est.virtuais));

  for (const [k, o] of novas) {
    const [sym, long, short] = k.split('|');
    est.contadores.avaliadas++;
    // funding acumula em virtual já aberta
    if (est.virtuais[k]) { const vp = est.virtuais[k]; vp.fundingAcum += NOTIONAL * (o.apr / 8760) * (INTERVALO_S / 3600); vp.ultimoApr = o.apr; vp.ciclosSemVer = 0; virtSemAtualizar.delete(k); est.fundingAcum += NOTIONAL * (o.apr / 8760) * (INTERVALO_S / 3600); continue; }
    // economia pré-saldo
    const custoFrac = CUSTO_FRAC + Math.max(0, o.spread || 0);
    const evFrac = o.apr * 24 / 8760 - custoFrac; // EV 24h/notional (proxy p/ decisão)
    if (o.apr <= 0 || evFrac <= 0) { est.contadores.bloqueadas++; est.bloqueios.evNaoPositivo++; continue; }
    if (NOTIONAL < L.MIN_NOTIONAL) { est.contadores.bloqueadas++; est.bloqueios.minOrderBlocked++; continue; }
    // CAPITAL LOCAL por exchange (item 5)
    const margemPorPerna = NOTIONAL / L.ALAVANCAGEM;
    const livreLong = margemLivre(est, long), livreShort = margemLivre(est, short);
    const abertasCount = Object.keys(est.virtuais).length;
    let motivo = null;
    if (abertasCount >= L.MAX_POSICOES) motivo = 'maxPositionsBlocked';
    else if (margemPorPerna > livreLong || margemPorPerna > livreShort) motivo = 'exchangeLocalBalanceBlocked';
    else if ((est.saldosPorExchange[long] < CAP_POR_EX * L.RESERVA) || (est.saldosPorExchange[short] < CAP_POR_EX * L.RESERVA)) motivo = 'reserveBlocked';
    const capTotalLivre = EXCHS.reduce((s, e) => s + margemLivre(est, e), 0);
    if (!motivo && margemPorPerna * 2 > capTotalLivre) motivo = 'aggregateCapitalBlocked';
    if (motivo) { est.contadores.bloqueadas++; est.bloqueios[motivo]++;
      append(F.diario, { ts: now(), evento: 'bloqueada', k, sym, apr: L.r4(o.apr), motivo, livreLong: L.r2(livreLong), livreShort: L.r2(livreShort) });
      continue;
    }
    // abre VIRTUAL (shadow): reserva margem local nas duas exchanges
    const custoEntrada = NOTIONAL * (2 * TAKER + 2 * SLIP);
    est.saldosPorExchange[long] -= margemPorPerna; est.saldosPorExchange[short] -= margemPorPerna;
    est.custosAcum += custoEntrada;
    est.virtuais[k] = { k, sym, long, short, abreTs: now(), notional: NOTIONAL, margemPorPerna, fundingAcum: 0, custoEntrada, ultimoApr: o.apr, ciclosSemVer: 0 };
    est.contadores.abertas++; virtSemAtualizar.delete(k);
    append(F.diario, { ts: now(), evento: 'abre', k, sym, apr: L.r4(o.apr), custoEntrada: L.r4(custoEntrada) });
    append(F.ledger, { ts: now(), tipo: 'abre', k, saldoLong: L.r2(est.saldosPorExchange[long]), saldoShort: L.r2(est.saldosPorExchange[short]) });
  }
  // fecha virtuais que sumiram (stale)
  for (const k of virtSemAtualizar) {
    const vp = est.virtuais[k]; vp.ciclosSemVer = (vp.ciclosSemVer || 0) + 1;
    if (vp.ciclosSemVer >= STALE_CICLOS || (vp.ultimoApr || 0) <= 0) {
      const custoSaida = vp.notional * (2 * TAKER + 2 * SLIP);
      est.saldosPorExchange[vp.long] += vp.margemPorPerna; est.saldosPorExchange[vp.short] += vp.margemPorPerna;
      est.custosAcum += custoSaida; est.contadores.fechadas++;
      const pnl = vp.fundingAcum - vp.custoEntrada - custoSaida;
      append(F.diario, { ts: now(), evento: 'fecha', k, sym: vp.sym, funding: L.r4(vp.fundingAcum), pnl: L.r4(pnl), motivo: vp.ciclosSemVer >= STALE_CICLOS ? 'desapareceu' : 'apr<=0' });
      append(F.ledger, { ts: now(), tipo: 'fecha', k, pnl: L.r4(pnl) });
      delete est.virtuais[k];
    }
  }
  est.cursorTs = maxTs;
  const capitalAtual = est.capitalInicial + est.fundingAcum - est.custosAcum;
  fs.writeFileSync(F.estado, JSON.stringify({ ...est, capitalAtual: L.r4(capitalAtual) }, null, 2));
  fs.writeFileSync(F.heartbeat, JSON.stringify({ pid: process.pid, modo: MODE, ultimoCiclo: now(), abertas: Object.keys(est.virtuais).length, fechadas: est.contadores.fechadas, capital: L.r4(capitalAtual) }, null, 2));
  const l = rd(F.lock, {}); l.heartbeat = now(); fs.writeFileSync(F.lock, JSON.stringify(l));
}

if (!adquirirLock()) { console.log(`[forward-lab ${MODE}] outra instância viva — saindo`); process.exit(0); }
process.on('SIGINT', () => { try { fs.unlinkSync(F.lock); } catch {} process.exit(0); });
process.on('SIGTERM', () => { try { fs.unlinkSync(F.lock); } catch {} process.exit(0); });
console.log(`[forward-lab ${MODE}] iniciado — ${EXCHS.join('+')} US$${EXCHS.length * CAP_POR_EX}, intervalo ${INTERVALO_S}s, FORWARD, NENHUMA ORDEM`);
umCiclo();
if (!ONCE) setInterval(umCiclo, INTERVALO_S * 1000);
