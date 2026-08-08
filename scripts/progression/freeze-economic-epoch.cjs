#!/usr/bin/env node
'use strict';
/**
 * v1.8 — ITEM 12. Congela a economicForwardEpoch: byteOffset = EOF atual do feed, para que
 * Mirror/Policy/Trial/observer-max3/4/5 comecem no MESMO watermark. Preserva o durabilitySoak.
 * Emite auditoria/progression/economic/epoch.json (runtime) + cópia versionada economic-epoch.json.
 */
const L = require('./lib-progression.cjs');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');

function build() {
  const { estado: champ, asOf } = L.loadChampion();
  const OBS = path.join(L.ROOT, 'vigilancia', 'arquivo-observacoes.jsonl');
  const st = fs.statSync(OBS);
  const byteOffset = st.size;
  const fileIdentity = `${st.dev}:${st.ino || Math.round(st.birthtimeMs)}`;
  const championCapital = champ ? L.r4(champ.capital) : null;
  const economicForwardEpochId = sha(`economic|${fileIdentity}|${byteOffset}|${championCapital}|${asOf}`).slice(0, 16);
  const epoch = {
    schema: 'snowball.economic-epoch.v1_8', economicForwardEpochId,
    // forward-lab lê 'forwardEpochId' e 'byteOffset' — replicamos p/ compatibilidade do reader
    forwardEpochId: economicForwardEpochId, sourceFileId: OBS, fileIdentity, byteOffset, lineNumber: 0, timestamp: asOf,
    championCapitalNaEpoch: championCapital, congeladoEm: new Date(asOf || 0).toISOString(),
    processos: ['mirror', 'policy', 'trial', 'observer-max3', 'observer-max4', 'observer-max5'],
    nota: 'Todos os processos econômicos partem deste byteOffset (mesmo watermark). Mirror lê o Champion, não o feed.',
  };
  const dir = path.join(L.ROOT, 'auditoria', 'progression', 'economic');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'epoch.json'), JSON.stringify(epoch, null, 2));
  const p = L.writeJSON('economic-epoch.json', epoch);
  console.log(JSON.stringify({ saida: p, economicForwardEpochId, byteOffset, championCapital }, null, 2));
}
build();
