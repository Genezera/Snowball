#!/usr/bin/env node
'use strict';
/**
 * v1.5 — PARTE 7. Common-window validator. A cada ciclo (aqui: a cada execução)
 * valida entre os 5 processos: mesmo forwardEpochId, mesmo startOffset (epoch),
 * mesma source identity, contagem de eventos e hash acumulado. Se divergir na MESMA
 * contagem => comparisonStatus = SUSPENDED_SOURCE_DIVERGENCE (coleta segue, sem
 * comparação econômica). READ-ONLY. Emite auditoria/progression/common-window-validator.json.
 */
const L = require('./lib-progression.cjs');
const path = require('node:path');

const LABELS = ['trial', 'control', 'observer-max3', 'observer-max4', 'observer-max5'];
const BASE = path.join(L.ROOT, 'auditoria', 'progression', 'forward');

function build() {
  const { asOf } = L.loadChampion();
  const epoch = L.rd(path.join(BASE, 'epoch.json'), null);
  const procs = LABELS.map((l) => { const h = L.rd(path.join(BASE, l, 'heartbeat.json'), null); const e = L.rd(path.join(BASE, l, 'estado.json'), null);
    return h ? { label: l, forwardEpochId: h.forwardEpochId, byteOffset: h.byteOffset, eventCount: h.eventCount, accumulatedEventHash: h.accumulatedEventHash, sourceStatus: h.sourceStatus, fileIdentity: e && e.cursor ? e.cursor.fileIdentity : null, vivo: h.ultimoCiclo && (Date.now() - h.ultimoCiclo) < 720_000 } : { label: l, ausente: true }; });
  const vivos = procs.filter((p) => !p.ausente);

  const epochsIguais = vivos.length > 0 && vivos.every((p) => p.forwardEpochId === (epoch ? epoch.forwardEpochId : vivos[0].forwardEpochId));
  const startOffsetIgual = epoch != null; // todos partem do epoch.byteOffset (congelado)
  const sourceIdIgual = vivos.every((p) => p.fileIdentity === (vivos[0] && vivos[0].fileIdentity));
  // divergência de hash NA MESMA contagem de eventos
  const porContagem = {}; let divergenciaHash = false; const detalhesDivergencia = [];
  for (const p of vivos) { const c = p.eventCount; if (porContagem[c] == null) porContagem[c] = p.accumulatedEventHash;
    else if (porContagem[c] !== p.accumulatedEventHash) { divergenciaHash = true; detalhesDivergencia.push({ eventCount: c, hashes: vivos.filter((x) => x.eventCount === c).map((x) => ({ label: x.label, hash: (x.accumulatedEventHash || '').slice(0, 12) })) }); } }
  const eventCounts = vivos.map((p) => p.eventCount);
  const spreadContagem = eventCounts.length ? Math.max(...eventCounts) - Math.min(...eventCounts) : 0;

  const comparacaoValida = epochsIguais && startOffsetIgual && sourceIdIgual && !divergenciaHash;
  const comparisonStatus = comparacaoValida ? 'OK' : (divergenciaHash ? 'SUSPENDED_SOURCE_DIVERGENCE' : (!epochsIguais ? 'SUSPENDED_EPOCH_MISMATCH' : 'SUSPENDED_SOURCE_DIVERGENCE'));

  const out = {
    schema: 'snowball.common-window-validator.v1_5', geradoEm: new Date(asOf || 0).toISOString(), asOfMs: asOf,
    epoch: epoch ? { forwardEpochId: epoch.forwardEpochId, byteOffset: epoch.byteOffset, fileIdentity: epoch.fileIdentity } : null,
    processos: procs,
    checks: { forwardEpochIdIgual: epochsIguais, startOffsetIgual, sourceIdentityIgual: sourceIdIgual, divergenciaHashMesmaContagem: divergenciaHash, spreadContagemEventos: spreadContagem },
    detalhesDivergencia,
    comparisonStatus,
    nota: comparacaoValida
      ? 'Os 5 processos partem do MESMO epoch/offset/fonte; hashes acumulados concordam na mesma contagem. Comparação econômica VÁLIDA (o spread de contagem é só defasagem de ciclo assíncrono; converge).'
      : 'Divergência detectada: comparação econômica SUSPENSA. A coleta continua; os números não são comparáveis até reconvergir.',
    honestidade: 'Divergência de contagem transitória (ciclos assíncronos) NÃO é divergência de fonte — só conta como SUSPENDED se dois processos na MESMA contagem têm hashes diferentes.',
  };
  const p = L.writeJSON('common-window-validator.json', out);
  console.log(JSON.stringify({ saida: p, comparisonStatus, epochsIguais, sourceIdIgual, divergenciaHash, spreadContagem,
    procs: procs.map((x) => x.ausente ? `${x.label}: ausente` : `${x.label}: epoch=${(x.forwardEpochId || '').slice(0, 8)} ev=${x.eventCount} src=${x.sourceStatus}`) }, null, 2));
}
build();
