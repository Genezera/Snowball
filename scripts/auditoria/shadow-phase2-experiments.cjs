#!/usr/bin/env node
/**
 * SHADOW FASE 2 — itens 3,4,5,7,8. READ-ONLY. Nunca fecha/abre/promove nada.
 * Só registra o que FARIA (shadow) e o contrafactual, para comparar depois.
 */
const fs = require('node:fs');
const path = require('node:path');
const SNAP = 'auditoria/snapshot-1786189433850/copias';
const OPORT = 'inteligencia/oportunidades';
const OUT = 'auditoria/shadow';
const SNAP_TS = 1786189433850;

const diario = fs.readFileSync(path.join(SNAP, 'spread__diario.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
const marc = JSON.parse(fs.readFileSync(path.join(SNAP, 'spread__marcacao.json'), 'utf8'));
const ciclos = [];
for (const arq of fs.readdirSync(OPORT).filter((f) => f.endsWith('.jsonl')).sort())
  for (const l of fs.readFileSync(path.join(OPORT, arq), 'utf8').split('\n').filter(Boolean)) { try { ciclos.push(JSON.parse(l)); } catch {} }
const ultimo = ciclos[ciclos.length - 1];
const vphDe = (sym) => { const c = (ultimo.candidatas || []).find((x) => x.symbol === sym); return c ? c.valorPorHora : null; };

// ── ITEM 3: SWITCH VALUE IN-CYCLE (read-only, nunca troca) ──────────────────
const abertas = (marc.posicoes || []).map((p) => ({
  symbol: p.symbol, notional: p.notionalShort, fundingAcum: p.fundingAcumulado,
  custoFechar: p.custoEstimadoFechamento, pnlNaoRealizExec: p.pnlNaoRealizadoExecutavelTotal,
  valorPorHora: vphDe(p.symbol), // taxa atual da posição, se ainda no ranking
}));
const bloqueadas = (ultimo.candidatas || []).filter((c) => !c.aprovada && /saldo_insuficiente/.test(c.motivoRejeicao || ''));
const HORIZONTE_H = 6.8; // mediana de vida da posição (survival-curves)
// posição mais fraca = menor valorPorHora conhecido (ou a com pior pnl executável)
const fraca = abertas.filter((a) => a.valorPorHora != null).sort((a, b) => a.valorPorHora - b.valorPorHora)[0]
  || abertas.slice().sort((a, b) => a.pnlNaoRealizExec - b.pnlNaoRealizExec)[0];
const swRows = bloqueadas.slice(0, 30).map((c) => {
  const evNova = (c.valorPorHora || 0) * HORIZONTE_H;
  const evManterFraca = fraca && fraca.valorPorHora != null ? fraca.valorPorHora * HORIZONTE_H : null;
  const custoAbrir = c.custo || 0;
  const custoFechar = fraca ? fraca.custoFechar : null;
  const switchValue = (evManterFraca != null && custoFechar != null)
    ? +(evNova - evManterFraca - custoFechar - custoAbrir).toFixed(4) : null;
  return {
    ts: ultimo.ts,
    candidataBloqueada: `${c.symbol}|${c.exchangeLong}|${c.exchangeShort}`, evNova: +evNova.toFixed(4), custoAbrir,
    posicaoFraca: fraca ? fraca.symbol : null, evManterFraca, custoFecharFraca: custoFechar, margemLiberavel: fraca ? +fraca.notional.toFixed(2) : null,
    switchValue, recomendacaoShadow: switchValue == null ? 'sem_dado_suficiente' : (switchValue > 0 ? 'TROCA_POSITIVA_shadow' : 'MANTER'),
    executou: false, // NUNCA
  };
});
fs.writeFileSync(path.join(OUT, 'switch-value-incycle.jsonl'), swRows.map((r) => JSON.stringify(r)).join('\n') + '\n');
const trocasPositivas = swRows.filter((r) => r.switchValue != null && r.switchValue > 0).length;

// ── ITEM 4: REPLAY DE FECHAMENTO (contrafactual via historico) ──────────────
const hist = fs.readFileSync('vigilancia/historico.jsonl', 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
const histPorChave = {}; for (const h of hist) (histPorChave[h.k] ||= []).push(h);
for (const k in histPorChave) histPorChave[k].sort((a, b) => a.ts - b.ts);
// posições fechadas (do diario) com sua chave e notional
const fechamentos = [];
const abre = {};
for (const e of diario) {
  if (e.evento === 'abre') abre[e.symbol] = { key: `${e.symbol}|${e.short}|${e.long}`, notional: e.notional, custoAbre: e.custo };
  else if (e.evento === 'fecha' && abre[e.symbol]) { fechamentos.push({ symbol: e.symbol, key: abre[e.symbol].key, notional: abre[e.symbol].notional, fechaTs: e.ts, custoFecha: e.custo, motivo: e.motivo }); delete abre[e.symbol]; }
}
const CICLO_MS = 5 * 60_000;
function fundingContrafactual(key, deTs, ateTs, notional) {
  // funding estimado = média(apr no intervalo) × notional × (Δt / ano)
  const serie = (histPorChave[key] || []).filter((h) => h.ts >= deTs && h.ts <= ateTs);
  if (!serie.length) return { estimado: null, cobertura: 0 };
  const aprMedio = serie.reduce((s, h) => s + (h.apr || 0), 0) / serie.length;
  const dtAnos = (ateTs - deTs) / (365 * 24 * 3600_000);
  return { estimado: +(aprMedio * notional * dtAnos).toFixed(4), aprMedio: +aprMedio.toFixed(4), pontos: serie.length };
}
const replay = fechamentos.map((f) => {
  const janelas = {};
  for (const [nome, ms] of [['+1ciclo', CICLO_MS], ['+2ciclos', 2 * CICLO_MS], ['+3ciclos', 3 * CICLO_MS], ['+1h', 3600_000], ['+8h', 8 * 3600_000]]) {
    janelas[nome] = fundingContrafactual(f.key, f.fechaTs, f.fechaTs + ms, f.notional);
  }
  return { symbol: f.symbol, key: f.key, fechaTs: f.fechaTs, motivo: f.motivo, notional: f.notional, contrafactualHold: janelas };
});
fs.writeFileSync(path.join(OUT, 'close-replay.json'), JSON.stringify({
  fechamentos: replay.length,
  nota: 'Contrafactual de MANTER a posição além do fechamento real, funding estimado do apr no historico (não o realizado — a posição foi fechada). Custo de fechar é o mesmo (adiado). Estimativa, marcada; não é PnL realizado.',
  replay,
}, null, 2));
const comGanhoSeguraria = replay.filter((r) => (r.contrafactualHold['+8h']?.estimado || 0) > 0.05).length;

// ── ITEM 5: CAPTURE SURVIVAL SHADOW (regras determinísticas vs 6 reais) ─────
const capReais = diario.filter((e) => e.evento === 'abre-captura').map((a) => {
  const fech = diario.find((e) => e.evento === 'fecha' && e.symbol === a.symbol && e.ts > a.ts);
  const funds = diario.filter((e) => e.evento === 'funding' && e.symbol === a.symbol && e.ts >= a.ts && (!fech || e.ts <= fech.ts));
  const receita = funds.reduce((s, x) => s + (x.ganho || 0), 0);
  const custo = (a.custo || 0) + (fech ? fech.custo || 0 : 0);
  return { symbol: a.symbol, spread: a.spread, intervaloHoras: a.intervaloHoras, faltamMin: a.faltamMin, cobertura: a.cobertura, escorregamento: a.escorregamento, receita, custo, pnl: receita - custo, pagou: receita > custo, inverteu: funds.length === 0 };
});
function regra(nome, filtro) {
  const aceitas = capReais.filter(filtro);
  const pnl = aceitas.reduce((s, c) => s + c.pnl, 0);
  const evitouInversao = capReais.filter((c) => c.inverteu && !filtro(c)).length;
  return { regra: nome, aceitas: aceitas.length, de: capReais.length, pnlDasAceitas: +pnl.toFixed(4), inversoesEvitadas: evitouInversao };
}
const capShadow = [
  regra('controle (todas)', () => true),
  regra('cobertura>=1.25', (c) => (c.cobertura || 0) >= 1.25),
  regra('cobertura>=1.50', (c) => (c.cobertura || 0) >= 1.50),
  regra('faltamMin<=15 (perto do settlement)', (c) => (c.faltamMin || 999) <= 15),
  regra('escorregamento<=0.001', (c) => (c.escorregamento || 1) <= 0.001),
];
fs.writeFileSync(path.join(OUT, 'capture-survival-shadow.json'), JSON.stringify({ capturasReais: capReais.length, inversoesReais: capReais.filter((c) => c.inverteu).length, regras: capShadow, detalhe: capReais, nota: 'Compara regras determinísticas contra as 6 capturas reais. "cobertura" = funding esperado / custo. NÃO altera o Champion; só mede qual regra teria evitado as inversões preservando o PnL.' }, null, 2));

// ── ITEM 7: RANKING CROSS-SECTIONAL CONTÍNUO (todos os ciclos) ──────────────
const outcomePorSym = {};
for (const f of fechamentos) outcomePorSym[f.symbol] = 'fechada';
const rankRows = [];
let acertosTop = 0, ciclosComEscolha = 0;
for (const c of ciclos) {
  const cands = (c.candidatas || []).map((x) => ({ symbol: x.symbol, score: (x.valorPorHora || 0) * Math.max(0, x.folga || 0) * (x.consistencia || 0), aprovada: x.aprovada }));
  cands.sort((a, b) => b.score - a.score);
  const shadowTop = cands[0];
  const real = c.escolhida;
  if (real) { ciclosComEscolha++; if (shadowTop && shadowTop.symbol === real) acertosTop++; }
  rankRows.push({ ts: c.ts, escolhaReal: real || null, escolhaShadowTop1: shadowTop ? shadowTop.symbol : null, coincide: real ? (shadowTop && shadowTop.symbol === real) : null, top3Shadow: cands.slice(0, 3).map((x) => x.symbol) });
}
fs.writeFileSync(path.join(OUT, 'cross-sectional-continuo.jsonl'), rankRows.map((r) => JSON.stringify(r)).join('\n') + '\n');

const resumo = {
  switchValueInCycle: { bloqueadasAvaliadas: swRows.length, trocasPositivasShadow: trocasPositivas, posicaoFraca: fraca ? fraca.symbol : null, horizonteH: HORIZONTE_H, nota: 'nunca executa; recomendação shadow' },
  closeReplay: { fechamentos: replay.length, comContrafactualPositivo8h: comGanhoSeguraria, nota: 'estimativa via historico, não realizado' },
  captureSurvival: { capturasReais: capReais.length, inversoesReais: capReais.filter((c) => c.inverteu).length, melhorRegra: capShadow.slice(1).sort((a, b) => b.inversoesEvitadas - a.inversoesEvitadas)[0] },
  crossSectionalContinuo: { ciclosComEscolha, coincidenciaTop1: ciclosComEscolha ? +(acertosTop / ciclosComEscolha).toFixed(3) : null, nota: 'coincidência entre escolha real e top-1 shadow (NÃO promover só com base nisso)' },
};
fs.writeFileSync(path.join(OUT, 'phase2-resumo.json'), JSON.stringify(resumo, null, 2));
console.log(JSON.stringify(resumo, null, 2));
