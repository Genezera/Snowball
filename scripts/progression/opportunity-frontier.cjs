#!/usr/bin/env node
'use strict';
/**
 * v1.2 — PARTES 1 e 2. Observer aditivo PRÉ-SALDO + Opportunity Frontier.
 * READ-ONLY: reprocessa as observações BRUTAS do mercado (vigilancia/
 * arquivo-observacoes.jsonl → {ts, k=symbol|long|short, spread(basis), apr, vol})
 * e RECOMPUTA a economia de TODA candidata (inclusive as que o motor rejeitou por
 * saldo antes de avaliar). NUNCA aprova/abre nada.
 *
 * Modelo econômico DOCUMENTADO (src/config.ts + src/backtest/engine.ts):
 *   custo round-trip delta-neutro (2 pernas, entra+sai = 4 fills) =
 *     notional × (4·takerFee + 4·slippage); + basis (spread) como fricção de entrada.
 *   funding por hora = notional × apr / 8760 (apr anualizado).
 *   paybackHoras = custoFrac / (apr/8760); viável se payback × margemPayback ≤ H_MAX.
 *   EV líquido (num horizonte de referência) = funding(H) − custo.
 * Emite auditoria/progression/opportunity-frontier.json.
 */
const L = require('./lib-progression.cjs');
const fs = require('node:fs');
const path = require('node:path');

const TAKER = 0.0005, SLIP = 0.0002;         // src/config.ts preset binance-futures
const CUSTO_FRAC = 4 * TAKER + 4 * SLIP;     // 0.0028 round-trip 2 pernas
const H_MAX = 168;                            // horizonte máx aceitável de hold (7 dias)
const NOTIONAL_REF = L.ALVO_POR_EXCHANGE;     // US$100/perna (desenho operacional)
const MARGEM_POS = 2 * NOTIONAL_REF / L.ALAVANCAGEM; // margem por posição = 2N/lev = 40

function economia(apr, spread) {
  const custoFrac = CUSTO_FRAC + Math.max(0, spread || 0); // basis como fricção de entrada (conservador)
  const fundingHora = apr / 8760;
  const paybackHoras = fundingHora > 0 ? custoFrac / fundingHora : Infinity;
  const viavel = isFinite(paybackHoras) && paybackHoras * L.MARGEM_PAYBACK <= H_MAX;
  const H = Math.min(H_MAX, Math.max(paybackHoras * L.MARGEM_PAYBACK, 8));
  const fundingFrac = apr * H / 8760;
  const evLiqFrac = fundingFrac - custoFrac;                 // por unidade de notional
  const evLiqUSD = evLiqFrac * NOTIONAL_REF;
  const capitalNecessario = MARGEM_POS;
  const retornoPorCapitalHora = (capitalNecessario * H) > 0 ? evLiqUSD / (capitalNecessario * H) : 0;
  return {
    valorBrutoFrac: L.r4(fundingFrac), custoEntradaFrac: L.r4(CUSTO_FRAC / 2 + Math.max(0, spread || 0)), custoSaidaFrac: L.r4(CUSTO_FRAC / 2),
    slippageFrac: L.r4(4 * SLIP), paybackHoras: isFinite(paybackHoras) ? L.r2(paybackHoras) : null,
    evLiquidoUSD: L.r4(evLiqUSD), retornoPorCapitalHora: L.r4(retornoPorCapitalHora),
    capitalNecessario: L.r2(capitalNecessario), reservaNecessaria: L.r2(NOTIONAL_REF * 2 * L.RESERVA), viavel,
  };
}

