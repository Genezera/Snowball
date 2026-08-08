#!/usr/bin/env node
'use strict';
/**
 * v1.4 — PARTES 2,3,4,5. Corrige a metodologia de "vida das oportunidades":
 *  - EPISÓDIOS: reaparição após gap > GAP_MAX inicia novo episódio (não agrupa tudo).
 *  - CENSURA: left/right/complete + observationCoverage; mediana só em completos.
 *  - PAYBACK SEM LOOKAHEAD: usa o APR/spread do PRIMEIRO ciclo do episódio.
 *  - FUNIL CORRIGIDO + survivalAmongAll vs survivalAmongModelPositive.
 * READ-ONLY. Emite auditoria/progression/opportunity-episodes.json.
 */
const L = require('./lib-progression.cjs');
const fs = require('node:fs');
const path = require('node:path');

const TAKER = 0.0005, SLIP = 0.0002, CUSTO_FRAC = 4 * TAKER + 4 * SLIP;
const GAP_MAX_MIN = 30;               // >30min sem ver a chave => novo episódio (cadência ~5min)
const GAP_MAX = GAP_MAX_MIN * 60000;
const EDGE = 6 * 60000;               // censura: <6min da borda da janela
const HORIZ = [1, 8, 24, 72];

function paybackHoras(apr, spread) { const c = CUSTO_FRAC + Math.max(0, spread || 0); return apr > 0 ? c * 8760 / apr : Infinity; }
function evHUSD(apr, spread, H) { const c = CUSTO_FRAC + Math.max(0, spread || 0); return L.r4((apr * H / 8760 - c) * L.ALVO_POR_EXCHANGE); }

