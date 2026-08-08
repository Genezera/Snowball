#!/usr/bin/env node
'use strict';
/**
 * PARTE 2 — Sistema de níveis. Deriva os requisitos de capital (lib) e computa o
 * unlockStatus de cada nível a partir de EVIDÊNCIA real (bosses.json, engine-registry.json,
 * relatório dos challengers, reconciliação do ledger). Capital sozinho NÃO desbloqueia.
 * Emite auditoria/progression/levels.json.
 * unlockStatus: UNLOCKED (capital+evidência) · BLOCKED (capital ok, falta evidência) ·
 *               LOCKED (capital insuficiente).
 */
const L = require('./lib-progression.cjs');

function build() {
  const { estado, asOf } = L.loadChampion();
  const capital = estado.capital || 0;
  const niveis = L.derivarNiveis();
  const recon = L.reconciliar(estado);
  const bosses = L.rd(L.P.outDir + '/bosses.json', { chefes: {} }).chefes || {};
  const registry = L.rd(L.P.outDir + '/engine-registry.json', { motores: [] }).motores || [];
  const chDiario = L.rd(L.P.challengersRel, null);
  const chGate = chDiario && chDiario.gate ? String(chDiario.gate.veredito) : '';
  const chFidelidadeOK = chDiario && chDiario.controlFidelity && chDiario.controlFidelity.comparisonStatus === 'OK';
  const derrotado = (id) => bosses[id] && bosses[id].status === 'DERROTADO';
  const estadoMotor = (id) => (registry.find((m) => m.engineId === id) || {}).estado;
  const nEligible = registry.filter((m) => m.estado === 'ELIGIBLE' || m.estado === 'LIVE').length;
  const netPositivo = (estado.fundingTotal || 0) - (estado.custosTotal || 0) > 0;

  // evidência por nível
  const evidencia = {
    0: { ok: recon.reconcilia && chFidelidadeOK, req: ['reconciliação exata', 'fidelidade/integridade do Control OK'], falta: [] },
    1: { ok: estadoMotor('champion-funding') === 'LIVE' && derrotado('custos') && derrotado('sobrevivencia') && netPositivo, req: ['Champion LIVE', 'Chefe Custos derrotado', 'Chefe Sobrevivência derrotado', 'lucro líquido > 0'], falta: [] },
    2: { ok: /LIBERADO/.test(chGate) && derrotado('concentracao'), req: ['gate dos challengers de timing LIBERADO', 'Chefe Concentração derrotado'], falta: [] },
    3: { ok: derrotado('diversificacao'), req: ['Chefe Diversificação derrotado (≥2 fontes independentes lucrativas com amostra)'], falta: [] },
    4: { ok: derrotado('capacidade') && estadoMotor('news-event-radar') !== 'LOCKED', req: ['Chefe Capacidade derrotado', 'dados de evento/listagem suficientes'], falta: [] },
    5: { ok: nEligible >= 2 && false, req: ['≥2 motores ELIGIBLE/LIVE', 'router shadow fiel por ≥2 janelas'], falta: [] },
    6: { ok: false, req: ['arquitetura multi-mercado com capital/risco/contabilidade separados', 'custos normalizados'], falta: [] },
  };

  const levels = niveis.map((n) => {
    const capitalMet = capital >= n.capitalMinimo;
    const ev = evidencia[n.levelId] || { ok: false, req: [] };
    let unlockStatus, blockedReasons = [];
    if (!capitalMet) { unlockStatus = 'LOCKED'; blockedReasons.push(`capital insuficiente: US$${L.r2(capital)} < US$${n.capitalMinimo}${n.estimativa ? ' (estimativa)' : ''}`); }
    else if (ev.ok) unlockStatus = 'UNLOCKED';
    else { unlockStatus = 'BLOCKED'; blockedReasons.push('capital suficiente; falta evidência: ' + ev.req.join(' · ')); }
    return {
      levelId: n.levelId, nome: n.nome, descricao: n.descricao,
      capitalMinimo: n.capitalMinimo, slots: n.slots, capitalMinimoEstimativa: n.estimativa,
      preRequisitos: ev.req, metricasObrigatorias: ev.req,
      modulosDesbloqueados: n.modulos, riscosNovos: n.riscos, bossCondition: n.bossCondition,
      capitalAtingido: capitalMet, evidenciaAtingida: ev.ok, unlockStatus, blockedReasons,
    };
  });

  const nivelAtual = levels.filter((l) => l.unlockStatus === 'UNLOCKED').reduce((m, l) => Math.max(m, l.levelId), 0);
  const proximo = levels.find((l) => l.levelId === nivelAtual + 1) || null;
  const out = {
    schema: 'snowball.levels.v1', geradoEm: new Date(asOf || 0).toISOString(), asOfMs: asOf,
    capitalRealizado: L.r4(capital),
    nivelAtual, nivelAtualNome: (levels.find((l) => l.levelId === nivelAtual) || {}).nome,
    proximoNivel: proximo ? { levelId: proximo.levelId, nome: proximo.nome, unlockStatus: proximo.unlockStatus, blockedReasons: proximo.blockedReasons } : null,
    principio: 'Capital sozinho não desbloqueia. Um lucro isolado ou uma moeda que subiu muito NÃO desbloqueia um motor. Exige capital + amostra + 2 janelas + 2 regimes + custos estressados + drawdown aceitável + concentração + estabilidade + dados íntegros + rollback + aprovação humana.',
    niveis: levels,
  };
  const p = L.writeJSON('levels.json', out);
  console.log(JSON.stringify({ saida: p, nivelAtual, nivelAtualNome: out.nivelAtualNome,
    status: levels.map((l) => `N${l.levelId} ${l.nome}: ${l.unlockStatus}`) }, null, 2));
}
build();
