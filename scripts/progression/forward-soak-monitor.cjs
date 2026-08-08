#!/usr/bin/env node
'use strict';
/**
 * v1.5 — PARTE 13. Monitor forwardSoak SEPARADO (não reutiliza a contagem do monitor
 * dos challengers). Exige 1440/1440 min contínuos dos 5 processos forward. Registra
 * uptime, restarts, downtime, eventos, perdas, duplicações, source divergences,
 * fidelity divergences. READ-ONLY.
 * Uso: node forward-soak-monitor.cjs [--min 1440] [--intervalo 60]
 */
const L = require('./lib-progression.cjs');
const fs = require('node:fs');
const path = require('node:path');
const arg = (k, d) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : d; };
const MIN = Number(arg('--min', 1440)), INT_S = Number(arg('--intervalo', 60));
const LABELS = ['trial', 'control', 'observer-max3', 'observer-max4', 'observer-max5'];
const BASE = path.join(L.ROOT, 'auditoria', 'progression', 'forward');
const OUT = path.join(BASE, 'soak.jsonl');
const SUM = path.join(L.ROOT, 'auditoria', 'progression', 'forward-soak-resumo.json');
const HB_MAX = 720_000;

const prev = {}; const acc = { restarts: {}, downtimeMin: {}, dups: {}, perdas: {}, sourceDiv: 0, fidelityDiv: 0 };
for (const l of LABELS) { prev[l] = { pid: null, byteOffset: null, eventCount: 0 }; acc.restarts[l] = 0; acc.downtimeMin[l] = 0; acc.dups[l] = 0; acc.perdas[l] = 0; }
let amostras = 0, vivosContinuos = 0;

function amostra() {
  const t = Date.now();
  const linha = { ts: new Date(t).toISOString(), amostra: ++amostras, processos: {} };
  let todosVivos = true;
  for (const l of LABELS) {
    const hb = L.rd(path.join(BASE, l, 'heartbeat.json'), null);
    const est = L.rd(path.join(BASE, l, 'estado.json'), null);
    const age = hb && hb.ultimoCiclo ? t - hb.ultimoCiclo : null;
    const vivo = age != null && age < HB_MAX;
    if (!vivo) { acc.downtimeMin[l]++; todosVivos = false; }
    const pv = prev[l];
    if (pv.pid != null && hb && hb.pid != null && hb.pid !== pv.pid) acc.restarts[l]++;
    if (est) { const dups = est.contadores ? est.contadores.dedupIgnorados || 0 : 0; acc.dups[l] = dups;
      if (pv.byteOffset != null && est.cursor && est.cursor.byteOffset < pv.byteOffset && est.sourceStatus === 'OK') acc.perdas[l]++; // offset regrediu com fonte OK = perda
      prev[l] = { pid: hb ? hb.pid : pv.pid, byteOffset: est.cursor ? est.cursor.byteOffset : pv.byteOffset, eventCount: hb ? hb.eventCount : pv.eventCount }; }
    linha.processos[l] = { vivo, sourceStatus: hb ? hb.sourceStatus : null, eventCount: hb ? hb.eventCount : null, byteOffset: hb ? hb.byteOffset : null, restartsAcum: acc.restarts[l], downtimeMin: acc.downtimeMin[l], dups: acc.dups[l] };
  }
  // divergências
  const val = L.rd(L.P.outDir + '/common-window-validator.json', null);
  if (val && val.comparisonStatus !== 'OK') acc.sourceDiv++;
  const fid = L.rd(L.P.outDir + '/control-fidelity-vectorial.json', null);
  if (fid && fid.todasReconciliam === false) acc.fidelityDiv++;
  linha.sourceDivergencesAcum = acc.sourceDiv; linha.fidelityDivergencesAcum = acc.fidelityDiv;
  vivosContinuos = todosVivos ? vivosContinuos + 1 : 0;

  try { fs.appendFileSync(OUT, JSON.stringify(linha) + '\n'); } catch {}
  const totalPerdas = Object.values(acc.perdas).reduce((s, v) => s + v, 0);
  const totalRestarts = Object.values(acc.restarts).reduce((s, v) => s + v, 0);
  console.log(`[${linha.ts}] soak ${amostras}/${Math.round(MIN * 60 / INT_S)} vivos=${LABELS.filter((l) => linha.processos[l].vivo).length}/5 restarts=${totalRestarts} perdas=${totalPerdas} srcDiv=${acc.sourceDiv} fidDiv=${acc.fidelityDiv}`);
  const resumo = { geradoEm: linha.ts, amostras, minutosExigidos: MIN, amostrasContinuasTodosVivos: vivosContinuos,
    completo: amostras >= Math.round(MIN * 60 / INT_S), restarts: acc.restarts, downtimeMin: acc.downtimeMin, dups: acc.dups, perdas: acc.perdas,
    sourceDivergences: acc.sourceDiv, fidelityDivergences: acc.fidelityDiv,
    integridade: (totalPerdas === 0) ? 'SEM PERDA' : `${totalPerdas} PERDAS`, separadoDoMonitorDosChallengers: true };
  try { fs.writeFileSync(SUM, JSON.stringify(resumo, null, 2)); } catch {}
}

const total = Math.max(1, Math.round(MIN * 60 / INT_S));
console.log(`forward-soak-monitor iniciado — ${MIN}min (${total} amostras), separado do monitor dos challengers. Saída ${OUT}`);
amostra();
const timer = setInterval(() => { amostra(); if (amostras >= total) { clearInterval(timer); console.log('forwardSoak concluído.'); process.exit(0); } }, INT_S * 1000);