function build() {
  const { estado, epochs, asOf } = L.loadChampion();
  const obsPath = path.join(L.ROOT, 'vigilancia', 'arquivo-observacoes.jsonl');
  const L2 = fs.readFileSync(obsPath, 'utf8').split('\n');
  const porK = new Map(); let wMin = Infinity, wMax = 0;
  for (const ln of L2) { if (!ln) continue; let o; try { o = JSON.parse(ln); } catch { continue; }
    if (!o.k || o.apr == null) continue; const [sym, long, short] = o.k.split('|');
    if (!L.EXCHANGES.includes(long) || !L.EXCHANGES.includes(short)) continue;
    if (!porK.has(o.k)) porK.set(o.k, []); porK.get(o.k).push(o); if (o.ts < wMin) wMin = o.ts; if (o.ts > wMax) wMax = o.ts;
  }

  // ── item 2: split em episódios por gap ──────────────────────────────────────
  const episodios = [];
  for (const [k, arr] of porK) {
    arr.sort((a, b) => a.ts - b.ts);
    const [sym, long, short] = k.split('|');
    let ep = null;
    for (const o of arr) {
      if (!ep || o.ts - ep.lastSeen > GAP_MAX) { if (ep) episodios.push(ep); ep = { k, sym, long, short, direcao: `${long}>${short}`, firstSeen: o.ts, lastSeen: o.ts, obs: [] }; }
      ep.lastSeen = o.ts; ep.obs.push({ ts: o.ts, apr: o.apr, spread: o.spread || 0 });
    }
    if (ep) episodios.push(ep);
  }

  // ── itens 3,4: censura + payback sem lookahead + realizado ──────────────────
  const CADENCIA = 5 * 60000;
  const eps = episodios.map((ep) => {
    const configEpochId = L.epochDe(ep.firstSeen, epochs);
    const leftCensored = (ep.firstSeen - wMin) < EDGE;
    const rightCensored = (wMax - ep.lastSeen) < EDGE;
    const completeEpisode = !leftCensored && !rightCensored;
    const duracaoH = (ep.lastSeen - ep.firstSeen) / 3.6e6;
    const esperadoCiclos = Math.max(1, Math.round((ep.lastSeen - ep.firstSeen) / CADENCIA) + 1);
    const observationCoverage = L.r4(Math.min(1, ep.obs.length / esperadoCiclos));
    // decision-time (PRIMEIRO ciclo, sem lookahead)
    const d = ep.obs[0];
    const dtPaybackH = paybackHoras(d.apr, d.spread);
    const decision = { decisionTimeAPR: L.r4(d.apr), decisionTimeSpread: L.r4(d.spread), decisionTimeCosts: L.r4(CUSTO_FRAC + Math.max(0, d.spread)),
      paybackH: isFinite(dtPaybackH) ? L.r2(dtPaybackH) : null };
    for (const H of HORIZ) decision['decisionTimePayback' + H + 'h'] = { evUSD: evHUSD(d.apr, d.spread, H), pago: (d.apr * H / 8760) >= (CUSTO_FRAC + Math.max(0, d.spread)) };
    // realizado (após encerramento): funding cumulativo pelo APR PATH observado
    let fundingReal = 0; for (let i = 0; i < ep.obs.length; i++) { const dtH = i > 0 ? (ep.obs[i].ts - ep.obs[i - 1].ts) / 3.6e6 : 0; fundingReal += ep.obs[i].apr * dtH / 8760; }
    const custoReal = CUSTO_FRAC + Math.max(0, d.spread);
    const paidBackBeforeDisappearance = fundingReal >= custoReal;
    const realizedOutcome = rightCensored ? 'censurado_direita' : (paidBackBeforeDisappearance ? 'pagou_payback' : 'sumiu_antes');
    const modelPositiveAtDecisionTime = isFinite(dtPaybackH) && dtPaybackH * L.MARGEM_PAYBACK <= 168;
    const survivedPayback = completeEpisode && isFinite(dtPaybackH) && duracaoH >= dtPaybackH * L.MARGEM_PAYBACK;
    return { opportunityEpisodeId: `${ep.k}|${configEpochId}#${ep.firstSeen}`, k: ep.k, sym: ep.sym, direcao: ep.direcao, configEpochId,
      firstSeen: ep.firstSeen, lastSeen: ep.lastSeen, duracaoH: L.r2(duracaoH), ciclos: ep.obs.length,
      leftCensored, rightCensored, completeEpisode, observationCoverage,
      maxAPR: L.r4(Math.max(...ep.obs.map((o) => o.apr))), minAPR: L.r4(Math.min(...ep.obs.map((o) => o.apr))),
      decision, realizedLifetimeH: rightCensored ? null : L.r2(duracaoH), fundingRealizadoFrac: L.r4(fundingReal), paidBackBeforeDisappearance, realizedOutcome,
      modelPositiveAtDecisionTime, survivedPayback };
  });

  // ── item 5: funil corrigido ─────────────────────────────────────────────────
  const completos = eps.filter((e) => e.completeEpisode);
  const modelPos = eps.filter((e) => e.modelPositiveAtDecisionTime);
  const modelPosCompletos = modelPos.filter((e) => e.completeEpisode);
  const survived = eps.filter((e) => e.survivedPayback);
  const survivedModelPos = survived.filter((e) => e.modelPositiveAtDecisionTime);
  const abertasChampion = new Set(L.reconstruirPosicoes(estado).filter((p) => !p.aberta).map((p) => p.sym));
  const profitableClosed = L.reconstruirPosicoes(estado).filter((p) => !p.aberta && (p.pnl || 0) > 0).length;
  const medDur = (a) => { const s = a.map((e) => e.duracaoH).sort((x, y) => x - y); return s.length ? L.r2(s[Math.floor(s.length / 2)]) : null; };

  const funil = {
    allEpisodes: eps.length,
    completeEpisodes: completos.length,
    modelPositiveAtDecisionTime: modelPos.length,
    survivedPayback: survived.length,
    engineApproved: 13, // estimativa v1.2 (candidate-observations indisponível)
    opened: abertasChampion.size,
    profitableClosed,
    survivalAmongAll: L.r4(survived.length / (completos.length || 1)),
    survivalAmongModelPositive: L.r4(survivedModelPos.length / (modelPosCompletos.length || 1)),
    nota: 'survivalAmongAll e survivalAmongModelPositive usam só episódios COMPLETOS (não censurados). engineApproved é estimativa (candidate-observations indisponível nesta sessão).',
  };
  const censura = {
    leftCensored: eps.filter((e) => e.leftCensored).length, rightCensored: eps.filter((e) => e.rightCensored).length,
    completeEpisodes: completos.length, observationCoverageMediana: L.r4([...eps.map((e) => e.observationCoverage)].sort((a, b) => a - b)[Math.floor(eps.length / 2)] || 0),
    duracaoMedianaH_completosApenas: medDur(completos), duracaoMedianaH_todos_ENGANOSA: medDur(eps),
    nota: 'A mediana de duração v1.3 (27h) misturava censurados. Correta = só completos. Censurados à direita NÃO têm duração conhecida.',
  };

  // ── correção-chave: visibilidade no scanner ≠ tempo de HOLD da posição ──────
  const fechadasReais = L.reconstruirPosicoes(estado).filter((p) => !p.aberta && p.fechaTs);
  const holdsH = fechadasReais.map((p) => (p.fechaTs - p.abreTs) / 3.6e6).sort((a, b) => a - b);
  const holdMedianoH = holdsH.length ? L.r2(holdsH[Math.floor(holdsH.length / 2)]) : null;
  const interpretacaoCorreta = {
    duracaoMedianaEpisodioScannerH: censura.duracaoMedianaH_completosApenas,
    duracaoMedianaHoldPosicaoRealH: holdMedianoH,
    posicoesFechadasReais: fechadasReais.length,
    insight: `O episódio no SCANNER dura ~${censura.duracaoMedianaH_completosApenas}h (a oportunidade some da varredura em minutos), mas a POSIÇÃO real do Champion é segurada por ~${holdMedianoH}h — cerca de ${holdMedianoH && censura.duracaoMedianaH_completosApenas ? Math.round(holdMedianoH / censura.duracaoMedianaH_completosApenas) : '?'}× o episódio do scanner. Ou seja: o Champion SEGURA a posição através da invisibilidade no scanner, rendendo funding mesmo quando o spread some da varredura. Por isso survivedPayback=0 medido pela vida-no-scanner é ENGANOSO — a vida-do-episódio NÃO é a métrica de payback. E o Champion só abre APR muito alto (payback curto), não a oportunidade mediana. CONCLUSÃO metodológica do v1.4: nenhum proxy offline (vida-no-scanner de v1.3/v1.4) responde ao payback; só o teste FORWARD — que segura posições sob as regras econômicas reais — resolve. Corrigir a metodologia ANTES de interpretar economia era o objetivo.`,
  };

  const out = {
    schema: 'snowball.opportunity-episodes.v1_4', geradoEm: new Date(asOf || 0).toISOString(), asOfMs: asOf,
    interpretacaoCorreta,
    parametros: { gapMaxMin: GAP_MAX_MIN, cadenciaMin: 5, edgeMin: 6, horizontes: HORIZ, margemPayback: L.MARGEM_PAYBACK, regimeProxy: 'configEpochId (classificador de regime de mercado fino = trabalho futuro)' },
    janela: { inicio: new Date(wMin).toISOString(), fim: new Date(wMax).toISOString(), chavesDistintas: porK.size },
    item2_3_episodios: { total: eps.length, completos: completos.length, exemplos: eps.filter((e) => e.completeEpisode && e.modelPositiveAtDecisionTime).slice(0, 6).map((e) => ({ id: e.opportunityEpisodeId, sym: e.sym, duracaoH: e.duracaoH, dtAPR: e.decision.decisionTimeAPR, paybackH: e.decision.paybackH, survived: e.survivedPayback, outcome: e.realizedOutcome })) },
    item3_censura: censura,
    item5_funilCorrigido: funil,
    honestidade: 'Correção metodológica: episódios por gap + censura + payback sem lookahead (APR do 1º ciclo). Antes de interpretar economia, a metodologia precisa estar certa — este é o objetivo do v1.4.',
  };
  const p = L.writeJSON('opportunity-episodes.json', out);
  console.log(JSON.stringify({ saida: p, funil, censura: { left: censura.leftCensored, right: censura.rightCensored, completos: censura.completeEpisodes, durMedCompletos: censura.duracaoMedianaH_completosApenas, durMedTodosEnganosa: censura.duracaoMedianaH_todos_ENGANOSA } }, null, 2));
}
build();
