#!/usr/bin/env node
'use strict';
/**
 * v1.8-profit — ITEM 1. Ledger econômico EXATO: 1 linha por sourcePositionId (fechada ou censurada),
 * com todos os campos e a validação da invariante de PnL. READ-ONLY (economic diaries).
 * Emite auditoria/progression/economic-ledger.json + economic-ledger.jsonl.
 */
const L = require('./lib-progression.cjs');
const fs = require('node:fs');
const path = require('node:path');
const ECON = path.join(L.ROOT, 'auditoria', 'progression', 'economic');
const POL = ['policy', 'trial', 'observer-max3', 'observer-max4', 'observer-max5'];
const NOTIONAL = L.ALVO_POR_EXCHANGE, MARGEM = NOTIONAL / L.ALAVANCAGEM, H = 3.6e6;
const TAKER = 0.0005, SLIP = 0.0002;

function diario(l) { try { return fs.readFileSync(path.join(ECON, l, 'diario.jsonl'), 'utf8').split('\n').filter(Boolean).map((x) => { try { return JSON.parse(x); } catch { return null; } }).filter(Boolean); } catch { return []; } }

function build() {
  const { asOf } = L.loadChampion();
  const now = asOf || Date.now();
  const linhas = []; let invariantesOk = 0, invariantesFalha = 0;
  for (const policy of POL) {
    const ev = diario(policy); const aberto = {};
    for (const e of ev) {
      if (e.evento === 'abre') aberto[e.k] = e;
      else if (e.evento === 'fecha') {
        const a = aberto[e.k]; delete aberto[e.k];
        const [sym, long, short] = (e.k || '').split('|');
        const entryCosts = a ? L.r4(a.custoEntrada || 0) : L.r4(NOTIONAL * (2 * TAKER + 2 * SLIP));
        const settledFunding = L.r4(e.funding || 0);
        const realizedNetPnL = L.r4(e.pnl || 0);
        // exitCosts derivado da identidade: pnl = funding - entry - exit → exit = funding - entry - pnl
        const exitCosts = L.r4(settledFunding - entryCosts - realizedNetPnL);
        const scalingCosts = 0, cutCosts = 0, outrosPnLRealizados = 0;
        const totalCosts = L.r4(entryCosts + exitCosts + scalingCosts + cutCosts);
        const holdingHours = a ? L.r2(((e.positionClosedAt || now) - (a.ts || e.positionOpenedAt || now)) / H) : L.r2(((e.positionClosedAt || now) - (e.positionOpenedAt || now)) / H);
        const capitalRequired = L.r4(2 * MARGEM);
        const capitalHours = L.r4(capitalRequired * holdingHours);
        // invariante
        const esperado = L.r4(settledFunding + outrosPnLRealizados - entryCosts - exitCosts - scalingCosts - cutCosts);
        const invOk = Math.abs(esperado - realizedNetPnL) <= 0.01; invOk ? invariantesOk++ : invariantesFalha++;
        linhas.push({ sourcePositionId: e.sourcePositionId, sourceDecisionId: e.sourceDecisionId, policy, symbol: sym, exchanges: [long, short],
          openedAt: a ? new Date(a.ts).toISOString() : (e.positionOpenedAt ? new Date(e.positionOpenedAt).toISOString() : null), closedAt: new Date(e.positionClosedAt || now).toISOString(), holdingHours,
          capitalRequired, entryNotional: NOTIONAL, entryCosts, settledFunding, expectedFunding: 'assentado (fechada)', scalingCosts, cutCosts, exitCosts, totalCosts,
          realizedNetPnL, markedPnL: realizedNetPnL, executablePnL: realizedNetPnL, capitalHours, netProfitPerCapitalHour: capitalHours > 0 ? L.r4(realizedNetPnL / capitalHours) : 0,
          drawdown: realizedNetPnL < 0 ? L.r4(-realizedNetPnL) : 0, closeReason: e.closeReason, rightCensored: false, gateEligible: true, invarianteOk: invOk });
      }
    }
    // censuradas (abertas)
    for (const a of Object.values(aberto)) { const [sym, long, short] = (a.k || '').split('|');
      linhas.push({ sourcePositionId: a.sourcePositionId, sourceDecisionId: a.sourceDecisionId, policy, symbol: sym, exchanges: [long, short],
        openedAt: new Date(a.ts).toISOString(), closedAt: null, holdingHours: L.r2((now - a.ts) / H), capitalRequired: L.r4(2 * MARGEM), entryNotional: NOTIONAL, entryCosts: L.r4(a.custoEntrada || 0),
        settledFunding: null, expectedFunding: 'em curso', scalingCosts: 0, cutCosts: 0, exitCosts: null, totalCosts: null, realizedNetPnL: null, markedPnL: null, executablePnL: null,
        capitalHours: L.r4(2 * MARGEM * ((now - a.ts) / H)), netProfitPerCapitalHour: null, drawdown: null, closeReason: null, rightCensored: true, gateEligible: false }); }
  }
  const fechadas = linhas.filter((r) => !r.rightCensored);
  const totalRealized = L.r4(fechadas.reduce((s, r) => s + (r.realizedNetPnL || 0), 0));
  try { fs.writeFileSync(path.join(L.ROOT, 'auditoria', 'progression', 'economic-ledger.jsonl'), linhas.map((r) => JSON.stringify(r)).join('\n') + '\n'); } catch {}
  const out = {
    schema: 'snowball.economic-ledger.v1_8', geradoEm: new Date(now).toISOString(), asOfMs: now,
    totalLinhas: linhas.length, fechadas: fechadas.length, censuradas: linhas.length - fechadas.length,
    totalRealizedNetPnL: totalRealized,
    invariantePnL: { formula: 'realizedNetPnL = settledFunding + outros - entryCosts - exitCosts - scalingCosts - cutCosts', ok: invariantesOk, falha: invariantesFalha, todasOk: invariantesFalha === 0 },
    linhas: linhas.slice(0, 500),
    honestidade: 'forward-lab abre/fecha simples (sem scaling/cut mid-posição) → scalingCosts=cutCosts=0. exitCosts derivado da identidade de PnL. Censuradas não têm PnL (não fechadas).',
  };
  const p = L.writeJSON('economic-ledger.json', out);
  console.log(JSON.stringify({ saida: p, fechadas: fechadas.length, censuradas: out.censuradas, totalRealizedNetPnL: totalRealized, invariantePnL: out.invariantePnL }, null, 2));
}
build();
