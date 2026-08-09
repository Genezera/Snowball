#!/usr/bin/env node
'use strict';
/**
 * Pipeline reprodutível da Plataforma de Progressão (read-only). Roda os builders na
 * ordem de dependência e reconcilia com o Champion. Nenhuma escrita fora de
 * auditoria/progression/. Uso: node build-all.cjs
 */
const { execFileSync } = require('node:child_process');
const path = require('node:path');
const ordem = [
  'build-capital-ledger.cjs',   // Parte 1
  'capacity-analysis.cjs',      // v1.1 Partes 1,5 (antes dos chefes)
  'build-bosses.cjs',           // Parte 3 (5 estados; lê capacity-analysis)
  'build-engine-registry.cjs',  // Parte 4
  'build-levels.cjs',           // Parte 2 + níveis capital/evidence/operational (lê bosses+registry)
  'exchange-selector.cjs',      // Parte 5 (landscape v1)
  'exchange-replay-2ex.cjs',    // v1.1 Partes 2,3,4 (replay reconciliado)
  'capital-opportunity-router.cjs', // Parte 6
  'reinvestment-sim.cjs',       // Parte 7 (v1)
  'reinvestment-counterfactual.cjs', // v1.1 Parte 6 (contrafactual real)
  'growth-scenarios.cjs',       // Parte 8/9 (corrigido)
  'engine-diagnostics.cjs',     // Parte 11
  'opportunity-frontier.cjs',   // v1.2 Partes 1,2 (observer pré-saldo + frontier)
  'trial-control-window.cjs',   // v1.2 Partes 3,4,5,6 (trial/control/common-window/gate)
  'unlock-fund.cjs',            // v1.2 Partes 7,8,9 (fundo/ranking/regra)
  'snapshot-freeze.cjs',        // v1.3 Parte 1 (corte comum)
  'reconcile-control.cjs',      // v1.3 Parte 2 (Control ≤US$0,01)
  'opportunity-life.cjs',       // v1.3 Partes 6,7 (vida + multi-horizonte)
  'maxpositions-test.cjs',      // v1.3 Parte 8 (maxPos 3/4/5)
  'forward-status.cjs',         // v1.3 Partes 9,10 (common-window forward + gate)
  'opportunity-episodes.cjs',   // v1.4 Partes 2,3,4,5 (episódios/censura/no-lookahead/funil)
  'control-fidelity-vectorial.cjs', // v1.4/1.5 (fidelidade por definição + consistência interna)
  'gap-sensitivity.cjs',        // v1.5 Parte 9 (sensibilidade do gap 15/30/45/60)
  'gap-coverage.cjs',           // v1.6 Parte 12 (gap sensitivity corrigida por cobertura)
  'common-window-validator.cjs', // v1.5 Parte 7 (validator dos 5 processos)
  'common-watermark.cjs',       // v1.6/1.7 Partes 5,6 (watermark comum + cobertura contínua)
  'source-health.cjs',          // v1.6/1.7 Parte 7/8 (saúde da fonte + por exchange)
  'host-reboot.cjs',            // v1.7 Parte 7 (status honesto do reboot de host)
  'assurance-level.cjs',        // v1.7 Parte 1 (nível de garantia realmente testado)
  'paired-economic-fidelity.cjs', // v1.7 Parte 9 (dataset pareado por oportunidade-fonte)
  'independent-sample.cjs',     // v1.7 Parte 10 (sourceOpportunityId únicos, censura)
  'concentration.cjs',          // v1.7 Parte 11 (limites de concentração)
  'stress-paired.cjs',          // v1.7 Parte 12 (stress no conjunto pareado)
  'soaks-separation.cjs',       // v1.8 Parte 1 (durabilitySoak vs economicSoak + warmup)
  'identity-provenance.cjs',    // v1.8-close Parte 1 (INFERRED_FROM_SOURCE_TIMING + confiança)
  'near-miss-record.cjs',       // v1.8-close (registro formal do near-miss t2)
  'mirror-fidelity.cjs',        // v1.8 Parte 4 (Mirror Control vs Champion)
  'policy-control-fidelity.cjs',// v1.8 Parte 5 (Policy Control divergências)
  'economic-pairing.cjs',       // v1.8 Parte 8 (pareamento por sourcePositionId)
  'economic-sample.cjs',        // v1.8 Parte 9 (amostra independente econômica)
  'economic-watermark.cjs',     // v1.8 Parte 11 (watermark econômico)
  'economic-source-validation.cjs', // v1.8-coleta Parte 2 (validação de fonte)
  'economic-recovery-check.cjs', // v1.8-op Parte 4 (não-regressão pós-restart)
  'risk-guardian.cjs',          // v1.8-op Parte 6 (guardian paper) — roda --once no pipeline
  'risk-alert-tracker.cjs',     // v1.8-exec Parte 4 (ciclo de vida dos alertas, nativa vs estimada)
  'operational-soak-audit.cjs', // v1.8-exec Partes 2,3,6,7 (métricas/recovery-full/financeiro exato)
  'bico-incident.cjs',          // v1.8-op Parte 7 (registro OPERATIONAL_RISK_NEAR_MISS)
  'economic-gate.cjs',          // v1.8-close/coleta/op (gate + readiness + supervisor matrix)
  'economic-daily-report.cjs',  // v1.8-coleta Parte 8 (relatório diário + close-exit + shadow)
  'game-layer-data.cjs',        // v1.8-coleta Parte 11 (dados da game layer)
  'relatorio-forward.cjs',      // v1.4→1.8 (identidade/capital local/diário/gate estendido)
  'build-progression-status.cjs', // Parte 13 (lê todos)
];
let ok = 0;
for (const s of ordem) {
  try { execFileSync(process.execPath, [path.join(__dirname, s)], { stdio: 'ignore' }); console.log('  [OK] ' + s); ok++; }
  catch (e) { console.error('  [FALHA] ' + s + ': ' + e.message); }
}
console.log(`pipeline: ${ok}/${ordem.length} builders concluídos.`);
