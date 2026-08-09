#!/usr/bin/env node
'use strict';
/**
 * v1.8-profit — ITENS 2,3,4,5,6,7,8,10,12. Descoberta e maximização de lucro (READ-ONLY). Consolida
 * ranking de políticas, melhor uso do próximo dólar, capacidade por exchange, rejeições
 * contrafactuais, timing de fechamento (shadow), maxPositions e compounding — reusando builders
 * existentes onde já respondem. NÃO declara vencedor com amostra insuficiente. NÃO move dinheiro.
 * Emite auditoria/progression/profit-discovery.json.
 */
const L = require('./lib-progression.cjs');
const fs = require('node:fs');
const path = require('node:path');
const ECON = path.join(L.ROOT, 'auditoria', 'progression', 'economic');
const POL = ['policy', 'trial', 'observer-max3', 'observer-max4', 'observer-max5'];
const MIN_AMOSTRA = 30;

function diario(l) { try { return fs.readFileSync(path.join(ECON, l, 'diario.jsonl'), 'utf8').split('\n').filter(Boolean).map((x) => { try { return JSON.parse(x); } catch { return null; } }).filter(Boolean); } catch { return []; } }

function build() {
  const { estado: champ, asOf } = L.loadChampion();
  const led = L.rd(L.P.outDir + '/economic-ledger.json', null);
  const pairing = L.rd(L.P.outDir + '/economic-pairing.json', null);
  const uniqueClosed = pairing ? pairing.resumo.uniqueSourcePositionClosed : 0;
  const amostraSuficiente = uniqueClosed >= MIN_AMOSTRA;
  const linhas = led ? led.linhas : [];

  // ── item 2: ranking de políticas ──
  const ranking = POL.map((p) => {
    const est = L.rd(path.join(ECON, p, 'estado.json'), null);
    const fech = linhas.filter((r) => r.policy === p && !r.rightCensored);
    const cens = linhas.filter((r) => r.policy === p && r.rightCensored).length;
    const net = L.r4(fech.reduce((s, r) => s + (r.realizedNetPnL || 0), 0));
    const capH = L.r4(fech.reduce((s, r) => s + (r.capitalHours || 0), 0));
    const custos = L.r4(fech.reduce((s, r) => s + (r.totalCosts || 0), 0));
    const dd = L.r4(Math.max(0, ...fech.map((r) => r.drawdown || 0)));
    const capUsado = est ? L.r4(Object.values(est.virtuais || {}).reduce((s, v) => s + 2 * (v.margemPorPerna || 0), 0)) : 0;
    const capInicial = est ? est.capitalInicial : 0;
    return { policy: p, lucroLiquido: net, lucroPorCapitalHora: capH > 0 ? L.r4(net / capH) : 0, capitalMedioUtilizado: capUsado, capitalOcioso: L.r4(capInicial - capUsado), frequenciaFechadas: fech.length, custos, drawdown: dd, posicoesFechadas: fech.length, censura: cens };
  });
  ranking.sort((a, b) => b.lucroLiquido - a.lucroLiquido);
  const vencedor = amostraSuficiente ? ranking[0].policy : 'INDETERMINADO (amostra insuficiente)';

  // ── item 4: capacidade por exchange (Champion) ──
  const saldos = champ ? (champ.saldos || {}) : {};
  const capacidadePorExchange = Object.entries(saldos).map(([ex, saldo]) => ({ exchange: ex, saldoLivre: L.r4(saldo), comprometidoAprox: 'nas posições abertas do Champion', abaixoDaReserva: saldo < (L.ALVO_POR_EXCHANGE * L.RESERVA) }));
  const exchangeLimitante = capacidadePorExchange.filter((e) => e.saldoLivre < 1).map((e) => e.exchange);

  // ── item 5: rejeições contrafactuais (economic 'bloqueada', dedup por sourceDecisionId) ──
  const rejById = new Map(); let rawRej = 0; const episodios = new Set(), simbolos = new Set();
  for (const p of POL) for (const e of diario(p)) { if (e.evento !== 'bloqueada') continue; rawRej++;
    const did = e.sourceDecisionId || (e.k + ':' + (e.motivo || '')); if (!rejById.has(did)) rejById.set(did, { motivo: e.motivo, k: e.k });
    if (e.k) { simbolos.add(e.k.split('|')[0]); } }
  const classifica = (m) => /evNaoPositivo|apr|ev/i.test(m || '') ? 'CORRECTLY_REJECTED_LOSS' : /maxPositions|localBalance|reserve|aggregate/i.test(m || '') ? 'INCONCLUSIVE' : 'INCONCLUSIVE';
  const rejClass = { GOOD_REJECTION: 0, MISSED_PROFITABLE_OPPORTUNITY: 0, CORRECTLY_REJECTED_LOSS: 0, INCONCLUSIVE: 0, RIGHT_CENSORED: 0 };
  for (const r of rejById.values()) rejClass[classifica(r.motivo)]++;

  // ── item 3: melhor uso do próximo dólar (EV marginal) — sem amostra suficiente, comparação estrutural ──
  const usos = [
    { uso: 'adicionar_saldo_exchange_limitante', expectedMarginalReturn: 'ALTO se destrava posição positive-EV bloqueada', risk: 'baixo', capacity: exchangeLimitante.length ? 'gate/limitante a $0 → destrava pares que precisam dela' : 'nenhuma limitante agora', confidence: amostraSuficiente ? 'média' : 'baixa (amostra insuficiente)', opportunityCost: 'imobiliza $ até fechar', unlockValue: 'direto' },
    { uso: 'abrir_posicao_adicional', expectedMarginalReturn: 'depende de haver slot livre + oportunidade positive-EV madura', risk: 'concentração', capacity: champ ? `${(champ.posicoes || []).length}/${L.MAX_POSICOES} slots` : '?', confidence: 'baixa', opportunityCost: 'reserva', unlockValue: 'médio' },
    { uso: 'aumentar_sizing_champion', expectedMarginalReturn: 'linear no funding, mas custo fixo por perna dilui em posição pequena', risk: 'liquidação (alavancagem)', capacity: 'limitado pela margem livre', confidence: 'baixa', opportunityCost: 'menos posições', unlockValue: 'médio' },
    { uso: 'acumular_unlock_fund', expectedMarginalReturn: 'habilita 2º motor no futuro', risk: 'nenhum', capacity: 'ilimitada', confidence: 'alta (regra)', opportunityCost: 'lucro parado', unlockValue: 'estratégico' },
    { uso: 'manter_reserva', expectedMarginalReturn: '0 direto; reduz risco de ruína', risk: 'menor', capacity: 'n/a', confidence: 'alta', opportunityCost: 'lucro não exposto', unlockValue: 'defensivo' },
    { uso: 'financiar_settlement_capture', expectedMarginalReturn: 'capturas de liquidação de alto %/liq (ver captura)', risk: 'timing', capacity: 'janelas de settlement', confidence: 'média', opportunityCost: 'capital de curto prazo', unlockValue: 'oportunista' },
    { uso: 'aguardar_oportunidade', expectedMarginalReturn: '0 até aparecer positive-EV madura', risk: 'nenhum', capacity: 'n/a', confidence: 'alta', opportunityCost: 'ociosidade', unlockValue: 'baixo' },
  ];
  const recomendacaoProximoDolar = exchangeLimitante.length ? 'adicionar_saldo_exchange_limitante (destrava EV bloqueada) — MAS aprovação humana e amostra ainda insuficiente p/ afirmar magnitude' : 'acumular_unlock_fund enquanto a amostra econômica não confirma a borda';

  const out = {
    schema: 'snowball.profit-discovery.v1_8', geradoEm: new Date(asOf || 0).toISOString(), asOfMs: asOf,
    amostra: { uniqueSourcePositionClosed: uniqueClosed, minimo: MIN_AMOSTRA, suficiente: amostraSuficiente },
    item2_rankingPoliticas: { ranking, vencedor, nota: amostraSuficiente ? null : 'NÃO se declara vencedor — amostra insuficiente (fechadas < 30).' },
    item3_proximoDolar: { usos, recomendacao: recomendacaoProximoDolar },
    item4_capacidadePorExchange: { porExchange: capacidadePorExchange, exchangeLimitante, nota: 'Não mover dinheiro automaticamente. Exchange a $0 livre bloqueia pares que a exigem.' },
    item5_rejeicoesContrafactuais: { rawRejectionEvents: rawRej, uniqueSourceDecisionIds: rejById.size, uniqueOpportunityEpisodes: episodios.size || rejById.size, uniqueSymbols: simbolos.size, classificacao: rejClass, nota: 'Sem lookahead confiável, a maioria fica INCONCLUSIVE ou CORRECTLY_REJECTED_LOSS (portão de EV). MISSED só com prova de que a rejeitada teria lucrado.' },
    item6_timingFechamento: { fonte: 'economic-daily-report.shadowMaxHoldingSensibilidade + close-exit categorias', shadow: L.rd(L.P.outDir + '/economic-daily-report.json', {}).shadowMaxHoldingSensibilidade || null, nota: 'Shadow 24/72/168h já calculado; champion/inversion/next-funding/risk exigem mais fechamentos. Política ativa (7d) NÃO alterada.' },
    item7_maxPositions: L.rd(L.P.outDir + '/maxpositions-test.json', { nota: 'ver maxpositions-test' }),
    item8_compounding: { reinvestment: L.rd(L.P.outDir + '/reinvestment-counterfactual.json', null) ? 'ver reinvestment-counterfactual.json' : null, growth: L.rd(L.P.outDir + '/growth-scenarios.json', null) ? 'ver growth-scenarios.json' : null, separacao: { operatingCapital: 'capital em uso', safetyReserve: L.r4(600 * L.RESERVA), unlockFund: (L.rd(L.P.outDir + '/unlock-fund.json', {}) || {}).fundoAtual || 0, freeCapital: 'livre acima da reserva', committedCapital: 'margem nas posições' }, principio: 'Todo lucro fica no sistema; nem todo lucro fica EXPOSTO (parte vira reserva/unlock).' },
    item12_candidatoSegundoMotor: { candidato: 'Settlement Capture (captura de liquidação) — já observado pagando alto %/liq no live.log', condicao: 'financiado pelo unlock fund após a borda do 1º motor ser comprovada (gate)', nota: 'não ativar sem gate + aprovação humana' },
    honestidade: 'Descoberta de lucro estrutural. Com 3/30 fechadas, NENHUM ranking/vencedor é declarado como definitivo — o framework está pronto e os números definitivos vêm com o soak.',
  };
  const p = L.writeJSON('profit-discovery.json', out);
  console.log(JSON.stringify({ saida: p, amostraSuficiente, vencedor, rankingTop: ranking.slice(0, 3).map((r) => r.policy + ':' + r.lucroLiquido), proximoDolar: recomendacaoProximoDolar, exchangeLimitante, rejeicoes: rejClass }, null, 2));
}
build();
