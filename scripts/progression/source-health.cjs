#!/usr/bin/env node
'use strict';
/**
 * v1.6 — PARTE 7. Modelo de saúde da fonte. NÃO usa batch vazio como prova de
 * indisponibilidade. Usa lastModified do arquivo, scan interval esperado, último
 * ciclo completo e (quando disponível) heartbeat do coletor. Classifica:
 * NO_NEW_DATA_YET / COLLECTOR_DOWNTIME / EXCHANGE_UNAVAILABLE / OPPORTUNITY_ABSENT /
 * SCANNER_FILTERED. READ-ONLY. Emite auditoria/progression/source-health.json.
 */
const L = require('./lib-progression.cjs');
const fs = require('node:fs');
const path = require('node:path');

function build() {
  const { asOf } = L.loadChampion();
  const OBS = path.join(L.ROOT, 'vigilancia', 'arquivo-observacoes.jsonl');
  let st = null; try { st = fs.statSync(OBS); } catch {}
  const agora = Date.now();
  const lastModifiedMs = st ? st.mtimeMs : null;
  const idadeArquivoS = lastModifiedMs ? Math.round((agora - lastModifiedMs) / 1000) : null;
  const SCAN_INTERVAL_S = 5 * 60; // cadência observada (~5min, gap-sensitivity)

  // heartbeat do coletor (se existir)
  const coletor = L.rd(path.join(L.ROOT, 'vigilancia', 'coletor-estado.json'), null);
  const custodia = L.rd(path.join(L.ROOT, 'vigilancia', 'captura.json'), null);

  // classificação da saúde global da FONTE (não do episódio)
  let classe;
  if (idadeArquivoS == null) classe = 'COLLECTOR_DOWNTIME';
  else if (idadeArquivoS <= SCAN_INTERVAL_S * 1.5) classe = 'NO_NEW_DATA_YET';         // arquivo fresco, só sem obs novas no ciclo
  else if (idadeArquivoS <= SCAN_INTERVAL_S * 4) classe = 'NO_NEW_DATA_YET';           // atraso tolerável
  else classe = 'COLLECTOR_DOWNTIME';                                                  // parado há > 4 ciclos

  const out = {
    schema: 'snowball.source-health.v1_6', geradoEm: new Date(asOf || 0).toISOString(), asOfMs: asOf,
    arquivo: OBS, arquivoBytes: st ? st.size : null, lastModifiedISO: lastModifiedMs ? new Date(lastModifiedMs).toISOString() : null, idadeArquivoS,
    scanIntervalEsperadoS: SCAN_INTERVAL_S, coletorHeartbeat: coletor ? { ok: true, chaves: Object.keys(coletor).slice(0, 6) } : { ok: false },
    classificacaoGlobal: classe,
    classesPossiveis: ['NO_NEW_DATA_YET', 'COLLECTOR_DOWNTIME', 'EXCHANGE_UNAVAILABLE', 'OPPORTUNITY_ABSENT', 'SCANNER_FILTERED'],
    porEpisodio: {
      OPPORTUNITY_ABSENT: 'feed ativo mas a chave sumiu (detectado no forward-lab por ciclo)',
      SCANNER_FILTERED: 'obs presente mas filtrada por EV/payback antes do saldo',
      EXCHANGE_UNAVAILABLE: 'saúde por exchange via captura/custódia (framework); parcial nesta fase',
    },
    nota: 'Batch vazio num ciclo NÃO prova indisponibilidade — só COLLECTOR_DOWNTIME quando o arquivo não é modificado por > 4× o scan interval. Distingue-se ausência global (fonte) de ausência de oportunidade (episódio).',
  };
  const p = L.writeJSON('source-health.json', out);
  console.log(JSON.stringify({ saida: p, classificacaoGlobal: classe, idadeArquivoS, coletorHeartbeat: !!coletor }, null, 2));
}
build();
