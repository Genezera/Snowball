#!/usr/bin/env node
'use strict';
/**
 * v1.8 — ITEM 6. RISK GUARDIAN (paper-only, NENHUMA ordem, NÃO altera política econômica). Monitora
 * as posições do Champion e o ambiente e emite ALERTAS/decisões PAPER: distância da liquidação,
 * movimento desde a entrada, saúde de exchange, perna órfã, saldos incompatíveis, feed stale,
 * posição sem gerenciamento. Níveis: SAFE / WARNING / CRITICAL / EMERGENCY_EXIT_RECOMMENDED.
 * READ-ONLY. Uso: node risk-guardian.cjs [--once] [--intervalo 60]. Emite risk-guardian.json.
 */
const L = require('./lib-progression.cjs');
const fs = require('node:fs');
const path = require('node:path');
const ONCE = !process.argv.includes('--daemon');   // default: single-shot (seguro p/ pipeline). --daemon p/ loop.
const opt = (n, d) => (process.argv.includes(n) ? process.argv[process.argv.indexOf(n) + 1] : d);
const INTERVALO_S = Number(opt('--intervalo', 60));
// calibrado ao incidente BICO real (movimento 11,6% + distância 5,3% ≈ 17% de limiar de liquidação p/ 5x)
const LIQ_THRESHOLD = 0.17;
const FEED_STALE_MS = 15 * 60000, MOTOR_STALE_MS = 12 * 60000;
const rd = (p, d) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return d; } };

function nivelPior(a, b) { const ord = { SAFE: 0, WARNING: 1, CRITICAL: 2, EMERGENCY_EXIT_RECOMMENDED: 3 }; return ord[a] >= ord[b] ? a : b; }

