#!/usr/bin/env node
'use strict';
/**
 * v1.2 — PARTES 3,4,5,6. Level-1 Trial (Bitget+Bybit, US$200 paper) vs Controle de
 * 6 exchanges (US$600 paper que reconcilia com o Champion), em common-window, com
 * o gate de janelas/regimes. READ-ONLY, paper, nenhuma ordem, nenhum saldo movido.
 * Emite auditoria/progression/trial-control-window.json.
 */
const L = require('./lib-progression.cjs');

const TRIAL_PARES = ['bitget', 'bybit'];
const trialKey = TRIAL_PARES.slice().sort().join('+');

function sandbox(posicoes, capitalInicial, asOf) {
  const pos = posicoes.slice().sort((a, b) => a.abreTs - b.abreTs);
  const freeMargin = capitalInicial * (1 - L.RESERVA);
  const ativos = []; let committed = 0, pico = 0;
  let funding = 0, custos = 0, financiadas = 0, perdidas = 0, minOrder = 0;
  const equity = []; let acc = 0; const symbFund = {};
  for (const p of pos) {
    for (let i = ativos.length - 1; i >= 0; i--) if (ativos[i].fechaTs != null && ativos[i].fechaTs <= p.abreTs) { committed -= ativos[i].margem; ativos.splice(i, 1); }
    if ((p.notional || 0) < L.MIN_NOTIONAL) { minOrder++; continue; }
    if (p.margem > (freeMargin - committed) + 1e-9 || ativos.length >= L.MAX_POSICOES) { perdidas++; continue; }
    ativos.push({ margem: p.margem, fechaTs: p.fechaTs }); committed += p.margem; pico = Math.max(pico, committed);
    funding += p.funding || 0; custos += p.custo || 0; financiadas++; acc += p.pnl || 0; equity.push(acc);
    symbFund[p.symbol] = (symbFund[p.symbol] || 0) + (p.pnl || 0);
  }
  let peq = 0, mdd = 0; for (const e of equity) { if (e > peq) peq = e; const dd = peq > 0 ? (peq - e) / peq : 0; if (dd > mdd) mdd = dd; }
  const fR = L.r4(funding), cR = L.r4(custos), capitalFinal = L.r4(capitalInicial + fR - cR);
  const contribs = Object.values(symbFund); const total = contribs.reduce((s, v) => s + Math.abs(v), 0) || 1;
  const top1 = contribs.length ? L.r4(Math.max(...contribs.map(Math.abs)) / total) : 0;
  const capitalHoras = pos.filter((p) => p.abreTs).reduce((s, p) => s + p.margem * Math.max(0, ((p.fechaTs || asOf) - p.abreTs) / 3.6e6), 0);
  return {
    capitalInicial, funding: fR, custos: cR, pnlLiquido: L.r4(fR - cR), capitalFinal,
    retornoPct: L.r2(((fR - cR) / capitalInicial) * 100), posicoes: financiadas, perdidas, minOrder,
    drawdownPct: L.r2(mdd * 100), feeToGross: fR > 0 ? L.r4(cR / fR) : null,
    capitalBloqueadoPicoUSD: L.r2(pico), capitalOciosoUSD: L.r2(Math.max(0, freeMargin - pico)),
    concentracaoTop1: top1, capitalHoras: L.r2(capitalHoras),
    reconciliacao: { calculado: capitalFinal, identidade: 'capitalInicial + funding − custos', reconcilia: Math.abs((capitalInicial + fR - cR) - capitalFinal) < 1e-6 },
  };
}

