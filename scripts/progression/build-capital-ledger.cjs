#!/usr/bin/env node
'use strict';
/**
 * PARTE 1 — Ledger de progressão do capital (read-only, reconciliável).
 * Emite:
 *   auditoria/progression/capital-ledger.jsonl  — histórico append-only (1 linha por delta econômico)
 *   auditoria/progression/capital-ledger.json   — snapshot reconciliado com o Champion
 * NÃO escreve no estado do Champion. Reconcilia exatamente com spread/estado.json.
 */
const L = require('./lib-progression.cjs');

function build() {
  const { estado, marcacao, epochs, asOf } = L.loadChampion();
  if (!estado) { console.error('estado do Champion ausente'); process.exit(1); }
  const { capSeries } = L.serieEconomica();
  const recon = L.reconciliar(estado);
  const comp = L.comprometido(estado);
  const mdd = L.maxDrawdown(capSeries);
  const niveis = L.derivarNiveis();
  const pos = L.posicaoNiveis(estado, niveis);

  // ── histórico append-only: classifica cada delta da série de capital ────────
  const hist = [];
  let prev = 0, i = 0;
  for (const e of capSeries) {
    const delta = e.capital - prev;
    let tipo = null, origem = e.evento;
    if (i === 0) { tipo = 'capital_inicial'; origem = 'init'; }
    else if (e.evento === 'funding') tipo = 'funding';
    else if (e.evento === 'fecha') tipo = 'fecha';
    else if (Math.abs(delta) > 20) tipo = 'aporte_capital'; // salto não-econômico = injeção externa (novas exchanges)
    // ignora leitura sem delta material (capital realizado só muda em funding/fecha/aporte)
    if (tipo && (tipo !== 'fecha' || Math.abs(delta) > 1e-9) && (i === 0 || Math.abs(delta) > 1e-9)) {
      hist.push({
        timestamp: e.ts, eventId: `${tipo}-${e.ts}-${i}`,
        origem: tipo === 'aporte_capital' ? 'expansao_exchanges' : origem,
        tipo, valor: L.r4(i === 0 ? e.capital : delta),
        saldoAnterior: L.r4(i === 0 ? 0 : prev), saldoPosterior: L.r4(e.capital),
        configEpochId: L.epochDe(e.ts, epochs),
        source: 'champion_observed', confidence: 1.0,
        nota: tipo === 'aporte_capital' ? 'injeção de capital (4 novas exchanges × US$100) — NÃO é lucro' : undefined,
      });
    }
    prev = e.capital; i++;
  }

  // ── composição do capital (Snowball é dono de tudo, inclusive reserva) ──────
  const capital = estado.capital || 0;
  const reservaOperacional = L.r4(capital * L.RESERVA);
  const capitalComprometido = comp.margem;                    // margem travada nas posições abertas
  const capitalLivre = L.r4(capital - capitalComprometido - reservaOperacional);
  const lucroLiquido = L.r4(capital - (estado.capitalInicial || 0)); // = funding − custos
  // capital-horas comprometidas: margem × horas aberta por posição
  const capitalHoras = L.r4((estado.posicoes || []).reduce((s, p) => s + ((p.margemShort || 0) + (p.margemLong || 0)) * Math.max(0, (asOf - (p.abertaEm || asOf)) / 3.6e6), 0));

  const aportes = hist.filter((h) => h.tipo === 'aporte_capital').map((h) => ({ ts: h.timestamp, valor: h.valor, configEpochId: h.configEpochId }));
  const capitalInicialEpoch0 = (epochs.find((e) => e.configEpochId === 'epoch-0') || {}).capitalBase ?? null;

  const cf = (v, src, obs) => L.campo(v, src, obs, asOf);
  const ledger = {
    schema: 'snowball.capital-ledger.v1', geradoEm: new Date(asOf || 0).toISOString(), asOfMs: asOf,
    reconciliacao: { ...recon, identidade: 'capital = capitalInicial + funding − custos' },
    capitalInicial: { epoch0: capitalInicialEpoch0, aportes, total: cf(estado.capitalInicial, 'champion_observed', asOf) },
    capitalRealizado: cf(capital, 'champion_observed', asOf),
    equityMarcada: cf(marcacao ? marcacao.equityMark : null, marcacao ? 'champion_observed' : 'unavailable', marcacao ? marcacao.geradoEm : null),
    equityExecutavel: cf(marcacao ? marcacao.equityLiquidacao : null, marcacao ? 'champion_observed' : 'unavailable', marcacao ? marcacao.geradoEm : null),
    lucroAcumulado: cf(lucroLiquido, 'derived', asOf),
    custosAcumulados: cf(estado.custosTotal, 'champion_observed', asOf),
    fundingAcumulado: cf(estado.fundingTotal, 'champion_observed', asOf),
    drawdown: { maxObservadoPct: mdd.pct, atualPct: L.r2((( (estado.pico||capital) - capital) / (estado.pico||capital)) * 100), picoTs: mdd.picoTs, valeTs: mdd.valeTs, source: 'derived' },
    reservaOperacional: cf(reservaOperacional, 'derived', asOf),
    capitalLivre: cf(capitalLivre, 'derived', asOf),
    capitalComprometido: cf(capitalComprometido, 'derived', asOf),
    notionalExposto: cf(comp.notionalPorPernaTotal, 'derived', asOf),
    capitalHorasComprometidas: cf(capitalHoras, 'derived', asOf),
    lucroReinvestivel: cf(lucroLiquido, 'derived', asOf),   // 100% permanece no sistema; nada é retirado
    capitalExperimentalVirtual: cf(0, 'derived', asOf),     // nenhum capital real de experimentação alocado (só shadow)
    capitalNecessarioProximoNivel: { valor: pos.capitalNecessarioProximoNivel, nivelAtualPorCapital: pos.nivelAtualPorCapital, proximoNivel: pos.proximoNivel, capitalDeployable: pos.capitalDeployable,
      nota: pos.capitalNecessarioProximoNivel === 0 ? 'capital já suficiente p/ o próximo nível — o bloqueio é EVIDÊNCIA (amostra/gate), não dinheiro.' : 'faltam US$ para o próximo degrau de capital.' },
    saldosPorExchange: estado.saldos || {},
    posicoesAbertas: (estado.posicoes || []).map((p) => ({ symbol: p.symbol, exchangeShort: p.exchangeShort, exchangeLong: p.exchangeLong, notionalPorPerna: L.r4(p.notionalPorPerna), margem: L.r4((p.margemShort||0)+(p.margemLong||0)), fundingAcumulado: L.r4(p.fundingAcumulado), abertaEm: p.abertaEm })),
    politicaComposicao: {
      regra: 'capitalSeguinte = capitalAtual + lucroLiquido; 100% do lucro permanece no Snowball.',
      reservaPct: L.RESERVA, alavancagem: L.ALAVANCAGEM, maxPosicoes: L.MAX_POSICOES, margemPayback: L.MARGEM_PAYBACK,
      nota: 'Reinvestir 100% ≠ expor 100%. Reserva/margem livre/capital de segurança pertencem ao Snowball e são capacidade operacional. Não reduzir reserva nem aumentar exposição para acelerar crescimento.',
    },
    historicoEntradas: hist.length,
    fontes: { estado: 'spread/estado.json', marcacao: 'spread/marcacao.json', diario: 'spread/diario.jsonl', epochs: 'auditoria/dataset/config-epochs.json' },
  };

  const pJsonl = L.writeJSONL('capital-ledger.jsonl', hist);
  const pJson = L.writeJSON('capital-ledger.json', ledger);
  console.log(JSON.stringify({
    reconcilia: recon.reconcilia, calculado: recon.calculado, reportado: recon.reportado,
    capitalRealizado: capital, capitalInicial: estado.capitalInicial, lucroLiquido, funding: estado.fundingTotal, custos: estado.custosTotal,
    reserva: reservaOperacional, comprometido: capitalComprometido, livre: capitalLivre, maxDD: mdd.pct + '%',
    nivelAtualPorCapital: pos.nivelAtualPorCapital, proximoNivel: pos.proximoNivel, gapProximoNivel: pos.capitalNecessarioProximoNivel,
    historicoEntradas: hist.length, aportes: aportes.length, saidas: [pJsonl, pJson],
  }, null, 2));
}
build();
