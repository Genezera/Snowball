#!/usr/bin/env node
'use strict';
/**
 * PARTE 6 — Capital Opportunity Router (SHADOW). Normaliza cada oportunidade
 * observada para um formato comum e registra a decisão VIRTUAL que tomaria,
 * comparando com a decisão real do Champion. NÃO envia ordem, NÃO move saldo,
 * NÃO fecha posição, NÃO altera sizing, NÃO aprova oportunidade real.
 * Emite capital-router-decisions.jsonl + capital-router.json.
 */
const L = require('./lib-progression.cjs');

function build() {
  const { estado, asOf } = L.loadChampion();
  const episodios = L.jsonl(L.P.episodios);
  const FREE = 2 * L.ALVO_POR_EXCHANGE * (1 - L.RESERVA); // 140 (US$100/perna, menos reserva)

  const decisoes = [];
  let shadowEscolheria = 0, championEscolheu = 0, concordam = 0, ambosRejeitam = 0, divergem = 0;
  for (const ep of episodios) {
    const f = ep.featuresAgregadas || ep.featuresIniciais || {};
    const opp = {
      opportunityId: ep.episodeId, engineId: 'champion-funding', timestamp: ep.firstSeenAt,
      symbol: ep.symbol, par: [ep.exchangeLong, ep.exchangeShort],
      capitalRequired: L.r4(f.capitalNecessario || 0),
      expectedGrossReturn: L.r4((f.valorEsperado || 0) + (f.custo || 0)),
      expectedNetReturn: L.r4(f.valorEsperado || 0),
      expectedDuration: L.r4(f.duracaoHoras || 0),
      expectedCapitalHours: L.r4((f.capitalNecessario || 0) * (f.duracaoHoras || 0)),
      expectedCosts: L.r4(f.custo || 0),
      expectedDrawdown: null,
      liquidationRisk: (f.folga || 0) < 0.06 ? 'alto' : 'baixo',
      confidence: L.r4(f.consistencia || 0),
      dataQuality: ep.featureCoverage != null ? L.r4(ep.featureCoverage) : null,
      capacity: (f.capitalNecessario || 0) <= FREE ? 'fundável-100/perna' : 'excede-100/perna',
      expiry: ep.lastSeenAt, returnPorCapitalHora: L.r4(f.valorPorHora || 0),
      blockedReasons: [],
    };
    // decisão shadow: EV positivo + fundável + payback + liquidação ok
    if (opp.expectedNetReturn <= 0) opp.blockedReasons.push('EV_nao_positivo');
    if (opp.capitalRequired > FREE) opp.blockedReasons.push('excede_margem_100_por_perna');
    if ((f.folga || 0) <= 0) opp.blockedReasons.push('payback_insuficiente');
    if (opp.liquidationRisk === 'alto') opp.blockedReasons.push('risco_liquidacao');
    const shadowChoose = opp.blockedReasons.length === 0;
    const championChoose = !!(ep.decisao && ep.decisao.escolhida);
    if (shadowChoose) shadowEscolheria++;
    if (championChoose) championEscolheu++;
    if (shadowChoose === championChoose) { if (championChoose) concordam++; else ambosRejeitam++; } else divergem++;

    decisoes.push({
      opportunityId: opp.opportunityId, ts: opp.timestamp, symbol: opp.symbol, par: opp.par,
      capitalRequired: opp.capitalRequired, expectedNetReturn: opp.expectedNetReturn, returnPorCapitalHora: opp.returnPorCapitalHora,
      confidence: opp.confidence, capacity: opp.capacity, liquidationRisk: opp.liquidationRisk,
      shadowDecisao: shadowChoose ? 'alocaria' : 'recusaria', shadowMotivos: opp.blockedReasons,
      championDecisao: championChoose ? 'escolheu' : 'nao_escolheu',
      concordancia: shadowChoose === championChoose,
      outcome: ep.outcome || null,
    });
  }

  const total = episodios.length;
  const out = {
    schema: 'snowball.capital-router.v1', geradoEm: new Date(asOf || 0).toISOString(), asOfMs: asOf,
    natureza: 'SHADOW/observer — nenhuma ordem, saldo, fechamento, sizing ou aprovação real. Só registra a decisão que TOMARIA e compara com o Champion.',
    formatoComum: ['opportunityId', 'engineId', 'timestamp', 'capitalRequired', 'expectedGrossReturn', 'expectedNetReturn', 'expectedDuration', 'expectedCapitalHours', 'expectedCosts', 'expectedDrawdown', 'liquidationRisk', 'confidence', 'dataQuality', 'capacity', 'expiry', 'blockedReasons'],
    criteriosComparacao: ['lucro líquido esperado', 'retorno por capital-hora', 'custo', 'risco', 'confiança', 'duração', 'capacidade', 'reserva necessária', 'correlação com abertas', 'oportunidade perdida ao comprometer capital'],
    amostra: { episodios: total, shadowAlocaria: shadowEscolheria, championEscolheu, concordamEscolha: concordam, ambosRejeitam, divergem, taxaConcordancia: total ? L.r4((concordam + ambosRejeitam) / total) : 0 },
    honestidade: 'A maioria esmagadora dos episódios tem EV não-positivo → shadow e Champion REJEITAM juntos. A concordância alta reflete que quase nada passa no custo/payback, não que o router "acerta". Router é observador; a decisão real continua do Champion.',
    posicoesAbertasChampion: (estado.posicoes || []).map((p) => p.symbol),
  };
  const p1 = L.writeJSONL('capital-router-decisions.jsonl', decisoes);
  const p2 = L.writeJSON('capital-router.json', out);
  console.log(JSON.stringify({ saidas: [p1, p2], ...out.amostra }, null, 2));
}
build();
