#!/usr/bin/env node
'use strict';
/**
 * PARTE 3 — Chefes e gates econômicos. Deriva o status de cada "chefe" dos dados
 * REAIS do Champion (read-only). Critérios objetivos, sem otimismo.
 * Emite auditoria/progression/bosses.json.
 */
const L = require('./lib-progression.cjs');

function build() {
  const { estado, marcacao, asOf } = L.loadChampion();
  const { eventos } = L.serieEconomica();
  const funding = estado.fundingTotal || 0, custos = estado.custosTotal || 0;
  const capital = estado.capital || 0;

  // ── funding realizado por símbolo (fonte de lucro) e concentração ───────────
  const fundPorSymbol = {};
  for (const e of eventos) if (e.evento === 'funding' && e.symbol) fundPorSymbol[e.symbol] = (fundPorSymbol[e.symbol] || 0) + (e.ganho || 0);
  const contrib = Object.entries(fundPorSymbol).map(([s, v]) => ({ symbol: s, funding: L.r4(v) })).sort((a, b) => b.funding - a.funding);
  const totalFund = contrib.reduce((s, c) => s + c.funding, 0) || 1;
  const top1Share = contrib.length ? L.r4(contrib[0].funding / totalFund) : 0;
  const herfindahl = L.r4(contrib.reduce((s, c) => s + Math.pow(c.funding / totalFund, 2), 0));
  // concentração por exchange (saldo acima/abaixo do par) e nº de posições por exchange
  const exchUso = {};
  for (const p of (estado.posicoes || [])) { exchUso[p.exchangeShort] = (exchUso[p.exchangeShort] || 0) + 1; exchUso[p.exchangeLong] = (exchUso[p.exchangeLong] || 0) + 1; }

  // ── distância de liquidação mínima (margem/notional − MMR) ──────────────────
  const MMR = 0.01;
  let distMin = Infinity, distMinInfo = null;
  for (const p of (estado.posicoes || [])) {
    for (const [leg, margem] of [['short', p.margemShort], ['long', p.margemLong]]) {
      const d = (margem || 0) / (p.notionalPorPerna || 1) - MMR;
      if (d < distMin) { distMin = d; distMinInfo = { symbol: p.symbol, leg, distancia: L.r4(d) }; }
    }
  }
  if (!isFinite(distMin)) distMin = null;

  // ── stress de custos 2× ─────────────────────────────────────────────────────
  const feeToGross = funding > 0 ? L.r4(custos / funding) : null;
  const netObservado = L.r4(funding - custos);
  const netCustos2x = L.r4(funding - 2 * custos);

  const LIM_FEE_TO_GROSS = 0.60; // limite: custos não podem passar de 60% do funding bruto
  const chefeCustos = {
    id: 'custos', nome: 'Chefe dos Custos',
    metricas: { feeToGross, limiteFeeToGross: LIM_FEE_TO_GROSS, netObservado, netComCustos2x: netCustos2x, funding: L.r4(funding), custos: L.r4(custos) },
    criterios: {
      feeToGrossAbaixoLimite: feeToGross != null && feeToGross < LIM_FEE_TO_GROSS,
      lucroPositivoComCustos2x: netCustos2x > 0,
      custosNaoConsomemMaioria: feeToGross != null && feeToGross < 0.5,
    },
    status: null, nota: netCustos2x > 0 && netCustos2x < 2 ? 'Sobrevive a custos 2×, porém com folga PEQUENA (+' + netCustos2x + '). Margem fina.' : undefined,
  };
  chefeCustos.status = Object.values(chefeCustos.criterios).every(Boolean) ? 'DERROTADO' : 'ATIVO';

  const drawdownMaxPct = L.maxDrawdown(L.serieEconomica().capSeries).pct;
  const chefeSobrevivencia = {
    id: 'sobrevivencia', nome: 'Chefe da Sobrevivência',
    metricas: { drawdownMaxPct, distanciaLiquidacaoMin: distMin, distMinInfo, capitalFloor: estado.capitalInicial, capitalAtual: L.r4(capital), fechamentosEmergencia: estado.fechamentosEmergencia || 0, equityExecutavel: marcacao ? marcacao.equityLiquidacao : null },
    criterios: {
      drawdownControlado: drawdownMaxPct < 10,
      semPerdaCatastrofica: (estado.fechamentosEmergencia || 0) <= 1 && capital >= (estado.capitalInicial || 0),
      distanciaLiquidacaoSegura: distMin == null || distMin > 0.06,
      pisoCapitalRespeitado: capital >= (estado.capitalInicial || 0),
    },
    status: null, nota: (estado.fechamentosEmergencia || 0) > 0 ? `Houve ${estado.fechamentosEmergencia} fechamento(s) de emergência no histórico — monitorar.` : undefined,
  };
  chefeSobrevivencia.status = Object.values(chefeSobrevivencia.criterios).every(Boolean) ? 'DERROTADO' : 'ATIVO';

  const chefeConcentracao = {
    id: 'concentracao', nome: 'Chefe da Concentração',
    metricas: { top1Symbol: contrib[0] || null, top1Share, herfindahl, nSimbolosComFunding: contrib.length, usoPorExchange: exchUso },
    criterios: {
      nenhumaPosicaoDomina: top1Share < 0.4,
      nenhumAtivoDomina: top1Share < 0.4,
      nenhumaExchangeConcentraExcesso: Object.values(exchUso).every((c) => c <= L.MAX_POSICOES),
      umaOperacaoNaoExplicaMaioria: top1Share < 0.5,
    },
    status: null,
  };
  chefeConcentracao.status = Object.values(chefeConcentracao.criterios).every(Boolean) ? 'DERROTADO' : 'ATIVO';

  // ── capacidade: oportunidades rejeitadas por saldo (capital-constrained?) ────
  const cand = L.jsonl(L.P.candidatos);
  const rejeitPorSaldo = cand.filter((c) => c.motivoRejeicao && /saldo_insuficiente/.test(c.motivoRejeicao)).length;
  const chefeCapacidade = {
    id: 'capacidade', nome: 'Chefe da Capacidade',
    metricas: { oportunidadesRejeitadasPorSaldo: rejeitPorSaldo, totalCandidatos: cand.length, temSegundoMotorAbsorvente: false },
    criterios: {
      motorSaturaCapital: rejeitPorSaldo === 0, // se NUNCA rejeita por saldo, o motor está saturado de capital
      evidenciaDeSaturacao: false,
      existeSegundoMotorParaAbsorver: false,
    },
    status: 'ATIVO',
    nota: rejeitPorSaldo > 0 ? `${rejeitPorSaldo} oportunidades rejeitadas por saldo insuficiente: o motor é CONSTRANGIDO POR CAPITAL, não saturado — há headroom de capacidade e falta um 2º motor para absorver.` : 'Motor não rejeita por saldo: possível saturação — avaliar 2º motor.',
  };

  // ── diversificação: ≥2 fontes independentes lucrativas ──────────────────────
  const captura = L.rd(L.P.captura, { pnlLiquido: 0, totalCapturas: 0, concluidas: 0 });
  const fontesLucrativas = [];
  if (netObservado > 0) fontesLucrativas.push({ motor: 'champion-funding', pnlLiquido: netObservado, amostra: (estado.pagamentos || 0) });
  if ((captura.pnlLiquido || 0) > 0) fontesLucrativas.push({ motor: 'settlement-capture', pnlLiquido: L.r4(captura.pnlLiquido), amostra: captura.concluidas || 0, nota: 'amostra pequena' });
  const chefeDiversificacao = {
    id: 'diversificacao', nome: 'Chefe da Diversificação',
    metricas: { fontesLucrativas, capturaPnl: L.r4(captura.pnlLiquido || 0), capturaAmostra: captura.concluidas || 0 },
    criterios: {
      duasFontesIndependentesLucrativas: fontesLucrativas.filter((f) => (f.amostra || 0) >= 20).length >= 2,
      correlacaoConhecida: false,
      naoDependemDoMesmoEvento: false,
    },
    status: 'ATIVO',
    nota: 'Só o funding tem amostra suficiente e lucro; captura é positiva (+' + L.r4(captura.pnlLiquido || 0) + ') mas com amostra pequena (' + (captura.concluidas || 0) + '). Falta uma 2ª fonte comprovada e independente.',
  };

  const bosses = {
    schema: 'snowball.bosses.v1', geradoEm: new Date(asOf || 0).toISOString(), asOfMs: asOf,
    resumo: { derrotados: [chefeCustos, chefeSobrevivencia, chefeConcentracao, chefeCapacidade, chefeDiversificacao].filter((b) => b.status === 'DERROTADO').map((b) => b.id), ativos: [chefeCustos, chefeSobrevivencia, chefeConcentracao, chefeCapacidade, chefeDiversificacao].filter((b) => b.status !== 'DERROTADO').map((b) => b.id) },
    chefes: { custos: chefeCustos, sobrevivencia: chefeSobrevivencia, concentracao: chefeConcentracao, capacidade: chefeCapacidade, diversificacao: chefeDiversificacao },
    honestidade: 'Status derivado de dados observados do Champion. Amostra pequena para captura/diversificação. Custos 2× deixa folga pequena.',
  };
  const p = L.writeJSON('bosses.json', bosses);
  console.log(JSON.stringify({ saida: p, feeToGross, netObservado, netCustos2x, top1Share, herfindahl, distLiqMin: distMin, drawdownMaxPct, rejeitPorSaldo,
    status: Object.fromEntries(Object.entries(bosses.chefes).map(([k, v]) => [k, v.status])) }, null, 2));
}
build();
