#!/usr/bin/env node
'use strict';
/**
 * PARTE 5 — Exchange Selection Engine (shadow, read-only). Avalia as 15 combinações
 * de 2-de-6 exchanges operacionais por replay CRONOLÓGICO verdadeiro, sem filtrar
 * retrospectivamente só as vencedoras. Duas visões:
 *   A) LANDSCAPE observado (candidate-observations, janela de scan comum a todos os
 *      pares): frequência, EV positivo, custo, spread, consistência, bloqueio por
 *      ordem mínima com US$100/perna.
 *   B) REALIZADO (posições reais do Champion no diário, história completa): funding e
 *      custo atribuídos ao par de cada posição → PnL líquido por par.
 * Emite exchange-pair-ranking.jsonl + exchange-selector.json. NÃO move capital.
 */
const L = require('./lib-progression.cjs');

const OPER = L.EXCHANGES; // 6 operacionais
const combos = [];
for (let i = 0; i < OPER.length; i++) for (let j = i + 1; j < OPER.length; j++) combos.push([OPER[i], OPER[j]]);
const pairKey = (a, b) => [a, b].sort().join('+');

function build() {
  const { estado, asOf } = L.loadChampion();
  const FREE_AT_100 = 2 * L.ALVO_POR_EXCHANGE * (1 - L.RESERVA); // margem livre com US$100/exchange (2 pernas) menos reserva 30% = 140

  // ── VIEW A: landscape observado (candidatos) ────────────────────────────────
  const cand = L.jsonl(L.P.candidatos).filter((c) => c && c.opportunityKey);
  const A = {}; for (const c of combos) A[pairKey(c[0], c[1])] = { obs: 0, evPos: 0, aprovadas: 0, sumEVpos: 0, sumCusto: 0, spread: 0, consist: 0, fundableAt100: 0, blockMinOrder: 0, symbols: new Set() };
  let janMin = Infinity, janMax = 0, foraOperacional = 0;
  for (const c of cand) {
    const [sym, long, short] = c.opportunityKey.split('|');
    if (!OPER.includes(long) || !OPER.includes(short)) { foraOperacional++; continue; }
    const k = pairKey(long, short); const a = A[k]; if (!a) continue;
    const f = c.features || {};
    a.obs++; a.symbols.add(sym);
    a.spread += f.spread || 0; a.consist += f.consistencia || 0; a.sumCusto += f.custo || 0;
    if ((f.valorEsperado || 0) > 0) { a.evPos++; a.sumEVpos += f.valorEsperado; }
    if (c.aprovada) a.aprovadas++;
    if ((f.capitalNecessario || 0) > 0 && f.capitalNecessario <= FREE_AT_100) a.fundableAt100++;
    else if ((f.capitalNecessario || 0) > FREE_AT_100) a.blockMinOrder++;
    if (c.ts < janMin) janMin = c.ts; if (c.ts > janMax) janMax = c.ts;
  }

  // ── VIEW B: realizado por par (reconstrução das posições do diário) ──────────
  const { eventos } = L.serieEconomica();
  const abertas = {}; // symbol -> {pair, funding, custo, abreTs}
  const realizadoPar = {}; for (const c of combos) realizadoPar[pairKey(c[0], c[1])] = { posicoes: 0, funding: 0, custo: 0, pnl: 0 };
  const foraPar = { posicoes: 0, funding: 0, custo: 0, pnl: 0 }; // pares fora dos 6 operacionais (não deve ocorrer, mas honesto)
  for (const e of eventos.sort((x, y) => x.ts - y.ts)) {
    if (e.evento === 'abre' || e.evento === 'abre-captura') {
      const long = e.long, short = e.short;
      abertas[e.symbol] = { pair: (OPER.includes(long) && OPER.includes(short)) ? pairKey(long, short) : null, funding: 0, custo: e.custo || 0 };
    } else if (e.evento === 'funding' && abertas[e.symbol]) {
      abertas[e.symbol].funding += e.ganho || 0;
    } else if ((e.evento === 'escalona' || e.evento === 'apara' || e.evento === 'socorre' || e.evento === 'reinveste') && abertas[e.symbol]) {
      abertas[e.symbol].custo += e.custo || 0;
    } else if (e.evento === 'fecha' && abertas[e.symbol]) {
      const o = abertas[e.symbol]; o.custo += e.custo || 0;
      const bucket = o.pair && realizadoPar[o.pair] ? realizadoPar[o.pair] : foraPar;
      bucket.posicoes++; bucket.funding += o.funding; bucket.custo += o.custo; bucket.pnl += o.funding - o.custo;
      delete abertas[e.symbol];
    }
  }
  // posições ainda abertas: atribui funding acumulado observado (estado.posicoes)
  for (const p of (estado.posicoes || [])) {
    const k = (OPER.includes(p.exchangeLong) && OPER.includes(p.exchangeShort)) ? pairKey(p.exchangeLong, p.exchangeShort) : null;
    const b = k && realizadoPar[k] ? realizadoPar[k] : foraPar;
    b.posicoes++; b.funding += p.fundingAcumulado || 0; b.pnl += p.fundingAcumulado || 0; // custo de fechamento ainda não realizado
  }

  // ── ranking ────────────────────────────────────────────────────────────────
  const linhas = combos.map(([a, b]) => {
    const k = pairKey(a, b); const va = A[k]; const vb = realizadoPar[k];
    return {
      par: k, exchanges: [a, b],
      landscape: { obs: va.obs, oportunidadesEVpositivo: va.evPos, aprovadas: va.aprovadas, somaEVpositivo: L.r4(va.sumEVpos), somaCusto: L.r4(va.sumCusto),
        spreadMedio: va.obs ? L.r4(va.spread / va.obs) : 0, consistenciaMedia: va.obs ? L.r4(va.consist / va.obs) : 0,
        symbolsDistintos: va.symbols.size, fundavelCom100PorPerna: va.fundableAt100, bloqueadasPorOrdemMinima: va.blockMinOrder },
      realizado: { posicoes: vb.posicoes, funding: L.r4(vb.funding), custo: L.r4(vb.custo), pnlLiquido: L.r4(vb.pnl) },
    };
  }).sort((x, y) => y.realizado.pnlLiquido - x.realizado.pnlLiquido || y.landscape.oportunidadesEVpositivo - x.landscape.oportunidadesEVpositivo);
  linhas.forEach((l, i) => { l.rank = i + 1; });

  const totalRealizado = Object.values(realizadoPar).reduce((s, v) => s + v.pnl, 0) + foraPar.pnl;
  const melhorPar = linhas[0];
  const perdaAoRestringir = L.r4(totalRealizado - (melhorPar ? melhorPar.realizado.pnlLiquido : 0));
  const totalEVpos = linhas.reduce((s, l) => s + l.landscape.oportunidadesEVpositivo, 0);

  const janH = janMax > janMin ? L.r2((janMax - janMin) / 3.6e6) : 0;
  const AMOSTRA_SUFICIENTE = totalEVpos >= 30 && janH >= 24 * 14; // ≥30 EV+ e ≥2 semanas (proxy p/ 2 janelas/regimes)

  const selector = {
    schema: 'snowball.exchange-selector.v1', geradoEm: new Date(asOf || 0).toISOString(), asOfMs: asOf,
    metodo: 'replay cronológico; sem seleção retrospectiva de vencedores; common-window por construção (scans varrem todas as exchanges no mesmo ciclo).',
    exchangesOperacionais: OPER, combinacoes: combos.length,
    janelaLandscape: { inicio: janMin === Infinity ? null : new Date(janMin).toISOString(), fim: janMax ? new Date(janMax).toISOString() : null, horas: janH, candidatosForaDos6Operacionais: foraOperacional },
    margemLivreCom100PorPerna: FREE_AT_100,
    respostas: {
      maiorPnlLiquidoRealizado: melhorPar ? { par: melhorPar.par, pnl: melhorPar.realizado.pnlLiquido } : null,
      maisOportunidadesEVpositivo: [...linhas].sort((a, b) => b.landscape.oportunidadesEVpositivo - a.landscape.oportunidadesEVpositivo).slice(0, 3).map((l) => ({ par: l.par, evPos: l.landscape.oportunidadesEVpositivo })),
      maisBloqueadasPorOrdemMinima: [...linhas].sort((a, b) => b.landscape.bloqueadasPorOrdemMinima - a.landscape.bloqueadasPorOrdemMinima).slice(0, 3).map((l) => ({ par: l.par, bloqueadas: l.landscape.bloqueadasPorOrdemMinima })),
      lucroPerdidoAoRestringirA2Exchanges: perdaAoRestringir,
      duasExchangesSaoSuficientes: null, // ver veredito
    },
    veredito: {
      suficienteParaEscolher2: AMOSTRA_SUFICIENTE,
      motivo: AMOSTRA_SUFICIENTE ? 'amostra suficiente' : `INSUFICIENTE: só ${totalEVpos} oportunidades de EV positivo numa janela de ${janH}h (1 janela). A regra do Snowball proíbe escolher 2 exchanges por uma única janela / lucro histórico bruto.`,
      recomendacao: 'Continuar coletando o landscape em ≥2 janelas e ≥2 regimes antes de fixar as 2 exchanges operacionais. O ranking abaixo é DIRECIONAL, não decisão.',
    },
    honestidade: 'O capitalNecessario/saldoDisponivel dos candidatos reflete a config viva (US$600/6 exchanges), não um cenário hipotético de US$200/2 exchanges — a coluna fundavelCom100PorPerna é aproximação. Realizado é enviesado para os pares que o Champion escolheu (ele só abre o melhor).',
    ranking: linhas,
  };

  const p1 = L.writeJSONL('exchange-pair-ranking.jsonl', linhas);
  const p2 = L.writeJSON('exchange-selector.json', selector);
  console.log(JSON.stringify({ saidas: [p1, p2], combinacoes: combos.length, janelaH: janH, candidatosForaOperacional: foraOperacional,
    totalEVpositivo: totalEVpos, suficiente: AMOSTRA_SUFICIENTE, melhorParRealizado: melhorPar ? `${melhorPar.par} (pnl ${melhorPar.realizado.pnlLiquido})` : null,
    lucroPerdidoRestringindo2: perdaAoRestringir, top5: linhas.slice(0, 5).map((l) => `${l.rank}. ${l.par}: pnl ${l.realizado.pnlLiquido}, EV+ ${l.landscape.oportunidadesEVpositivo}, obs ${l.landscape.obs}`) }, null, 2));
}
build();
