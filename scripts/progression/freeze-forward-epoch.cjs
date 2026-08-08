#!/usr/bin/env node
'use strict';
/**
 * v1.5 — PARTE 1. Congela um Forward Epoch COMUM para os 5 processos forward: mesmo
 * snapshotId, configEpochId, arquivo, byteOffset, lineNumber, eventHash, timestamp e
 * primeira observação. Os processos que virem um epoch diferente preservam o estado
 * antigo como WARMUP_NOT_COMPARABLE (não apagam). READ-ONLY sobre a fonte.
 * Emite auditoria/progression/forward/epoch.json (+ cópia versionada em auditoria/progression/forward-epoch.json).
 */
const L = require('./lib-progression.cjs');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');

function build() {
  const OBS = path.join(L.ROOT, 'vigilancia', 'arquivo-observacoes.jsonl');
  const st = fs.statSync(OBS);
  const fileIdentity = `${st.dev}:${st.ino || Math.round(st.birthtimeMs)}`;
  const byteOffset = st.size;
  // lineNumber e eventHash até o offset + última observação existente (a "primeira observação"
  // do epoch será a PRÓXIMA linha appendada — o forward parte daqui).
  const buf = fs.readFileSync(OBS, 'utf8');
  const linhas = buf.split('\n').filter(Boolean);
  const lineNumber = linhas.length;
  const eventHash = sha(buf).slice(0, 32);
  let ultimaObs = null; try { ultimaObs = JSON.parse(linhas[linhas.length - 1]); } catch {}
  const snap = L.rd(L.P.outDir + '/snapshot.json', {});
  const timestamp = ultimaObs ? ultimaObs.ts : Date.now();
  const forwardEpochId = sha(`${snap.snapshotId || ''}|${fileIdentity}|${byteOffset}|${eventHash}`).slice(0, 16);

  const epoch = {
    schema: 'snowball.forward-epoch.v1_5', forwardEpochId,
    snapshotId: snap.snapshotId || null, configEpochId: snap.configEpochId || null,
    sourceFileId: OBS, fileIdentity, byteOffset, lineNumber, eventHash, timestamp,
    primeiraObservacaoEsperada: 'a próxima linha appendada após byteOffset (forward começa daqui)',
    ultimaObservacaoAntesDoEpoch: ultimaObs ? { ts: ultimaObs.ts, k: ultimaObs.k } : null,
    processos: ['trial', 'control', 'observer-max3', 'observer-max4', 'observer-max5'],
    warmupPolicy: 'estado anterior de qualquer processo é preservado como warmup-<epoch>.json (WARMUP_NOT_COMPARABLE); nada é apagado.',
    congeladoEm: new Date(timestamp).toISOString(),
  };
  fs.mkdirSync(path.join(L.ROOT, 'auditoria', 'progression', 'forward'), { recursive: true });
  fs.writeFileSync(path.join(L.ROOT, 'auditoria', 'progression', 'forward', 'epoch.json'), JSON.stringify(epoch, null, 2));
  const p = L.writeJSON('forward-epoch.json', epoch); // cópia versionada (não-runtime)
  console.log(JSON.stringify({ saida: p, forwardEpochId, byteOffset, lineNumber, fileIdentity, eventHash: eventHash.slice(0, 12), timestamp: new Date(timestamp).toISOString() }, null, 2));
}
build();
