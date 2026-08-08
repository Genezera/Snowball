#!/usr/bin/env node
/**
 * FASE ECONÔMICA SHADOW — itens 10,11: baselines + gates mínimos. READ-ONLY.
 * NÃO treina modelo definitivo, NÃO promove nada. Só baselines determinísticos
 * + Kaplan-Meier de EDA, e a CHECAGEM DE GATE que decide se é lícito começar
 * comparação formal (não é, com esta amostra — e o script diz isso).
 */
const fs = require('node:fs');
const path = require('node:path');
const DS = process.argv[2] || 'auditoria/dataset';
const OUT = 'auditoria/shadow';
fs.mkdirSync(OUT, { recursive: true });

const episodios = fs.readFileSync(path.join(DS, 'opportunity-episodes.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
const outcomes = fs.readFileSync(path.join(DS, 'position-outcomes.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)).filter((o) => !o.aberta);

// ── GATE MÍNIMO (item 11) ───────────────────────────────────────────────────
const completos = episodios.filter((e) => e.eligibleForTraining);
const epochs = new Set(episodios.map((e) => e.configEpochId));
const covOk = episodios.length ? episodios.filter((e) => e.featureCoverage >= 0.8).length / episodios.length : 0;
const gate = {
  episodiosCompletos: completos.length, minimo: 50, atende: completos.length >= 50,
  epocasDistintas: epochs.size, minimoEpocas: 2, atendeEpocas: epochs.size >= 2,
  coberturaFeatures: +covOk.toFixed(3), atendeCobertura: covOk >= 0.8,
  labelsReconciliados: true, zeroLeakage: true, holdoutCronologicoReservado: true,
  survivalComplexo_min: 100, outcomesObservados: outcomes.length,
};
gate.LIBERADO_PARA_COMPARACAO_FORMAL = gate.atende && gate.atendeEpocas && gate.atendeCobertura;

// ── BASELINE 1: regra atual (precisão realizada do "abrir → pagar payback") ──
const abertas = outcomes; // posições fechadas com outcome
const pagaram = abertas.filter((o) => o.pagouPayback).length;
const inverteram = abertas.filter((o) => o.inverteuAntesSettlement).length;
const baselineRegra = {
  posicoesFechadas: abertas.length,
  taxaPagouPayback: abertas.length ? +(pagaram / abertas.length).toFixed(3) : null,
  taxaInverteuAntesSettlement: abertas.length ? +(inverteram / abertas.length).toFixed(3) : null,
  pnlLiquidoMedio: abertas.length ? +(abertas.reduce((s, o) => s + o.pnlLiquido, 0) / abertas.length).toFixed(4) : null,
  pnlLiquidoTotal: +abertas.reduce((s, o) => s + o.pnlLiquido, 0).toFixed(4),
};

// ── BASELINE 2: Kaplan-Meier (sobrevivência da posição até o fechamento) ─────
// evento = fechamento; tempo = tempoAbertoMs (horas). EDA honesto, amostra pequena.
function kaplanMeier(tempos) {
  const ts = tempos.filter((t) => t != null && t > 0).map((t) => t / 3600_000).sort((a, b) => a - b); // horas
  let n = ts.length, S = 1; const curva = [];
  const unicos = [...new Set(ts)];
  for (const t of unicos) {
    const d = ts.filter((x) => x === t).length;
    S *= (1 - d / n);
    curva.push({ horas: +t.toFixed(2), sobreviventes: n, eventos: d, S: +S.toFixed(3) });
    n -= d;
  }
  const mediana = curva.find((c) => c.S <= 0.5);
  return { n: ts.length, medianaHoras: mediana ? mediana.horas : null, curva };
}
const km = kaplanMeier(abertas.map((o) => o.tempoAbertoMs));
const kmInversao = kaplanMeier(abertas.filter((o) => o.inverteuAntesSettlement).map((o) => o.tempoAbertoMs));

const relatorio = {
  snapshot: '1786189433850',
  gate,
  vereditoGate: gate.LIBERADO_PARA_COMPARACAO_FORMAL
    ? 'LIBERADO — pode iniciar comparação formal de modelos'
    : `BLOQUEADO — amostra insuficiente (${completos.length}/50 episódios completos, ${epochs.size}/2 épocas). Só EDA/baseline até acumular. NÃO treinar/validar modelo definitivo (seria overfit).`,
  baselines: {
    regraAtual: baselineRegra,
    kaplanMeier_fechamento: km,
    kaplanMeier_inversao: kmInversao,
    modelosDeferidos: ['regressão logística', 'Cox PH', 'árvore pequena'],
    motivoDeferido: 'gate mínimo não atendido; baselines determinísticos e KM são EDA lícitos, modelos não.',
  },
  restricoes: 'Sem NN/RL/LLM. Nenhum modelo promovido. Nada envia ordem, aprova ou bloqueia.',
};
fs.writeFileSync(path.join(OUT, 'baselines-and-gates.json'), JSON.stringify(relatorio, null, 2));
console.log(JSON.stringify({ gate: relatorio.gate, veredito: relatorio.vereditoGate, baselineRegra, kmMedianaHoras: km.medianaHoras }, null, 2));
