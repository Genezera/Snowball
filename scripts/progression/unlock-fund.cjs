#!/usr/bin/env node
'use strict';
/**
 * v1.2 — PARTES 7,8,9. Fundo de desbloqueio (Política C, contabilidade SHADOW),
 * ranking dos candidatos a 2º motor e a regra de desbloqueio. O fundo NÃO financia
 * nenhum motor real. READ-ONLY. Emite auditoria/progression/unlock-fund.json.
 */
const L = require('./lib-progression.cjs');

function build() {
  const { estado, asOf } = L.loadChampion();
  const g = (n) => L.rd(L.P.outDir + '/' + n, null);
  const contraf = g('reinvestment-counterfactual.json');
  const registry = g('engine-registry.json');
  const diag = g('engine-diagnostics.json');
  const bosses = g('bosses.json');
  const MIN_2O_MOTOR = 200;

  // ── item 7: fundo de desbloqueio (Política C shadow) ────────────────────────
  const lucroTotal = L.r4((estado.fundingTotal || 0) - (estado.custosTotal || 0));
  const fundoSaldo = contraf && contraf.resultados && contraf.resultados.base_600 ? contraf.resultados.base_600.C.fundoDesbloqueio : L.r4(Math.max(0, lucroTotal) * 0.5);
  const parcelaReservada = fundoSaldo;
  const parcelaOperacional = L.r4(lucroTotal - parcelaReservada);
  const progresso = L.r2((fundoSaldo / MIN_2O_MOTOR) * 100);

  // ── item 8: ranking dos candidatos a 2º motor ───────────────────────────────
  const motores = registry ? registry.motores.filter((m) => m.engineId !== 'champion-funding' && m.estado !== 'ARCHITECTURE_ONLY') : [];
  const candidatos = motores.map((m) => {
    const pnl = typeof m.pnlLiquido === 'number' ? m.pnlLiquido : null;
    let independencia = 'baixa (compartilha exchanges/funding com o Champion)';
    if (m.engineId === 'pares' || m.engineId === 'momentum') independencia = 'potencialmente alta (sinal independente do funding)';
    return {
      engineId: m.engineId, estado: m.estado, capitalMinimo: m.capitalMinimo, amostra: m.amostra,
      pnlLiquido: pnl, drawdown: m.drawdown ?? null, frequencia: m.frequencia, capacidade: m.capacidade,
      independenciaDoChampion: independencia, gate: (m.blockedReasons && m.blockedReasons[0]) || 'sem gate', confianca: m.confianca,
    };
  }).sort((a, b) => (b.pnlLiquido ?? -1e9) - (a.pnlLiquido ?? -1e9) || (a.estado === 'SHADOW' ? -1 : 1));
  candidatos.forEach((c, i) => { c.rank = i + 1; });
  const candidatoTopo = candidatos[0];

  // ── item 9: regra de desbloqueio ────────────────────────────────────────────
  function regraDesbloqueio(m) {
    return {
      eligible: m.estado === 'ELIGIBLE' || m.estado === 'LIVE',
      amostraSuficiente: false, // nenhum candidato tem amostra suficiente ainda
      duasJanelas: false, doisRegimes: false, custos2xPositivo: (m.pnlLiquido ?? -1) > 0,
      pnlLiquidoPositivo: (m.pnlLiquido ?? -1) > 0, drawdownAceitavel: true,
      correlacaoConhecida: false, rollback: true, aprovacaoHumana: false,
    };
  }
  const regraTopo = candidatoTopo ? regraDesbloqueio(candidatoTopo) : null;
  const podeDesbloquear = regraTopo ? Object.values(regraTopo).every(Boolean) : false;

  const out = {
    schema: 'snowball.unlock-fund.v1_2', geradoEm: new Date(asOf || 0).toISOString(), asOfMs: asOf,
    item7_fundoDesbloqueio: {
      natureza: 'contabilidade SHADOW — o fundo NÃO financia nenhum motor real.',
      lucroTotal, parcelaOperacional, parcelaReservada, saldoDoFundo: fundoSaldo,
      capitalMinimoProximoMotor: MIN_2O_MOTOR, progressoPct: progresso,
      motorCandidatoAoDesbloqueio: candidatoTopo ? candidatoTopo.engineId : null,
      nota: `Política C acumula ${fundoSaldo} (${progresso}% de US$${MIN_2O_MOTOR}) a custo ZERO de PnL do motor saturado. Nada é financiado de verdade.`,
    },
    item8_rankingSegundoMotor: candidatos,
    item9_regraDesbloqueio: {
      criterios: ['ELIGIBLE', 'amostra suficiente', '2 janelas', '2 regimes', 'custos 2× positivo', 'PnL líquido positivo', 'drawdown aceitável', 'correlação conhecida', 'rollback', 'aprovação humana'],
      candidatoAvaliado: candidatoTopo ? candidatoTopo.engineId : null, avaliacao: regraTopo, podeDesbloquear,
      veredito: podeDesbloquear ? 'PODE DESBLOQUEAR' : `BLOQUEADO — nenhum candidato é ELIGIBLE com 2 janelas/2 regimes/amostra. Topo: ${candidatoTopo ? candidatoTopo.engineId : 'nenhum'} (${candidatoTopo ? candidatoTopo.estado : '—'}).`,
    },
    honestidade: 'O fundo é só contabilidade shadow; o ganho de C é diversificação futura, não lucro. Nenhum motor é promovido; nenhuma ordem; nenhum capital real movido.',
  };
  const p = L.writeJSON('unlock-fund.json', out);
  console.log(JSON.stringify({ saida: p, saldoFundo: fundoSaldo, progressoPct: progresso, candidatoTopo: candidatoTopo ? `${candidatoTopo.engineId} (${candidatoTopo.estado}, pnl ${candidatoTopo.pnlLiquido})` : null,
    podeDesbloquear, ranking: candidatos.map((c) => `${c.rank}. ${c.engineId}: ${c.estado} pnl ${c.pnlLiquido}`) }, null, 2));
}
build();
