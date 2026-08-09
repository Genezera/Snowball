#!/usr/bin/env node
'use strict';
/**
 * BACKTEST de MAXIMIZAÇÃO (read-only, análise; NÃO opera, NÃO toca no Champion).
 * Replica a política do forward-lab sobre TODO o feed real, para cada par de 2 exchanges, e testa
 * alavancas de maximização (segurar vencedores, seletividade, filtro de persistência "ML-lite").
 * Modelo de funding IDÊNTICO ao motor reconciliado: inc = NOTIONAL*(apr/8760)*Δh, apr decaindo por ciclo.
 *
 * Uso: node scripts/analise/backtest-pares.cjs [--pair bybit+bitget] [--policy baseline]
 *   sem args: roda a matriz completa (pares candidatos × políticas) + calibração 6-exchanges.
 */
const fs = require('node:fs');
const path = require('node:path');
const ROOT = path.resolve(__dirname, '..', '..');
const FEED = path.join(ROOT, 'vigilancia', 'arquivo-observacoes.jsonl');
const NOTIONAL = 100, TAKER = 0.0005, SLIP = 0.0002;
const ROUND_TRIP = NOTIONAL * (4 * TAKER + 4 * SLIP); // 0.28
const CUSTO_FRAC = 4 * TAKER + 4 * SLIP;
const MARGEM_PERNA = NOTIONAL / 5;                    // 5x alavancagem → $20 margem/perna
const economia = (apr, spread) => apr * 24 / 8760 - (CUSTO_FRAC + Math.max(0, spread || 0));
const GAP_STALE_MS = 60 * 60000;                      // sem obs > 60min → fecha (dado sumiu)

// ── carregar feed uma vez, ordenado por ts ──
function carregarFeed() {
  const buf = fs.readFileSync(FEED, 'utf8');
  const obs = [];
  for (const ln of buf.split('\n')) { if (!ln) continue; let o; try { o = JSON.parse(ln); } catch { continue; }
    const p = (o.k || '').split('|'); if (p.length !== 3) continue;
    obs.push({ ts: o.ts, k: o.k, sym: p[0], long: p[1], short: p[2], par: [p[1], p[2]].sort().join('+'), apr: o.apr || 0, spread: o.spread || 0 }); }
  obs.sort((a, b) => a.ts - b.ts);
  return obs;
}

// ── políticas ──
const POLICIES = {
  baseline:      { entryApr: 0, inversionCiclos: 2, deterioracaoFrac: 0.5, maxHoldH: 168, persistMinBeforeEntry: 0 },
  holdLonger:    { entryApr: 0, inversionCiclos: 4, deterioracaoFrac: 0.35, maxHoldH: 168, persistMinBeforeEntry: 0 },
  selective:     { entryApr: 6, inversionCiclos: 2, deterioracaoFrac: 0.5, maxHoldH: 168, persistMinBeforeEntry: 0 },
  persistFilter: { entryApr: 4, inversionCiclos: 3, deterioracaoFrac: 0.4, maxHoldH: 168, persistMinBeforeEntry: 30 },
  maximize:      { entryApr: 6, inversionCiclos: 4, deterioracaoFrac: 0.35, maxHoldH: 168, persistMinBeforeEntry: 30 },
};

// backtest: obs já filtrado para o(s) par(es) alvo. maxConc = posições simultâneas (margem).
function backtest(obs, pol, maxConc) {
  const abertas = new Map();        // k -> posição
  const firstSeen = new Map();      // k -> ts (p/ filtro de persistência)
  const lastEV = new Map();
  let netFunding = 0, netCusto = 0, nPos = 0, nWin = 0, nLoss = 0;
  let capitalHoursUsados = 0, capitalHoursDisp = 0;
  const t0 = obs.length ? obs[0].ts : 0, tN = obs.length ? obs[obs.length - 1].ts : 0;
  const totalH = (tN - t0) / 3.6e6;

  function fecha(k, ts, motivo) { const p = abertas.get(k); if (!p) return;
    netFunding += p.fundingAcum; netCusto += ROUND_TRIP; nPos++;
    const net = p.fundingAcum - ROUND_TRIP; if (net > 0) nWin++; else nLoss++;
    capitalHoursUsados += ((ts - p.abertaEm) / 3.6e6) * (2 * MARGEM_PERNA);
    abertas.delete(k); }

  let ti = 0;
  for (const o of obs) {
    // fechar posições cujo dado sumiu (gap > 60min) antes de processar
    for (const [k, p] of abertas) if (o.ts - p.ultimoTs > GAP_STALE_MS) fecha(k, p.ultimoTs, 'stale_gap');
    // registrar primeira vez que a chave apareceu positiva (p/ filtro de persistência)
    const ev = economia(o.apr, o.spread);
    if (ev > 0 && !firstSeen.has(o.k)) firstSeen.set(o.k, o.ts);
    if (ev <= 0) firstSeen.delete(o.k);

    if (abertas.has(o.k)) {
      // acumular funding desde a última obs desta chave
      const p = abertas.get(o.k); const dtH = (o.ts - p.ultimoTs) / 3.6e6;
      p.fundingAcum += NOTIONAL * Math.max(0, p.ultimoApr) / 8760 * dtH;
      p.ultimoTs = o.ts; p.ultimoApr = o.apr;
      // condições de saída
      p.ciclosInv = ev <= 0 ? p.ciclosInv + 1 : 0;
      const deteriorou = o.apr < pol.deterioracaoFrac * p.aprEntrada;
      p.ciclosDet = deteriorou ? p.ciclosDet + 1 : 0;
      const holdH = (o.ts - p.abertaEm) / 3.6e6;
      if (p.ciclosInv >= pol.inversionCiclos) fecha(o.k, o.ts, 'inversao');
      else if (p.ciclosDet >= pol.inversionCiclos) fecha(o.k, o.ts, 'deterioracao');
      else if (holdH >= pol.maxHoldH) fecha(o.k, o.ts, 'max_hold');
    } else {
      // entrada?
      const persistOk = pol.persistMinBeforeEntry === 0 || (firstSeen.has(o.k) && (o.ts - firstSeen.get(o.k)) / 60000 >= pol.persistMinBeforeEntry);
      if (ev > 0 && o.apr >= pol.entryApr && persistOk && abertas.size < maxConc) {
        abertas.set(o.k, { k: o.k, abertaEm: o.ts, ultimoTs: o.ts, aprEntrada: o.apr, ultimoApr: o.apr, fundingAcum: 0, ciclosInv: 0, ciclosDet: 0 });
      }
    }
  }
  // fechar remanescentes no fim
  for (const [k, p] of [...abertas]) fecha(k, p.ultimoTs, 'fim');
  capitalHoursDisp = totalH * (2 * MARGEM_PERNA * maxConc);
  const net = netFunding - netCusto;
  return { net, funding: netFunding, custo: netCusto, posicoes: nPos, wins: nWin, losses: nLoss,
    winRate: nPos ? nWin / nPos : 0, lucroPorDia: totalH > 0 ? net / (totalH / 24) : 0,
    utilizacao: capitalHoursDisp > 0 ? capitalHoursUsados / capitalHoursDisp : 0, dias: totalH / 24 };
}

