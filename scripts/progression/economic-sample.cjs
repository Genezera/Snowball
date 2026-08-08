#!/usr/bin/env node
'use strict';
/**
 * v1.8 — ITEM 9. Amostra independente ECONÔMICA. Conta sourcePositionId ÚNICOS fechados,
 * sourceDecisionId únicos e divergências reais POR posição-fonte — nunca a mesma oportunidade
 * multiplicada pelas políticas. Posições abertas = RIGHT_CENSORED (item 7). Metas futuras:
 * ≥30 sourcePositionId únicos fechados, ≥15 posições-fonte com divergência real.
 * READ-ONLY. Emite auditoria/progression/economic-sample.json.
 */
const L = require('./lib-progression.cjs');

function build() {
  const { asOf } = L.loadChampion();
  const pair = L.rd(L.P.outDir + '/economic-pairing.json', null);
  const r = pair ? pair.resumo : { uniqueSourcePositionClosed: 0, uniqueSourceDecision: 0, divergenciasReais: 0, censuradasRightCensored: 0 };
  const META_POS = 30, META_DIV = 15;
  const out = {
    schema: 'snowball.economic-sample.v1_8', geradoEm: new Date(asOf || 0).toISOString(), asOfMs: asOf,
    contagemCorreta: { sourcePositionIdUnicosFechados: r.uniqueSourcePositionClosed, sourceDecisionIdUnicos: r.uniqueSourceDecision, divergenciasReaisPorPosicaoFonte: r.divergenciasReais, rightCensored: r.censuradasRightCensored },
    metas: { posicoesFonteUnicas: META_POS, divergencias: META_DIV },
    atende: { posicoesFonteUnicas: r.uniqueSourcePositionClosed >= META_POS, divergencias: r.divergenciasReais >= META_DIV },
    veredito: (r.uniqueSourcePositionClosed >= META_POS && r.divergenciasReais >= META_DIV)
      ? `Amostra econômica suficiente: ${r.uniqueSourcePositionClosed}≥${META_POS} posições-fonte, ${r.divergenciasReais}≥${META_DIV} divergências.`
      : `Amostra econômica INSUFICIENTE: ${r.uniqueSourcePositionClosed}/${META_POS} posições-fonte únicas, ${r.divergenciasReais}/${META_DIV} divergências. RIGHT_CENSORED (${r.censuradasRightCensored}) não contam. economicSoak recém-iniciado.`,
    honestidade: 'Unidade = sourcePositionId único fechado. Não se reusa fechamento do warmup v1.7 (ECONOMIC_WARMUP_NOT_GATE_ELIGIBLE).',
  };
  const p = L.writeJSON('economic-sample.json', out);
  console.log(JSON.stringify({ saida: p, ...out.contagemCorreta, atende: out.atende }, null, 2));
}
build();
