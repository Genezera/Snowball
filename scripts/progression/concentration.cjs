#!/usr/bin/env node
'use strict';
/**
 * v1.7 — ITEM 11. Concentração. Antes de liberar qualquer política, o ganho não pode
 * depender de um único ponto: posição ≤25% do ganho incremental, símbolo ≤35%, par de
 * exchanges ≤50%, e nenhuma janela (dia) responde pela maior parte. Usa as operações
 * FECHADAS pareadas (control como referência de 6 exchanges). READ-ONLY.
 * Emite auditoria/progression/concentration.json.
 */
const L = require('./lib-progression.cjs');
const DIA = 86400000;

function build() {
  const { asOf } = L.loadChampion();
  const paired = L.rd(L.P.outDir + '/paired-economic-fidelity.json', null);
  const ops = paired && paired.operacoesFechadas ? (paired.operacoesFechadas.control || []) : [];
  const positivos = ops.filter((o) => o.realizedPnL > 0);
  const ganhoTotal = L.r4(positivos.reduce((s, o) => s + o.realizedPnL, 0));

  const share = (mapper) => { const m = {}; for (const o of positivos) { const k = mapper(o); m[k] = (m[k] || 0) + o.realizedPnL; } const top = Object.entries(m).sort((a, b) => b[1] - a[1])[0]; return top ? { chave: top[0], valor: L.r4(top[1]), pct: ganhoTotal > 0 ? L.r2((top[1] / ganhoTotal) * 100) : 0 } : { chave: null, valor: 0, pct: 0 }; };

  const posTop = positivos.length ? (() => { const top = positivos.slice().sort((a, b) => b.realizedPnL - a.realizedPnL)[0]; return { chave: top.controlPositionId, valor: L.r4(top.realizedPnL), pct: ganhoTotal > 0 ? L.r2((top.realizedPnL / ganhoTotal) * 100) : 0 }; })() : { chave: null, valor: 0, pct: 0 };
  const symTop = share((o) => o.sym);
  const parTop = share((o) => o.exchanges.slice().sort().join('|'));
  const janelaTop = share((o) => `dia:${Math.floor(o.entryTs / DIA)}`);

  const LIM = { posicao: 25, simbolo: 35, par: 50, janela: 50 };
  const amostraSuficiente = positivos.length >= 4 && ganhoTotal > 0;
  const checks = {
    posicao: { top: posTop, limite: LIM.posicao, ok: posTop.pct <= LIM.posicao },
    simbolo: { top: symTop, limite: LIM.simbolo, ok: symTop.pct <= LIM.simbolo },
    parExchanges: { top: parTop, limite: LIM.par, ok: parTop.pct <= LIM.par },
    janela: { top: janelaTop, limite: LIM.janela, ok: janelaTop.pct <= LIM.janela },
  };
  const aceitavel = amostraSuficiente && Object.values(checks).every((c) => c.ok);

  const out = {
    schema: 'snowball.concentration.v1_7', geradoEm: new Date(asOf || 0).toISOString(), asOfMs: asOf,
    operacoesPositivas: positivos.length, ganhoIncrementalTotal: ganhoTotal,
    limites: LIM, checks, amostraSuficiente, concentracaoAceitavel: aceitavel,
    veredito: !amostraSuficiente ? `Amostra insuficiente p/ julgar concentração (${positivos.length} fechamentos positivos). NÃO aceitável ainda.` : (aceitavel ? 'Concentração dentro dos limites.' : 'Concentração EXCEDE algum limite — não liberar.'),
    honestidade: 'Concentração só é avaliável com fechamentos reais suficientes. Com amostra ~0, o resultado é "não aceitável ainda" por falta de evidência, não por aprovação.',
  };
  const p = L.writeJSON('concentration.json', out);
  console.log(JSON.stringify({ saida: p, positivos: positivos.length, ganhoTotal, aceitavel, posPct: posTop.pct, symPct: symTop.pct, parPct: parTop.pct }, null, 2));
}
build();
