#!/usr/bin/env node
'use strict';
/**
 * v1.7 — ITEM 10. Amostra INDEPENDENTE. O gate conta sourceOpportunityId ÚNICOS fechados —
 * NÃO a quantidade de políticas multiplicada pelo mesmo evento. Posições abertas = censuradas.
 * Meta: ≥30 oportunidades-fonte únicas fechadas e ≥15 divergências reais entre políticas.
 * READ-ONLY. Emite auditoria/progression/independent-sample.json.
 */
const L = require('./lib-progression.cjs');

function build() {
  const { asOf } = L.loadChampion();
  const paired = L.rd(L.P.outDir + '/paired-economic-fidelity.json', null);
  const uniqueClosed = paired ? paired.resumo.uniqueSourceOpportunityClosed : 0;
  const divergencias = paired ? paired.resumo.divergenciasReais : 0;
  const censuradas = paired ? paired.resumo.censuradasAbertas : 0;
  const somaFechamentosPolitica = paired ? Object.values(paired.fechadasPorPolitica || {}).reduce((s, v) => s + v, 0) : 0;

  const META_UNICAS = 30, META_DIVERGENCIAS = 15;
  const out = {
    schema: 'snowball.independent-sample.v1_7', geradoEm: new Date(asOf || 0).toISOString(), asOfMs: asOf,
    contagemCorreta: { sourceOpportunityIdUnicosFechados: uniqueClosed, divergenciasReais: divergencias, censuradasAbertas: censuradas },
    contagemInflada_NAO_USADA: { somaFechamentosPorPolitica: somaFechamentosPolitica, nota: 'Isto contaria a MESMA oportunidade uma vez por política — NÃO é usado no gate.' },
    metas: { unicasFechadas: META_UNICAS, divergencias: META_DIVERGENCIAS },
    atende: { unicasFechadas: uniqueClosed >= META_UNICAS, divergencias: divergencias >= META_DIVERGENCIAS },
    veredito: (uniqueClosed >= META_UNICAS && divergencias >= META_DIVERGENCIAS)
      ? `Amostra suficiente: ${uniqueClosed}≥${META_UNICAS} únicas, ${divergencias}≥${META_DIVERGENCIAS} divergências.`
      : `Amostra INSUFICIENTE: ${uniqueClosed}/${META_UNICAS} únicas, ${divergencias}/${META_DIVERGENCIAS} divergências. Posições abertas (${censuradas}) são censuradas e NÃO contam.`,
    honestidade: 'Unidade de evidência = oportunidade-fonte única fechada. Multiplicar por políticas seria contar o mesmo evento várias vezes.',
  };
  const p = L.writeJSON('independent-sample.json', out);
  console.log(JSON.stringify({ saida: p, uniqueClosed, divergencias, censuradas, atendeUnicas: uniqueClosed >= META_UNICAS, atendeDiverg: divergencias >= META_DIVERGENCIAS }, null, 2));
}
build();
