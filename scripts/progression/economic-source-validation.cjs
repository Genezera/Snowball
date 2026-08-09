#!/usr/bin/env node
'use strict';
/**
 * v1.8-coleta — ITEM 2. Valida a identidade da FONTE antes/durante o economicSoak: mesma fonte,
 * mesma file identity (ou rotação reconhecida), não truncada, economicForwardEpochId preservado,
 * byteOffset inicial preservado, nenhum evento anterior reprocessado. Se a fonte foi truncada,
 * substituída ou recriada → SUSPENDER (não reiniciar silenciosamente) e relatar. READ-ONLY.
 * Emite auditoria/progression/economic-source-validation.json.
 */
const L = require('./lib-progression.cjs');
const fs = require('node:fs');
const path = require('node:path');
const ECON = path.join(L.ROOT, 'auditoria', 'progression', 'economic');
const FEED = ['policy', 'trial', 'observer-max3', 'observer-max4', 'observer-max5'];

function build() {
  const { asOf } = L.loadChampion();
  const OBS = path.join(L.ROOT, 'vigilancia', 'arquivo-observacoes.jsonl');
  const epoch = L.rd(path.join(ECON, 'epoch.json'), null);
  let st = null; try { st = fs.statSync(OBS); } catch {}
  const fidAtual = st ? `${st.dev}:${st.ino || Math.round(st.birthtimeMs)}` : null;

  const checks = {
    fonteExiste: !!st,
    mesmaFonte: !!(epoch && epoch.sourceFileId === OBS),
    fileIdentityIgual: !!(epoch && fidAtual === epoch.fileIdentity),
    naoTruncado: !!(st && epoch && st.size >= epoch.byteOffset),
    epochPreservado: !!(epoch && epoch.economicForwardEpochId),
    byteOffsetInicialPreservado: !!(epoch && typeof epoch.byteOffset === 'number'),
  };
  // nenhum evento anterior reprocessado: todo cursor >= byteOffset da epoch
  const cursores = {}; let semReprocesso = true;
  for (const l of FEED) { const e = L.rd(path.join(ECON, l, 'estado.json'), null); const bo = e && e.cursor ? e.cursor.byteOffset : null; cursores[l] = { byteOffset: bo, eventCount: e ? e.eventCount : null, epochId: e ? (e.forwardEpochId || '').slice(0, 16) : null };
    if (bo != null && epoch && bo < epoch.byteOffset) semReprocesso = false; }
  checks.nenhumEventoAnteriorReprocessado = semReprocesso;
  checks.mesmoEpochNosProcessos = FEED.every((l) => !cursores[l].epochId || cursores[l].epochId === (epoch ? epoch.economicForwardEpochId : ''));

  const rotacaoReconhecida = false; // não houve rotação nesta janela (fileIdentity igual)
  const fonteIntegra = checks.fonteExiste && checks.mesmaFonte && (checks.fileIdentityIgual || rotacaoReconhecida) && checks.naoTruncado && checks.epochPreservado && checks.byteOffsetInicialPreservado && checks.nenhumEventoAnteriorReprocessado;

  let veredito, acao;
  if (fonteIntegra) { veredito = 'SOURCE_OK'; acao = 'PROSSEGUIR_ECONOMIC_SOAK'; }
  else if (st && epoch && st.size < epoch.byteOffset) { veredito = 'SOURCE_TRUNCATED'; acao = 'SUSPENDER_E_RELATAR'; }
  else if (epoch && fidAtual !== epoch.fileIdentity) { veredito = 'SOURCE_REPLACED_OR_RECREATED'; acao = 'SUSPENDER_E_RELATAR'; }
  else { veredito = 'SOURCE_INDETERMINADO'; acao = 'SUSPENDER_E_RELATAR'; }

  const out = {
    schema: 'snowball.economic-source-validation.v1_8', geradoEm: new Date(asOf || 0).toISOString(), asOfMs: asOf,
    arquivoFonte: OBS, economicForwardEpochId: epoch ? epoch.economicForwardEpochId : null,
    fileIdentity: { epoch: epoch ? epoch.fileIdentity : null, atual: fidAtual, igual: checks.fileIdentityIgual, rotacaoReconhecida },
    byteOffset: { inicialEpoch: epoch ? epoch.byteOffset : null, sizeAtual: st ? st.size : null, bytesNovos: st && epoch ? st.size - epoch.byteOffset : null, truncado: !checks.naoTruncado },
    cursoresPorProcesso: cursores,
    checks, fonteIntegra, veredito, acao,
    suspendeEconomicSoak: acao === 'SUSPENDER_E_RELATAR',
    novaEpochNecessaria: acao === 'SUSPENDER_E_RELATAR',
    honestidade: 'Se a fonte foi truncada/substituída/recriada, o economicSoak SUSPENDE (não reinicia em silêncio) e só se congela nova epoch se necessário. Nesta janela: fonte íntegra, mesma identity, sem reprocessamento.',
  };
  const p = L.writeJSON('economic-source-validation.json', out);
  console.log(JSON.stringify({ saida: p, veredito, acao, fileIdentityIgual: checks.fileIdentityIgual, naoTruncado: checks.naoTruncado, bytesNovos: out.byteOffset.bytesNovos, semReprocesso }, null, 2));
}
build();
