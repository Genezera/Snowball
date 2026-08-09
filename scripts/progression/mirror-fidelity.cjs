#!/usr/bin/env node
'use strict';
/**
 * v1.8 — ITEM 4 (verificação). Fidelidade do MIRROR CONTROL vs Champion: operacional (mesmo
 * conjunto de posições abertas) e contábil (funding/custos/capital espelhados). SEPARADA da
 * fidelidade do Policy Control (item 5). READ-ONLY. Emite auditoria/progression/mirror-fidelity.json.
 */
const L = require('./lib-progression.cjs');
const fs = require('node:fs');
const path = require('node:path');
const MIRROR = path.join(L.ROOT, 'auditoria', 'progression', 'economic', 'mirror', 'estado.json');

function build() {
  const { estado: champ, asOf } = L.loadChampion();
  const mir = L.rd(MIRROR, null);
  if (!champ) { const out = { schema: 'snowball.mirror-fidelity.v1_8', status: 'CHAMPION_UNAVAILABLE' }; L.writeJSON('mirror-fidelity.json', out); console.log(JSON.stringify(out)); return; }
  if (!mir) { const out = { schema: 'snowball.mirror-fidelity.v1_8', geradoEm: new Date(asOf || 0).toISOString(), status: 'MIRROR_NOT_STARTED', nota: 'Mirror Control ainda não iniciado (economicSoak).' }; L.writeJSON('mirror-fidelity.json', out); console.log(JSON.stringify({ status: out.status })); return; }

  const championSet = new Set((champ.posicoes || []).map((p) => `${p.symbol}:${p.abertaEm}`));
  const mirrorSet = new Set(Object.keys(mir.aberturas || {}));
  const soMirror = [...mirrorSet].filter((k) => !championSet.has(k));
  const soChampion = [...championSet].filter((k) => !mirrorSet.has(k));
  const operacionalFiel = soMirror.length === 0 && soChampion.length === 0;

  // contábil: funding de cada posição aberta bate com o Champion ≤US$0,01
  let maxDiffFunding = 0;
  for (const p of (champ.posicoes || [])) { const m = (mir.aberturas || {})[`${p.symbol}:${p.abertaEm}`]; if (m) maxDiffFunding = Math.max(maxDiffFunding, Math.abs((m.fundingMirror || 0) - (p.fundingAcumulado || 0))); }
  const contabilFiel = maxDiffFunding <= 0.01;
  const capitalEspelhado = Math.abs((mir.championCapital || 0) - L.r4(champ.capital)) <= 0.01;

  const out = {
    schema: 'snowball.mirror-fidelity.v1_8', geradoEm: new Date(asOf || 0).toISOString(), asOfMs: asOf,
    mirrorMode: mir.mirrorMode || 'SNAPSHOT_MIRROR_INCOMPLETE',
    nivelDeFidelidade: 'SNAPSHOT_GRANULAR',   // não event-level: Champion não tem event log append-only
    operacional: { championAbertas: championSet.size, mirrorAbertas: mirrorSet.size, soNoMirror: soMirror, soNoChampion: soChampion, fiel: operacionalFiel },
    contabil: { maxDiffFundingAberto: L.r4(maxDiffFunding), fiel: contabilFiel, capitalEspelhado, championCapital: L.r4(champ.capital), mirrorChampionCapital: mir.championCapital, toleranciaUSD: 0.01 },
    eventos: { total: mir.eventos || 0, duplicadosIgnorados: mir.eventosDuplicadosIgnorados || 0, stateHash: mir.stateHash || null, tiposDerivados: ['OPEN', 'SCALE', 'FUNDING_SETTLED', 'COST_APPLIED', 'CLOSE'], championEventIdSintetico: true },
    // ── item 6: campos de fidelidade HONESTOS (sem 'fielTotal' ambíguo) ──
    snapshotAccountingFidelity: contabilFiel && capitalEspelhado,   // reconciliação financeira no snapshot (≤US$0,01)
    snapshotPositionFidelity: operacionalFiel,                       // mesmo conjunto de posições abertas no snapshot
    eventLevelFidelity: 'UNAVAILABLE',                               // Champion não expõe event log → não declarável
    mirrorCompleteness: 'SNAPSHOT_MIRROR_INCOMPLETE',
    fidelidadeSnapshotGranular: operacionalFiel && contabilFiel && capitalEspelhado,   // compat (= snapshotAccounting && snapshotPosition)
    limitacaoHonesta: 'eventLevelFidelity=UNAVAILABLE: o Champion NÃO expõe log de eventos append-only, então o Mirror DERIVA eventos do diff de snapshots. snapshotAccountingFidelity e snapshotPositionFidelity são declaráveis; "zero evento perdido" a nível de evento NÃO é declarado. championEventId é SINTÉTICO.',
    honestidade: 'Fidelidade do Mirror é SEPARADA da do Policy Control. Mirror = baseline contábil-operacional no snapshot; Policy = reexecução de regras do feed.',
  };
  const p = L.writeJSON('mirror-fidelity.json', out);
  console.log(JSON.stringify({ saida: p, mirrorCompleteness: out.mirrorCompleteness, snapshotAccountingFidelity: out.snapshotAccountingFidelity, snapshotPositionFidelity: out.snapshotPositionFidelity, eventLevelFidelity: out.eventLevelFidelity, championAbertas: championSet.size, mirrorAbertas: mirrorSet.size }, null, 2));
}
build();
