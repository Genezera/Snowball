#!/usr/bin/env node
'use strict';
/**
 * v1.3 — PARTE 1. Congela um snapshot comum para TODAS as comparações v1.3.
 * READ-ONLY. Emite auditoria/progression/snapshot.json.
 */
const L = require('./lib-progression.cjs');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execSync } = require('node:child_process');

function hashArquivo(p) {
  try { const b = fs.readFileSync(p); return { sha256: crypto.createHash('sha256').update(b).digest('hex'), bytes: b.length }; }
  catch { return { sha256: null, bytes: 0 }; }
}

function build() {
  const { estado, epochs } = L.loadChampion();
  const diario = L.jsonl(L.P.diario).filter((e) => typeof e.ts === 'number').sort((a, b) => a.ts - b.ts);
  const primeiro = diario[0], ultimo = diario[diario.length - 1];
  const ultimoEventId = ultimo ? `${ultimo.ts}:${ultimo.evento}:${ultimo.symbol || ''}` : null;
  // último cycleId: das observações/candidatos (formato "persistencia-<ts>") ou do diário
  let ultimoCycleId = null;
  try { const obs = fs.readFileSync(path.join(L.ROOT, 'vigilancia', 'ciclos.json'), 'utf8'); const j = JSON.parse(obs); const ks = Object.keys(j.ciclos || j || {}); ultimoCycleId = ks.length ? ks[ks.length - 1] : null; } catch { /* ignore */ }
  if (!ultimoCycleId && ultimo) ultimoCycleId = `ciclo-${ultimo.ts}`;

  let commit = null; try { commit = execSync('git rev-parse HEAD', { cwd: L.ROOT }).toString().trim(); } catch { /* ignore */ }
  const configEpochId = L.epochDe(ultimo ? ultimo.ts : 0, epochs);

  const arquivos = {
    'spread/diario.jsonl': hashArquivo(L.P.diario),
    'spread/estado.json': hashArquivo(L.P.estado),
    'spread/marcacao.json': hashArquivo(L.P.marcacao),
    'vigilancia/arquivo-observacoes.jsonl': hashArquivo(path.join(L.ROOT, 'vigilancia', 'arquivo-observacoes.jsonl')),
  };
  const snapshotId = crypto.createHash('sha256').update(`${ultimoEventId}|${commit}|${arquivos['spread/diario.jsonl'].sha256}`).digest('hex').slice(0, 16);

  const snap = {
    schema: 'snowball.snapshot.v1_3', snapshotId,
    tsInicial: primeiro ? primeiro.ts : null, tsInicialISO: primeiro ? new Date(primeiro.ts).toISOString() : null,
    tsFinal: ultimo ? ultimo.ts : null, tsFinalISO: ultimo ? new Date(ultimo.ts).toISOString() : null,
    ultimoEventId, ultimoCycleId, commit, configEpochId,
    capitalNoCorte: L.r4(estado.capital), fundingNoCorte: L.r4(estado.fundingTotal), custosNoCorte: L.r4(estado.custosTotal),
    posicoesAbertasNoCorte: (estado.posicoes || []).map((p) => p.symbol),
    hashes: arquivos, eventosNoDiario: diario.length,
    nota: 'Corte comum congelado. Todas as comparações v1.3 (Control, Trial replay, frontier, vida) usam ESTE snapshotId. Os processos FORWARD (Trial/Control live-paper) partem daqui para a frente.',
  };
  const p = L.writeJSON('snapshot.json', snap);
  console.log(JSON.stringify({ saida: p, snapshotId, ultimoEventId, ultimoCycleId, commit: commit ? commit.slice(0, 8) : null, configEpochId,
    janela: `${snap.tsInicialISO} → ${snap.tsFinalISO}`, eventos: diario.length, capital: snap.capitalNoCorte }, null, 2));
}
build();
