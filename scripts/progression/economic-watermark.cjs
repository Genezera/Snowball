#!/usr/bin/env node
'use strict';
/**
 * v1.8 — ITEM 11. Watermark ECONÔMICO. A comparação pareada usa SOMENTE posições cujos eventos
 * estejam materializados no MESMO common watermark. Registra commonWatermarkEventCount/Offset/Hash,
 * comparablePositions e excludedDueToLag. READ-ONLY. Emite auditoria/progression/economic-watermark.json.
 */
const L = require('./lib-progression.cjs');
const fs = require('node:fs');
const path = require('node:path');
const ECON = path.join(L.ROOT, 'auditoria', 'progression', 'economic');
const POLITICAS = ['policy', 'trial', 'observer-max3', 'observer-max4', 'observer-max5'];
function snaps(label) { try { return fs.readFileSync(path.join(ECON, label, 'snapshots.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)); } catch { return []; } }

function build() {
  const { asOf } = L.loadChampion();
  const porLabel = {}; for (const l of POLITICAS) porLabel[l] = snaps(l);
  const presentes = POLITICAS.filter((l) => porLabel[l].length > 0);
  if (!presentes.length) { const out = { schema: 'snowball.economic-watermark.v1_8', geradoEm: new Date(asOf || 0).toISOString(), status: 'NO_SNAPSHOTS_YET', commonWatermarkEventCount: 0, comparablePositions: 0, excludedDueToLag: 0, nota: 'economicSoak recém-iniciado — sem snapshots.' }; L.writeJSON('economic-watermark.json', out); console.log(JSON.stringify({ status: out.status })); return; }
  const maxPorLabel = {}; for (const l of presentes) maxPorLabel[l] = porLabel[l][porLabel[l].length - 1].eventCount;
  const commonWatermarkEventCount = Math.min(...Object.values(maxPorLabel));
  const noWm = {}; for (const l of presentes) { const arr = porLabel[l].filter((s) => s.eventCount <= commonWatermarkEventCount); noWm[l] = arr.length ? arr[arr.length - 1] : porLabel[l][0]; }
  const offsets = presentes.map((l) => noWm[l].committedOffset);
  const commonWatermarkOffset = Math.min(...offsets);
  const hashes = presentes.map((l) => noWm[l].accumulatedHash);
  const commonWatermarkHash = hashes[0]; const hashesConcordam = hashes.every((h) => h === commonWatermarkHash);
  const comparablePositions = presentes.reduce((s, l) => s + (noWm[l].posicoes || 0), 0);
  const maxEv = Math.max(...Object.values(maxPorLabel));
  const excludedDueToLag = presentes.reduce((s, l) => s + Math.max(0, (porLabel[l][porLabel[l].length - 1].posicoes || 0) - (noWm[l].posicoes || 0)), 0);
  const status = hashesConcordam ? (maxEv > commonWatermarkEventCount ? 'OK_LAGGING' : 'OK_COMMON_WATERMARK') : 'SOURCE_DIVERGENCE';

  const out = {
    schema: 'snowball.economic-watermark.v1_8', geradoEm: new Date(asOf || 0).toISOString(), asOfMs: asOf,
    status, commonWatermarkEventCount, commonWatermarkOffset, commonWatermarkHash, hashesConcordam,
    comparablePositions, excludedDueToLag, spreadEventCount: maxEv - commonWatermarkEventCount,
    porPolitica: Object.fromEntries(presentes.map((l) => [l, { eventCountNoWatermark: noWm[l].eventCount, posicoesNoWatermark: noWm[l].posicoes, capital: noWm[l].capital }])),
    nota: 'A comparação econômica pareada só considera posições materializadas neste watermark comum; o resto é excludedDueToLag.',
  };
  const p = L.writeJSON('economic-watermark.json', out);
  console.log(JSON.stringify({ saida: p, status, commonWatermarkEventCount, comparablePositions, excludedDueToLag }, null, 2));
}
build();
