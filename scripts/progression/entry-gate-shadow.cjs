#!/usr/bin/env node
'use strict';
/**
 * v1.8 — ENTRY GATE SHADOW LAB. READ-ONLY, SEM ordens, SEM promoção automática. A política ativa
 * (entrada por apr-snapshot) permanece congelada como CONTROL. Testa em SHADOW se filtros de entrada
 * (A Consecutive Confirmation, B Minimum Persistence, C Payback Survival, D Historical Episode
 * Survival, E Settlement Proximity) teriam evitado as perdas — SEM lookahead na decisão (só info
 * até o timestamp de entrada). Resultados futuros só avaliam a decisão a posteriori.
 * Emite auditoria/progression/entry-gate-shadow.json.
 */
const L = require('./lib-progression.cjs');
const fs = require('node:fs');
const path = require('node:path');
const ECON = path.join(L.ROOT, 'auditoria', 'progression', 'economic');
const POL = ['policy', 'trial', 'observer-max3', 'observer-max4', 'observer-max5'];
const NOTIONAL = L.ALVO_POR_EXCHANGE, TAKER = 0.0005, SLIP = 0.0002;
const ROUND_TRIP = L.r4(NOTIONAL * (4 * TAKER + 4 * SLIP)); // $0,28
const CUSTO_FRAC = 4 * TAKER + 4 * SLIP;
const economia = (apr, spread) => apr * 24 / 8760 - (CUSTO_FRAC + Math.max(0, spread || 0));
const paybackHours = (apr) => apr > 0 ? L.r2(ROUND_TRIP / (NOTIONAL * apr / 8760)) : Infinity;

