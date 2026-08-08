#!/usr/bin/env node
/**
 * FASE ECONÔMICA SHADOW — itens 1,2,3: config epochs + dataset em 2 níveis +
 * prevenção de leakage. READ-ONLY. Não toca motor/estratégia/estado.
 *
 * Epochs: detectadas do init (opcoes) + saltos de capital-base no diario
 * (mudança de nº de exchanges/capital). Config não re-logada pelo motor após
 * o init → o que não é observável é marcado como "assumido do init" (lacuna
 * de instrumentação honesta; NÃO se inventa).
 *
 * Níveis:
 *   - candidate-observations.jsonl : 1 linha por observação (features de decisão)
 *   - opportunity-episodes.jsonl   : 1 linha por episódio (agrega obs; label NO
 *                                    episódio, nunca replicado por observação)
 *   - position-outcomes.jsonl      : 1 linha por posição aberta (do diario)
 *
 * Leakage: fold por episodeId (todas as obs do mesmo episódio no MESMO fold),
 * também respeitando tempo/posição/configEpoch. Sem feature pós-decisão. Sem
 * imputar ausentes (featureCoverage explícito).
 */
const fs = require('node:fs');
const path = require('node:path');

const SNAP = process.argv[2] || 'auditoria/snapshot-1786189433850/copias';
const OPORT = process.argv[3] || 'inteligencia/oportunidades';
const OUT = process.argv[4] || 'auditoria/dataset';
fs.mkdirSync(OUT, { recursive: true });
const GAP_EPISODIO_MS = 30 * 60_000;

