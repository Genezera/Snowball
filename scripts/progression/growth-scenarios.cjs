#!/usr/bin/env node
'use strict';
/**
 * v1.1 — PARTE 9 (corrigido). Growth scenarios SEM taxa-base de longo prazo.
 * NÃO usa 0,67%/dia como base; NÃO promete data para níveis futuros. Enquanto a
 * amostra for insuficiente, produz apenas: (a) trajetória observada, (b) stress
 * MECÂNICO, (c) intervalo de cenários. Bootstrap por operações/janelas só quando
 * a amostra for suficiente (≥30 operações E ≥2 janelas/regimes). Emite growth-scenarios.json.
 */
const L = require('./lib-progression.cjs');

function build() {
  const { estado, asOf } = L.loadChampion();
  const { capSeries } = L.serieEconomica();
  const pos = L.reconstruirPosicoes(estado).filter((p) => !p.aberta); // operações fechadas p/ amostra
  const fund = estado.fundingTotal || 0, cus = estado.custosTotal || 0, netObs = L.r4(fund - cus);

  // ── (a) trajetória OBSERVADA (fatos, sem extrapolação) ──────────────────────
  const serie = capSeries.map((e) => ({ ts: e.ts, capital: e.capital }));
  const mdd = L.maxDrawdown(capSeries);
  const trajetoria = {
    tipo: 'observed',
    capitalInicial: serie.length ? L.r4(serie[0].capital) : null, capitalAtual: L.r4(estado.capital),
    pontos: serie.length, primeiroTs: serie.length ? new Date(serie[0].ts).toISOString() : null, ultimoTs: new Date(asOf || 0).toISOString(),
    diasObservados: serie.length ? L.r2((serie[serie.length - 1].ts - serie[0].ts) / 8.64e7) : 0,
    fundingObservado: L.r4(fund), custosObservado: L.r4(cus), netObservado: netObs, maxDrawdownPct: mdd.pct,
    nota: 'Trajetória de fato. Inclui 1 aporte de US$400 (4 exchanges) — não é lucro.',
  };

  // ── amostra p/ bootstrap ────────────────────────────────────────────────────
  const nOperacoes = pos.length, JANELAS = 1, REGIMES = 1;
  const bootstrapPronto = nOperacoes >= 30 && JANELAS >= 2 && REGIMES >= 2;

  // ── (b) stress MECÂNICO (sobre o net observado; SEM taxa diária, SEM datas) ──
  const stress = [
    { id: 'observado', net: netObs, tipo: 'observed' },
    { id: 'custos_1_5x', net: L.r4(fund - 1.5 * cus), tipo: 'simulated' },
    { id: 'custos_2x', net: L.r4(fund - 2 * cus), tipo: 'simulated' },
    { id: 'funding_menos25', net: L.r4(0.75 * fund - cus), tipo: 'simulated' },
    { id: 'funding_menos50', net: L.r4(0.5 * fund - cus), tipo: 'simulated' },
    { id: 'custos_2x_funding_menos25', net: L.r4(0.75 * fund - 2 * cus), tipo: 'simulated' },
  ].map((s) => ({ ...s, sobreviveComLucro: s.net > 0 }));

  // ── (c) intervalo de cenários ───────────────────────────────────────────────
  const nets = stress.map((s) => s.net);
  const intervalo = { min: L.r4(Math.min(...nets)), max: L.r4(Math.max(...nets)), observado: netObs };

  const out = {
    schema: 'snowball.growth-scenarios.v1_1', geradoEm: new Date(asOf || 0).toISOString(), asOfMs: asOf,
    politica: 'SEM taxa-base de longo prazo; SEM data prometida para níveis futuros. Só trajetória observada + stress mecânico + intervalo enquanto a amostra for insuficiente.',
    trajetoriaObservada: trajetoria,
    amostra: { operacoesFechadas: nOperacoes, janelas: JANELAS, regimes: REGIMES, bootstrapPronto,
      nota: bootstrapPronto ? 'amostra suficiente p/ bootstrap' : `INSUFICIENTE p/ bootstrap (precisa ≥30 operações E ≥2 janelas/regimes; tem ${nOperacoes} operações / ${JANELAS} janela / ${REGIMES} regime). Nenhuma projeção temporal produzida.` },
    stressMecanico: stress,
    intervaloCenarios: intervalo,
    projecaoTemporal: null,
    projecaoTemporalNota: 'REMOVIDO: v1.0 usava 0,67%/dia (2,72 dias de amostra) para projetar datas de nível. Isso é extrapolação indevida — nenhuma data é prometida.',
    contribuicaoPorMotor: { 'champion-funding': netObs, outros: 0 },
    honestidade: 'Só fato observado + stress mecânico. Nenhuma taxa de longo prazo, nenhuma data, nenhum lucro futuro garantido. Bootstrap só quando houver ≥2 janelas/regimes.',
  };
  const p = L.writeJSON('growth-scenarios.json', out);
  console.log(JSON.stringify({ saida: p, netObservado: netObs, bootstrapPronto, operacoes: nOperacoes,
    intervalo, stress: stress.map((s) => `${s.id}: net ${s.net} (${s.sobreviveComLucro ? 'lucro' : 'PREJUÍZO'})`) }, null, 2));
}
build();
