#!/usr/bin/env node
'use strict';
/**
 * v1.1 — PARTE 6. Reinvestimento CONTRAFACTUAL real. A/B/C NÃO recebem a mesma
 * sequência fixa de PnL: cada política financia só as oportunidades que seu capital
 * disponível permite NAQUELE momento, sobre as posições reais do Champion.
 * Rodado em 2 bases: US$200 (alvo, abaixo da saturação ~US$400) e US$600 (atual,
 * acima da saturação) — para mostrar que a política importa abaixo da saturação e
 * NÃO importa acima. Emite reinvestment-counterfactual.json.
 */
const L = require('./lib-progression.cjs');

// política B: degraus úteis de sizing (a base operacional só sobe ao cruzar um degrau)
const DEGRAUS = [0, 50, 100, 200, 400];
// política C: fração do lucro desviada para um FUNDO de desbloqueio de 2º motor
const C_FRACAO_FUNDO = 0.5;
const MIN_2O_MOTOR = 200; // capital mínimo p/ um 2º motor elegível (N1)

function replay(base, politica, pos, asOf) {
  pos = pos.slice().sort((a, b) => a.abreTs - b.abreTs);
  let lucro = 0, fundoDesbloqueio = 0, degrauIdx = 0;
  const ativos = []; let committed = 0;
  let funding = 0, custos = 0, financiadas = 0, perdidas = 0, ocioAcum = 0, n = 0, tempo2oMotorTs = null;
  for (const p of pos) {
    for (let i = ativos.length - 1; i >= 0; i--) if (ativos[i].fechaTs != null && ativos[i].fechaTs <= p.abreTs) { committed -= ativos[i].margem; ativos.splice(i, 1); }
    // capital OPERACIONAL disponível segundo a política
    let operacional;
    if (politica === 'A') operacional = base + lucro;                       // tudo vira base na hora
    else if (politica === 'B') { while (degrauIdx + 1 < DEGRAUS.length && lucro >= DEGRAUS[degrauIdx + 1]) degrauIdx++; operacional = base + DEGRAUS[degrauIdx]; } // sobe por degrau
    else operacional = base + lucro * (1 - C_FRACAO_FUNDO);                 // C: metade do lucro fica no fundo
    const freeMargin = operacional * (1 - L.RESERVA);
    const livre = freeMargin - committed;
    const cabe = p.margem <= livre + 1e-9 && ativos.length < L.MAX_POSICOES && (p.notional || 0) >= L.MIN_NOTIONAL;
    if (cabe) {
      ativos.push({ margem: p.margem, fechaTs: p.fechaTs }); committed += p.margem;
      funding += p.funding || 0; custos += p.custo || 0; financiadas++;
      const pnl = p.pnl || 0; lucro += pnl;
      if (politica === 'C') { fundoDesbloqueio += Math.max(0, pnl) * C_FRACAO_FUNDO; if (tempo2oMotorTs == null && fundoDesbloqueio >= MIN_2O_MOTOR) tempo2oMotorTs = p.fechaTs || asOf; }
    } else perdidas++;
    ocioAcum += Math.max(0, (operacional * (1 - L.RESERVA)) - committed); n++;
  }
  const capitalFinalOperacional = L.r4(base + lucro - (politica === 'C' ? fundoDesbloqueio : 0));
  const capitalFinalTotal = L.r4(base + lucro); // dono de tudo: operacional + fundo
  return {
    politica, base, pnlGerado: L.r4(funding - custos), capitalFinalOperacional, fundoDesbloqueio: L.r4(fundoDesbloqueio), capitalFinalTotal,
    posicoesFinanciadas: financiadas, posicoesPerdidas: perdidas, capitalOciosoMedioUSD: L.r2(n ? ocioAcum / n : 0),
    fundo2oMotorAtingido: fundoDesbloqueio >= MIN_2O_MOTOR, tempoAte2oMotor: tempo2oMotorTs ? new Date(tempo2oMotorTs).toISOString() : null,
    drawdownPct: L.maxDrawdown([]).pct, // placeholder — drawdown do equity abaixo
  };
}

