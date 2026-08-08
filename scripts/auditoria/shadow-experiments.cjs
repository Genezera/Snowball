#!/usr/bin/env node
/**
 * FASE ECONÔMICA SHADOW — itens 4-9. READ-ONLY. Nada aqui fecha posição,
 * envia ordem, altera proteção, capital, risco ou o Champion. Só LÊ o snapshot
 * congelado e registra o que FARIA (shadow), para comparar depois com o real.
 */
const fs = require('node:fs');
const path = require('node:path');
const SNAP = process.argv[2] || 'auditoria/snapshot-1786189433850/copias';
const OPORT = process.argv[3] || 'inteligencia/oportunidades';
const OUT = 'auditoria/shadow';
fs.mkdirSync(OUT, { recursive: true });
const diario = fs.readFileSync(path.join(SNAP, 'spread__diario.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));

// ── ITEM 5: BATCH REBALANCING REPLAY ────────────────────────────────────────
// Eventos de rebalance com custo: escalona (+notional), apara (−notional),
// reinveste (+notional pequeno). Batching coalesce eventos do MESMO símbolo
// dentro de uma janela; adds e trims que se cancelam economizam custo. Taxa
// implícita por evento = custo/|Δnotional|. NÃO toca proteção (socorre fica de fora).
const rebal = diario.filter((e) => ['escalona', 'apara', 'reinveste'].includes(e.evento) && e.custo != null);
function deltaNotional(e) {
  if (e.evento === 'escalona') return +(e.notionalAdicionado || 0);
  if (e.evento === 'reinveste') return +(e.notionalExtra || 0);
  if (e.evento === 'apara') return -Math.abs((e.margemAntes || 0) - (e.margemAlvo || 0)); // trim aproximado
  return 0;
}
function replayBatch(janelaMs) {
  // agrupa por símbolo; coalesce eventos consecutivos dentro da janela pelo Δ NET
  const porSym = {};
  for (const e of rebal) (porSym[e.symbol || '?'] ||= []).push(e);
  let custoBatch = 0, opsBatch = 0, opsOrig = 0;
  for (const evs of Object.values(porSym)) {
    evs.sort((a, b) => a.ts - b.ts);
    let i = 0;
    while (i < evs.length) {
      let j = i, deltaNet = 0, taxaMedia = 0, nTaxa = 0;
      while (j < evs.length && evs[j].ts - evs[i].ts <= janelaMs) {
        const d = deltaNotional(evs[j]); deltaNet += d;
        const t = Math.abs(d) > 0 ? evs[j].custo / Math.abs(d) : 0; if (t > 0) { taxaMedia += t; nTaxa++; }
        j++;
      }
      taxaMedia = nTaxa ? taxaMedia / nTaxa : 0;
      custoBatch += Math.abs(deltaNet) * taxaMedia;  // custo do Δ NET coalescido
      opsBatch += 1; opsOrig += (j - i);
      i = j;
    }
  }
  return { custoBatch: +custoBatch.toFixed(4), opsBatch, opsOrig };
}
const custoControle = +rebal.reduce((s, e) => s + e.custo, 0).toFixed(4);
const politicas = { 'controle': { custo: custoControle, ops: rebal.length } };
for (const [nome, ms] of [['batch-15min', 15 * 60_000], ['batch-30min', 30 * 60_000], ['batch-60min', 60 * 60_000]]) {
  const r = replayBatch(ms);
  politicas[nome] = { custo: r.custoBatch, ops: r.opsBatch, economiaVsControle: +(custoControle - r.custoBatch).toFixed(4), economiaPct: +(100 * (custoControle - r.custoBatch) / custoControle).toFixed(1) };
}
fs.writeFileSync(path.join(OUT, 'batch-replay.json'), JSON.stringify({
  eventosRebalance: rebal.length, custoRebalanceTotal: custoControle,
  politicas,
  metricasNaoInstrumentadas: ['exposicao', 'distanciaLiquidacao', 'desbalanceamento', 'capitalHoras'],
  nota: 'Modelo shadow: taxa implícita por evento × Δ NET coalescido. Economia vem de coalescer adds/trims que se cancelam dentro da janela. Proteção (socorre) NÃO entra no batching. Exposição/dist-liquidação/capital-horas não estão instrumentadas por evento de rebalance no diario — marcadas como não medidas (não fabricadas).',
}, null, 2));

// ── ITEM 7: CAPTURE ACCOUNTING (separação completa) ─────────────────────────
const capAbre = diario.filter((e) => e.evento === 'abre-captura');
const capSyms = new Set(capAbre.map((e) => e.symbol));
// reconstrói cada captura: abre-captura → funding(s) do símbolo → fecha
const capturas = [];
for (const a of capAbre) {
  const fech = diario.find((e) => e.evento === 'fecha' && e.symbol === a.symbol && e.ts > a.ts);
  const fundings = diario.filter((e) => e.evento === 'funding' && e.symbol === a.symbol && e.ts >= a.ts && (!fech || e.ts <= fech.ts));
  const receita = fundings.reduce((s, f) => s + (f.ganho || 0), 0);
  const custo = (a.custo || 0) + (fech ? (fech.custo || 0) : 0);
  capturas.push({
    symbol: a.symbol, abreTs: a.ts, fechaTs: fech ? fech.ts : null,
    intervaloHoras: a.intervaloHoras, liquidacaoAlvo: a.liquidacaoAlvo, faltamMin: a.faltamMin,
    escorregamento: a.escorregamento, escorregamentoMedido: a.escorregamentoMedido,
    receitaFunding: +receita.toFixed(4), custo: +custo.toFixed(4), pnlLiquido: +(receita - custo).toFixed(4),
    fundings: fundings.length, chegouSettlement: fundings.length > 0,
    inverteuAntesSettlement: fundings.length === 0, tempoExposicaoMs: fech ? fech.ts - a.ts : null,
    motivoFecha: fech ? fech.motivo : null,
  });
}
const capReceita = capturas.reduce((s, c) => s + c.receitaFunding, 0);
const capCusto = capturas.reduce((s, c) => s + c.custo, 0);
fs.writeFileSync(path.join(OUT, 'capture-accounting.json'), JSON.stringify({
  totalCapturas: capturas.length, simbolos: [...capSyms],
  receitaFunding: +capReceita.toFixed(4), custoTotal: +capCusto.toFixed(4), pnlLiquido: +(capReceita - capCusto).toFixed(4),
  concluidas: capturas.filter((c) => c.chegouSettlement).length,
  inversoesAntesSettlement: capturas.filter((c) => c.inverteuAntesSettlement).length,
  custoMedioPorCaptura: +(capCusto / capturas.length).toFixed(4),
  capturas,
  nota: 'Captura decomposta e NÃO somada ao modo normal. PnL líquido da captura é próprio. Contribuição marginal ao portfólio exige o framework multi-strategy (fase futura).',
}, null, 2));

// ── ITEM 8: FUNDING CROSS-SECTIONAL SHADOW (ranking determinístico) ─────────
// usa o último ciclo de oportunidades: ranqueia TODO o universo por um score
// determinístico (valorPorHora líquido, persistência, payback), só registra.
const arqs = fs.readdirSync(OPORT).filter((f) => f.endsWith('.jsonl')).sort();
const ultimoArq = arqs[arqs.length - 1];
const ciclos = fs.readFileSync(path.join(OPORT, ultimoArq), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
const ultimoCiclo = ciclos[ciclos.length - 1];
const universo = (ultimoCiclo.candidatas || []).map((c) => ({
  symbol: c.symbol, exchangeLong: c.exchangeLong, exchangeShort: c.exchangeShort,
  valorPorHora: c.valorPorHora, folgaPayback: c.folga, persistencia: c.consistencia, custo: c.custo,
  scoreDeterministico: +(((c.valorPorHora || 0) * Math.max(0, c.folga || 0) * (c.consistencia || 0))).toFixed(6),
  aprovadaReal: !!c.aprovada,
}));
universo.sort((a, b) => b.scoreDeterministico - a.scoreDeterministico);
const top = universo.slice(0, 20).map((u, i) => ({ rank: i + 1, ...u }));
fs.writeFileSync(path.join(OUT, 'cross-sectional-ranking.jsonl'),
  top.map((t) => JSON.stringify(t)).join('\n') + '\n');
const escolhaShadow = top[0];

// ── ITEM 6: SWITCH VALUE OBSERVER (shadow, nunca fecha) ─────────────────────
// para cada rejeição por saldo_insuficiente no último ciclo, identifica que há
// posições ocupando capital e registra a recomendação shadow de EV (dados
// instrumentados de EV de manter/trocar são parciais → registra o que dá, marca lacuna).
const bloqueadasPorSaldo = (ultimoCiclo.candidatas || []).filter((c) => !c.aprovada && /saldo_insuficiente/.test(c.motivoRejeicao || ''));
const swObs = bloqueadasPorSaldo.slice(0, 30).map((c) => ({
  ts: ultimoCiclo.ts, oportunidadeBloqueada: `${c.symbol}|${c.exchangeLong}|${c.exchangeShort}`,
  valorPorHoraBloqueada: c.valorPorHora, folgaBloqueada: c.folga, capitalNecessario: c.capitalNecessario, saldoDisponivel: c.saldoDisponivel,
  evTrocaInstrumentado: false,
  motivoLacuna: 'EV de manter a posição fraca vs EV líquido da troca (fechar+abrir+slippage) exige o estado de posições no MESMO instante do ciclo — não co-registrado no oportunidades.jsonl. O observer real deve rodar dentro do ciclo (aditivo) para capturar ambos. Aqui só registro a oportunidade bloqueada e o gap.',
  recomendacaoShadow: 'PENDENTE_INSTRUMENTACAO', // nunca fecha nada
}));
fs.writeFileSync(path.join(OUT, 'switch-value-observer.jsonl'), swObs.map((s) => JSON.stringify(s)).join('\n') + '\n');

// ── ITEM 9: DIAGNÓSTICO DE PARES ────────────────────────────────────────────
const paresEstado = JSON.parse(fs.readFileSync(path.join(SNAP, 'pares__estado.json'), 'utf8'));
const paresDiario = fs.readFileSync(path.join(SNAP, 'pares__diario.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
fs.writeFileSync(path.join(OUT, 'pares-diagnostico.json'), JSON.stringify({
  estado: { capital: paresEstado.capital, capitalInicial: paresEstado.capitalInicial, fechados: paresEstado.fechados, pnlAcumulado: paresEstado.pnlAcumulado, ultimaCalibracao: paresEstado.ultimaCalibracao ? new Date(paresEstado.ultimaCalibracao).toISOString() : null, ultimoCiclo: paresEstado.ultimoCicloTs ? new Date(paresEstado.ultimoCicloTs).toISOString() : null },
  diarioLinhas: paresDiario.length,
  eventos: paresDiario.map((e) => e.evento || Object.keys(e).join(',')),
  chavesEstado: Object.keys(paresEstado),
  hipoteses: [
    'ausência real de sinal (nenhum par passou p-value/half-life/threshold na janela)',
    'calibração recente sem cointegração aprovada (ultimaCalibracao vs ultimoCiclo)',
    'universo/filtros restritivos demais',
    'custos acima do edge esperado dos pares',
  ],
  proximoPasso: 'Ler pares/live.log e o critério de calibração (read-only) para distinguir "sem sinal" de "filtro apertado". NÃO afrouxar filtros antes do diagnóstico.',
  nota: 'Pares NÃO operou (0 fechados, pnl 0). Diagnóstico observacional; nenhuma alteração de filtro/capital.',
}, null, 2));

console.log('BATCH REPLAY:', JSON.stringify(politicas));
console.log('CAPTURE: receita', capReceita.toFixed(3), 'custo', capCusto.toFixed(3), 'pnl', (capReceita - capCusto).toFixed(3), '| capturas', capturas.length, '| inversões', capturas.filter((c) => c.inverteuAntesSettlement).length);
console.log('CROSS-SECTIONAL top1 shadow:', escolhaShadow ? escolhaShadow.symbol + ' score ' + escolhaShadow.scoreDeterministico : 'n/a', '| universo', universo.length);
console.log('SWITCH-VALUE: bloqueadas por saldo no último ciclo:', bloqueadasPorSaldo.length, '(EV de troca não instrumentado — gap registrado)');
console.log('PARES: 0 operações — diagnóstico observacional gravado');