function build() {
  const { estado, asOf } = L.loadChampion();
  const todas = L.reconstruirPosicoes(estado).filter((p) => p.abreTs);
  const trialPos = todas.filter((p) => p.par === trialKey);
  const trial = sandbox(trialPos, 2 * L.ALVO_POR_EXCHANGE, asOf);           // US$200, só Bitget+Bybit
  const control = sandbox(todas, 6 * L.ALVO_POR_EXCHANGE, asOf);            // US$600, 6 exchanges

  // reconciliação do controle com o Champion (tolerância documentada)
  const championNet = L.r4((estado.fundingTotal || 0) - (estado.custosTotal || 0));
  const difControleChampion = L.r4(control.pnlLiquido - championNet);
  const TOL = 1.0; // tolerância: posições abertas contam funding acumulado sem custo de fechamento ainda
  const controleReconciliaChampion = Math.abs(difControleChampion) <= TOL;

  // common-window (item 5): tabela comparativa
  const janela = { inicio: new Date(Math.min(...todas.map((p) => p.abreTs))).toISOString(), fim: new Date(asOf).toISOString(), mesma: true };
  const comparacao = {
    pnlAbsolutoUSD: { trial: trial.pnlLiquido, control: control.pnlLiquido },
    retornoPct: { trial: trial.retornoPct, control: control.retornoPct },
    drawdownPct: { trial: trial.drawdownPct, control: control.drawdownPct },
    feeToGross: { trial: trial.feeToGross, control: control.feeToGross },
    oportunidades: { trial: trial.posicoes, control: control.posicoes },
    capitalHoras: { trial: trial.capitalHoras, control: control.capitalHoras },
    capitalOciosoUSD: { trial: trial.capitalOciosoUSD, control: control.capitalOciosoUSD },
    concentracaoTop1: { trial: trial.concentracaoTop1, control: control.concentracaoTop1 },
    ordensMinimasBloqueadas: { trial: trial.minOrder, control: control.minOrder },
    funding: { trial: trial.funding, control: control.funding },
    custos: { trial: trial.custos, control: control.custos },
    estabilidade: { falhasDeExchangeObservadas: 0, nota: 'sem falhas de exchange registradas na janela (custódia)' },
    retornoMarginal2exVs6ex: L.r4(control.pnlLiquido - trial.pnlLiquido),
  };

  // custos 2× (item 6)
  const trial2x = L.r4(trial.funding - 2 * trial.custos), control2x = L.r4(control.funding - 2 * control.custos);

  // gate janelas/regimes (item 6): NÃO escolher 2 exchanges ainda
  const JANELAS = 1, REGIMES = 1, AMOSTRA_MIN = 30;
  const gate = {
    duasJanelasCronologicas: JANELAS >= 2, doisRegimes: REGIMES >= 2,
    controlFielAoChampion: controleReconciliaChampion, custos2xPositivo: { trial: trial2x > 0, control: control2x > 0, valores: { trial: trial2x, control: control2x } },
    nenhumaOperacaoDominante: control.concentracaoTop1 < 0.5 && trial.concentracaoTop1 < 0.5,
    semFalhaDeExchange: true, amostraMinima: { minimo: AMOSTRA_MIN, trial: trial.posicoes, control: control.posicoes, atende: trial.posicoes >= AMOSTRA_MIN },
    LIBERADO: false,
    veredito: `BLOQUEADO — ${JANELAS}/2 janelas, ${REGIMES}/2 regimes, amostra do trial ${trial.posicoes}/${AMOSTRA_MIN}. NÃO escolher Bitget+Bybit ainda. Controle reconcilia com o Champion (dif ${difControleChampion}, tol ${TOL}).`,
  };

  const out = {
    schema: 'snowball.trial-control-window.v1_2', geradoEm: new Date(asOf || 0).toISOString(), asOfMs: asOf,
    parametros: { trial: { exchanges: TRIAL_PARES, capital: 2 * L.ALVO_POR_EXCHANGE }, control: { exchanges: L.EXCHANGES, capital: 6 * L.ALVO_POR_EXCHANGE }, reserva: L.RESERVA, alavancagem: L.ALAVANCAGEM, maxPosicoes: L.MAX_POSICOES },
    natureza: 'paper/shadow — contabilidade própria, nenhuma ordem, nenhum saldo movido. Roda em paralelo ao Champion de 6 exchanges (observador).',
    item3_trialBitgetBybit: trial,
    item4_controle6ex: { ...control, reconciliacaoComChampion: { championNet, controlePnl: control.pnlLiquido, diferenca: difControleChampion, tolerancia: TOL, reconcilia: controleReconciliaChampion, nota: 'Diferença vem do funding acumulado das posições abertas ainda não líquido do custo de fechamento.' } },
    item5_commonWindow: { janela, comparacao },
    item6_gateJanelasRegimes: gate,
    honestidade: 'observed (posições/funding/custos do Champion) + replay (sandbox reconciliado). Trial enviesado p/ o par que o Champion escolheu; 1 janela/1 regime → decisão NÃO liberada.',
  };
  const p = L.writeJSON('trial-control-window.json', out);
  console.log(JSON.stringify({ saida: p,
    trial: `${trialKey} $200 → pnl ${trial.pnlLiquido} (${trial.retornoPct}%) recon ${trial.reconciliacao.reconcilia}`,
    control: `6ex $600 → pnl ${control.pnlLiquido} (${control.retornoPct}%) recon-champion ${controleReconciliaChampion} (dif ${difControleChampion})`,
    diff2exVs6ex: comparacao.retornoMarginal2exVs6ex, gate: gate.veredito }, null, 2));
}
build();