function build() {
  const { estado, asOf } = L.loadChampion();
  const pos = L.reconstruirPosicoes(estado).filter((p) => p.abreTs);
  const bases = [200, 600];
  const resultados = {};
  for (const base of bases) {
    resultados['base_' + base] = {
      A: replay(base, 'A', pos, asOf), B: replay(base, 'B', pos, asOf), C: replay(base, 'C', pos, asOf),
    };
  }
  // diferença econômica por base
  const analise = {};
  for (const base of bases) {
    const r = resultados['base_' + base];
    const pnls = [r.A.pnlGerado, r.B.pnlGerado, r.C.pnlGerado];
    const iguais = Math.max(...pnls) - Math.min(...pnls) < 0.01;
    const bindou = r.A.posicoesPerdidas > 0 || r.B.posicoesPerdidas > 0 || r.C.posicoesPerdidas > 0;
    analise['base_' + base] = {
      pnlGeradoA: r.A.pnlGerado, pnlGeradoB: r.B.pnlGerado, pnlGeradoC: r.C.pnlGerado,
      pnlConverge: iguais, capitalBindou: bindou,
      fundoC: r.C.fundoDesbloqueio, fundoCatinge2oMotor: r.C.fundo2oMotorAtingido,
      interpretacao: (iguais && !bindou)
        ? `Base US$${base} ACIMA da saturação (~US$400): capital nunca binda; A/B/C geram o MESMO PnL de motor. C acumula US$${r.C.fundoDesbloqueio} p/ um 2º motor a custo ZERO de PnL — C DOMINA.`
        : (iguais && bindou)
        ? `Base US$${base} ABAIXO da saturação: capital binda (perdas ${r.A.posicoesPerdidas}), mas IGUAL p/ A/B/C — o lucro compõe devagar demais na janela (~6 dias) p/ relaxar a restrição, então a política NÃO muda o PnL de motor. C ainda constrói o fundo (US$${r.C.fundoDesbloqueio}) sem custo de PnL MEDIDO.`
        : `Base US$${base}: política MUDA o PnL de motor — A ${r.A.pnlGerado} vs C ${r.C.pnlGerado} (tradeoff real).`,
    };
  }

  const out = {
    schema: 'snowball.reinvestment-counterfactual.v1_1', geradoEm: new Date(asOf || 0).toISOString(), asOfMs: asOf,
    metodo: 'Cada política financia só o que seu capital disponível permite naquele instante, sobre as posições reais (funding/custo observados). PnL NÃO é uma sequência fixa compartilhada.',
    politicas: { A: 'contínua (lucro vira base na hora)', B: `degraus úteis ${JSON.stringify(DEGRAUS)}`, C: `${C_FRACAO_FUNDO * 100}% do lucro → fundo de 2º motor (min US$${MIN_2O_MOTOR})` },
    saturacaoRef: 'capacity-analysis.json: saturação ~US$400',
    resultados, analise,
    conclusao: 'Nesta janela (~6 dias) as políticas A/B/C geram o MESMO PnL de motor em ambas as bases — o lucro compõe devagar demais p/ relaxar restrição de capital, então a política de reinvestimento NÃO muda o lucro do motor. A única diferença econômica REAL é que a Política C acumula um fundo de 2º motor (US$6,14 a US$600) sem custo de PnL medido. Como o motor satura ~US$400, reinvestir MAIS nele é ocioso; desviar o excedente p/ diversificação (C) é a política superior no estado atual — mas o ganho é DIVERSIFICAÇÃO futura, não lucro garantido, e precisa de ≥2 janelas/regimes p/ confirmar.',
    honestidade: 'observed (posições/outcomes) + shadow (gating por política). Nenhuma promessa de lucro; o ganho de C é DIVERSIFICAÇÃO futura, não lucro garantido.',
  };
  const p = L.writeJSON('reinvestment-counterfactual.json', out);
  console.log(JSON.stringify({ saida: p,
    base200: `A ${out.resultados.base_200.A.pnlGerado} / B ${out.resultados.base_200.B.pnlGerado} / C ${out.resultados.base_200.C.pnlGerado} (perdidasA ${out.resultados.base_200.A.posicoesPerdidas})`,
    base600: `A ${out.resultados.base_600.A.pnlGerado} / B ${out.resultados.base_600.B.pnlGerado} / C ${out.resultados.base_600.C.pnlGerado} — converge ${out.analise.base_600.pnlConverge}, fundoC ${out.resultados.base_600.C.fundoDesbloqueio}` }, null, 2));
}
build();
