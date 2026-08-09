#!/usr/bin/env node
'use strict';
/**
 * v1.8 — ITEM 1. Proveniência da identidade causal. O feed de observações NÃO possui
 * collectorCycleId/scanCycleId NATIVO (chaves: ts,k,spread,apr,vol). Portanto o
 * sourceRankingCycleId é INFERRED_FROM_SOURCE_TIMING (gap de burst). Este builder:
 *  - confirma a ausência do ID nativo;
 *  - mede a distribuição de gaps globais p/ justificar a CONFIANÇA da inferência (bimodalidade
 *    intra-scan vs inter-scan em torno do BURST_GAP_MS);
 *  - documenta o gap usado;
 *  - deixa explícito que NÃO é ID nativo (prefixo inf_).
 * READ-ONLY. Emite auditoria/progression/identity-provenance.json.
 */
const L = require('./lib-progression.cjs');
const fs = require('node:fs');
const path = require('node:path');
const BURST_GAP_MS = 120000, EPISODE_GAP_MS = 30 * 60000;

function build() {
  const { asOf } = L.loadChampion();
  const OBS = path.join(L.ROOT, 'vigilancia', 'arquivo-observacoes.jsonl');
  // amostra a cauda (~2MB) p/ schema + distribuição de gaps
  let st = null; try { st = fs.statSync(OBS); } catch {}
  let tail = '';
  if (st) { try { const n = Math.min(st.size, 2 * 1024 * 1024); const fd = fs.openSync(OBS, 'r'); const buf = Buffer.alloc(n); fs.readSync(fd, buf, 0, n, st.size - n); fs.closeSync(fd); tail = buf.toString('utf8'); } catch {} }
  const linhas = tail.split('\n'); if (linhas.length) linhas.shift();
  const tsAll = []; let chavesObs = null;
  for (const ln of linhas) { if (!ln) continue; let o; try { o = JSON.parse(ln); } catch { continue; } if (o.ts == null) continue; if (!chavesObs) chavesObs = Object.keys(o); tsAll.push(o.ts); }
  tsAll.sort((a, b) => a - b);
  const idNativoPresente = !!(chavesObs && (chavesObs.includes('collectorCycleId') || chavesObs.includes('scanCycleId') || chavesObs.includes('cycleId') || chavesObs.includes('generation')));

  // gaps consecutivos
  const gaps = []; for (let i = 1; i < tsAll.length; i++) { const g = tsAll[i] - tsAll[i - 1]; if (g >= 0) gaps.push(g); }
  const intra = gaps.filter((g) => g <= BURST_GAP_MS).length;
  const inter = gaps.filter((g) => g > BURST_GAP_MS).length;
  // "vale" em torno do limiar: fração de gaps na zona ambígua [0.5x, 2x]*BURST_GAP
  const ambiguos = gaps.filter((g) => g > BURST_GAP_MS * 0.5 && g < BURST_GAP_MS * 2).length;
  const total = gaps.length || 1;
  const fracAmbigua = L.r4(ambiguos / total);
  // confiança: alta se a zona ambígua é pequena (separação bimodal limpa)
  const confianca = idNativoPresente ? 1 : L.r4(Math.max(0, 1 - fracAmbigua * 3));
  const nivelConfianca = confianca >= 0.85 ? 'ALTA' : confianca >= 0.6 ? 'MEDIA' : 'BAIXA';

  const out = {
    schema: 'snowball.identity-provenance.v1_8', geradoEm: new Date(asOf || 0).toISOString(), asOfMs: asOf,
    idNativoPresente,
    classificacao: idNativoPresente ? 'NATIVE_COLLECTOR_CYCLE_ID' : 'INFERRED_FROM_SOURCE_TIMING',
    chavesDoFeed: chavesObs || [],
    prefixoDeInferencia: 'inf_',
    nota: idNativoPresente ? 'Feed expõe cycleId nativo — identidade causal perfeita disponível.' : 'Feed SEM collectorCycleId/scanCycleId nativo. sourceRankingCycleId é INFERIDO do timing (gap de burst) e prefixado inf_ para NUNCA ser confundido com ID nativo. sourceOpportunityEpisodeId e sourcePositionId também são inferidos por contiguidade.',
    gapUsadoMs: { rankingCycleBurstGapMs: BURST_GAP_MS, opportunityEpisodeGapMs: EPISODE_GAP_MS },
    distribuicaoGaps: { amostraGaps: total, intraBurst: intra, interBurst: inter, ambiguosNaZonaLimiar: ambiguos, fracaoAmbigua: fracAmbigua },
    confianca: { valor: confianca, nivel: nivelConfianca, metodo: 'fração de gaps na zona ambígua [0.5x,2x]*BURST_GAP; quanto menor, mais limpa a separação bimodal (scan interno vs entre scans)' },
    recomendacaoColetor: 'PREFERENCIAL (não feito nesta fase p/ não tocar o coletor de produção durante a rigor-closure): adicionar collectorCycleId append-only por scan no coletor (vigilancia), sem alterar lógica econômica nem o Champion — elevaria a identidade a NATIVE_COLLECTOR_CYCLE_ID.',
    impedeConfusao: 'O valor de sourceRankingCycleId começa com inf_; qualquer join que espere ID nativo falha explicitamente em vez de casar por engano.',
    honestidade: 'Não se declara identidade causal PERFEITA. O que existe é identidade causal INFERIDA com confiança medida sobre a distribuição real de gaps do feed.',
  };
  const p = L.writeJSON('identity-provenance.json', out);
  console.log(JSON.stringify({ saida: p, classificacao: out.classificacao, idNativoPresente, confianca: out.confianca, gaps: out.distribuicaoGaps }, null, 2));
}
build();
