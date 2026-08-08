#!/usr/bin/env node
'use strict';
/**
 * PARTE 8 — Simulação de crescimento (Snowball). USA SÓ dados observados; nenhuma
 * taxa fixa inventada. Distingue explicitamente fato observado / replay / simulado /
 * hipótese / projeção. NÃO extrapola dias como se fossem meses garantidos: cada
 * projeção carrega a ressalva de amostra insuficiente. Emite growth-scenarios.json.
 */
const L = require('./lib-progression.cjs');

function build() {
  const { estado, asOf, epochs } = L.loadChampion();
  const { capSeries } = L.serieEconomica();
  const capital = estado.capital || 0;
  const niveis = L.derivarNiveis();

  // ── taxa observada (epoch-1: pós-injeção, US$600/6 exchanges) ────────────────
  const ep1 = epochs.find((e) => e.configEpochId === 'epoch-1');
  const serieEp1 = capSeries.filter((e) => e.ts >= (ep1 ? ep1.inicioTs : 0));
  const capIniEp1 = serieEp1.length ? serieEp1[0].capital : capital; // ~599.14 (pós-injeção)
  const capFimEp1 = serieEp1.length ? serieEp1[serieEp1.length - 1].capital : capital;
  const diasEp1 = serieEp1.length ? Math.max(0.01, (serieEp1[serieEp1.length - 1].ts - serieEp1[0].ts) / 8.64e7) : 0;
  const ganhoEp1 = capFimEp1 - capIniEp1;
  const retornoDiarioObs = capIniEp1 > 0 ? ganhoEp1 / capIniEp1 / diasEp1 : 0; // fração/dia (OBSERVADO)
  const mdd = L.maxDrawdown(capSeries);

  const amostraFragil = diasEp1 < 14; // < 2 semanas => projeções são hipóteses frágeis
  const fund = estado.fundingTotal || 0, cus = estado.custosTotal || 0;

  // ── cenários (ajustam o retorno diário observado) ───────────────────────────
  const cenarios = [
    { id: 'observado', label: 'observado', mult: 1, tipo: 'observed', nota: 'taxa diária observada no epoch-1 (US$600/6ex).' },
    { id: 'custos_1_5x', label: 'custos 1,5×', tipo: 'simulated', net: fund - 1.5 * cus },
    { id: 'custos_2x', label: 'custos 2×', tipo: 'simulated', net: fund - 2 * cus },
    { id: 'funding_menos25', label: 'funding −25%', tipo: 'simulated', net: 0.75 * fund - cus },
    { id: 'funding_menos50', label: 'funding −50%', tipo: 'simulated', net: 0.5 * fund - cus },
    { id: 'menos_oportunidades', label: 'redução de oportunidades (−50%)', mult: 0.5, tipo: 'hypothetical', nota: 'metade das aberturas; escala linear (hipótese).' },
    { id: 'drawdown', label: 'drawdown observado aplicado', tipo: 'simulated', net: (fund - cus) * (1 - mdd.fracao), nota: 'retorno líquido reduzido pelo maxDD observado.' },
    { id: 'perde_exchange', label: 'perda de uma exchange', mult: 5 / 6, tipo: 'hypothetical', nota: 'capacidade ∝ nº de exchanges (6→5); hipótese linear.' },
    { id: 'saturacao_motor', label: 'saturação do motor', mult: 0.0, tipo: 'hypothetical', nota: 'motor não absorve capital novo: retorno incremental ≈ 0 (poucas oportunidades EV+).' },
    { id: 'segundo_motor', label: '2º motor desbloqueado', tipo: 'hypothetical', nota: 'requer motor ELIGIBLE — inexistente hoje; projeção condicional, NÃO garantida.' },
  ];

  const netObs = fund - cus; // 9.98 observado
  function taxaCenario(c) {
    if (c.mult != null) return retornoDiarioObs * c.mult;
    if (c.net != null) return retornoDiarioObs * (netObs !== 0 ? c.net / netObs : 0); // escala pelo net relativo
    return retornoDiarioObs;
  }
  const proximoNivelCap = (niveis.find((n) => n.capitalMinimo > capital) || {}).capitalMinimo || null;

  const resultados = cenarios.map((c) => {
    const taxa = taxaCenario(c);
    const niveisTempo = niveis.filter((n) => n.capitalMinimo > capital).map((n) => {
      const dias = taxa > 0 ? Math.log(n.capitalMinimo / capital) / Math.log(1 + taxa) : null;
      return { nivel: n.levelId, capitalMinimo: n.capitalMinimo, diasEstimados: dias == null || !isFinite(dias) || dias < 0 ? null : Math.round(dias), classificacao: 'projeção (hipótese)' };
    });
    return { id: c.id, label: c.label, tipo: c.tipo, retornoDiarioPct: L.r4(taxa * 100), netCenario: c.net != null ? L.r4(c.net) : (c.mult != null ? L.r4(netObs * c.mult) : L.r4(netObs)), tempoParaNiveis: niveisTempo, nota: c.nota };
  });

  const out = {
    schema: 'snowball.growth-scenarios.v1', geradoEm: new Date(asOf || 0).toISOString(), asOfMs: asOf,
    baseObservada: {
      tipo: 'observed', capitalAtual: L.r4(capital), fundingObservado: L.r4(fund), custosObservado: L.r4(cus), netObservado: L.r4(netObs),
      epoch1: { capitalInicial: L.r4(capIniEp1), capitalFinal: L.r4(capFimEp1), dias: L.r2(diasEp1), retornoDiarioPct: L.r4(retornoDiarioObs * 100) },
      maxDrawdownPct: mdd.pct,
    },
    avisoAmostra: amostraFragil ? `AMOSTRA INSUFICIENTE: só ${L.r2(diasEp1)} dias de epoch-1. TODA projeção abaixo é HIPÓTESE frágil — não é lucro futuro garantido. Não extrapolar dias como meses.` : 'amostra ainda modesta; tratar projeções como hipóteses.',
    contribuicaoPorMotor: { 'champion-funding': L.r4(netObs), outros: 0, nota: '100% do lucro vem do funding; nenhum 2º motor comprovado contribui.' },
    dependenciaDasMelhoresOperacoes: 'ver bosses.json (concentração top-1 ~24%).',
    proximoNivelCapital: proximoNivelCap,
    legenda: { observed: 'fato medido', replay: 'reexecução determinística', simulated: 'ajuste de parâmetro sobre observado', hypothetical: 'suposição estrutural', projecao: 'extrapolação temporal (não garantida)' },
    cenarios: resultados,
    honestidade: 'Nenhum lucro futuro é garantido. Projeções de tempo-para-nível são extrapolações mecânicas do retorno diário observado (amostra de poucos dias) e servem só para ordenar cenários, não para prometer datas.',
  };
  const p = L.writeJSON('growth-scenarios.json', out);
  console.log(JSON.stringify({ saida: p, retornoDiarioObsPct: L.r4(retornoDiarioObs * 100), diasEp1: L.r2(diasEp1), amostraFragil,
    cenarios: resultados.map((r) => `${r.label}: ${r.retornoDiarioPct}%/dia`) }, null, 2));
}
build();
