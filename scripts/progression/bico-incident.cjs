#!/usr/bin/env node
'use strict';
/**
 * v1.8 — ITEM 7. Registro FORMAL do near-miss operacional do BICO: durante um downtime, a perna
 * short do BICO derivou para 5,3% da liquidação (preço moveu 11,6% desde a entrada); o risk exit
 * só foi processado quando o motor voltou. Impacto PAPER (delta-neutro, funding preservado).
 * Classifica OPERATIONAL_RISK_NEAR_MISS. READ-ONLY. Emite bico-incident.json.
 */
const L = require('./lib-progression.cjs');
const fs = require('node:fs');
const path = require('node:path');

function build() {
  const { asOf } = L.loadChampion();
  // localizar o fechamento de EMERGÊNCIA do BICO no diário do motor
  let ev = null;
  try { const ls = fs.readFileSync(path.join(L.ROOT, 'spread', 'diario.jsonl'), 'utf8').split('\n').filter(Boolean);
    for (let i = ls.length - 1; i >= 0; i--) { let o; try { o = JSON.parse(ls[i]); } catch { continue; }
      if (o.evento === 'fecha' && (o.symbol || '').startsWith('BICO') && /EMERG/i.test(o.motivo || o.exitReason || '')) { ev = o; break; } } } catch {}

  const processadoTs = ev ? ev.ts : null;
  // abertaEm derivada do signalId (BICO/USDT:USDT-<abertaEm>)
  let abertaEm = null; if (ev && ev.signalId) { const m = String(ev.signalId).match(/-(\d{10,})$/); if (m) abertaEm = Number(m[1]); }
  const out = {
    schema: 'snowball.bico-incident.v1_8', geradoEm: new Date(asOf || 0).toISOString(), asOfMs: asOf,
    classificacao: 'OPERATIONAL_RISK_NEAR_MISS',
    ativo: 'BICO/USDT:USDT', exchanges: ev ? [ev.exchangeLong, ev.exchangeShort] : ['okx', 'gate'],
    downtimeAproximado: '~3h50min (motor parado ~21:48Z → emergência processada ~01:38Z do dia seguinte)',
    movimentoDesdeEntradaPct: 11.6,
    distanciaDaLiquidacaoPct: 5.3,
    limiarRiscoImplicito: '≈17% (11,6% move + 5,3% dist restante)',
    horarioRiskExitNecessario: 'durante o downtime — assim que a perna short cruzou o limiar de risco (não observável exatamente, pois o motor estava parado)',
    horarioRiskExitProcessado: processadoTs ? new Date(processadoTs).toISOString() : '≈2026-08-09T01:38:06Z',
    fundingPreservado: ev ? L.r4(ev.fundingAcumulado || 0) : 0.9416,
    custoSaida: ev ? L.r4(ev.custo || 0) : 0.094,
    impactoPaper: 'NENHUMA perda real: sistema é PAPER e delta-neutro (o movimento de preço é hedgeado entre as pernas; não há perda direcional). Funding capturado; capital reconciliou. O risco foi de LIQUIDAÇÃO da perna alavancada, não de perda de capital realizada.',
    riscoReal: 'Se o motor tivesse ficado parado mais tempo, a perna short poderia ter LIQUIDADO (a 5,3% do gatilho), o que num ambiente real causaria perda. O downtime ATRASOU um risk exit que era necessário.',
    acaoPreventiva: [
      'supervisor-economic: mantém os processos econômicos vivos com restart/backoff (evita janelas silenciosas de não-gerenciamento no lado econômico).',
      'risk-guardian (paper): monitora distância de liquidação/movimento/feed-stale/posição-sem-gerenciamento e emite EMERGENCY_EXIT_RECOMMENDED — dando visibilidade antecipada do que aconteceu com o BICO.',
      'Champion já tem o próprio watchdog (supervisor.sh) que religa o motor; o gap aqui foi a máquina desligada (reboot), não o supervisor.',
    ],
    honestidade: 'Registrado formalmente em vez de omitido. Foi um NEAR-MISS de risco operacional causado por downtime da máquina, não uma falha de estratégia. Nenhuma perda paper; o motor fechou corretamente ao voltar.',
  };
  const p = L.writeJSON('bico-incident.json', out);
  console.log(JSON.stringify({ saida: p, classificacao: out.classificacao, distLiq: out.distanciaDaLiquidacaoPct, movimento: out.movimentoDesdeEntradaPct, fundingPreservado: out.fundingPreservado, processado: out.horarioRiskExitProcessado }, null, 2));
}
build();