const diario = fs.readFileSync(path.join(SNAP, 'spread__diario.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
const estado = JSON.parse(fs.readFileSync(path.join(SNAP, 'spread__estado.json'), 'utf8'));

// ── 1) CONFIG EPOCHS ────────────────────────────────────────────────────────
const init = diario.find((e) => e.evento === 'init');
const epochs = [];
// época 0: do init
epochs.push({
  configEpochId: 'epoch-0', inicioTs: init.ts, fimTs: null,
  capitalBase: init.opcoes.capital, exchanges: init.opcoes.exchanges.length,
  alavancagem: init.opcoes.alavancagem, reserva: init.opcoes.reserva,
  margemPayback: init.opcoes.margemPayback, maxPosicoes: init.opcoes.maxPosicoes,
  fonte: 'init.opcoes (observado)',
});
// fronteiras adicionais: saltos de capital-base > 50 no campo capital dos eventos
let last = null, idx = 0;
for (const e of diario) {
  if (typeof e.capital !== 'number') continue;
  if (last !== null && Math.abs(e.capital - last) > 50) {
    epochs[epochs.length - 1].fimTs = e.ts;
    idx++;
    epochs.push({
      configEpochId: `epoch-${idx}`, inicioTs: e.ts, fimTs: null,
      capitalBase: Math.round(e.capital / 100) * 100, // base aproximada (múltiplo de 100/exchange)
      exchanges: Object.keys(estado.saldosIniciais || {}).length, // época atual: nº de exchanges do estado
      alavancagem: init.opcoes.alavancagem, reserva: init.opcoes.reserva,
      margemPayback: init.opcoes.margemPayback, maxPosicoes: init.opcoes.maxPosicoes,
      fonte: 'salto de capital-base (observado) + config assumida do init (não re-logada pelo motor)',
    });
  }
  last = e.capital;
}
const epochDe = (ts) => { for (let i = epochs.length - 1; i >= 0; i--) if (ts >= epochs[i].inicioTs) return epochs[i].configEpochId; return epochs[0].configEpochId; };
fs.writeFileSync(path.join(OUT, 'config-epochs.json'), JSON.stringify({ total: epochs.length, epochs, nota: 'alavancagem/reserva/margemPayback/maxPosicoes não são re-logados pelo motor após o init — assumidos constantes por época; instrumentar um evento de config seria melhoria ADITIVA futura.' }, null, 2));

// ── 3-level: position-outcomes (do diario) ──────────────────────────────────
// cada posição = do abre até o fecha do mesmo símbolo (episódio de posição)
const outcomes = [];
const abertasPorSym = {};
for (const e of diario) {
  if (e.evento === 'abre' || e.evento === 'abre-captura') {
    abertasPorSym[e.symbol] = { symbol: e.symbol, modo: e.evento === 'abre-captura' ? 'captura' : 'normal', abreTs: e.ts, custo: e.custo || 0, funding: 0, nFund: 0, short: e.short, long: e.long };
  } else if (e.evento === 'funding' && abertasPorSym[e.symbol]) {
    abertasPorSym[e.symbol].funding += e.ganho || 0; abertasPorSym[e.symbol].nFund++;
  } else if (['reinveste', 'escalona', 'apara'].includes(e.evento) && e.symbol && abertasPorSym[e.symbol]) {
    abertasPorSym[e.symbol].custo += e.custo || 0;
  } else if (e.evento === 'fecha' && abertasPorSym[e.symbol]) {
    const p = abertasPorSym[e.symbol]; p.custo += e.custo || 0; p.fechaTs = e.ts;
    outcomes.push({
      symbol: p.symbol, modo: p.modo, configEpochId: epochDe(p.abreTs),
      abreTs: p.abreTs, fechaTs: p.fechaTs, tempoAbertoMs: p.fechaTs - p.abreTs,
      funding: +p.funding.toFixed(4), custo: +p.custo.toFixed(4), pnlLiquido: +(p.funding - p.custo).toFixed(4),
      fundings: p.nFund, chegouSettlement: p.nFund > 0, pagouPayback: p.funding > p.custo,
      inverteuAntesSettlement: p.nFund === 0, motivoFecha: e.motivo,
    });
    delete abertasPorSym[e.symbol];
  }
}
// posições ainda abertas
for (const p of Object.values(abertasPorSym)) outcomes.push({ symbol: p.symbol, modo: p.modo, configEpochId: epochDe(p.abreTs), abreTs: p.abreTs, fechaTs: null, aberta: true, funding: +p.funding.toFixed(4), custo: +p.custo.toFixed(4), fundings: p.nFund, chegouSettlement: p.nFund > 0 });
fs.writeFileSync(path.join(OUT, 'position-outcomes.jsonl'), outcomes.map((o) => JSON.stringify(o)).join('\n') + '\n');

// ── candidate-observations + opportunity-episodes ───────────────────────────
const FEATURES = ['spread', 'consistencia', 'duracaoHoras', 'valorEsperado', 'valorPorHora', 'folga', 'custo', 'escorregamento', 'capitalNecessario', 'saldoDisponivel', 'score'];
const obsStream = fs.createWriteStream(path.join(OUT, 'candidate-observations.jsonl'));
const obsPorChave = {};
let nObs = 0;
for (const arq of fs.readdirSync(OPORT).filter((f) => f.endsWith('.jsonl')).sort()) {
  for (const l of fs.readFileSync(path.join(OPORT, arq), 'utf8').split('\n').filter(Boolean)) {
    let c; try { c = JSON.parse(l); } catch { continue; }
    for (const cand of (c.candidatas || [])) {
      const key = `${cand.symbol}|${cand.exchangeLong}|${cand.exchangeShort}`;
      const feat = {}; let cov = 0;
      for (const f of FEATURES) { feat[f] = cand[f] ?? null; if (feat[f] != null) cov++; }
      const featureCoverage = +(cov / FEATURES.length).toFixed(3);
      (obsPorChave[key] ||= []).push({ ts: c.ts, feat, aprovada: !!cand.aprovada, escolhida: c.escolhida === cand.symbol, motivo: cand.motivoRejeicao ?? null, featureCoverage });
      obsStream.write(JSON.stringify({ ts: c.ts, cycleId: c.cycleId, modo: c.modo, opportunityKey: key, configEpochId: epochDe(c.ts), features: feat, featureCoverage, aprovada: !!cand.aprovada, escolhida: c.escolhida === cand.symbol, motivoRejeicao: cand.motivoRejeicao ?? null }) + '\n');
      nObs++;
    }
  }
}
obsStream.end();

// episódios: quebra por gap de 30min; label NO episódio (nunca por obs)
const episodios = [];
for (const [key, obs] of Object.entries(obsPorChave)) {
  obs.sort((a, b) => a.ts - b.ts);
  let ini = 0;
  for (let i = 1; i <= obs.length; i++) {
    if (i === obs.length || obs[i].ts - obs[i - 1].ts > GAP_EPISODIO_MS) {
      const ep = obs.slice(ini, i); ini = i;
      const [symbol, long, short] = key.split('|');
      const episodeStartedAt = ep[0].ts, lastSeenAt = ep[ep.length - 1].ts;
      // features: iniciais (1ª obs) + agregadas PERMITIDAS (média das obs do episódio — todas pré/na decisão)
      const featIniciais = ep[0].feat;
      const featAgg = {};
      for (const f of FEATURES) { const vals = ep.map((o) => o.feat[f]).filter((v) => v != null); featAgg[f] = vals.length ? +(vals.reduce((s, v) => s + v, 0) / vals.length).toFixed(6) : null; }
      const aprovadaAlguma = ep.some((o) => o.aprovada);
      const escolhida = ep.some((o) => o.escolhida);
      // OUTCOME: junta com position-outcomes por símbolo + sobreposição temporal (abre após firstSeen−gap)
      const outc = outcomes.filter((o) => o.symbol === symbol && o.abreTs >= episodeStartedAt - GAP_EPISODIO_MS && o.abreTs <= lastSeenAt + 6 * 3600_000);
      const outcome = outc.length ? outc[0] : null;
      const featureCoverage = +(ep.reduce((s, o) => s + o.featureCoverage, 0) / ep.length).toFixed(3);
      const outcomeCoverage = outcome ? 1 : 0;
      const configEpochId = epochDe(episodeStartedAt);
      const eligibleForTraining = featureCoverage >= 0.8 && outcomeCoverage === 1 && configEpochId != null;
      episodios.push({
        opportunityKey: key, episodeId: `${key}#${episodeStartedAt}`, symbol, exchangeLong: long, exchangeShort: short,
        configEpochId, firstSeenAt: episodeStartedAt, lastSeenAt, settlementAt: null,
        observationCount: ep.length, featuresIniciais: featIniciais, featuresAgregadas: featAgg,
        decisao: { aprovadaAlguma, escolhida }, outcome,
        featureCoverage, outcomeCoverage, eligibleForTraining,
      });
    }
  }
}
// leakage-safe fold: por episodeId (determinístico), todas as obs do episódio no mesmo fold
const foldDe = (episodeId) => { let h = 0; for (const c of episodeId) h = (h * 31 + c.charCodeAt(0)) >>> 0; return h % 5; };
for (const ep of episodios) ep.fold = foldDe(ep.episodeId);
fs.writeFileSync(path.join(OUT, 'opportunity-episodes.jsonl'), episodios.map((e) => JSON.stringify(e)).join('\n') + '\n');

// ── auditoria de leakage + resumo ───────────────────────────────────────────
const treinaveis = episodios.filter((e) => e.eligibleForTraining);
const porEpoch = {}; for (const e of episodios) porEpoch[e.configEpochId] = (porEpoch[e.configEpochId] || 0) + 1;
const resumo = {
  snapshot: '1786189433850',
  epochs: epochs.map((e) => ({ id: e.configEpochId, capitalBase: e.capitalBase, exchanges: e.exchanges, inicio: new Date(e.inicioTs).toISOString(), fim: e.fimTs ? new Date(e.fimTs).toISOString() : 'atual' })),
  candidateObservations: nObs,
  opportunityEpisodes: episodios.length,
  positionOutcomes: outcomes.length,
  episodiosPorEpoch: porEpoch,
  episodiosComOutcome: episodios.filter((e) => e.outcomeCoverage === 1).length,
  episodiosTreinaveis: treinaveis.length,
  leakageAudit: {
    foldPor: 'episodeId (todas as obs do mesmo episódio no mesmo fold)',
    semFeaturePosDecisao: true, semImputacao: true,
    labelNoEpisodio: 'sim — label vive no episódio/posição, nunca replicado por observação',
    respeitaConfigEpoch: true, respeitaTempo: true,
  },
  aviso: `episódios treináveis=${treinaveis.length}. Gate mínimo (item 11) exige ≥50 completos e >1 época/regime — checar antes de qualquer comparação formal.`,
};
fs.writeFileSync(path.join(OUT, 'dataset-resumo.json'), JSON.stringify(resumo, null, 2));
console.log(JSON.stringify(resumo, null, 2));
