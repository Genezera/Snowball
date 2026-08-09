#!/usr/bin/env node
'use strict';
/**
 * Placar HEAD-TO-HEAD dos competidores de 2 exchanges (paper, engine reconciliado forward-lab).
 * READ-ONLY. Lê o estado de cada competidor e mostra net PnL, funding, custos, posições, utilização,
 * e bloqueios (incl. persistencePending do filtro). NÃO opera, NÃO toca no Champion.
 */
const fs = require('node:fs');
const path = require('node:path');
const ROOT = path.resolve(__dirname, '..', '..');
const BASE = path.join(ROOT, 'auditoria', 'progression', 'compete');
const COMPETIDORES = [
  { label: 'compete-bybit-bitget', par: 'bybit+bitget' },
  { label: 'compete-gate-okx', par: 'gate+okx' },
];

function ler(label) {
  const est = JSON.parse(fs.readFileSync(path.join(BASE, label, 'estado.json'), 'utf8'));
  const hb = (() => { try { return JSON.parse(fs.readFileSync(path.join(BASE, label, 'heartbeat.json'), 'utf8')); } catch { return null; } })();
  const funding = est.fundingAcum || 0, custos = est.custosAcum || 0;
  const net = funding - custos;
  const dias = est.iniciadoEm ? (Date.now() - est.iniciadoEm) / 86400000 : 0;
  const c = est.contadores || {};
  const b = est.bloqueios || {};
  return { label, capitalInicial: est.capitalInicial, capital: est.capitalInicial + net, funding, custos, net,
    dias, lucroPorDia: dias > 0 ? net / dias : 0, pctPorDia: (dias > 0 && est.capitalInicial) ? net / est.capitalInicial / dias * 100 : 0,
    abertas: Object.keys(est.virtuais || {}).length, fechadas: c.fechadas || 0, avaliadas: c.avaliadas || 0, bloqueadas: c.bloqueadas || 0,
    persistPending: b.persistencePending || 0, evNaoPositivo: b.evNaoPositivo || 0,
    vivo: !!(hb && hb.ultimoCiclo && Date.now() - hb.ultimoCiclo < 15 * 60000), idadeS: hb && hb.ultimoCiclo ? Math.round((Date.now() - hb.ultimoCiclo) / 1000) : null };
}

function main() {
  console.log('\n=== HEAD-TO-HEAD: 2 exchanges paper ($100+$100, filtro persistência 30min) ===\n');
  const rows = [];
  for (const c of COMPETIDORES) { try { rows.push(ler(c.label)); } catch (e) { console.log(c.label, 'sem estado ainda:', e.message); } }
  rows.sort((a, b) => b.net - a.net);
  for (const r of rows) {
    console.log(`${r.label}  ${r.vivo ? 'VIVO' : 'PARADO'} (${r.idadeS}s)`);
    console.log(`  capital $${r.capital.toFixed(4)} (inicial ${r.capitalInicial}) | NET ${r.net >= 0 ? '+' : ''}${r.net.toFixed(4)} | ${r.dias.toFixed(2)}d | $${r.lucroPorDia.toFixed(3)}/dia | ${r.pctPorDia.toFixed(3)}%/dia`);
    console.log(`  funding +${r.funding.toFixed(4)} | custos -${r.custos.toFixed(4)} | custo/funding ${r.funding > 0 ? (r.custos / r.funding * 100).toFixed(0) + '%' : 'n/a'}`);
    console.log(`  posições abertas ${r.abertas} | fechadas ${r.fechadas} | persistencePending ${r.persistPending} | evNaoPositivo ${r.evNaoPositivo}`);
    console.log('');
  }
  if (rows.length === 2 && (rows[0].fechadas + rows[0].abertas > 0 || rows[1].fechadas + rows[1].abertas > 0)) {
    const [a, b] = rows;
    console.log(`LÍDER: ${a.label} (net ${a.net.toFixed(4)} vs ${b.net.toFixed(4)})`);
  } else {
    console.log('Ainda acumulando — os competidores começam prospectivos (0 posições) e entram só após 30min de sinal persistente. Volte em algumas horas.');
  }
  console.log('\nHONESTO: paper, engine reconciliado. Amostra cresce com o tempo. Champion NÃO afetado.');
}
main();
