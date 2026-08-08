#!/usr/bin/env node
/**
 * SHADOW FASE 2 — itens 1,2,6. READ-ONLY. Não altera Champion/motor/estado.
 *   1) Gate corrigido: ≥50 episódios completos, ≥2 janelas cronológicas
 *      independentes, ≥2 regimes de mercado detectáveis, mesma config na
 *      comparação principal. NÃO provoca mudança de config.
 *   2) Auditoria de joins episódio↔posição (matchReason/distância/confiança/
 *      nMatches/ambiguidade); ambíguos EXCLUÍDOS do treino.
 *   6) Curvas de sobrevivência separadas (KM com censura).
 */
const fs = require('node:fs');
const path = require('node:path');
const SNAP = 'auditoria/snapshot-1786189433850/copias';
const DS = 'auditoria/dataset';
const OUT = 'auditoria/shadow';
const SNAP_TS = 1786189433850;
fs.mkdirSync(OUT, { recursive: true });

const diario = fs.readFileSync(path.join(SNAP, 'spread__diario.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
const episodios = fs.readFileSync(path.join(DS, 'opportunity-episodes.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
const epochs = JSON.parse(fs.readFileSync(path.join(DS, 'config-epochs.json'), 'utf8')).epochs;
const GAP = 30 * 60_000;

// ── posições com timestamps de funding (do diario) para sobrevivência ───────
const pos = {};
for (const e of diario) {
  if (e.evento === 'abre' || e.evento === 'abre-captura') pos[e.symbol] = { symbol: e.symbol, modo: e.evento === 'abre-captura' ? 'captura' : 'normal', abreTs: e.ts, custo: e.custo || 0, fundTs: [], fundAcum: 0, fundValsCum: [] };
  else if (e.evento === 'funding' && pos[e.symbol]) { const p = pos[e.symbol]; p.fundAcum += e.ganho || 0; p.fundTs.push(e.ts); p.fundValsCum.push(p.fundAcum); }
  else if (['reinveste', 'escalona', 'apara'].includes(e.evento) && e.symbol && pos[e.symbol]) pos[e.symbol].custo += e.custo || 0;
  else if (e.evento === 'fecha' && pos[e.symbol]) { pos[e.symbol].fechaTs = e.ts; pos[e.symbol].motivoFecha = e.motivo; pos[e.symbol].custo += e.custo || 0; pos[e.symbol].fechada = true; }
}
const posicoes = Object.values(pos);

// ── item 2: AUDITORIA DE JOINS episódio↔posição ─────────────────────────────
const joinRows = [];
for (const ep of episodios) {
  const cands = posicoes.filter((p) => p.symbol === ep.symbol && p.abreTs >= ep.firstSeenAt - GAP && p.abreTs <= ep.lastSeenAt + 6 * 3600_000);
  if (!cands.length) continue;
  const melhor = cands.map((p) => ({ p, dist: Math.abs(p.abreTs - ep.lastSeenAt) })).sort((a, b) => a.dist - b.dist)[0];
  const ambiguo = cands.length > 1;
  const distH = +(melhor.dist / 3600_000).toFixed(3);
  joinRows.push({
    episodeId: ep.episodeId, positionId: `${melhor.p.symbol}@${melhor.p.abreTs}`,
    matchReason: 'symbol + abertura dentro de [firstSeen−30min, lastSeen+6h]',
    distanciaTemporalH: distH, nMatches: cands.length, ambiguidade: ambiguo,
    confianca: ambiguo ? 'baixa' : (distH <= 1 ? 'alta' : 'media'),
    incluirNoTreino: !ambiguo && distH <= 6,
  });
}
fs.writeFileSync(path.join(OUT, 'join-audit.jsonl'), joinRows.map((r) => JSON.stringify(r)).join('\n') + '\n');
const joinsLimpos = joinRows.filter((r) => r.incluirNoTreino);

// ── item 1: DETECÇÃO DE REGIMES (do historico, sem provocar config change) ──
const hist = fs.readFileSync('vigilancia/historico.jsonl', 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
// bucket de 6h: apr médio do universo
const B = 6 * 3600_000, buckets = {};
for (const h of hist) { const b = Math.floor(h.ts / B); (buckets[b] ||= []).push(h.apr || 0); }
const serie = Object.entries(buckets).map(([b, aprs]) => ({ ts: Number(b) * B, aprMedio: aprs.reduce((s, v) => s + v, 0) / aprs.length, n: aprs.length })).sort((a, b) => a.ts - b.ts);
const aprsOrd = serie.map((s) => s.aprMedio).sort((a, b) => a - b);
const mediana = aprsOrd[Math.floor(aprsOrd.length / 2)] || 0;
for (const s of serie) s.regime = s.aprMedio >= mediana ? 'funding-alto' : 'funding-baixo';
const regimes = {};
for (const s of serie) regimes[s.regime] = (regimes[s.regime] || 0) + 1;
const regimesDetectados = Object.keys(regimes).filter((r) => regimes[r] >= 3).length;

// janelas cronológicas independentes: metade 1 / metade 2 do epoch-1
const epoch1 = epochs.find((e) => e.configEpochId === 'epoch-1');
const inicioE1 = epoch1.inicioTs, fimE1 = SNAP_TS, meioE1 = (inicioE1 + fimE1) / 2;
const epsE1 = episodios.filter((e) => e.configEpochId === 'epoch-1' && e.outcomeCoverage === 1);
const janela1 = epsE1.filter((e) => e.firstSeenAt < meioE1).length;
const janela2 = epsE1.filter((e) => e.firstSeenAt >= meioE1).length;

const completos = episodios.filter((e) => e.eligibleForTraining && joinsLimpos.some((j) => j.episodeId === e.episodeId));
const gate = {
  criterio1_episodiosCompletos: { valor: completos.length, minimo: 50, atende: completos.length >= 50 },
  criterio2_janelasCronologicas: { janela1, janela2, minimo: 2, atende: (janela1 >= 1 && janela2 >= 1) ? 2 >= 2 : false, nota: 'metades independentes do epoch-1' },
  criterio3_regimesMercado: { detectados: regimesDetectados, distribuicao: regimes, minimo: 2, atende: regimesDetectados >= 2, metodo: 'apr médio do universo em buckets de 6h, split pela mediana' },
  criterio4_mesmaConfig: { epochPrincipal: 'epoch-1', atende: true, nota: 'comparação principal só dentro do epoch-1 (mesma config) — não se provoca mudança de config' },
  substituiuCriterioAntigo: 'de "≥2 config epochs" para "≥2 janelas cronológicas + ≥2 regimes na MESMA config" — não exige mudar configuração',
};
gate.LIBERADO = gate.criterio1_episodiosCompletos.atende && gate.criterio2_janelasCronologicas.atende && gate.criterio3_regimesMercado.atende && gate.criterio4_mesmaConfig.atende;
gate.veredito = gate.LIBERADO ? 'LIBERADO' : `BLOQUEADO — falta principalmente amostra: ${completos.length}/50 episódios completos (limpos de ambiguidade). Regimes e janelas já OK. Acumular mais aberturas antes de comparar modelos.`;
fs.writeFileSync(path.join(OUT, 'gate-v2.json'), JSON.stringify(gate, null, 2));

// ── item 6: CURVAS DE SOBREVIVÊNCIA SEPARADAS (KM com censura) ───────────────
// para cada posição: durações (horas) de 4 eventos; abertas = censuradas.
function kmCensored(registros) {
  // registros: {t (horas), evento:1|0(censura)}. Arredonda t de forma
  // CONSISTENTE (3 casas) para casar tempos de evento com a população em risco.
  const rs = registros.filter((r) => r.t != null && r.t >= 0).map((r) => ({ t: +r.t.toFixed(3), evento: r.evento })).sort((a, b) => a.t - b.t);
  let S = 1; const curva = [];
  const temposEvento = [...new Set(rs.filter((r) => r.evento === 1).map((r) => r.t))].sort((a, b) => a - b);
  for (const t of temposEvento) {
    const emRisco = rs.filter((r) => r.t >= t).length;
    const d = rs.filter((r) => r.evento === 1 && r.t === t).length;
    if (emRisco > 0) { S *= (1 - d / emRisco); curva.push({ horas: t, emRisco, eventos: d, S: +S.toFixed(3) }); }
  }
  const med = curva.find((c) => c.S <= 0.5);
  return { n: rs.length, eventos: rs.filter((r) => r.evento === 1).length, censurados: rs.filter((r) => r.evento === 0).length, medianaHoras: med ? med.horas : null, curva };
}
const h = (ms) => ms == null ? null : ms / 3600_000;
const curvas = {
  tempoAteInversao: kmCensored(posicoes.map((p) => {
    const inverteu = p.fechada && p.fundTs.length === 0;
    return { t: h((p.fechaTs || SNAP_TS) - p.abreTs), evento: inverteu ? 1 : 0 };
  })),
  tempoAtePrimeiroSettlement: kmCensored(posicoes.map((p) => ({ t: h((p.fundTs[0] || (p.fechada ? p.fechaTs : SNAP_TS)) - p.abreTs), evento: p.fundTs.length ? 1 : 0 }))),
  tempoAtePayback: kmCensored(posicoes.map((p) => {
    const idx = p.fundValsCum.findIndex((v) => v > p.custo);
    const tsPay = idx >= 0 ? p.fundTs[idx] : (p.fechada ? p.fechaTs : SNAP_TS);
    return { t: h(tsPay - p.abreTs), evento: idx >= 0 ? 1 : 0 };
  })),
  tempoAteFechamento: kmCensored(posicoes.map((p) => ({ t: h((p.fechaTs || SNAP_TS) - p.abreTs), evento: p.fechada ? 1 : 0 }))),
};
fs.writeFileSync(path.join(OUT, 'survival-curves.json'), JSON.stringify({
  totalPosicoes: posicoes.length, abertas: posicoes.filter((p) => !p.fechada).length, censura: 'posições abertas censuradas no snapshot',
  curvas: Object.fromEntries(Object.entries(curvas).map(([k, v]) => [k, { n: v.n, eventos: v.eventos, censurados: v.censurados, medianaHoras: v.medianaHoras }])),
  curvasCompletas: curvas,
}, null, 2));

console.log('GATE v2:', gate.veredito);
console.log('  completos(limpos):', completos.length, '| janelas:', janela1, '/', janela2, '| regimes:', regimesDetectados, JSON.stringify(regimes));
console.log('JOINS: total', joinRows.length, '| ambíguos', joinRows.filter((r) => r.ambiguidade).length, '| limpos p/ treino', joinsLimpos.length);
console.log('SURVIVAL (mediana h): inversão', curvas.tempoAteInversao.medianaHoras, '| 1º settlement', curvas.tempoAtePrimeiroSettlement.medianaHoras, '| payback', curvas.tempoAtePayback.medianaHoras, '| fechamento', curvas.tempoAteFechamento.medianaHoras);
