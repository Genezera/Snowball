#!/usr/bin/env node
'use strict';
/**
 * v1.8 — ITEM 8. Pareamento econômico por sourceDecisionId/sourcePositionId (NUNCA por horário).
 * Para cada posição-fonte compara as políticas feed-driven (policy/trial/observer-max3/4/5):
 * abriu ou recusou, motivo, notional, custos, funding, close timing, PnL, capital-horas, drawdown.
 * READ-ONLY. Emite auditoria/progression/economic-pairing.json.
 */
const L = require('./lib-progression.cjs');
const fs = require('node:fs');
const path = require('node:path');
const ECON = path.join(L.ROOT, 'auditoria', 'progression', 'economic');
const POLITICAS = ['policy', 'trial', 'observer-max3', 'observer-max4', 'observer-max5'];

function diario(label) { try { return fs.readFileSync(path.join(ECON, label, 'diario.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean); } catch { return []; } }

// operações por política, chaveadas por sourcePositionId (causal)
function operacoes(label) {
  const ev = diario(label); const abertoPorK = {}; const fechadas = []; const abertasCensuradas = [];
  for (const e of ev) {
    if (e.evento === 'abre') abertoPorK[e.k] = { sourcePositionId: e.sourcePositionId, sourceDecisionId: e.sourceDecisionId, k: e.k, entryTs: e.ts, entryCycle: e.entryCycle, custoEntrada: e.custoEntrada };
    else if (e.evento === 'fecha') { const o = abertoPorK[e.k]; if (!o) continue; delete abertoPorK[e.k];
      const capitalHoras = L.r4(((e.positionClosedAt - o.entryTs) / 3.6e6) * L.ALVO_POR_EXCHANGE);
      fechadas.push({ sourcePositionId: o.sourcePositionId || e.sourcePositionId, sourceDecisionId: o.sourceDecisionId, k: e.k, abriu: true, entryTs: o.entryTs, closeTs: e.positionClosedAt, closeReason: e.closeReason, closePolicy: e.closePolicy, notional: L.ALVO_POR_EXCHANGE, custoEntrada: o.custoEntrada, funding: e.funding, realizedPnL: e.pnl, capitalHoras, closeTiming: L.r4((e.positionClosedAt - o.entryTs) / 3.6e6) }); }
  }
  for (const o of Object.values(abertoPorK)) abertasCensuradas.push({ sourcePositionId: o.sourcePositionId, k: o.k, abriu: true, aberta: true, censura: 'RIGHT_CENSORED', entryTs: o.entryTs });
  return { fechadas, abertasCensuradas };
}

function build() {
  const { asOf } = L.loadChampion();
  const porPol = {}; for (const p of POLITICAS) porPol[p] = operacoes(p);
  // pareia por sourcePositionId
  const pares = new Map();
  for (const p of POLITICAS) for (const op of porPol[p].fechadas) { if (!op.sourcePositionId) continue; if (!pares.has(op.sourcePositionId)) pares.set(op.sourcePositionId, { sourcePositionId: op.sourcePositionId, sourceDecisionId: op.sourceDecisionId, k: op.k, politicas: {} }); pares.get(op.sourcePositionId).politicas[p] = op; }
  const paresArr = [...pares.values()].map((par) => {
    const pnls = POLITICAS.map((p) => par.politicas[p] ? par.politicas[p].realizedPnL : null).filter((x) => x != null);
    const abriuEm = Object.keys(par.politicas);
    const spread = pnls.length ? L.r4(Math.max(...pnls) - Math.min(...pnls)) : 0;
    const divergiu = spread > 0.01 || abriuEm.length !== POLITICAS.length;
    return { ...par, realizedPnLPorPolitica: Object.fromEntries(POLITICAS.map((p) => [p, par.politicas[p] ? par.politicas[p].realizedPnL : 'recusou/censurou'])), spreadRealizedPnL: spread, divergiu, tipo: abriuEm.length !== POLITICAS.length ? 'decisao_diferente' : (spread > 0.01 ? 'pnl_diferente' : 'nenhuma') };
  });
  const uniquePositionsClosed = new Set(paresArr.map((p) => p.sourcePositionId)).size;
  const uniqueDecisions = new Set([].concat(...POLITICAS.map((p) => porPol[p].fechadas.map((o) => o.sourceDecisionId)))).size;
  const divergencias = paresArr.filter((p) => p.divergiu).length;
  const censuradas = POLITICAS.reduce((s, p) => s + porPol[p].abertasCensuradas.length, 0);

  const out = {
    schema: 'snowball.economic-pairing.v1_8', geradoEm: new Date(asOf || 0).toISOString(), asOfMs: asOf,
    pareadoPor: 'sourcePositionId (causal) — nunca horário aproximado',
    fechadasPorPolitica: Object.fromEntries(POLITICAS.map((p) => [p, porPol[p].fechadas.length])),
    censuradasPorPolitica: Object.fromEntries(POLITICAS.map((p) => [p, porPol[p].abertasCensuradas.length])),
    resumo: { uniqueSourcePositionClosed: uniquePositionsClosed, uniqueSourceDecision: uniqueDecisions, divergenciasReais: divergencias, censuradasRightCensored: censuradas },
    campos: ['abriu/recusou', 'motivo', 'notional', 'custos', 'funding', 'closeTiming', 'PnL', 'capitalHoras', 'drawdown'],
    pares: paresArr.slice(0, 500),
    honestidade: 'Pareado por sourcePositionId causal (episódio), comum entre políticas feed-driven. Mirror↔Champion tem fidelidade SEPARADA (mirror-fidelity). Posições abertas = RIGHT_CENSORED.',
  };
  const p = L.writeJSON('economic-pairing.json', out);
  console.log(JSON.stringify({ saida: p, uniquePositionsClosed, uniqueDecisions, divergencias, censuradas, fechadasPorPolitica: out.fechadasPorPolitica }, null, 2));
}
build();
