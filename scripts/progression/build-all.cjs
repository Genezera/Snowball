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
  'build-progression-status.cjs', // Parte 13 (lê todos)
];
let ok = 0;
for (const s of ordem) {
  try { execFileSync(process.execPath, [path.join(__dirname, s)], { stdio: 'ignore' }); console.log('  [OK] ' + s); ok++; }
  catch (e) { console.error('  [FALHA] ' + s + ': ' + e.message); }
}
console.log(`pipeline: ${ok}/${ordem.length} builders concluídos.`);
