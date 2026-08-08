#!/usr/bin/env node
/**
 * BUILDER DE DATASET ML — READ-ONLY, ADITIVO, SEM LOOKAHEAD (item 18 da auditoria).
 *
 * NÃO toca motor, estratégia, capital ou execução. Só LÊ a fonte já persistida
 * (inteligencia/oportunidades/*.jsonl com todas as candidatas por ciclo, e
 * spread/diario.jsonl com os resultados) e produz um dataset append-only
 * rotulado para modelagem em SHADOW.
 *
 * Regras:
 *   - features vêm SÓ do instante da decisão (nada do futuro entra como feature);
 *   - labels de outcome são anexados SEPARADAMENTE e marcados, nunca realimentados;
 *   - candidatas rejeitadas ficam com outcome "nao_tomada" (lacuna contrafactual
 *     que o logger de decisões futuras preencherá — não se inventa resultado).
 *
 * Uso: node scripts/auditoria/build-ml-dataset.js [oportDir] [diario] [outDir]
 */
const fs = require('node:fs');
const path = require('node:path');

const OPORT_DIR = process.argv[2] || 'inteligencia/oportunidades';
const DIARIO = process.argv[3] || 'spread/diario.jsonl';
const OUT_DIR = process.argv[4] || 'auditoria/ml';
fs.mkdirSync(OUT_DIR, { recursive: true });

// ── outcomes por símbolo (a partir do diario) — labels, nunca features ──────
const ev = fs.readFileSync(DIARIO, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
const outcomePorSimbolo = {};
const g = (s) => (outcomePorSimbolo[s] ||= { funding: 0, nFund: 0, custo: 0, abriu: false, fechou: false, inverteu: false, aberturas: 0, tsAbre: null, tsFecha: null });
for (const e of ev) {
  if (e.evento === 'abre' || e.evento === 'abre-captura') { const o = g(e.symbol); o.abriu = true; o.aberturas++; o.custo += e.custo || 0; o.tsAbre ??= e.ts; }
  if (e.evento === 'funding') { const o = g(e.symbol); o.funding += e.ganho || 0; o.nFund++; }
  if (['reinveste', 'escalona', 'apara'].includes(e.evento) && e.symbol) g(e.symbol).custo += e.custo || 0;
  if (e.evento === 'fecha') { const o = g(e.symbol); o.fechou = true; o.custo += e.custo || 0; o.tsFecha = e.ts; if (/invertid/i.test(e.motivo || '')) o.inverteu = true; }
}
// deriva labels honestos
const labelDe = (sym) => {
  const o = outcomePorSimbolo[sym];
  if (!o || !o.abriu) return { outcome: 'nao_tomada' };
  const pnlLiquido = +(o.funding - o.custo).toFixed(4);
  return {
    outcome: 'tomada',
    chegouSettlement: o.nFund > 0,             // recebeu ao menos 1 funding
    pagouPayback: o.funding > o.custo,          // funding cobriu o custo
    inverteuAntesDeSettlement: o.nFund === 0 && o.fechou, // fechou sem nenhum funding
    pnlLiquido, funding: +o.funding.toFixed(4), custo: +o.custo.toFixed(4),
    fundings: o.nFund, aberturas: o.aberturas,
    tempoAbertoMs: o.tsAbre && o.tsFecha ? o.tsFecha - o.tsAbre : null,
  };
};

// ── features de decisão (a partir das candidatas) ───────────────────────────
const FEATURES = ['spread', 'consistencia', 'duracaoHoras', 'valorEsperado', 'valorPorHora',
  'folga', 'custo', 'escorregamento', 'escorregamentoMedido', 'capitalNecessario', 'saldoDisponivel', 'score'];

const outStream = fs.createWriteStream(path.join(OUT_DIR, 'dataset-candidatas.jsonl'));
let total = 0, tomadas = 0, pagaram = 0, inverteram = 0;
const arquivos = fs.readdirSync(OPORT_DIR).filter((f) => f.endsWith('.jsonl')).sort();
for (const arq of arquivos) {
  const lines = fs.readFileSync(path.join(OPORT_DIR, arq), 'utf8').split('\n').filter(Boolean);
  for (const l of lines) {
    let c; try { c = JSON.parse(l); } catch { continue; }
    for (const cand of (c.candidatas || [])) {
      const key = `${cand.symbol}|${cand.exchangeLong}|${cand.exchangeShort}`;
      const feat = {}; for (const f of FEATURES) feat[f] = cand[f] ?? null;
      const lbl = labelDe(cand.symbol);
      const row = {
        // identidade + tempo da DECISÃO (nunca do futuro)
        ts: c.ts, cycleId: c.cycleId, modo: c.modo, opportunityKey: key,
        symbol: cand.symbol, exchangeLong: cand.exchangeLong, exchangeShort: cand.exchangeShort,
        // features de decisão
        features: feat,
        aprovada: !!cand.aprovada, motivoRejeicao: cand.motivoRejeicao ?? null,
        escolhida: c.escolhida === cand.symbol || (Array.isArray(c.aprovadasNaoEscolhidas) ? false : undefined),
        // LABEL (outcome) — anexado, marcado, nunca realimentado como feature
        label: lbl,
      };
      outStream.write(JSON.stringify(row) + '\n');
      total++;
      if (lbl.outcome === 'tomada') { tomadas++; if (lbl.pagouPayback) pagaram++; if (lbl.inverteuAntesDeSettlement) inverteram++; }
    }
  }
}
outStream.end();

const resumo = {
  geradoEm: new Date(Number(process.env.SNAPSHOT_MS || 1786189433850)).toISOString(),
  snapshot: '1786189433850',
  fonte: { oportunidades: OPORT_DIR, diario: DIARIO },
  totalLinhas: total,
  observacoesTomadas: tomadas,
  simbolosComOutcome: Object.keys(outcomePorSimbolo).filter((s) => outcomePorSimbolo[s].abriu).length,
  pagaramPayback: pagaram, inverteramAntesSettlement: inverteram,
  features: FEATURES,
  labels: ['outcome', 'chegouSettlement', 'pagouPayback', 'inverteuAntesDeSettlement', 'pnlLiquido', 'tempoAbertoMs'],
  aviso: 'Amostra de OUTCOMES é pequena (poucas aberturas). Suficiente para baseline/EDA, NÃO para treinar/validar modelo sem overfit. Rejeitadas = nao_tomada (lacuna contrafactual honesta).',
  semLookahead: 'features vêm só do ts da decisão; labels são outcomes posteriores anexados e nunca usados como feature.',
};
fs.writeFileSync(path.join(OUT_DIR, 'dataset-resumo.json'), JSON.stringify(resumo, null, 2));
console.log(JSON.stringify(resumo, null, 2));