function build() {
  const { estado, asOf } = L.loadChampion();
  const obsPath = path.join(L.ROOT, 'vigilancia', 'arquivo-observacoes.jsonl');
  let linhas = [];
  try { linhas = fs.readFileSync(obsPath, 'utf8').split('\n'); } catch { console.error('sem arquivo-observacoes'); process.exit(1); }

  // agrega por oportunidade (k): apr mediano, spread mediano, vol máx, nº de observações, janela
  const porK = new Map();
  let tsMin = Infinity, tsMax = 0, foraOperacional = 0, semFeatures = 0;
  for (const ln of linhas) {
    if (!ln) continue; let o; try { o = JSON.parse(ln); } catch { continue; }
    if (!o.k) continue;
    const [sym, long, short] = o.k.split('|');
    if (!L.EXCHANGES.includes(long) || !L.EXCHANGES.includes(short)) { foraOperacional++; continue; }
    if (o.apr == null || o.spread == null) { semFeatures++; continue; }
    let e = porK.get(o.k); if (!e) { e = { k: o.k, sym, long, short, aprs: [], spreads: [], vol: 0, n: 0 }; porK.set(o.k, e); }
    e.aprs.push(o.apr); e.spreads.push(o.spread); e.vol = Math.max(e.vol, o.vol || 0); e.n++;
    if (o.ts < tsMin) tsMin = o.ts; if (o.ts > tsMax) tsMax = o.ts;
  }
  const mediana = (a) => { const s = a.slice().sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : 0; };
  const oportunidades = [...porK.values()].map((e) => {
    const apr = mediana(e.aprs), spread = mediana(e.spreads);
    return { k: e.k, sym: e.sym, par: [e.long, e.short].sort().join('+'), apr: L.r4(apr), spread: L.r4(spread), vol: L.r2(e.vol), observacoes: e.n, ...economia(apr, spread) };
  });

  const viaveis = oportunidades.filter((o) => o.viavel);
  const positivas = oportunidades.filter((o) => o.evLiquidoUSD > 0 && o.viavel);

  // ── item 1: economia das "rejeições por saldo" recomputada ───────────────────
  // Reconstrução: no motor real, a saldo-rejeição ocorria quando o capital livre
  // não cobria a margem. Com o modelo acima, medimos quantas oportunidades VIÁVEIS
  // e POSITIVAS existiriam e quantas o capital (por nível) deixaria de fora.
  const economiaObserver = {
    observacoesBrutas: linhas.filter(Boolean).length, oportunidadesDistintas: oportunidades.length,
    foraDos6Operacionais: foraOperacional, semFeaturesRaw: semFeatures,
    viaveisEconomicamente: viaveis.length, positivasEV: positivas.length,
    aprMedianoGlobal: L.r4(mediana(oportunidades.map((o) => o.apr))),
    aprP90: L.r4(oportunidades.map((o) => o.apr).sort((a, b) => a - b)[Math.floor(oportunidades.length * 0.9)] || 0),
    nota: `Das ${oportunidades.length} oportunidades distintas observadas (6 exchanges), ${positivas.length} têm EV líquido positivo com payback ≤${H_MAX}h (margem ${L.MARGEM_PAYBACK}×). ESTE É UM LIMITE SUPERIOR: assume que dá p/ segurar até ${H_MAX}h. A vida real de cada oportunidade NÃO está no bruto (só ts/spread/apr/vol) — e é justamente ela que derruba o número.`,
    respostaItem1: `As saldo-rejeições do motor tinham features zeradas (rejeitadas antes de avaliar). Recomputando do bruto com hold-máx de ${H_MAX}h, até ${positivas.length} oportunidades PODERIAM ser positivas; mas o motor, usando a VIDA REAL de cada oportunidade, aprovou só ~13 (v1.1) — as demais não vivem tempo suficiente p/ pagar o round-trip. Em ambos os casos: 0 positivas bloqueadas por CAPITAL (margem/posição = US$${MARGEM_POS}). O gargalo é vida/oferta de EV+, não capital.`,
    limiteSuperiorVsReal: { upperBoundHoldMax: positivas.length, realDoMotorV1: 13, motivoDiferenca: 'vida esperada por oportunidade (ausente no bruto) — o motor exige payback dentro da vida observada; o modelo assume hold até ' + H_MAX + 'h.' },
  };

  // ── item 2: Opportunity Frontier por nível de capital ────────────────────────
  const niveis = [200, 300, 400, 600, 800, 1000];
  const janelaH = (tsMax - tsMin) / 3.6e6;
  const frontier = niveis.map((C) => {
    const freeMargin = C * (1 - L.RESERVA);
    const maxConcorrentes = Math.min(L.MAX_POSICOES, Math.floor(freeMargin / MARGEM_POS));
    // financiáveis: uma posição individual cabe se margem ≤ free (sempre p/ N=100). O
    // limite real é concorrência (maxConcorrentes) sobre o fluxo de oportunidades.
    const positivasFinanciaveis = positivas.filter((o) => o.capitalNecessario <= freeMargin);
    const positivasBloqueadasPorMargem = positivas.filter((o) => o.capitalNecessario > freeMargin);
    // PnL potencial: EV das positivas que caberiam, limitado por concorrência × rotatividade.
    const evPoolTotal = positivasFinanciaveis.reduce((s, o) => s + o.evLiquidoUSD, 0);
    // achievable: limitado por CONCORRÊNCIA (maxConcorrentes posições), não pelo pool total.
    const evPorPosMedia = positivas.length ? evPoolTotal / positivas.length : 0;
    const pnlConcorrenciaLimitado = evPorPosMedia * maxConcorrentes; // proxy: nº de slots × EV médio
    const capitalHoras = maxConcorrentes * MARGEM_POS * H_MAX;
    return {
      capital: C, maxConcorrentes, positivasObservadas: positivas.length,
      positivasFinanciaveis: positivasFinanciaveis.length, positivasBloqueadasPorCapital: positivasBloqueadasPorMargem.length,
      evPoolTotalUSD_upperBound: L.r4(evPoolTotal), pnlLiquidoConcorrenciaLimitadoUSD: L.r4(pnlConcorrenciaLimitado),
      capitalHoras: L.r2(capitalHoras), capitalOciosoUSD: L.r2(Math.max(0, freeMargin - maxConcorrentes * MARGEM_POS)),
    };
  });
  for (let i = 1; i < frontier.length; i++) { const dC = frontier[i].capital - frontier[i - 1].capital; const dP = frontier[i].pnlLiquidoConcorrenciaLimitadoUSD - frontier[i - 1].pnlLiquidoConcorrenciaLimitadoUSD; frontier[i].retornoMarginalPorDolar = L.r4(dP / dC); }
  frontier[0].retornoMarginalPorDolar = null;

  const saturacaoEconomica = MARGEM_POS * L.MAX_POSICOES / (1 - L.RESERVA); // capital p/ 3 posições
  const out = {
    schema: 'snowball.opportunity-frontier.v1_2', geradoEm: new Date(asOf || 0).toISOString(), asOfMs: asOf,
    modeloEconomico: { takerFee: TAKER, slippage: SLIP, custoRoundTripFrac: CUSTO_FRAC, horizonteMaxH: H_MAX, notionalRef: NOTIONAL_REF, margemPorPosicao: MARGEM_POS, margemPayback: L.MARGEM_PAYBACK, fonte: 'src/config.ts + src/backtest/engine.ts' },
    janela: { inicio: new Date(tsMin).toISOString(), fim: new Date(tsMax).toISOString(), horas: L.r2(janelaH) },
    item1_observerPreSaldo: economiaObserver,
    item2_opportunityFrontier: {
      frontier,
      saturacao: {
        operacionalObservada: 'Champion nunca passou de 3 posições / US$232,83 de margem (v1.1).',
        economicaComprovada: `~US$${L.r2(saturacaoEconomica)}: acima disso o capital não financia mais posições concorrentes (limite maxPos=${L.MAX_POSICOES}) nem há EV+ suficiente. Capital extra fica ocioso.`,
        desconhecidaPorFeatures: `${semFeatures} observações sem apr/spread + ausência de "vida esperada" por observação → viabilidade é ESTIMADA (modelo), não a decisão exata do motor.`,
      },
      conclusao: `A fronteira satura ~US$${L.r2(saturacaoEconomica)} (3 posições concorrentes). Positivas bloqueadas por capital: ${frontier.every((f) => f.positivasBloqueadasPorCapital === 0) ? '0 em todos os níveis' : 'ver tabela'}. O gargalo é OFERTA de EV+ (${positivas.length} oportunidades) + limite de 3 posições, não capital.`,
    },
    honestidade: 'observed (spread/apr/vol brutos) + simulated (EV recomputado por modelo documentado). Não é a decisão exata do motor (que zerou as features das saldo-rejeições). Nenhuma ordem, nenhum capital movido.',
  };
  const p = L.writeJSON('opportunity-frontier.json', out);
  console.log(JSON.stringify({ saida: p, oportunidadesDistintas: oportunidades.length, viaveis: viaveis.length, positivasEV: positivas.length,
    aprMediano: economiaObserver.aprMedianoGlobal, aprP90: economiaObserver.aprP90, saturacaoEconomica: L.r2(saturacaoEconomica),
    frontier: frontier.map((f) => `$${f.capital}: concorrentes ${f.maxConcorrentes} bloq.capital ${f.positivasBloqueadasPorCapital} pnlLim ${f.pnlLiquidoConcorrenciaLimitadoUSD} mrg ${f.retornoMarginalPorDolar}`) }, null, 2));
}
build();
