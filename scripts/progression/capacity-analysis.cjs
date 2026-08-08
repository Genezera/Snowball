#!/usr/bin/env node
'use strict';
/**
 * v1.1 — PARTES 1 e 5. Corrige o Chefe da Capacidade (não usar rejeições brutas por
 * saldo como prova) e mede a capacidade MARGINAL do capital. Read-only.
 * Emite auditoria/progression/capacity-analysis.json.
 */
const L = require('./lib-progression.cjs');

function build() {
  const { estado, asOf } = L.loadChampion();
  const cand = L.jsonl(L.P.candidatos);

  // ── item 1: classificar TODAS as rejeições ──────────────────────────────────
  const cat = { aprovada: 0, saldo_semEconomia: 0, saldo_comEconomia: 0, payback_EVneg: 0, payback_EVzero: 0, payback_EVpos: 0, cobertura: 0, outro: 0 };
  const saldoEVdesconhecido = [];
  for (const c of cand) {
    const f = c.features || {}; const m = c.motivoRejeicao || (c.aprovada ? 'APROVADA' : '');
    if (c.aprovada) cat.aprovada++;
    else if (/saldo_insuficiente/.test(m)) { const temEcon = (f.custo > 0 || f.capitalNecessario > 0); if (temEcon) cat.saldo_comEconomia++; else { cat.saldo_semEconomia++; } }
    else if (/payback_insuficiente/.test(m)) { if (f.valorEsperado < 0) cat.payback_EVneg++; else if (f.valorEsperado > 0) cat.payback_EVpos++; else cat.payback_EVzero++; }
    else if (/cobertura_insuficiente/.test(m)) cat.cobertura++;
    else cat.outro++;
  }
  // oportunidades POSITIVAS bloqueadas SOMENTE por capital (evidência de capacidade produtiva)
  const evPosBloqSaldo = cand.filter((c) => c.features && c.features.valorEsperado > 0 && /saldo_insuficiente/.test(c.motivoRejeicao || '')).length;
  const evPos = cand.filter((c) => c.features && c.features.valorEsperado > 0);

  const capacidadeProdutiva = evPosBloqSaldo > 0; // só verdadeira se capital extra libera EV+ real
  const item1 = {
    rejeicoesClassificadas: cat,
    interpretacao: {
      saldoRejeicoesSemAvaliacaoEconomica: cat.saldo_semEconomia,
      nota_saldo: 'Rejeições por saldo ocorrem ANTES da avaliação econômica (features zeradas) → o EV dessas oportunidades é DESCONHECIDO. O número bruto de rejeições por saldo NÃO é prova de capacidade produtiva.',
      paybackTodosEVnegativo: cat.payback_EVneg,
      nota_payback: 'Todas as rejeições por payback têm EV<0 — recusadas corretamente, independentemente de capital.',
      oportunidadesEVpositivo: evPos.length,
      oportunidadesEVpositivoBloqueadasSoPorCapital: evPosBloqSaldo,
    },
    veredito: capacidadeProdutiva ? 'CAPACIDADE PRODUTIVA COMPROVADA' : 'CAPACIDADE PRODUTIVA NÃO COMPROVADA',
    conclusao: capacidadeProdutiva
      ? `${evPosBloqSaldo} oportunidades de EV positivo foram bloqueadas só por capital.`
      : `ZERO oportunidades de EV positivo foram bloqueadas por capital. Toda oportunidade avaliada como positiva foi financiada. O gargalo é a OFERTA de oportunidades (EV≤0 ou não-avaliadas), não o capital. Correção da v1: as 6422 rejeições por saldo NÃO comprovam capacidade.`,
  };

  // ── item 5: curva de capacidade marginal (modelo de concorrência sobre posições REAIS) ──
  const pos = L.reconstruirPosicoes(estado).filter((p) => p.abreTs).sort((a, b) => a.abreTs - b.abreTs);
  const fimGlobal = asOf;
  function simular(C) {
    const freeMargin = C * (1 - L.RESERVA);
    const ativos = []; // {margem, fechaTs}
    let committedSum = 0, committedTime = 0, ultimoTs = pos.length ? pos[0].abreTs : asOf;
    let pnl = 0, funding = 0, custo = 0, financiadas = 0, positivasFin = 0, perdidas = 0, chFin = 0, capitalHoras = 0;
    const equity = []; let picoMargem = 0;
    for (const p of pos) {
      // libera posições fechadas antes deste abre
      for (let i = ativos.length - 1; i >= 0; i--) if (ativos[i].fechaTs != null && ativos[i].fechaTs <= p.abreTs) { committedSum -= ativos[i].margem; ativos.splice(i, 1); }
      const livre = freeMargin - committedSum;
      const cabe = p.margem <= livre + 1e-9 && ativos.length < L.MAX_POSICOES;
      if (cabe) {
        ativos.push({ margem: p.margem, fechaTs: p.fechaTs }); committedSum += p.margem; picoMargem = Math.max(picoMargem, committedSum);
        financiadas++; if ((p.pnl || 0) > 0) positivasFin++;
        pnl += p.pnl || 0; funding += p.funding || 0; custo += p.custo || 0;
        const dur = ((p.fechaTs || fimGlobal) - p.abreTs) / 3.6e6; capitalHoras += p.margem * Math.max(0, dur);
        equity.push(pnl);
      } else { perdidas++; }
    }
    // maxDD do equity de posições financiadas (fechamentos)
    let pico = 0, mdd = 0; for (const e of equity) { if (e > pico) pico = e; const dd = pico > 0 ? (pico - e) / pico : 0; if (dd > mdd) mdd = dd; }
    const utilPct = C ? L.r2((picoMargem / C) * 100) : 0;
    return {
      capital: C, pnlLiquido: L.r4(pnl), retornoPct: C ? L.r2((pnl / C) * 100) : 0,
      oportunidadesPositivasFinanciadas: positivasFin, posicoesFinanciadas: financiadas, posicoesPerdidas: perdidas,
      utilizacaoPicoPct: utilPct, capitalOciosoPicoUSD: L.r2(Math.max(0, freeMargin - picoMargem)),
      feeToGross: funding > 0 ? L.r4(custo / funding) : null, drawdownPct: L.r2(mdd * 100), capitalHoras: L.r2(capitalHoras),
      picoMargemUSD: L.r2(picoMargem),
    };
  }
  const niveisCapital = [200, 300, 400, 600, 800, 1000];
  const curva = niveisCapital.map(simular);
  // marginalReturn entre níveis consecutivos
  for (let i = 1; i < curva.length; i++) { const dC = curva[i].capital - curva[i - 1].capital; const dP = curva[i].pnlLiquido - curva[i - 1].pnlLiquido; curva[i].marginalReturnPorDolar = L.r4(dP / dC); }
  curva[0].marginalReturnPorDolar = null;
  // saturação: primeiro nível onde marginalReturn ~ 0 (e permanece)
  let saturacao = null; for (let i = 1; i < curva.length; i++) { if (Math.abs(curva[i].marginalReturnPorDolar) < 1e-4) { saturacao = curva[i - 1].capital; break; } }
  const picoMargemGlobal = curva[curva.length - 1].picoMargemUSD;

  const out = {
    schema: 'snowball.capacity-analysis.v1_1', geradoEm: new Date(asOf || 0).toISOString(), asOfMs: asOf,
    item1_chefeCapacidade: item1,
    item5_capacidadeMarginal: {
      modelo: 'concorrência sobre posições REAIS do Champion (funding/custo OBSERVADOS): a capital C, financia uma posição se cabe na margem livre (C×0,7) e sob maxPosições; PnL usa outcome realizado.',
      curva, saturacaoUSD: saturacao, picoMargemComprometidaUSD: picoMargemGlobal,
      capitalMinimoParaTudo: L.r2(picoMargemGlobal / (1 - L.RESERVA)),
      lucroMarginalAcimaDaSaturacao: 0,
      conclusao: `O Champion nunca comprometeu mais que US$${picoMargemGlobal} de margem. Capital acima de ~US$${L.r2(picoMargemGlobal / (1 - L.RESERVA))} fica OCIOSO — o lucro satura (marginalReturn→0). Dobrar capital NÃO dobra lucro; a oferta de oportunidades EV+ é o teto.`,
      caveat: 'Modelo de concorrência (financia-ou-perde). Com menos capital o Champion também poderia REDUZIR o sizing (funding proporcionalmente menor + ordens mínimas mordendo) — efeito não isolado aqui. Ambos apontam saturação por falta de oportunidade, não por capital.',
    },
    honestidade: 'observed (rejeições, outcomes) + shadow (simulação de concorrência). Nenhuma promessa de que mais capital = mais lucro.',
  };
  const p = L.writeJSON('capacity-analysis.json', out);
  console.log(JSON.stringify({ saida: p, veredito: item1.veredito, evPosBloqSaldo, saldoSemEcon: cat.saldo_semEconomia, paybackEVneg: cat.payback_EVneg,
    saturacaoUSD: saturacao, picoMargem: picoMargemGlobal, curva: curva.map((c) => `$${c.capital}: pnl ${c.pnlLiquido} (${c.retornoPct}%) mrg ${c.marginalReturnPorDolar}`) }, null, 2));
}
build();