function main() {
  const args = process.argv.slice(2);
  const obsAll = carregarFeed();
  const CANDIDATOS = ['bitget+bybit', 'gate+okx', 'bingx+bybit', 'binanceusdm+bybit']; // nomes ORDENADOS (sort)
  const MAXCONC = 3;
  console.log(`\nFeed: ${obsAll.length} obs | ${((obsAll[obsAll.length-1].ts-obsAll[0].ts)/86400000).toFixed(2)} dias | custo/pos $${ROUND_TRIP.toFixed(2)} | maxConc ${MAXCONC}\n`);

  // ── calibração: 6 exchanges, TODAS as políticas (deve haver uma que bate ~ Champion +17.6/6d, ~42 pos) ──
  console.log('CALIBRAÇÃO (todas exchanges) — qual política reproduz o Champion real (+17.6, ~42 pos, winRate alto)?');
  for (const pn of Object.keys(POLICIES)) { const c = backtest(obsAll, POLICIES[pn], MAXCONC);
    console.log(`  ${pn.padEnd(14)} net $${c.net.toFixed(2).padStart(8)} | ${String(c.posicoes).padStart(3)} pos | winRate ${(c.winRate*100).toFixed(0).padStart(3)}% | funding $${c.funding.toFixed(1)} custo $${c.custo.toFixed(1)}`); }
  console.log('');

  // ── matriz: par × política ──
  const polNames = Object.keys(POLICIES);
  console.log('=== NET $ POR PAR × POLÍTICA (backtest 2 exchanges, $100+$100) ===\n');
  console.log('par'.padEnd(20), polNames.map(p => p.padStart(12)).join(''));
  const resultado = {};
  for (const par of CANDIDATOS) {
    const obsPar = obsAll.filter(o => o.par === par);
    resultado[par] = {};
    const cells = polNames.map(pn => { const r = backtest(obsPar, POLICIES[pn], MAXCONC); resultado[par][pn] = r; return r.net.toFixed(2).padStart(12); });
    console.log(par.padEnd(20), cells.join(''));
  }
  // melhor combinação
  let best = null;
  for (const par of CANDIDATOS) for (const pn of polNames) { const r = resultado[par][pn]; if (!best || r.net > best.net) best = { par, pol: pn, ...r }; }
  console.log('\n=== MELHOR COMBINAÇÃO ===');
  console.log(`par ${best.par} | política ${best.pol}`);
  console.log(`net $${best.net.toFixed(2)} em ${best.dias.toFixed(1)}d | $${best.lucroPorDia.toFixed(3)}/dia | ${(best.lucroPorDia/200*100).toFixed(3)}%/dia sobre $200`);
  console.log(`posições ${best.posicoes} | winRate ${(best.winRate*100).toFixed(0)}% | utilização capital ${(best.utilizacao*100).toFixed(1)}% | funding $${best.funding.toFixed(2)} custo $${best.custo.toFixed(2)}`);
  console.log(`custo/funding = ${(best.custo/best.funding*100).toFixed(0)}% (baseline all-ex era 40%)`);

  // ranking dos pares pela melhor política de cada
  console.log('\n=== RANKING DOS PARES (melhor política de cada) ===');
  const rank = CANDIDATOS.map(par => { let b = null; for (const pn of polNames) { const r = resultado[par][pn]; if (!b || r.net > b.net) b = { pol: pn, ...r }; } return { par, ...b }; }).sort((a, b) => b.net - a.net);
  for (const r of rank) console.log(`  ${r.par.padEnd(20)} net $${r.net.toFixed(2).padStart(7)} | ${r.pol.padEnd(13)} | ${(r.lucroPorDia).toFixed(2)}/dia | win ${(r.winRate*100).toFixed(0)}% | util ${(r.utilizacao*100).toFixed(0)}%`);
}
main();
