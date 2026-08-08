#!/usr/bin/env node
'use strict';
/**
 * PARTE 11 — Diagnóstico dos motores atuais (momentum, pares, captura, cross-sectional)
 * a partir dos dados REAIS (read-only). NÃO afrouxa filtros nem promove nada.
 * Emite auditoria/progression/engine-diagnostics.json.
 */
const L = require('./lib-progression.cjs');
const path = require('node:path');

function build() {
  const { asOf } = L.loadChampion();
  const momentum = L.rd(path.join(L.ROOT, 'momentum', 'estado.json'), null);
  const pares = L.rd(L.P.pares, null);
  const captura = L.rd(L.P.captura, null);
  const cross = L.jsonl(L.P.crossRank);

  const diag = {
    schema: 'snowball.engine-diagnostics.v1', geradoEm: new Date(asOf || 0).toISOString(), asOfMs: asOf,
    momentum: momentum ? {
      estado: 'DATA_COLLECTION (live-paper)', capital: L.r4(momentum.capital), pnlAcumulado: L.r4(momentum.pnlAcumulado || 0),
      fechados: momentum.fechados || 0, vitorias: momentum.vitorias || 0, abertos: (momentum.posicoes || []).length, custosTotal: L.r4(momentum.custosTotal || 0), halted: !!momentum.halted,
      diagnostico: [
        `PnL inicial NEGATIVO (${L.r4(momentum.pnlAcumulado || 0)}) com amostra fechada mínima (${momentum.fechados || 0}) — inconclusivo.`,
        `${(momentum.posicoes || []).length} posições abertas vs ${momentum.fechados || 0} fechadas: quase nada realizou; sem base para julgar edge.`,
        'Não afrouxar entradas/saídas para forçar fechamentos. Acumular fechados suficientes antes de shadow verdict.',
      ],
      porQuePerdeu: 'ainda indeterminado — amostra fechada insuficiente; custos e regime a medir sobre fechados reais.',
      precisaAntesDeShadow: ['≥30 fechados', 'custos medidos sobre fechados', 'regimes distintos', 'universo/timeframe fixados'],
    } : { estado: 'RESEARCH', nota: 'sem runtime de momentum encontrado.' },
    pares: pares ? {
      estado: 'DATA_COLLECTION', capital: pares.estado ? L.r4(pares.estado.capital) : null, fechados: pares.estado ? pares.estado.fechados : 0,
      hipoteses: pares.hipoteses || [], proximoPasso: pares.proximoPasso || null,
      diagnostico: ['Nenhum par passou p-value/half-life/threshold — ausência real de sinal na janela.', 'Continuar observação em barras DIÁRIAS. NÃO afrouxar filtros para aumentar frequência.'],
    } : { estado: 'RESEARCH' },
    captura: captura ? {
      estado: 'SHADOW', totalCapturas: captura.totalCapturas, concluidas: captura.concluidas, inversoesAntesSettlement: captura.inversoesAntesSettlement,
      receitaFunding: L.r4(captura.receitaFunding), custoTotal: L.r4(captura.custoTotal), pnlLiquido: L.r4(captura.pnlLiquido), custoMedioPorCaptura: L.r4(captura.custoMedioPorCaptura),
      diagnostico: [`PnL líquido próprio positivo (+${L.r4(captura.pnlLiquido)}) mas amostra pequena (${captura.concluidas} concluídas).`, `${captura.inversoesAntesSettlement} inversões antes do settlement encarecem — monitorar.`, 'Continuar acumulando funding esperado vs assentado, inversões, custo, liquidez, tempo até settlement, PnL líquido. Não somar ao modo normal.'],
      precisaAntesDeChallenger: ['≥30 capturas concluídas', 'taxa de inversão estável', 'contribuição marginal ao portfólio (framework multi-strategy)'],
    } : { estado: 'RESEARCH' },
    crossSectional: { estado: 'DATA_COLLECTION', ranqueados: cross.length, aprovados: cross.filter((c) => c.aprovadaReal).length, diagnostico: ['0 oportunidades aprovadas (valorPorHora=0 no topo do ranking) — sem edge cross-sectional na janela.'] },
    honestidade: 'Todos os motores secundários têm amostra insuficiente ou PnL não-positivo. Nenhum está pronto para capital real. Diagnóstico é ponto de partida, não veredito.',
  };
  const p = L.writeJSON('engine-diagnostics.json', diag);
  console.log(JSON.stringify({ saida: p, momentumPnl: momentum ? L.r4(momentum.pnlAcumulado || 0) : null, capturaPnl: captura ? L.r4(captura.pnlLiquido) : null, crossAprovados: cross.filter((c) => c.aprovadaReal).length }, null, 2));
}
build();
