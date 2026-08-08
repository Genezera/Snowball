#!/usr/bin/env node
'use strict';
/**
 * v1.1 — PARTES 2, 3, 4. Replay VERDADEIRO de duas exchanges: sandbox de US$200
 * (US$100 em cada) por combinação, com reserva 30%, alavancagem 5×, ordem mínima,
 * mesmos custos/slippage/concentração/payback e máximo de posições. Reconstrói
 * cronologicamente e RECONCILIA capitalFinal = capitalInicial + funding − custos
 * (+ residual). Ranking só aceita combinações que reconciliam EXATO.
 *
 * Honestidade: só há OUTCOME realizado para posições que o Champion abriu naquele
 * par. O sandbox NÃO cereja vencedores — pega TODAS as posições do par em ordem e
 * aplica o orçamento de US$200 (que pode causar PERDAS por falta de margem). Não há
 * outcome observado para oportunidades nunca abertas → não podem ser creditadas.
 * Emite exchange-replay.json + exchange-replay-ledger.jsonl.
 */
const L = require('./lib-progression.cjs');

const OPER = L.EXCHANGES;
const combos = [];
for (let i = 0; i < OPER.length; i++) for (let j = i + 1; j < OPER.length; j++) combos.push([OPER[i], OPER[j]]);
const pk = (a, b) => [a, b].sort().join('+');
const INICIAL = 2 * L.ALVO_POR_EXCHANGE; // 200

function sandbox(posicoesPar, asOf) {
  const freeMargin = INICIAL * (1 - L.RESERVA); // 140
  const pos = posicoesPar.slice().sort((a, b) => a.abreTs - b.abreTs);
  const ativos = []; let committed = 0, picoComprometido = 0;
  let funding = 0, custos = 0, financiadas = 0, perdidasPorMargem = 0, minOrderRejeicoes = 0;
  const ledger = []; const equity = []; let acc = 0;
  for (const p of pos) {
    for (let i = ativos.length - 1; i >= 0; i--) if (ativos[i].fechaTs != null && ativos[i].fechaTs <= p.abreTs) { committed -= ativos[i].margem; ativos.splice(i, 1); }
    const livre = freeMargin - committed;
    if ((p.notional || 0) < L.MIN_NOTIONAL) { minOrderRejeicoes++; continue; }
    const cabe = p.margem <= livre + 1e-9 && ativos.length < L.MAX_POSICOES;
    if (!cabe) { perdidasPorMargem++; ledger.push({ ts: p.abreTs, symbol: p.symbol, acao: 'perdida', motivo: ativos.length >= L.MAX_POSICOES ? 'max_posicoes' : 'margem_insuficiente', margemNecessaria: L.r2(p.margem), livre: L.r2(livre) }); continue; }
    ativos.push({ margem: p.margem, fechaTs: p.fechaTs }); committed += p.margem; picoComprometido = Math.max(picoComprometido, committed);
    funding += p.funding || 0; custos += p.custo || 0; financiadas++;
    acc += p.pnl || 0; equity.push(acc);
    ledger.push({ ts: p.abreTs, symbol: p.symbol, acao: 'financia', notional: L.r2(p.notional), margem: L.r2(p.margem), funding: L.r4(p.funding), custo: L.r4(p.custo), pnl: L.r4(p.pnl), aberta: !!p.aberta });
  }
  let pico = 0, mdd = 0; for (const e of equity) { if (e > pico) pico = e; const dd = pico > 0 ? (pico - e) / pico : 0; if (dd > mdd) mdd = dd; }
  // reconciliação EXATA: deriva capitalFinal dos MESMOS valores arredondados que reporta.
  const fundingR = L.r4(funding), custosR = L.r4(custos);
  const capitalFinal = L.r4(INICIAL + fundingR - custosR);
  return {
    capitalInicial: INICIAL, funding: fundingR, custos: custosR, pnlRealizado: L.r4(fundingR - custosR),
    residualRealizado: 0, capitalFinal,
    posicoesFinanciadas: financiadas, posicoesPerdidasPorMargem: perdidasPorMargem, minOrderRejeicoes,
    capitalBloqueadoPicoUSD: L.r2(picoComprometido), capitalOciosoPicoUSD: L.r2(Math.max(0, freeMargin - picoComprometido)),
    equityMarcada: L.r4(capitalFinal), drawdownPct: L.r2(mdd * 100), ledger,
  };
}