function ciclo() {
  const { estado: champ, asOf } = L.loadChampion();
  const now = Date.now();
  const marc = rd(path.join(L.ROOT, 'spread', 'marcacao.json'), null);
  const OBS = path.join(L.ROOT, 'vigilancia', 'arquivo-observacoes.jsonl');
  let obsAgeMs = null; try { obsAgeMs = now - fs.statSync(OBS).mtimeMs; } catch {}
  let motorAgeMs = null; try { motorAgeMs = now - fs.statSync(path.join(L.ROOT, 'spread', 'estado.json')).mtimeMs; } catch {}
  const feedStale = obsAgeMs != null && obsAgeMs > FEED_STALE_MS;
  const posicaoSemGerenciamento = motorAgeMs != null && motorAgeMs > MOTOR_STALE_MS;

  const marcPos = marc && marc.posicoes ? Object.fromEntries(marc.posicoes.map((p) => [p.symbol, p])) : {};
  const posicoes = (champ && champ.posicoes ? champ.posicoes : []).map((p) => {
    const mp = marcPos[p.symbol];
    let adverseShort = 0, adverseLong = 0, movimento = 0, pernaOrfa = false;
    if (mp) {
      adverseShort = (mp.markPriceShort - mp.precoEntradaShort) / mp.precoEntradaShort;   // short perde se preço sobe
      adverseLong = (mp.precoEntradaLong - mp.markPriceLong) / mp.precoEntradaLong;        // long perde se preço cai
      movimento = Math.max(Math.abs((mp.markPriceShort - mp.precoEntradaShort) / mp.precoEntradaShort), Math.abs((mp.markPriceLong - mp.precoEntradaLong) / mp.precoEntradaLong));
      pernaOrfa = (mp.notionalShort > 0) !== (mp.notionalLong > 0);
    } else if (p.precoEntrada && p.precoUltimo) { movimento = Math.abs((p.precoUltimo - p.precoEntrada) / p.precoEntrada); adverseShort = adverseLong = movimento; }
    const piorAdverse = Math.max(adverseShort, adverseLong, 0);
    const distLiq = LIQ_THRESHOLD - piorAdverse;   // fração até a liquidação da perna pior
    let nivel = 'SAFE';
    if (distLiq <= 0.06) nivel = 'EMERGENCY_EXIT_RECOMMENDED';
    else if (distLiq <= 0.10) nivel = 'CRITICAL';
    else if (distLiq <= 0.15) nivel = 'WARNING';
    if (pernaOrfa) nivel = nivelPior(nivel, 'CRITICAL');
    if (posicaoSemGerenciamento) nivel = nivelPior(nivel, 'CRITICAL');
    return { symbol: p.symbol, exchanges: [p.exchangeLong, p.exchangeShort], movimentoDesdeEntradaPct: L.r2(movimento * 100), distanciaLiquidacaoPct: L.r2(distLiq * 100), pernaOrfa, nivel, faltasSeguidas: p.faltasSeguidas, abertaHhoras: L.r2((now - p.abertaEm) / 3.6e6) };
  });

  // saldos incompatíveis (reconciliação do Champion)
  const somaSaldos = champ ? Object.values(champ.saldos || {}).reduce((s, v) => s + v, 0) : 0;
  const saldosIncompativeis = champ ? Math.abs(somaSaldos - champ.capital) > 0.01 : false;

  const globais = [];
  if (feedStale) globais.push({ tipo: 'FEED_STALE', nivel: 'WARNING', idadeMin: Math.round(obsAgeMs / 60000) });
  if (posicaoSemGerenciamento) globais.push({ tipo: 'POSICAO_SEM_GERENCIAMENTO', nivel: 'CRITICAL', motorParadoMin: Math.round(motorAgeMs / 60000) });
  if (saldosIncompativeis) globais.push({ tipo: 'SALDOS_INCOMPATIVEIS', nivel: 'WARNING', somaSaldos: L.r4(somaSaldos), capital: L.r4(champ ? champ.capital : 0) });

  let nivelGlobal = 'SAFE';
  for (const p of posicoes) nivelGlobal = nivelPior(nivelGlobal, p.nivel);
  for (const g of globais) nivelGlobal = nivelPior(nivelGlobal, g.nivel);

  const out = {
    schema: 'snowball.risk-guardian.v1_8', geradoEm: new Date(asOf || 0).toISOString(), asOfMs: asOf,
    paperOnly: true, semOrdens: true, naoAlteraPolitica: true,
    limiarLiquidacaoEstimado: LIQ_THRESHOLD, calibracao: 'incidente BICO (11,6% move + 5,3% dist ≈ 17%)',
    ambiente: { obsIdadeMin: obsAgeMs != null ? Math.round(obsAgeMs / 60000) : null, feedStale, motorIdadeMin: motorAgeMs != null ? Math.round(motorAgeMs / 60000) : null, posicaoSemGerenciamento },
    posicoes, alertasGlobais: globais, nivelGlobal,
    niveisPossiveis: ['SAFE', 'WARNING', 'CRITICAL', 'EMERGENCY_EXIT_RECOMMENDED'],
    honestidade: 'Guardian PAPER: só observa e recomenda. NÃO executa fechamento nem altera a política econômica. O motor do Champion continua sendo o único que age.',
  };
  const p = L.writeJSON('risk-guardian.json', out);
  console.log(`[risk-guardian] nivelGlobal=${nivelGlobal} | posições ${posicoes.map((x) => x.symbol.split('/')[0] + ':' + x.nivel + '(dist ' + x.distanciaLiquidacaoPct + '%)').join(' ')} | ${globais.map((g) => g.tipo).join(',') || 'sem alertas globais'} → ${p}`);
}

if (ONCE) { ciclo(); } else {
  const LOCK = path.join(L.ROOT, 'auditoria', 'progression', 'risk-guardian.lock');
  const c = rd(LOCK, null); if (c && c.heartbeat && Date.now() - c.heartbeat < 90000) { console.log('[risk-guardian] outra instância viva — saindo'); process.exit(0); }
  fs.writeFileSync(LOCK, JSON.stringify({ pid: process.pid, heartbeat: Date.now() }));
  process.on('SIGINT', () => { try { fs.unlinkSync(LOCK); } catch {} process.exit(0); });
  process.on('SIGTERM', () => { try { fs.unlinkSync(LOCK); } catch {} process.exit(0); });
  console.log('[risk-guardian] iniciado (paper-only, sem ordens)');
  ciclo(); setInterval(() => { try { fs.writeFileSync(LOCK, JSON.stringify({ pid: process.pid, heartbeat: Date.now() })); } catch {} ciclo(); }, INTERVALO_S * 1000);
}
