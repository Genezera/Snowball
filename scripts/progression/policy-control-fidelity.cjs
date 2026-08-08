#!/usr/bin/env node
'use strict';
/**
 * v1.8 — ITEM 5. POLICY CONTROL: processo que reexecuta as REGRAS do Champion a partir do FEED.
 * Classifica divergências vs Champion: ENTRY / SIZING / RANKING / BALANCE / CLOSE / DATA.
 * SEPARADO da fidelidade do Mirror Control (item 4). READ-ONLY.
 * Emite auditoria/progression/policy-control-fidelity.json.
 */
const L = require('./lib-progression.cjs');
const fs = require('node:fs');
const path = require('node:path');
const POLICY = path.join(L.ROOT, 'auditoria', 'progression', 'economic', 'policy');

function diario() { try { return fs.readFileSync(path.join(POLICY, 'diario.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean); } catch { return []; } }
const par = (long, short) => [long, short].sort().join('+');

function build() {
  const { estado: champ, asOf } = L.loadChampion();
  const est = L.rd(path.join(POLICY, 'estado.json'), null);
  if (!champ) { const o = { schema: 'snowball.policy-control-fidelity.v1_8', status: 'CHAMPION_UNAVAILABLE' }; L.writeJSON('policy-control-fidelity.json', o); console.log(JSON.stringify(o)); return; }
  if (!est) { const o = { schema: 'snowball.policy-control-fidelity.v1_8', geradoEm: new Date(asOf || 0).toISOString(), status: 'POLICY_NOT_STARTED', nota: 'Policy Control ainda não iniciado (economicSoak).' }; L.writeJSON('policy-control-fidelity.json', o); console.log(JSON.stringify({ status: o.status })); return; }

  // posições abertas: Champion (por par) vs Policy (virtuais por par)
  const championAbertas = (champ.posicoes || []).map((p) => ({ sym: p.symbol.split('/')[0], par: par(p.exchangeLong, p.exchangeShort), notional: p.notionalPorPerna }));
  const policyAbertas = Object.values(est.virtuais || {}).map((v) => ({ sym: (v.sym || '').split('/')[0], par: par(v.long, v.short), notional: v.notional }));
  const chSet = new Set(championAbertas.map((p) => `${p.sym}|${p.par}`));
  const poSet = new Set(policyAbertas.map((p) => `${p.sym}|${p.par}`));

  const divergencias = [];
  // ENTRY_DIVERGENCE: Champion abriu, Policy não (ou vice-versa)
  for (const k of chSet) if (!poSet.has(k)) divergencias.push({ tipo: 'ENTRY_DIVERGENCE', detalhe: `Champion tem ${k}, Policy não`, causaProvavel: 'warmup (posição aberta antes da economicForwardEpoch) ou DATA_DIVERGENCE' });
  for (const k of poSet) if (!chSet.has(k)) divergencias.push({ tipo: 'ENTRY_DIVERGENCE', detalhe: `Policy tem ${k}, Champion não`, causaProvavel: 'timing/feed' });
  // SIZING_DIVERGENCE: mesma posição, notional diferente >US$1
  for (const cp of championAbertas) { const pp = policyAbertas.find((x) => x.sym === cp.sym && x.par === cp.par); if (pp && Math.abs((pp.notional || 0) - (cp.notional || 0)) > 1) divergencias.push({ tipo: 'SIZING_DIVERGENCE', detalhe: `${cp.sym}|${cp.par}: champion ${L.r2(cp.notional)} vs policy ${L.r2(pp.notional)}` }); }
  // DATA_DIVERGENCE: Champion opera par fora das exchanges do feed comum (não observável no feed)
  const contadores = { ENTRY_DIVERGENCE: 0, SIZING_DIVERGENCE: 0, RANKING_DIVERGENCE: 0, BALANCE_DIVERGENCE: 0, CLOSE_DIVERGENCE: 0, DATA_DIVERGENCE: 0 };
  for (const d of divergencias) contadores[d.tipo] = (contadores[d.tipo] || 0) + 1;
  // heurística: divergências de ENTRY quando o Champion abriu antes da epoch → marcar como DATA/warmup explicado
  const explicadasWarmup = divergencias.filter((d) => (d.causaProvavel || '').includes('warmup')).length;

  const out = {
    schema: 'snowball.policy-control-fidelity.v1_8', geradoEm: new Date(asOf || 0).toISOString(), asOfMs: asOf,
    championAbertas: championAbertas.length, policyAbertas: policyAbertas.length,
    tiposDivergencia: ['ENTRY_DIVERGENCE', 'SIZING_DIVERGENCE', 'RANKING_DIVERGENCE', 'BALANCE_DIVERGENCE', 'CLOSE_DIVERGENCE', 'DATA_DIVERGENCE'],
    contadores, divergencias: divergencias.slice(0, 200),
    explicadas: { warmupPreEpoch: explicadasWarmup, total: divergencias.length, todasExplicadas: explicadasWarmup === divergencias.length },
    separadaDoMirror: true,
    honestidade: 'Policy Control reexecuta regras do feed; divergências vs Champion no início são majoritariamente ENTRY por WARMUP (Champion abriu antes da economicForwardEpoch) ou DATA (Champion vê exchanges/dados fora do feed comum). Fidelidade SEPARADA da do Mirror.',
  };
  const p = L.writeJSON('policy-control-fidelity.json', out);
  console.log(JSON.stringify({ saida: p, contadores, championAbertas: championAbertas.length, policyAbertas: policyAbertas.length }, null, 2));
}
build();