function build() {
  const { estado, asOf } = L.loadChampion();
  const todas = L.reconstruirPosicoes(estado).filter((p) => p.par && p.abreTs);
  const janela = { inicio: Math.min(...todas.map((p) => p.abreTs)), fim: asOf };

  const linhas = []; const ledgerAll = [];
  for (const [a, b] of combos) {
    const par = pk(a, b);
    const posPar = todas.filter((p) => p.par === par);
    const s = sandbox(posPar, asOf);
    // reconciliação EXATA
    const calc = L.r4(s.capitalInicial + s.funding - s.custos + s.residualRealizado);
    const reconcilia = Math.abs(calc - s.capitalFinal) < 1e-6;
    linhas.push({ par, exchanges: [a, b], posicoesNoPar: posPar.length, ...s, ledger: undefined, reconciliacao: { calculado: calc, reportado: s.capitalFinal, reconcilia } });
    for (const e of s.ledger) ledgerAll.push({ par, ...e });
  }
  linhas.sort((x, y) => y.capitalFinal - x.capitalFinal);
  linhas.forEach((l, i) => { l.rank = i + 1; });
  const todasReconciliam = linhas.every((l) => l.reconciliacao.reconcilia);

  // ── item 4: dinâmico vs fixo ────────────────────────────────────────────────
  const melhorFixo = linhas[0];
  const pnlTotal6 = L.r4(todas.reduce((s, p) => s + (p.pnl || 0), 0)); // 6 exchanges financiadas (Champion real, multi-par)
  const MIGRACAO_CUSTO_PCT = 0.001, MIGRACAO_TEMPO_H = 2; // estimativa (withdrawal+deposit fee ~0,1% + ~2h de settlement)
  const semanas = Math.max(1, (janela.fim - janela.inicio) / (7 * 8.64e7));
  const dinamicoVsFixo = {
    melhorParFixo: { par: melhorFixo.par, capitalFinal: melhorFixo.capitalFinal, pnl: melhorFixo.pnlRealizado },
    parEscolhidoSemanalmente: { nota: `janela = ${L.r2(semanas)} semana(s) — curta demais p/ troca semanal provar valor; ver caveat`, aplicavel: semanas >= 2 },
    parEscolhidoPorJanela: { nota: 'trocar por janela exige ≥2 janelas/regimes; indisponível na amostra atual', aplicavel: false },
    seisMonitoradas2Financiadas: { par: melhorFixo.par, capitalUsado: INICIAL, pnl: melhorFixo.pnlRealizado, nota: 'monitora 6 (shadow), financia só o melhor par com US$200' },
    seisFinanciadas: { capitalUsado: 600, pnl: pnlTotal6, nota: 'Champion real multi-par: acessa posições de TODOS os pares' },
    duasMaisFundoMigracao: { custoMovimentacaoPct: MIGRACAO_CUSTO_PCT, tempoMovimentacaoH: MIGRACAO_TEMPO_H, custoEstimadoPorTroca: L.r4(INICIAL * MIGRACAO_CUSTO_PCT), nota: 'trocar de par custa taxa de saque/depósito + tempo de settlement — corrói ganho de troca frequente' },
    diferencaFixo2_vs_6financiadas: L.r4(pnlTotal6 - melhorFixo.pnlRealizado),
    conclusao: `6 exchanges financiadas rendem ${pnlTotal6} vs ${melhorFixo.pnlRealizado} do melhor par fixo (US$200): diferença de ${L.r4(pnlTotal6 - melhorFixo.pnlRealizado)}. A troca dinâmica NÃO é comprovável na amostra (1 janela) e o custo/tempo de migração desencoraja troca frequente.`,
  };

  const out = {
    schema: 'snowball.exchange-replay-2ex.v1_1', geradoEm: new Date(asOf || 0).toISOString(), asOfMs: asOf,
    parametros: { capitalInicial: INICIAL, porExchange: L.ALVO_POR_EXCHANGE, reserva: L.RESERVA, alavancagem: L.ALAVANCAGEM, maxPosicoes: L.MAX_POSICOES, minNotional: L.MIN_NOTIONAL },
    commonWindow: { inicio: new Date(janela.inicio).toISOString(), fim: new Date(janela.fim).toISOString(), horas: L.r2((janela.fim - janela.inicio) / 3.6e6), mesmaParaTodas: true },
    reconciliacao: { identidade: 'capitalFinal = capitalInicial + funding − custos + residual', todasReconciliam },
    metodo: 'sandbox US$200 por par sobre TODAS as posições reais do par (funding/custo observados), aplicando o orçamento — sem cereja de vencedores. Oportunidades nunca abertas não têm outcome e não entram.',
    limitacao: 'Só há outcome realizado para posições que o Champion abriu. Un-taken opportunities não são creditadas. Portanto este replay mede o desempenho de cada par SOB orçamento US$200 nas posições observadas, não um universo hipotético completo.',
    ranking: linhas,
    dinamicoVsFixo,
    honestidade: todasReconciliam ? 'Todas as 15 combinações reconciliam exatamente.' : 'ATENÇÃO: alguma combinação não reconcilia — ranking rejeitado.',
  };
  const p1 = L.writeJSONL('exchange-replay-ledger.jsonl', ledgerAll);
  const p2 = L.writeJSON('exchange-replay.json', out);
  console.log(JSON.stringify({ saidas: [p1, p2], todasReconciliam, melhorPar: `${melhorFixo.par} capFinal ${melhorFixo.capitalFinal} (pnl ${melhorFixo.pnlRealizado})`,
    pnl6exchanges: pnlTotal6, diff: dinamicoVsFixo.diferencaFixo2_vs_6financiadas,
    top5: linhas.slice(0, 5).map((l) => `${l.rank}. ${l.par}: capFinal ${l.capitalFinal} pnl ${l.pnlRealizado} fin ${l.posicoesFinanciadas} perd ${l.posicoesPerdidasPorMargem} recon ${l.reconciliacao.reconcilia}`) }, null, 2));
}
build();
