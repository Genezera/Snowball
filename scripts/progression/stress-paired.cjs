#!/usr/bin/env node
'use strict';
/**
 * v1.7 — ITEM 12. Stress sobre o MESMO conjunto pareado de operações fechadas: custos
 * 1,5× e 2×, funding −25% e −50%, slippage adicional, e perda temporária de uma exchange.
 * Recalcula o PnL realizado agregado sob cada cenário e diz se a borda sobrevive.
 * READ-ONLY. Emite auditoria/progression/stress-paired.json.
 */
const L = require('./lib-progression.cjs');
const SLIP_EXTRA = 0.0002;   // slippage adicional por perna

function build() {
  const { asOf } = L.loadChampion();
  const paired = L.rd(L.P.outDir + '/paired-economic-fidelity.json', null);
  const ops = paired && paired.operacoesFechadas ? (paired.operacoesFechadas.control || []) : [];

  // PnL de uma op sob multiplicadores. custos = custoEntrada+custoSaida (cada = notional*(2taker+2slip)).
  const pnlSob = (o, { custoMult = 1, fundingMult = 1, slipExtra = 0, dropExchange = null } = {}) => {
    if (dropExchange && o.exchanges.includes(dropExchange)) return null;   // exchange indisponível → operação não ocorre
    const custoBase = (o.custoEntrada || 0) + (o.custoSaida || 0);
    const custoSlip = slipExtra * o.notional * 4;   // 2 pernas × entrada+saída
    return L.r4((o.funding || 0) * fundingMult - custoBase * custoMult - custoSlip);
  };
  const agrega = (opts) => { const vals = ops.map((o) => pnlSob(o, opts)).filter((x) => x != null); return { operacoes: vals.length, pnlTotal: L.r4(vals.reduce((s, v) => s + v, 0)), positivas: vals.filter((v) => v > 0).length }; };

  const base = agrega({});
  const cenarios = {
    baseline: base,
    custos_1_5x: agrega({ custoMult: 1.5 }),
    custos_2x: agrega({ custoMult: 2 }),
    funding_menos_25: agrega({ fundingMult: 0.75 }),
    funding_menos_50: agrega({ fundingMult: 0.5 }),
    slippage_adicional: agrega({ slipExtra: SLIP_EXTRA }),
    perda_bybit: agrega({ dropExchange: 'bybit' }),
    combinado_2x_funding_menos_50: agrega({ custoMult: 2, fundingMult: 0.5, slipExtra: SLIP_EXTRA }),
  };
  const amostraSuficiente = ops.length >= 4;
  const sobreviveTudo = amostraSuficiente && Object.values(cenarios).every((c) => c.pnlTotal > 0);

  const out = {
    schema: 'snowball.stress-paired.v1_7', geradoEm: new Date(asOf || 0).toISOString(), asOfMs: asOf,
    operacoesNoConjunto: ops.length, custoRoundTripFrac: L.r4(4 * 0.0005 + 4 * 0.0002), slippageAdicionalPorPerna: SLIP_EXTRA,
    cenarios, amostraSuficiente, stressAprovado: sobreviveTudo,
    veredito: !amostraSuficiente ? `Amostra insuficiente p/ stress (${ops.length} fechamentos). NÃO aprovado ainda.` : (sobreviveTudo ? 'Borda sobrevive a todos os cenários de stress.' : 'Borda NÃO sobrevive a algum cenário — não liberar.'),
    honestidade: 'Stress aplicado ao MESMO conjunto pareado (control 6-ex). Com amostra ~0, o veredito é "não aprovado ainda" por falta de evidência.',
  };
  const p = L.writeJSON('stress-paired.json', out);
  console.log(JSON.stringify({ saida: p, ops: ops.length, aprovado: sobreviveTudo, cenarios: Object.fromEntries(Object.entries(cenarios).map(([k, v]) => [k, v.pnlTotal])) }, null, 2));
}
build();
