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
  'build-progression-status.cjs', // Parte 13 (lê todos)
];
let ok = 0;
for (const s of ordem) {
  try { execFileSync(process.execPath, [path.join(__dirname, s)], { stdio: 'ignore' }); console.log('  [OK] ' + s); ok++; }
  catch (e) { console.error('  [FALHA] ' + s + ': ' + e.message); }
}
console.log(`pipeline: ${ok}/${ordem.length} builders concluídos.`);