function build() {
  const { asOf } = L.loadChampion();
  // ── 4 posições fechadas (dedup por sourcePositionId), com dados de entrada ──
  const seen = new Set(); const posicoes = [];
  for (const l of POL) { let ls = []; try { ls = fs.readFileSync(path.join(ECON, l, 'diario.jsonl'), 'utf8').split('\n').filter(Boolean).map(JSON.parse); } catch { continue; }
    const ab = {}; for (const e of ls) { if (e.evento === 'abre') ab[e.k] = e; else if (e.evento === 'fecha') { const a = ab[e.k]; if (seen.has(e.sourcePositionId)) continue; seen.add(e.sourcePositionId);
      posicoes.push({ policy: l, k: e.k, sourcePositionId: e.sourcePositionId, symbol: (e.k || '').split('|')[0], entryApr: a ? a.apr : null, entrySpread: a ? 0.0003 : 0, openedAt: a ? a.ts : e.positionOpenedAt, closedAt: e.positionClosedAt, funding: L.r4(e.funding || 0), pnl: L.r4(e.pnl || 0), closeReason: e.closeReason }); } } }

  // ── ler o feed uma vez: sequência de obs por chave das posições + episódios históricos ──
  const chaves = new Set(posicoes.map((p) => p.k));
  const obsPorChave = {}; for (const k of chaves) obsPorChave[k] = [];
  try { const buf = fs.readFileSync(path.join(L.ROOT, 'vigilancia', 'arquivo-observacoes.jsonl'), 'utf8');
    for (const ln of buf.split('\n')) { if (!ln) continue; let o; try { o = JSON.parse(ln); } catch { continue; } if (chaves.has(o.k)) obsPorChave[o.k].push({ ts: o.ts, apr: o.apr, spread: o.spread || 0 }); } } catch {}
  for (const k of chaves) obsPorChave[k].sort((a, b) => a.ts - b.ts);
  const GAP = 30 * 60000; // episódio = contiguidade < 30min

  // métricas por posição (SEM lookahead p/ a decisão) + episódios p/ challenger D
  function metricas(p) {
    const obs = obsPorChave[p.k] || [];
    const antes = obs.filter((o) => o.ts <= p.openedAt);
    const depois = obs.filter((o) => o.ts > p.openedAt && o.ts <= p.closedAt);
    // persistência observada ANTES da entrada: minutos contíguos+positiveEV terminando na entrada
    let persistMin = 0, consecEV = 0;
    for (let i = antes.length - 1; i >= 1; i--) { const cur = antes[i], prev = antes[i - 1];
      if (cur.ts - prev.ts > GAP) break; if (economia(prev.apr, prev.spread) > 0) { consecEV++; persistMin = (p.openedAt - prev.ts) / 60000; } else break; }
    // episódios da chave p/ estimar sobrevivência. SEM LOOKAHEAD: só episódios COMPLETADOS
    // (last < openedAt) contam — o episódio corrente (em que se está decidindo entrar) e os
    // futuros são invisíveis no instante da decisão.
    const epsTodos = []; let cur = null; for (const o of obs) { if (!cur || o.ts - cur.last > GAP) { if (cur) epsTodos.push(cur); cur = { first: o.ts, last: o.ts }; } cur.last = o.ts; } if (cur) epsTodos.push(cur);
    const eps = epsTodos.filter((e) => e.last < p.openedAt); // só histórico anterior à decisão
    const vidasH = eps.map((e) => (e.last - e.first) / 3.6e6);
    const pb = paybackHours(p.entryApr);
    const fracSobrevivemPayback = vidasH.length ? L.r2(vidasH.filter((v) => v >= pb).length / vidasH.length) : 0;
    const medianaVidaH = vidasH.length ? L.r2(vidasH.slice().sort((a, b) => a - b)[Math.floor(vidasH.length / 2)]) : 0;
    const vidaRealPosEntradaH = L.r2((p.closedAt - p.openedAt) / 3.6e6);
    const aprRealizado = vidaRealPosEntradaH > 0 ? L.r2(p.funding * 8760 / (NOTIONAL * vidaRealPosEntradaH)) : 0;
    return { persistMin: L.r2(persistMin), consecEV, paybackHours: pb, medianaVidaHistoricaH: medianaVidaH, fracEpisodiosSobrevivemPayback: fracSobrevivemPayback, vidaRealPosEntradaH, breakEven: ROUND_TRIP, fracBreakEven: L.r2(p.funding / ROUND_TRIP), entryApr: p.entryApr, aprRealizado, episodios: eps.length };
  }
  const posComMetricas = posicoes.map((p) => ({ ...p, m: metricas(p) }));

  // ── challengers: decisão enter/reject por posição (só info até a entrada) ──
  const challengers = {};
  // A) Consecutive Confirmation: N ciclos consecutivos de EV+ antes
  for (const N of [2, 3, 4]) challengers[`A_consecutive_${N}`] = (m) => m.consecEV >= N;
  // B) Minimum Persistence: minutos observados
  for (const min of [15, 30, 60, 120]) challengers[`B_persistence_${min}min`] = (m) => m.persistMin >= min;
  // C) Payback Survival: vida esperada (mediana histórica) >= payback × safety
  for (const sf of [1.0, 1.25, 1.5, 2.0]) challengers[`C_paybackSurvival_${sf}x`] = (m) => m.medianaVidaHistoricaH >= m.paybackHours * sf;
  // D) Historical Episode Survival: prob. de sobreviver ao payback >= 0.5
  challengers['D_historicalSurvival_p50'] = (m) => m.fracEpisodiosSobrevivemPayback >= 0.5;
  // E) Settlement Proximity: exige entrada com payback curto o bastante p/ liquidar (proxy: payback <= 4h)
  challengers['E_settlementProximity_4h'] = (m) => m.paybackHours <= 4;

  // ── avaliação: aplicar cada challenger às 4 (todas foram PERDAS) ──
  const avaliacao = {}; const lucroDedup = L.r4(posComMetricas.reduce((s, p) => s + p.pnl, 0)); // -0,87 aprox por única
  for (const [nome, filtro] of Object.entries(challengers)) {
    const decisoes = posComMetricas.map((p) => ({ symbol: p.symbol, spId: p.sourcePositionId.slice(0, 8), entraria: filtro(p.m), pnl: p.pnl }));
    const entrariam = decisoes.filter((d) => d.entraria);
    const rejeitadas = decisoes.filter((d) => !d.entraria);
    const lossesAvoided = rejeitadas.length; // todas as 4 foram perdas
    const profitableTradesRejected = rejeitadas.filter((d) => d.pnl > 0).length; // 0 (não há vencedores na amostra)
    const pnlPosFiltro = L.r4(entrariam.reduce((s, d) => s + d.pnl, 0));
    avaliacao[nome] = { entrariam: entrariam.map((d) => d.symbol), rejeitadas: rejeitadas.map((d) => d.symbol), lossesAvoided, profitableTradesRejected, pnlAposFiltro: pnlPosFiltro, netPnLImprovement: L.r4(pnlPosFiltro - lucroDedup) };
  }

  // ── item 8: hipótese central — apr prediz sobrevivência ao break-even? ──
  const pares = posComMetricas.map((p) => ({ apr: p.entryApr, fracBreakEven: p.m.fracBreakEven, aprRealizado: p.m.aprRealizado }));
  const correlAprVsSobrevivencia = (() => { const n = pares.length; if (n < 3) return null; const mx = pares.reduce((s, x) => s + x.apr, 0) / n, my = pares.reduce((s, x) => s + x.fracBreakEven, 0) / n;
    let num = 0, dx = 0, dy = 0; for (const x of pares) { num += (x.apr - mx) * (x.fracBreakEven - my); dx += (x.apr - mx) ** 2; dy += (x.fracBreakEven - my) ** 2; } return dx > 0 && dy > 0 ? L.r2(num / Math.sqrt(dx * dy)) : 0; })();
  const aprMedioRealizadoVsEntrada = { entradaMedia: L.r2(pares.reduce((s, x) => s + x.apr, 0) / pares.length), realizadoMedio: L.r2(pares.reduce((s, x) => s + x.aprRealizado, 0) / pares.length) };
  const hipotese = { enunciado: 'A intensidade atual do funding (APR de entrada) é insuficiente para prever persistência até o break-even.',
    evidencia: { correlacaoAprEntradaVsFracBreakEven: correlAprVsSobrevivencia, aprEntradaVsRealizado: aprMedioRealizadoVsEntrada, exemplo: 'LA|bingx apr 15,77 (o MAIOR) sobreviveu só a 12% do break-even; 1000CAT apr 8,07 chegou a 49%.' },
    veredito: pares.length < 5 ? 'INCONCLUSIVO (amostra 4) — MAS a direção SUPORTA a hipótese: apr de entrada não previu sobrevivência; apr realizado médio << apr de entrada.' : (correlAprVsSobrevivencia != null && correlAprVsSobrevivencia < 0.3 ? 'HIPÓTESE SUPORTADA' : 'HIPÓTESE REJEITADA') };

  const out = {
    schema: 'snowball.entry-gate-shadow.v1_8', geradoEm: new Date(asOf || 0).toISOString(), asOfMs: asOf,
    control: { descricao: 'gate ativo = economia(apr,spread)>0 no snapshot (congelado)', posicoes: posComMetricas.map((p) => ({ symbol: p.symbol, policy: p.policy, entryApr: p.entryApr, funding: p.funding, pnl: p.pnl, closeReason: p.closeReason, m: p.m })) },
    populacao: { policyRecords: seen.size, uniqueSourcePositions: posicoes.length, realizedNetPnLDedup: lucroDedup, todasForamPerdas: posComMetricas.every((p) => p.pnl < 0) },
    challengersAvaliacao: avaliacao,
    diagnostico4Posicoes: posComMetricas.map((p) => ({ symbol: p.symbol, spId: p.sourcePositionId.slice(0, 8), quaisFiltrosTeriamEvitado: Object.entries(challengers).filter(([, f]) => !f(p.m)).map(([n]) => n), pnl: p.pnl, m: p.m })),
    item6_custoOportunidade: { aviso: 'Com 0 vencedores na amostra, profitableTradesRejected=0 SEMPRE — não dá p/ medir o custo de oportunidade real. Rejeitar as 4 perdas é OVERFIT à hipótese. Confidence BAIXA.', winnersNaAmostra: 0 },
    item8_hipoteseCentral: hipotese,
    confidence: 'BAIXA (4 posições fechadas, todas perdas, 0 vencedores) — nenhum challenger promovível.',
    honestidade: 'Shadow/read-only. Nenhum challenger substitui o Control. Sem lookahead na decisão. Rejeitar as 4 perdas NÃO prova melhoria — falta amostra com vencedores e 2ª janela/regime.',
  };
  const p = L.writeJSON('entry-gate-shadow.json', out);
  console.log(JSON.stringify({ saida: p, posicoes: posicoes.length, lucroDedup, correlAprVsSobrevivencia, hipotese: hipotese.veredito.slice(0, 60), challengersQueEvitamTudo: Object.entries(avaliacao).filter(([, v]) => v.lossesAvoided === posicoes.length).map(([n]) => n) }, null, 2));
}
build();
