#!/usr/bin/env node
'use strict';
/**
 * v1.3 — PARTES 6 e 7. Vida das oportunidades (opportunityId persistente) + EV
 * multi-horizonte. Explica o funil 1064 modelPositiveEV → ~13 enginePositiveEV →
 * posições realmente abertas. READ-ONLY (observações brutas). Emite
 * auditoria/progression/opportunity-life.json.
 */
const L = require('./lib-progression.cjs');
const fs = require('node:fs');
const path = require('node:path');

const TAKER = 0.0005, SLIP = 0.0002, CUSTO_FRAC = 4 * TAKER + 4 * SLIP; // 0.0028
const HORIZONTES = [1, 8, 24, 72]; // item 6: NÃO só 168h

function evNoHorizonte(apr, spread, H) {
  const custoFrac = CUSTO_FRAC + Math.max(0, spread || 0);
  const fundingFrac = apr * H / 8760;
  return L.r4((fundingFrac - custoFrac) * L.ALVO_POR_EXCHANGE); // por posição de US$100/perna
}

function build() {
  const { estado, asOf } = L.loadChampion();
  const obsPath = path.join(L.ROOT, 'vigilancia', 'arquivo-observacoes.jsonl');
  let linhas = []; try { linhas = fs.readFileSync(obsPath, 'utf8').split('\n'); } catch { console.error('sem observações'); process.exit(1); }

  const porK = new Map();
  for (const ln of linhas) {
    if (!ln) continue; let o; try { o = JSON.parse(ln); } catch { continue; }
    if (!o.k || o.apr == null) continue;
    const [sym, long, short] = o.k.split('|');
    if (!L.EXCHANGES.includes(long) || !L.EXCHANGES.includes(short)) continue;
    let e = porK.get(o.k); if (!e) { e = { k: o.k, sym, firstSeen: o.ts, lastSeen: o.ts, aprs: [], spreads: [], inversoes: 0, ciclos: 0, ultimoSinal: null }; porK.set(o.k, e); }
    e.firstSeen = Math.min(e.firstSeen, o.ts); e.lastSeen = Math.max(e.lastSeen, o.ts);
    e.aprs.push(o.apr); e.spreads.push(o.spread || 0); e.ciclos++;
    const sinal = o.apr >= 0 ? 1 : -1; if (e.ultimoSinal != null && sinal !== e.ultimoSinal) e.inversoes++; e.ultimoSinal = sinal;
  }
  const mediana = (a) => { const s = a.slice().sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : 0; };
  const media = (a) => a.reduce((s, v) => s + v, 0) / (a.length || 1);
  const desvio = (a) => { const m = media(a); return Math.sqrt(media(a.map((v) => (v - m) ** 2))); };

  const oportunidades = [...porK.values()].map((e) => {
    const apr = mediana(e.aprs), maxAPR = Math.max(...e.aprs), minAPR = Math.min(...e.aprs);
    const spread = mediana(e.spreads);
    const duracaoH = (e.lastSeen - e.firstSeen) / 3.6e6;
    const custoFrac = CUSTO_FRAC + Math.max(0, spread);
    const paybackH = apr > 0 ? custoFrac * 8760 / apr : Infinity;
    const tempoSuficienteParaPayback = isFinite(paybackH) && duracaoH >= paybackH * L.MARGEM_PAYBACK;
    const estabilidade = media(e.aprs) !== 0 ? L.r4(1 - Math.min(1, desvio(e.aprs) / Math.abs(media(e.aprs)))) : 0;
    const evHorizonte = {}; for (const H of HORIZONTES) evHorizonte['h' + H] = evNoHorizonte(apr, spread, H);
    const evVidaObservada = evNoHorizonte(apr, spread, Math.min(duracaoH, 168));
    return {
      opportunityId: e.k, sym: e.sym, firstSeen: e.firstSeen, lastSeen: e.lastSeen, duracaoH: L.r2(duracaoH),
      aprMediano: L.r4(apr), maxAPR: L.r4(maxAPR), minAPR: L.r4(minAPR), estabilidade, inversoes: e.inversoes, ciclos: e.ciclos,
      paybackH: isFinite(paybackH) ? L.r2(paybackH) : null, tempoSuficienteParaPayback,
      evVidaObservada, evPorHorizonte: evHorizonte,
      modelPositive: isFinite(paybackH) && paybackH * L.MARGEM_PAYBACK <= 168, // "1064" (assume hold 168h)
      realmentePositiva: tempoSuficienteParaPayback && evVidaObservada > 0,     // viveu o suficiente
    };
  });

  // funil
  const modelPositive = oportunidades.filter((o) => o.modelPositive);
  const viveuOSuficiente = oportunidades.filter((o) => o.realmentePositiva);
  // realmente abertas pelo Champion (símbolos distintos)
  const abertasChampion = new Set(L.reconstruirPosicoes(estado).map((p) => p.sym));
  const modelPosQueViveram = modelPositive.filter((o) => o.tempoSuficienteParaPayback).length;

  const funil = {
    oportunidadesDistintas: oportunidades.length,
    modelPositiveEV_holdMax168h: modelPositive.length,
    modelPositiveEV_queViveramAtePayback: modelPosQueViveram,
    realmentePositivas_vidaObservada: viveuOSuficiente.length,
    abertasPeloChampion_simbolos: abertasChampion.size,
    explicacao: `De ${oportunidades.length} oportunidades, ${modelPositive.length} pareceriam positivas SE segurássemos até 168h (o "1064"). Mas só ${modelPosQueViveram} realmente VIVERAM tempo suficiente (duração ≥ payback×${L.MARGEM_PAYBACK}) — o resto DESAPARECEU antes de pagar o round-trip. É por isso que o motor, usando a vida real, aprova ~${modelPosQueViveram} (≈13 na janela anterior), não 1064. O Champion abriu ${abertasChampion.size} símbolos distintos, um subconjunto dos que viveram o suficiente.`,
  };
  // distribuição de duração vs payback
  const distribuicao = {
    duracaoMedianaH: L.r2(mediana(oportunidades.map((o) => o.duracaoH))),
    paybackMedianoH: L.r2(mediana(oportunidades.filter((o) => o.paybackH != null).map((o) => o.paybackH))),
    pctQueViveramAtePayback: L.r2((viveuOSuficiente.length / (oportunidades.length || 1)) * 100),
  };

  const out = {
    schema: 'snowball.opportunity-life.v1_3', geradoEm: new Date(asOf || 0).toISOString(), asOfMs: asOf,
    item7_funil: funil, distribuicao,
    item6_multiHorizonte: { horizontes: HORIZONTES, nota: 'EV calculado por posição de US$100/perna em 1h/8h/24h/72h + vida observada. Horizontes curtos raramente pagam o round-trip (0,28%); só APR alto + vida longa fecha a conta.',
      exemplosTop: oportunidades.filter((o) => o.realmentePositiva).sort((a, b) => b.evVidaObservada - a.evVidaObservada).slice(0, 8).map((o) => ({ sym: o.sym, aprMediano: o.aprMediano, duracaoH: o.duracaoH, paybackH: o.paybackH, evVidaObservada: o.evVidaObservada, evPorHorizonte: o.evPorHorizonte })) },
    honestidade: 'observed (ts/apr/spread por opportunityId) + simulated (EV por horizonte). A vida observada é limitada pela janela do arquivo de observações (poda de 7 dias).',
  };
  const p = L.writeJSON('opportunity-life.json', out);
  console.log(JSON.stringify({ saida: p, ...funil, distribuicao }, null, 2));
}
build();
