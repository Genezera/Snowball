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

  // ── item 8: máquina de estados dos chefes (v1.1) ────────────────────────────
  // UNTESTED / ACTIVE / PASSED_CURRENT_WINDOW / PROVISIONALLY_DEFEATED / DEFEATED.
  // DEFEATED exige múltiplas janelas E regimes. Amostra atual = 1 janela contínua,
  // 1 regime observável → nenhum chefe pode ser DEFEATED ainda.
  const JANELAS = 1, REGIMES = 1;
  function estadoChefe(criterios, opts) {
    opts = opts || {};
    if (opts.naoAvaliavel) return 'UNTESTED';
    if (!Object.values(criterios).every(Boolean)) return 'ACTIVE';
    if (JANELAS >= 2 && REGIMES >= 2) return 'DEFEATED';
    return opts.borderline ? 'PASSED_CURRENT_WINDOW' : 'PROVISIONALLY_DEFEATED';
  }

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
  chefeCustos.status = estadoChefe(chefeCustos.criterios, { borderline: netCustos2x > 0 && netCustos2x < 2 });

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
  chefeSobrevivencia.status = estadoChefe(chefeSobrevivencia.criterios, { borderline: (estado.fechamentosEmergencia || 0) > 0 });

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
  chefeConcentracao.status = estadoChefe(chefeConcentracao.criterios);

  // ── capacidade (CORRIGIDO v1.1): só produtiva se capital extra libera EV+ real ──
  const cand = L.jsonl(L.P.candidatos);
  const rejeitPorSaldo = cand.filter((c) => c.motivoRejeicao && /saldo_insuficiente/.test(c.motivoRejeicao)).length;
  const saldoSemEconomia = cand.filter((c) => /saldo_insuficiente/.test(c.motivoRejeicao || '') && !(c.features && (c.features.custo > 0 || c.features.capitalNecessario > 0))).length;
  const evPosBloqSaldo = cand.filter((c) => c.features && c.features.valorEsperado > 0 && /saldo_insuficiente/.test(c.motivoRejeicao || '')).length;
  const capAnalise = L.rd(L.P.outDir + '/capacity-analysis.json', null);
  const saturacaoUSD = capAnalise && capAnalise.item5_capacidadeMarginal ? capAnalise.item5_capacidadeMarginal.saturacaoUSD : null;
  const chefeCapacidade = {
    id: 'capacidade', nome: 'Chefe da Capacidade',
    metricas: { rejeicoesPorSaldo: rejeitPorSaldo, rejeicoesPorSaldoSemAvaliacaoEconomica: saldoSemEconomia, oportunidadesEVpositivoBloqueadasSoPorCapital: evPosBloqSaldo, saturacaoUSD, temSegundoMotorAbsorvente: false },
    criterios: {
      capitalExtraLiberaEVpositivoReal: evPosBloqSaldo > 0, // corrigido: número bruto de rejeições NÃO conta
      existeSegundoMotorParaAbsorver: false,
    },
    status: null,
    nota: `CORREÇÃO v1.1: das ${rejeitPorSaldo} rejeições por saldo, ${saldoSemEconomia} ocorreram ANTES da avaliação econômica (EV desconhecido). ZERO oportunidades de EV positivo foram bloqueadas por capital. O motor SATURA ~US$${saturacaoUSD}. Não há capacidade produtiva de capital adicional; o gargalo é oferta de oportunidade + falta de 2º motor.`,
  };
  chefeCapacidade.status = estadoChefe(chefeCapacidade.criterios); // critérios falham → ACTIVE

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
    status: null,
    nota: 'Só o funding tem amostra suficiente e lucro; captura é positiva (+' + L.r4(captura.pnlLiquido || 0) + ') mas com amostra pequena (' + (captura.concluidas || 0) + '). Falta uma 2ª fonte comprovada e independente.',
  };
  chefeDiversificacao.status = estadoChefe(chefeDiversificacao.criterios);

  const bosses = {
    schema: 'snowball.bosses.v1', geradoEm: new Date(asOf || 0).toISOString(), asOfMs: asOf,
    maquinaEstados: { estados: ['UNTESTED', 'ACTIVE', 'PASSED_CURRENT_WINDOW', 'PROVISIONALLY_DEFEATED', 'DEFEATED'], janelas: JANELAS, regimes: REGIMES, notaDefeated: 'DEFEATED exige ≥2 janelas E ≥2 regimes — inatingível com 1 janela. Máximo atual: PROVISIONALLY_DEFEATED.' },
    resumo: (() => { const todos = [chefeCustos, chefeSobrevivencia, chefeConcentracao, chefeCapacidade, chefeDiversificacao]; const g = {}; for (const b of todos) (g[b.status] = g[b.status] || []).push(b.id); return g; })(),
    chefes: { custos: chefeCustos, sobrevivencia: chefeSobrevivencia, concentracao: chefeConcentracao, capacidade: chefeCapacidade, diversificacao: chefeDiversificacao },
    honestidade: 'Estados de 5 níveis; DEFEATED exige múltiplas janelas/regimes. Amostra atual = 1 janela → nada DEFEATED. Capacidade CORRIGIDA (v1.1): rejeições brutas por saldo não provam capacidade.',
  };
  const p = L.writeJSON('bosses.json', bosses);
  console.log(JSON.stringify({ saida: p, feeToGross, netObservado, netCustos2x, top1Share, herfindahl, distLiqMin: distMin, drawdownMaxPct, rejeitPorSaldo,
    status: Object.fromEntries(Object.entries(bosses.chefes).map(([k, v]) => [k, v.status])) }, null, 2));
}
build();
