#!/usr/bin/env node
'use strict';
/**
 * v1.6 — PARTES 5,6. Common watermark: minimumCommittedOffset/EventCount,
 * commonLastEventId, commonAccumulatedHash. Compara os 5 processos EXATAMENTE no
 * mesmo evento usando os snapshots por watermark (mesmo que um esteja adiantado).
 * READ-ONLY. Emite auditoria/progression/common-watermark.json.
 */
const L = require('./lib-progression.cjs');
const fs = require('node:fs');
const path = require('node:path');
const LABELS = ['trial', 'control', 'observer-max3', 'observer-max4', 'observer-max5'];
const BASE = path.join(L.ROOT, 'auditoria', 'progression', 'forward');

function snaps(label) { try { return fs.readFileSync(path.join(BASE, label, 'snapshots.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)); } catch { return []; } }

function build() {
  const { asOf } = L.loadChampion();
  const porLabel = {}; for (const l of LABELS) porLabel[l] = snaps(l);
  const presentes = LABELS.filter((l) => porLabel[l].length > 0);
  if (presentes.length === 0) { L.writeJSON('common-watermark.json', { schema: 'snowball.common-watermark.v1_6', geradoEm: new Date(asOf || 0).toISOString(), status: 'SUSPENDED', nota: 'sem snapshots ainda' }); console.log(JSON.stringify({ status: 'SUSPENDED', nota: 'sem snapshots' })); return; }

  // watermark = menor eventCount máximo entre os presentes (o evento que TODOS já cruzaram)
  const maxPorLabel = {}; for (const l of presentes) maxPorLabel[l] = porLabel[l][porLabel[l].length - 1].eventCount;
  const minimumCommittedEventCount = Math.min(...Object.values(maxPorLabel));
  // snapshot de cada processo no watermark (maior eventCount ≤ watermark)
  const noWatermark = {}; for (const l of presentes) { const arr = porLabel[l].filter((s) => s.eventCount <= minimumCommittedEventCount); noWatermark[l] = arr.length ? arr[arr.length - 1] : porLabel[l][0]; }
  const offsets = presentes.map((l) => noWatermark[l].committedOffset);
  const minimumCommittedOffset = Math.min(...offsets);
  const hashes = presentes.map((l) => noWatermark[l].accumulatedHash);
  const commonAccumulatedHash = hashes[0];
  const hashesConcordam = hashes.every((h) => h === commonAccumulatedHash);

  // comparação econômica SÓ no watermark
  const economiaNoWatermark = presentes.map((l) => ({ label: l, eventCount: noWatermark[l].eventCount, capital: noWatermark[l].capital, pnl: noWatermark[l].pnl, funding: noWatermark[l].funding, custos: noWatermark[l].custos, posicoes: noWatermark[l].posicoes, stateHash: noWatermark[l].stateHash, saldos: noWatermark[l].saldos }));
  // control e observer-max3 têm as MESMAS 6 exchanges + maxPos 3 => devem ter estado idêntico no watermark
  const controlSnap = noWatermark['control'], obs3Snap = noWatermark['observer-max3'];
  const controlVsObs3Igual = controlSnap && obs3Snap && controlSnap.stateHash === obs3Snap.stateHash;

  const maxEventCount = Math.max(...Object.values(maxPorLabel));
  const spread = maxEventCount - minimumCommittedEventCount;
  let status = 'OK_COMMON_WATERMARK';
  if (!hashesConcordam) status = 'SOURCE_DIVERGENCE';
  else if (controlSnap && obs3Snap && !controlVsObs3Igual) status = 'STATE_DIVERGENCE';
  else if (spread > 0) status = 'PROCESS_LAGGING'; // adiantamento assíncrono (comparação ainda válida no watermark)

  // ── v1.7 item 5: cobertura CONTÍNUA do watermark comum (append-only, cresce no soak) ──
  const latestOffset = {}; for (const l of presentes) latestOffset[l] = porLabel[l][porLabel[l].length - 1].committedOffset;
  const maxLatestOffset = Math.max(...Object.values(latestOffset));
  const watermarkCoveragePct = maxEventCount > 0 ? L.r2((minimumCommittedEventCount / maxEventCount) * 100) : 100;
  const maxProcessLagEvents = spread, maxProcessLagBytes = maxLatestOffset - minimumCommittedOffset;
  const covLog = path.join(BASE, 'watermark-coverage.jsonl');
  let hist = []; try { hist = fs.readFileSync(covLog, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)); } catch {}
  const rec = { ts: asOf, status, watermarkCoveragePct, commonEventCount: minimumCommittedEventCount, commonCommittedOffset: minimumCommittedOffset, maxProcessLagEvents, maxProcessLagBytes, hashesConcordam };
  if (!hist.length || hist[hist.length - 1].ts !== asOf) { try { fs.appendFileSync(covLog, JSON.stringify(rec) + '\n'); hist.push(rec); } catch {} }
  const sourceDivergences = hist.filter((r) => r.status === 'SOURCE_DIVERGENCE').length;
  const stateDivergences = hist.filter((r) => r.status === 'STATE_DIVERGENCE').length;
  let maxReconvergenceTimeMs = 0, divStart = null;
  for (const r of hist) { const div = r.status === 'SOURCE_DIVERGENCE' || r.status === 'STATE_DIVERGENCE'; if (div) { if (divStart == null) divStart = r.ts; } else if (divStart != null) { maxReconvergenceTimeMs = Math.max(maxReconvergenceTimeMs, r.ts - divStart); divStart = null; } }
  const coverageMediaPct = hist.length ? L.r2(hist.reduce((s, r) => s + (r.watermarkCoveragePct || 0), 0) / hist.length) : watermarkCoveragePct;

  const out = {
    schema: 'snowball.common-watermark.v1_7', geradoEm: new Date(asOf || 0).toISOString(), asOfMs: asOf,
    minimumCommittedOffset, minimumCommittedEventCount, commonAccumulatedHash, commonLastEventIdHashPrefix: (commonAccumulatedHash || '').slice(0, 12),
    hashesConcordamNoWatermark: hashesConcordam, spreadEventCount: spread,
    status,
    coberturaContinua: { watermarkCoveragePct, coverageMediaPct, commonCommittedOffset: minimumCommittedOffset, commonEventCount: minimumCommittedEventCount, maxProcessLagEvents, maxProcessLagBytes, maxReconvergenceTimeMs, sourceDivergences, stateDivergences, amostras: hist.length },
    economiaNoWatermark,
    controlVsObserverMax3Identico: controlVsObs3Igual,
    nota: status === 'PROCESS_LAGGING' ? 'Um processo está adiantado (assíncrono) — a comparação econômica usa o watermark comum, então continua VÁLIDA.' : (status === 'OK_COMMON_WATERMARK' ? 'Todos no mesmo watermark; hashes concordam.' : 'Divergência — comparação econômica SUSPENSA fora do watermark.'),
    honestidade: 'A comparação econômica dos 5 usa SOMENTE o estado materializado no watermark comum, não o último estado de cada um.',
  };
  const p = L.writeJSON('common-watermark.json', out);
  console.log(JSON.stringify({ saida: p, status, minimumCommittedEventCount, minimumCommittedOffset, hashesConcordam, spread, controlVsObs3Igual,
    cobertura: { coveragePct: watermarkCoveragePct, lagEvents: maxProcessLagEvents, lagBytes: maxProcessLagBytes, sourceDiv: sourceDivergences, stateDiv: stateDivergences, amostras: hist.length },
    econ: economiaNoWatermark.map((e) => `${e.label}: ev${e.eventCount} cap ${e.capital} pos ${e.posicoes}`) }, null, 2));
}
build();
