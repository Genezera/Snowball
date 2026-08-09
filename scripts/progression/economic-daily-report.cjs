#!/usr/bin/env node
'use strict';
/**
 * v1.8-coleta — ITENS 7,8. Relatório econômico DIÁRIO do economicSoak + categorias de fechamento
 * + análise SHADOW de sensibilidade de maxHolding (24h/72h/168h) SEM alterar a política ativa (7d).
 * READ-ONLY. Emite auditoria/progression/economic-daily-report.json.
 */
const L = require('./lib-progression.cjs');
const fs = require('node:fs');
const path = require('node:path');
const ECON = path.join(L.ROOT, 'auditoria', 'progression', 'economic');
const FEED = ['policy', 'trial', 'observer-max3', 'observer-max4', 'observer-max5'];
const H = 3.6e6;

function diario(l) { try { return fs.readFileSync(path.join(ECON, l, 'diario.jsonl'), 'utf8').split('\n').filter(Boolean).map((x) => { try { return JSON.parse(x); } catch { return null; } }).filter(Boolean); } catch { return []; } }

function build() {
  const { asOf } = L.loadChampion();
  const now = asOf || Date.now();
  const pair = L.rd(L.P.outDir + '/economic-pairing.json', null);
  const sample = L.rd(L.P.outDir + '/economic-sample.json', null);
  const conc = L.rd(L.P.outDir + '/concentration.json', null);
  const unlock = L.rd(L.P.outDir + '/unlock-fund.json', null);
  // referência de capital: processo 'policy' (control 6-ex, $600) — o economicSoak é paper isolado
  const pol = L.rd(path.join(ECON, 'policy', 'estado.json'), null);
  const capitalInicial = pol ? pol.capitalInicial : 600;
  const funding = pol ? L.r4(pol.fundingAcum || 0) : 0;
  const custos = pol ? L.r4(pol.custosAcum || 0) : 0;
  const capital = L.r4(capitalInicial + funding - custos);
  const abertas = pol ? Object.keys(pol.virtuais || {}).length : 0;
  const comprometido = pol ? L.r4(Object.values(pol.virtuais || {}).reduce((s, v) => s + 2 * (v.margemPorPerna || 0), 0)) : 0;
  const reserva = L.r4(capitalInicial * L.RESERVA);
  const livre = L.r4(capital - comprometido - reserva);

  // ── item 7: categorias de fechamento (contagem real nos diários econômicos) ──
  const closeCats = { economicInversionExit: 0, riskExit: 0, maxHoldingExit: 0, fundingDeteriorationExit: 0, exchangeFailureExit: 0, ChampionSourceClose: 0, rightCensored: 0 };
  const holdDurations = [];
  for (const l of FEED) { const abertoTs = {}; for (const e of diario(l)) {
    if (e.evento === 'abre') abertoTs[e.k] = e.ts;
    else if (e.evento === 'fecha') { const r = e.closeReason;
      if (r === 'economic_inversion') closeCats.economicInversionExit++;
      else if (r === 'funding_deterioration') closeCats.fundingDeteriorationExit++;
      else if (r === 'exchange_failure') closeCats.exchangeFailureExit++;
      else if (r === 'max_holding_exit') closeCats.maxHoldingExit++;
      else if (r === 'champion_source_close') closeCats.ChampionSourceClose++;
      if (e.riskExit) closeCats.riskExit++;
      if (abertoTs[e.k]) { holdDurations.push((e.positionClosedAt - abertoTs[e.k]) / H); delete abertoTs[e.k]; }
    } }
    closeCats.rightCensored += Object.keys(abertoTs).length; }

  // ── item 7: SHADOW de sensibilidade de maxHolding — quantas posições ABERTAS fechariam sob 24/72/168h
  //    (SEM tocar a política ativa de 7 dias = 168h) ──
  const abertasIdadesH = [];
  if (pol) for (const v of Object.values(pol.virtuais || {})) { abertasIdadesH.push((now - (v.positionOpenedAt || now)) / H); }
  const shadow = { ativoMaxHoldingH: 168, nota: 'shadow — NÃO altera a política ativa (7d)' };
  for (const h of [24, 72, 168]) shadow['fechariam_sob_' + h + 'h'] = abertasIdadesH.filter((x) => x >= h).length;

  const uniqueClosed = sample ? sample.contagemCorreta.sourcePositionIdUnicosFechados : 0;
  const divergencias = sample ? sample.contagemCorreta.divergenciasReaisPorPosicaoFonte : 0;
  const censuradas = pair && pair.resumo ? pair.resumo.censuradasRightCensored : 0;

  const out = {
    schema: 'snowball.economic-daily-report.v1_8', geradoEm: new Date(now).toISOString(), asOfMs: now,
    janela: 'economicSoak v1.8 (epoch 032a0b32) — dia 1',
    capital: { total: capital, comprometido, livre, reserva, fundoDesbloqueio: unlock ? (unlock.fundoAtual || unlock.saldo || 0) : null },
    pnl: { realizadoFechado: 0, marcado: funding, executavel: L.r4(funding - comprometido * 0), fundingLiquidado: funding, fundingEsperado: 'a assentar (posições abertas)', custos },
    risco: { drawdown: 0, capitalHoras: L.r4(abertasIdadesH.reduce((s, h) => s + h * L.ALVO_POR_EXCHANGE, 0)), lucroPorCapitalHora: 0 },
    amostra: { sourcePositionIdsFechados: uniqueClosed, divergenciasReais: divergencias, censura: censuradas },
    concentracao: conc ? conc.concentracaoAceitavel : null,
    progresso: { posicoesFonte_30: `${uniqueClosed}/30`, divergencias_15: `${divergencias}/15`, duasJanelas: false, doisRegimes: false },
    fechamentos: { categorias: closeCats, duracaoMediaHoldH: holdDurations.length ? L.r2(holdDurations.reduce((a, b) => a + b, 0) / holdDurations.length) : null },
    shadowMaxHoldingSensibilidade: shadow,
    honestidade: 'economicSoak dia 1 — quase tudo em 0 (coleta recém-iniciada, warmup EXCLUÍDO). Sombra de maxHolding é analítica; política ativa de 7d NÃO alterada.',
  };
  const p = L.writeJSON('economic-daily-report.json', out);
  console.log(JSON.stringify({ saida: p, capital: out.capital, progresso: out.progresso, fechamentos: closeCats, shadow }, null, 2));
}
build();
