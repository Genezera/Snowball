#!/usr/bin/env node
'use strict';
/**
 * v1.8-exec — ITEM 4. Rastreador de alertas do Risk Guardian (READ-ONLY do risk-guardian.json —
 * NÃO altera o Risk Guardian). Separa distância de liquidação NATIVA (da exchange) da ESTIMADA e
 * registra a fonte, sem apresentar estimativa como valor oficial. Mantém o ciclo de vida por alerta:
 * alertId/positionId/firstObservedAt/warningAt/criticalAt/emergencyAt/resolvedAt/maxAdverseMove/
 * minimumLiquidationDistance/engineResponseDelayMs. Emite risk-alert-tracker.json + state.
 */
const L = require('./lib-progression.cjs');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex').slice(0, 16);
const STATE = path.join(L.ROOT, 'auditoria', 'progression', 'economic', 'risk-alerts-state.json');
const rd = (p, d) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return d; } };

function build() {
  const { asOf } = L.loadChampion();
  const now = asOf || Date.now();
  const rg = L.rd(L.P.outDir + '/risk-guardian.json', null);
  const st = rd(STATE, { alertas: {} });
  const vistos = new Set();

  if (rg && rg.posicoes) for (const p of rg.posicoes) {
    const positionId = p.symbol; vistos.add(positionId);
    let a = st.alertas[positionId];
    if (!a) a = st.alertas[positionId] = { alertId: sha(positionId + ':' + now), positionId, firstObservedAt: now, warningAt: null, criticalAt: null, emergencyAt: null, resolvedAt: null, maxAdverseMove: 0, minimumLiquidationDistance: 100 };
    a.resolvedAt = null; // ainda aberta
    a.maxAdverseMove = Math.max(a.maxAdverseMove, p.movimentoDesdeEntradaPct || 0);
    a.minimumLiquidationDistance = Math.min(a.minimumLiquidationDistance, p.distanciaLiquidacaoPct != null ? p.distanciaLiquidacaoPct : 100);
    if (p.nivel === 'WARNING' && !a.warningAt) a.warningAt = now;
    if (p.nivel === 'CRITICAL' && !a.criticalAt) a.criticalAt = now;
    if (p.nivel === 'EMERGENCY_EXIT_RECOMMENDED' && !a.emergencyAt) a.emergencyAt = now;
    a.nivelAtual = p.nivel;
    // distância NATIVA da exchange NÃO é exposta ao lab → UNAVAILABLE; só a ESTIMADA existe
    a.exchangeNativeLiquidationDistance = null;
    a.estimatedLiquidationDistancePct = p.distanciaLiquidacaoPct;
    a.liquidationDistanceSource = 'ESTIMATED_FROM_LEVERAGE (~17% p/ 5x, calibrado ao BICO) — NÃO é valor oficial da exchange';
  }
  // resolver alertas de posições que sumiram (fechadas) — engineResponseDelay = fecho - emergência
  for (const [pid, a] of Object.entries(st.alertas)) {
    if (!vistos.has(pid) && !a.resolvedAt) { a.resolvedAt = now; a.nivelAtual = 'RESOLVED';
      a.engineResponseDelayMs = a.emergencyAt ? (a.resolvedAt - a.emergencyAt) : null; }
  }
  try { fs.writeFileSync(STATE, JSON.stringify(st, null, 2)); } catch {}

  const alertas = Object.values(st.alertas);
  const ativos = alertas.filter((a) => !a.resolvedAt);
  const out = {
    schema: 'snowball.risk-alert-tracker.v1_8', geradoEm: new Date(now).toISOString(), asOfMs: now,
    paperOnly: true, naoAlteraRiskGuardian: true,
    nivelGlobalAtual: rg ? rg.nivelGlobal : null,
    liquidationDistance: { nativaDisponivel: false, fonte: 'ESTIMATED_FROM_LEVERAGE', nota: 'A exchange não expõe preço de liquidação ao lab; usamos estimativa por alavancagem (não apresentada como oficial).' },
    alertasAtivos: ativos.length, alertasTotais: alertas.length,
    alertas: alertas.slice(-100),
    honestidade: 'Read-only do Risk Guardian. Distância NATIVA = UNAVAILABLE (não exposta); só ESTIMADA, com fonte rotulada. engineResponseDelayMs = quanto o motor demorou a agir após EMERGENCY (mede o risco operacional do incidente BICO).',
  };
  const p = L.writeJSON('risk-alert-tracker.json', out);
  console.log(JSON.stringify({ saida: p, nivelGlobal: out.nivelGlobalAtual, ativos: ativos.length, totais: alertas.length, nativaDisponivel: false }, null, 2));
}
build();
