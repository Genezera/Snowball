#!/usr/bin/env node
'use strict';
/**
 * COUNTERFACTUAL de maximização (READ-ONLY, análise). Usa dados RECONCILIADOS (Champion real +
 * exchange-selector replay) para mostrar quanto cada lever TERIA melhorado o lucro e quanto DEVE
 * melhorar. Não opera, não toca no Champion. Escreve a seção no profit-maximization.json.
 *
 * Levers quantificados:
 *  1. taker -> maker (ordem limite): custo cai para 35,7% do atual (modelo real do config.ts).
 *  2. concentração em 2 exchanges: mesma TAXA/dólar, menos capital (não é mais lucro absoluto).
 * Filtro de persistência/liquidez: qualitativo (medido ao vivo no head-to-head).
 */
const L = require('./../progression/lib-progression.cjs');
const fs = require('node:fs');
const path = require('node:path');
const OUT = path.join(L.ROOT, 'auditoria', 'progression');
const rd = (p, d) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return d; } };

// custo round-trip (4 fills = 2 pernas × entrada+saída) — presets REAIS do src/config.ts
const TAKER_RT = 4 * 0.0005 + 4 * 0.0002; // 0.0028  (binance-futures taker + slip)
const MAKER_RT = 4 * 0.0002 + 4 * 0.00005; // 0.0010 (binance-futures-maker)
const RATIO = MAKER_RT / TAKER_RT;         // 0.357 — custo maker é 35,7% do taker
// haircut de execução: maker não enche sempre; parte cai pra taker. Cenário realista = 60% do ganho.
const HAIRCUT = 0.6;

function championEcon() {
  const { estado: e } = L.loadChampion();
  const dias = (Date.now() - e.iniciadoEm) / 86400000;
  return { funding: L.r4(e.fundingTotal || 0), custo: L.r4(e.custosTotal || 0), net: L.r4((e.fundingTotal || 0) - (e.custosTotal || 0)), dias: L.r2(dias) };
}

function build() {
  const ch = championEcon();
  const sel = rd(path.join(OUT, 'exchange-selector.json'), null);
  const pares = (sel && sel.ranking || []).filter((x) => x.realizado && x.realizado.posicoes > 0)
    .map((x) => ({ par: x.par, funding: x.realizado.funding, custoTaker: x.realizado.custo, netTaker: x.realizado.pnlLiquido, pos: x.realizado.posicoes }))
    .sort((a, b) => b.netTaker - a.netTaker);

  // ── lever 1: taker -> maker no Champion (6 ex) ──
  const custoMakerBest = L.r4(ch.custo * RATIO);
  const netMakerBest = L.r4(ch.funding - custoMakerBest);
  const netMakerReal = L.r4(ch.net + (netMakerBest - ch.net) * HAIRCUT); // haircut de execução
  const champion = {
    atual6ex: { capital: 600, funding: ch.funding, custo: ch.custo, net: ch.net, pctDia: L.r2(ch.net / 600 / ch.dias * 100), custoSobreFunding: L.r2(ch.custo / ch.funding * 100) },
    comMakerBest: { custo: custoMakerBest, net: netMakerBest, ganhoVsAtual: L.r4(netMakerBest - ch.net), ganhoPct: L.r2((netMakerBest - ch.net) / ch.net * 100), custoSobreFunding: L.r2(custoMakerBest / ch.funding * 100) },
    comMakerRealista: { net: netMakerReal, ganhoVsAtual: L.r4(netMakerReal - ch.net), ganhoPct: L.r2((netMakerReal - ch.net) / ch.net * 100), nota: `haircut de execução ${(HAIRCUT * 100)}% (maker nem sempre enche; parte cai pra taker)` },
  };

  // ── lever 2: cada par de 2 exchanges, taker vs maker ──
  const paresCounterfactual = pares.map((p) => {
    const custoMaker = L.r4(p.custoTaker * RATIO);
    const netMaker = L.r4(p.funding - custoMaker);
    const netMakerReal = L.r4(p.netTaker + (netMaker - p.netTaker) * HAIRCUT);
    return { par: p.par, capital: 200, pos: p.pos, funding: p.funding, custoTaker: p.custoTaker, netTaker: p.netTaker,
      custoMaker, netMakerBest: netMaker, netMakerRealista: netMakerReal, ganhoMakerPct: L.r2((netMaker - p.netTaker) / Math.max(0.01, p.netTaker) * 100) };
  });
  const melhorPar = paresCounterfactual[0];

  const out = {
    schema: 'snowball.counterfactual-maximizacao.v1', geradoEm: Date.now(),
    modeloCusto: { takerRoundTrip: TAKER_RT, makerRoundTrip: MAKER_RT, ratio: L.r4(RATIO), fonte: 'src/config.ts (presets reais das corretoras)', haircutExecucao: HAIRCUT },
    lever1_makerOrders: champion,
    lever2_paresTakerVsMaker: paresCounterfactual,
    melhorCaminho: {
      config: `${melhorPar ? melhorPar.par : '?'} + ordens maker + filtro de persistência`,
      raciocinio: 'O lever de custo (taker→maker) é o de maior impacto e é matemática exata do config.ts. A concentração em 2 exchanges mantém a MESMA taxa/dólar (não é mais lucro absoluto, é o formato do dinheiro real).',
      projecaoMelhorPar2ex: melhorPar ? { par: melhorPar.par, capital: 200, netTakerAtual: melhorPar.netTaker, netComMaker: melhorPar.netMakerRealista, ganhoPct: melhorPar.ganhoMakerPct } : null,
    },
    honestidade: 'Counterfactual sobre dados RECONCILIADOS (Champion real + replay auditado). O lever maker é matemática exata dos presets; o haircut de execução é conservador. Amostra por par pequena (5-7 trades). O real confirma os fills.',
  };
  const p = path.join(OUT, 'counterfactual-maximizacao.json');
  fs.writeFileSync(p, JSON.stringify(out, null, 2));

  // print
  console.log('\n=== LEVER 1: taker -> maker (ordens limite) — Champion 6 exchanges ===');
  console.log(`  ATUAL (taker):  funding $${ch.funding} - custo $${ch.custo} = NET $${ch.net}  (custo = ${champion.atual6ex.custoSobreFunding}% do funding)`);
  console.log(`  MAKER (best):   funding $${ch.funding} - custo $${custoMakerBest} = NET $${netMakerBest}  → +$${champion.comMakerBest.ganhoVsAtual} (+${champion.comMakerBest.ganhoPct}%)`);
  console.log(`  MAKER (real):   NET ~$${netMakerReal}  → +$${champion.comMakerRealista.ganhoVsAtual} (+${champion.comMakerRealista.ganhoPct}%)  [haircut ${HAIRCUT * 100}%]`);
  console.log('\n=== LEVER 2: melhor par de 2 exchanges ($200), taker vs maker ===');
  console.log('  par'.padEnd(20), 'netTaker'.padStart(9), 'netMaker'.padStart(9), 'ganho%'.padStart(8));
  for (const p of paresCounterfactual) console.log('  ' + p.par.padEnd(18), ('$' + p.netTaker).padStart(9), ('$' + p.netMakerRealista).padStart(9), (p.ganhoMakerPct + '%').padStart(8));
  console.log(`\n  MELHOR CAMINHO: ${out.melhorCaminho.config}`);
  console.log(`  saída: ${p}`);
}
build();
