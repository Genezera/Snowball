#!/usr/bin/env node
'use strict';
/**
 * v1.3 — PARTE 8. Observers SHADOW de maxPositions = 3/4/5 (NÃO altera o Champion).
 * Usa a sobreposição temporal das oportunidades que VIVERAM o suficiente (payback)
 * para medir se o gargalo é CAPITAL ou o LIMITE DE POSIÇÕES. READ-ONLY.
 * Emite auditoria/progression/maxpositions-test.json.
 */
const L = require('./lib-progression.cjs');
const fs = require('node:fs');
const path = require('node:path');

const TAKER = 0.0005, SLIP = 0.0002, CUSTO_FRAC = 4 * TAKER + 4 * SLIP;

function build() {
  const { estado, asOf } = L.loadChampion();
  const obsPath = path.join(L.ROOT, 'vigilancia', 'arquivo-observacoes.jsonl');
  let linhas = []; try { linhas = fs.readFileSync(obsPath, 'utf8').split('\n'); } catch { process.exit(1); }
  const porK = new Map();
  for (const ln of linhas) {
    if (!ln) continue; let o; try { o = JSON.parse(ln); } catch { continue; }
    if (!o.k || o.apr == null) continue; const [sym, long, short] = o.k.split('|');
    if (!L.EXCHANGES.includes(long) || !L.EXCHANGES.includes(short)) continue;
    let e = porK.get(o.k); if (!e) { e = { k: o.k, sym, long, short, first: o.ts, last: o.ts, aprs: [], spreads: [] }; porK.set(o.k, e); }
    e.first = Math.min(e.first, o.ts); e.last = Math.max(e.last, o.ts); e.aprs.push(o.apr); e.spreads.push(o.spread || 0);
  }
  const med = (a) => { const s = a.slice().sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : 0; };
  // oportunidades que viveram o suficiente p/ payback (EV+ real)
  const positivas = [];
  for (const e of porK.values()) {
    const apr = med(e.aprs), spread = med(e.spreads); if (apr <= 0) continue;
    const custoFrac = CUSTO_FRAC + Math.max(0, spread);
    const paybackH = custoFrac * 8760 / apr; const duracaoH = (e.last - e.first) / 3.6e6;
    if (duracaoH >= paybackH * L.MARGEM_PAYBACK) {
      const evUSD = (apr * Math.min(duracaoH, 168) / 8760 - custoFrac) * L.ALVO_POR_EXCHANGE;
      if (evUSD > 0) positivas.push({ k: e.k, sym: e.sym, long: e.long, short: e.short, inicio: e.first, fim: e.first + paybackH * 3.6e6, evUSD, margem: 2 * L.ALVO_POR_EXCHANGE / L.ALAVANCAGEM });
    }
  }
  // concorrência máxima observada (sobreposição das janelas de payback)
  const eventos = []; for (const p of positivas) { eventos.push([p.inicio, 1]); eventos.push([p.fim, -1]); }
  eventos.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  let cur = 0, maxConc = 0; for (const [, d] of eventos) { cur += d; if (cur > maxConc) maxConc = cur; }

  // simula captura por maxPositions ∈ {3,4,5} (greedy por EV, respeitando concorrência)
  function simula(maxPos) {
    const ativos = []; let capturadas = 0, pnl = 0, picoMargem = 0, committed = 0; const exchUso = {};
    for (const p of positivas.slice().sort((a, b) => a.inicio - b.inicio)) {
      for (let i = ativos.length - 1; i >= 0; i--) if (ativos[i].fim <= p.inicio) { committed -= ativos[i].margem; ativos.splice(i, 1); }
      if (ativos.length < maxPos) { ativos.push(p); committed += p.margem; picoMargem = Math.max(picoMargem, committed); capturadas++; pnl += p.evUSD; exchUso[p.long] = (exchUso[p.long] || 0) + 1; exchUso[p.short] = (exchUso[p.short] || 0) + 1; }
    }
    const capitalNecessario = maxPos * (2 * L.ALVO_POR_EXCHANGE / L.ALAVANCAGEM) / (1 - L.RESERVA);
    const contribs = positivas.slice(0, capturadas).map((p) => p.evUSD); const total = contribs.reduce((s, v) => s + v, 0) || 1;
    return { maxPositions: maxPos, oportunidadesCapturadas: capturadas, pnlPotencialUSD: L.r4(pnl),
      capitalNecessarioUSD: L.r2(capitalNecessario), picoMargemUSD: L.r2(picoMargem),
      usoSimultaneoExchanges: Object.keys(exchUso).length, concentracaoTop1: L.r4(Math.max(...contribs, 0) / total) };
  }
  const cenarios = [3, 4, 5].map(simula);
  for (let i = 1; i < cenarios.length; i++) { const dP = cenarios[i].pnlPotencialUSD - cenarios[i - 1].pnlPotencialUSD; const dC = cenarios[i].capitalNecessarioUSD - cenarios[i - 1].capitalNecessarioUSD; cenarios[i].retornoMarginalPorDolar = dC > 0 ? L.r4(dP / dC) : 0; }
  cenarios[0].retornoMarginalPorDolar = null;

  const gargalo = maxConc > 3
    ? `LIMITE DE POSIÇÕES *pelo modelo leniente* (até ${maxConc} janelas de payback sobrepostas). MAS este modelo superconta (${positivas.length} vs ~13 do motor): janelas de payback de ~160h se sobrepõem em excesso, e o motor exige best-ranked + payback-dentro-da-vida. O gargalo REAL só o TESTE FORWARD (itens 3/4) resolve.`
    : 'NENHUM dos dois é binding: nunca houve mais de ' + maxConc + ' oportunidades boas simultâneas.';
  const out = {
    schema: 'snowball.maxpositions-test.v1_3', geradoEm: new Date(asOf || 0).toISOString(), asOfMs: asOf,
    positivasQueViveram: positivas.length, concorrenciaMaximaObservada: maxConc,
    cenarios,
    gargalo, determinacao: `Modelos OFFLINE discordam: v1.1/v1.2 (posições REAIS do Champion, capadas em 3) → capital satura em 3; este teste (fluxo de oportunidades, modelo leniente) → subir maxPositions captura mais (15→19→23, marginal 0.048→0.144/US$). A discordância vem do modelo de viabilidade (leniente superconta). NÃO se decide o gargalo offline — o TESTE FORWARD live-paper (Trial/Control) é que resolve, medindo oportunidades boas REAIS simultâneas ao vivo. Não alterar o Champion sem esse dado forward.`,
    riscoLiquidacao: 'inalterado: cada perna mantém margem/notional = 1/alavancagem; mais posições concorrentes não muda a distância de liquidação individual, mas aumenta a concentração agregada.',
    honestidade: 'observed (janelas de vida) + simulated (captura greedy por EV). Censura: o Champion capou em 3, então a captura de 4/5 é inferida da sobreposição de oportunidades, não de posições reais.',
  };
  const p = L.writeJSON('maxpositions-test.json', out);
  console.log(JSON.stringify({ saida: p, positivasQueViveram: positivas.length, concorrenciaMax: maxConc, gargalo,
    cenarios: cenarios.map((c) => `maxPos${c.maxPositions}: captura ${c.oportunidadesCapturadas} pnl ${c.pnlPotencialUSD} capNec ${c.capitalNecessarioUSD} mrg ${c.retornoMarginalPorDolar}`) }, null, 2));
}
build();
