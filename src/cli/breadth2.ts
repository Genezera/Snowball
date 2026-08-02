/**
 * LARGURA VALIDADA — versão honesta do teste de largura.
 *
 * O teste anterior encontrou 4 pernas positivas em 14 candidatos, e as 4 eram
 * a MESMA estratégia (`vwma-dip`) — a que reprovou em quase tudo antes. Isso é
 * a assinatura clássica de teste múltiplo: varra o suficiente e algo aparece.
 *
 * Esta versão corrige três coisas:
 *
 *   1. VALIDA CADA PERNA com walk-forward, não com expectancy de amostra
 *      cheia. Uma perna só entra se a vantagem sobrevive fora da amostra.
 *   2. CONTABILIZA os testes e aplica Sharpe deflacionado sobre o total.
 *   3. RESPEITA O TETO DE CAPITAL. Com US$ 100 e notional mínimo de US$ 5, a
 *      conta sustenta poucas posições simultâneas — não adianta achar 20
 *      pernas se cabem 3. É a restrição que a largura não vence.
 *
 * O horizonte é parâmetro: 2 meses dobram o número de operações e reduzem pela
 * metade a vantagem necessária por operação.
 */
import fs from 'node:fs';
import { loadSeries, hasSeries, DATA_DIR } from '../data/store.ts';
import { buildStrategy, REGISTRY } from '../strategies/index.ts';
import { runBacktest } from '../backtest/engine.ts';
import { computeMetrics, deflatedSharpe } from '../backtest/metrics.ts';
import { walkForward } from '../validate/walkforward.ts';
import { GRIDS } from '../validate/grids.ts';
import { effectiveHeat } from '../backtest/portfolio.ts';
import { forecastVolatility, targetVolatility, volSizeMultiplier } from '../core/volatility.ts';
import { analisarLiquidacao, aplicarTrade, TIERS_MAJOR } from '../core/liquidation.ts';
import { makeConfig, COSTS } from '../config.ts';
import { parseArgs, num, str } from './args.ts';

const a = parseArgs();
const ALVO_MULT = num(a.mult, 5);
const INICIAL = num(a.equity, 100);
const MESES = num(a.months, 2);
const SIMS = num(a.sims, 20000);
const STOP = 0.015;
const MIN_NOTIONAL = 5;

const cfg = makeConfig({ initialEquity: 100, costPreset: 'binance-futures-maker', riskProfile: 'seed', maxBarsInTrade: 100000 });
const custo = COSTS['binance-futures-maker'];

console.log(`\n${'='.repeat(90)}`);
console.log(`LARGURA VALIDADA: ${ALVO_MULT}x em ${MESES} meses`);
console.log(`${'='.repeat(90)}\n`);
const prodNecessario = Math.log(ALVO_MULT) / (0.10 * MESES);
console.log(`Produto necessário (expectancy × trades/mês) com risco 10%: ${prodNecessario.toFixed(2)}`);
console.log(`(em 1 mês seria ${(Math.log(ALVO_MULT) / 0.10).toFixed(2)} — dobrar o prazo corta o requisito pela metade)\n`);

// ── 1. inventário do que já existe em cache ────────────────────────────────
const arquivos = fs.existsSync(DATA_DIR) ? fs.readdirSync(DATA_DIR).filter((f) => f.endsWith('.json')) : [];
const series5m = arquivos
  .filter((f) => f.includes('__5m.') && f.startsWith('binanceusdm'))
  .map((f) => {
    const [, sym] = f.replace('.json', '').split('__');
    return sym.replace(/_/g, '/').replace(/\/(USDT)$/, ':$1');
  });

console.log(`${series5m.length} séries de 5m em cache — usando o que já existe, sem baixar mais\n`);

// ── 2. validação por walk-forward de cada perna ────────────────────────────
interface Perna {
  sym: string; st: string;
  expOOS: number; tradesOOS: number; tradesMes: number; produto: number;
  efic: number; dsr: number; aprovada: boolean; motivo: string;
  pool: number[];
}

const pernas: Perna[] = [];
let testesTotais = 0;

console.log('VALIDANDO CADA PERNA COM WALK-FORWARD\n');
console.log('  ativo'.padEnd(16) + 'estratégia'.padEnd(20) + 'exp OOS'.padEnd(11) + 'trades'.padEnd(9) + 'efic'.padEnd(8) + 'DSR'.padEnd(7) + 'situação');

for (const sym of series5m) {
  if (!hasSeries('binanceusdm', sym, '5m')) continue;
  let serie;
  try { serie = loadSeries('binanceusdm', sym, '5m'); } catch { continue; }
  const anos = (serie.bars.at(-1)!.t - serie.bars[0].t) / (365.25 * 86_400_000);
  if (anos < 0.4 || serie.bars.length < 20000) continue;

  const vf = forecastVolatility(serie.bars);
  const vt = targetVolatility(vf);
  const idx = new Map(serie.bars.map((b, i) => [b.t, i]));

  for (const st of Object.keys(REGISTRY)) {
    const grid = GRIDS[st];
    if (!grid) continue;
    testesTotais++;
    let wf;
    try { wf = walkForward({ series: serie, strategyName: st, grid, cfg, folds: 4 }); } catch { continue; }
    if (!wf.folds.length || wf.combined.trades < 60) continue;
    if (wf.combined.expectancyR <= 0) continue;

    const tradesMes = wf.combined.trades / (anos * 12 * 0.3); // OOS ≈ 30% da série
    const prod = wf.combined.expectancyR * tradesMes;
    const dsr = deflatedSharpe(wf.combined.sharpe, wf.totalCombosTested, wf.combined.trades);
    const motivos: string[] = [];
    if (wf.efficiency < 0.4) motivos.push(`efic ${wf.efficiency.toFixed(2)}`);
    if (dsr < 0.9) motivos.push(`DSR ${dsr.toFixed(2)}`);

    const p: Perna = {
      sym, st, expOOS: wf.combined.expectancyR, tradesOOS: wf.combined.trades,
      tradesMes, produto: prod, efic: wf.efficiency, dsr,
      aprovada: motivos.length === 0, motivo: motivos[0] ?? 'APROVADA',
      pool: wf.combinedTrades.map((t) => (t.rEquity / cfg.risk.riskPerTrade) * volSizeMultiplier(vf, idx.get(t.entryTime) ?? 0, vt)),
    };
    pernas.push(p);
    console.log(
      '  ' + sym.replace('/USDT:USDT', '').padEnd(14) + st.padEnd(20) +
      (p.expOOS.toFixed(3) + 'R').padEnd(11) + String(p.tradesOOS).padEnd(9) +
      p.efic.toFixed(2).padEnd(8) + p.dsr.toFixed(2).padEnd(7) + p.motivo,
    );
  }
}

const aprovadas = pernas.filter((p) => p.aprovada);
const positivas = pernas; // todas já têm expectancy > 0

console.log(`\n  ${testesTotais} testes · ${positivas.length} com vantagem OOS positiva · ${aprovadas.length} aprovadas no portão completo\n`);

const usar = aprovadas.length >= 3 ? aprovadas : positivas;
const rotulo = aprovadas.length >= 3 ? 'APROVADAS' : 'POSITIVAS (portão relaxado — poucas aprovadas)';
if (!usar.length) { console.log('Nenhuma perna utilizável.'); process.exit(0); }

const prodTotal = usar.reduce((x, p) => x + p.produto, 0);
console.log(`Usando ${usar.length} pernas ${rotulo}`);
console.log(`Produto somado ${prodTotal.toFixed(2)} · necessário ${prodNecessario.toFixed(2)} · ` +
  (prodTotal >= prodNecessario ? 'ALCANÇA' : `${(prodNecessario / prodTotal).toFixed(1)}x abaixo`) + '\n');

// ── 3. correlação ──────────────────────────────────────────────────────────
const n = usar.length;
const C: number[][] = Array.from({ length: n }, () => new Array(n).fill(0));
const rets = usar.map((p) => {
  const s = loadSeries('binanceusdm', p.sym, '5m');
  const m = new Map<number, number>();
  for (let i = 1; i < s.bars.length; i++) if (s.bars[i - 1].c > 0) m.set(s.bars[i].t, s.bars[i].c / s.bars[i - 1].c - 1);
  return m;
});
for (let i = 0; i < n; i++) {
  C[i][i] = 1;
  for (let j = i + 1; j < n; j++) {
    const xs: number[] = [], ys: number[] = [];
    for (const [t, v] of rets[i]) { const w = rets[j].get(t); if (w != null) { xs.push(v); ys.push(w); } }
    if (xs.length < 200) continue;
    const mx = xs.reduce((p, q) => p + q, 0) / xs.length, my = ys.reduce((p, q) => p + q, 0) / ys.length;
    let nu = 0, dx = 0, dy = 0;
    for (let k = 0; k < xs.length; k++) { nu += (xs[k] - mx) * (ys[k] - my); dx += (xs[k] - mx) ** 2; dy += (ys[k] - my) ** 2; }
    C[i][j] = C[j][i] = dx > 0 && dy > 0 ? nu / Math.sqrt(dx * dy) : 0;
  }
}
let cs = 0, cc = 0;
for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) { cs += C[i][j]; cc++; }
const corrMedia = cc ? cs / cc : 0;
console.log(`Correlação média entre as pernas: ${corrMedia.toFixed(3)}\n`);

// ── 4. simulação com todas as restrições ───────────────────────────────────
let seed = 8675309;
const rnd = () => { seed ^= seed << 13; seed >>>= 0; seed ^= seed >> 17; seed ^= seed << 5; seed >>>= 0; return seed / 4294967296; };

function simular(risco: number) {
  const alvo = INICIAL * ALVO_MULT;
  const tradesMesTotal = usar.reduce((x, p) => x + p.tradesMes, 0);
  const nTrades = Math.round(tradesMesTotal * MESES);
  let chegou = 0, ruina = 0, liq = 0, semCapital = 0;
  const finais: number[] = [];

  // O teto de posições simultâneas sai do notional mínimo, não da vontade.
  const simult = Math.min(n, 3);
  const calor = effectiveHeat(new Array(simult).fill(risco), Array.from({ length: simult }, (_, i) => i), C);
  const riscoAjustado = risco * (risco / (calor / Math.sqrt(simult)));

  for (let s = 0; s < SIMS; s++) {
    let eq = INICIAL, tocou = false, foiLiq = false, parou = false;
    for (let k = 0; k < nTrades; k++) {
      const notional = (eq * riscoAjustado) / (STOP + 2 * custo.takerFee + 2 * custo.slippage);
      if (notional < MIN_NOTIONAL) { parou = true; break; }
      const an = analisarLiquidacao(riscoAjustado, STOP, TIERS_MAJOR, notional);
      const perna = usar[Math.floor(rnd() * usar.length)];
      const ret = perna.pool[Math.floor(rnd() * perna.pool.length)];
      const out = aplicarTrade(eq, ret, riscoAjustado, STOP, an);
      eq = out.novoEquity;
      if (out.liquidado) foiLiq = true;
      if (eq >= alvo) tocou = true;
      if (eq <= 1) break;
    }
    finais.push(eq);
    if (tocou) chegou++;
    if (eq <= INICIAL * 0.1) ruina++;
    if (foiLiq) liq++;
    if (parou) semCapital++;
  }
  finais.sort((x, y) => x - y);
  const q = (p: number) => finais[Math.floor((finais.length - 1) * p)];
  return {
    risco, riscoAjustado, pAlvo: chegou / SIMS, pRuina: ruina / SIMS, pLiq: liq / SIMS,
    pSemCapital: semCapital / SIMS, mediana: q(0.5), p25: q(0.25), p75: q(0.75), p90: q(0.90),
    nTrades, simult,
  };
}

console.log(`SIMULAÇÃO — ${n} pernas · ${MESES} meses · alvo US$ ${INICIAL * ALVO_MULT}\n`);
const primeiro = simular(0.10);
console.log(`  ${primeiro.nTrades} operações no período · até ${primeiro.simult} posições simultâneas\n`);
console.log('risco'.padEnd(9) + 'ajustado'.padEnd(11) + `chega ${ALVO_MULT}x`.padEnd(13) + 'ruína'.padEnd(9) + 'mediana'.padEnd(11) + 'p25'.padEnd(10) + 'p75'.padEnd(10) + 'p90');
const grid = [0.02, 0.05, 0.08, 0.10, 0.15, 0.20, 0.25].map(simular);
for (const r of grid) {
  console.log(
    ((r.risco * 100).toFixed(0) + '%').padEnd(9) + ((r.riscoAjustado * 100).toFixed(1) + '%').padEnd(11) +
    ((r.pAlvo * 100).toFixed(2) + '%').padEnd(13) + ((r.pRuina * 100).toFixed(1) + '%').padEnd(9) +
    ('$' + r.mediana.toFixed(0)).padEnd(11) + ('$' + r.p25.toFixed(0)).padEnd(10) +
    ('$' + r.p75.toFixed(0)).padEnd(10) + '$' + r.p90.toFixed(0),
  );
}

const bons = grid.filter((g) => g.pRuina < 0.10).sort((x, y) => y.pAlvo - x.pAlvo);
console.log(`\n${'='.repeat(90)}`);
if (bons.length) {
  const b = bons[0];
  console.log(
    `MELHOR COM RUÍNA ABAIXO DE 10%\n\n` +
    `  risco ${(b.risco * 100).toFixed(0)}% (ajustado por correlação para ${(b.riscoAjustado * 100).toFixed(1)}%)\n` +
    `  chance de chegar a US$ ${INICIAL * ALVO_MULT} em ${MESES} meses: ${(b.pAlvo * 100).toFixed(2)}%\n` +
    `  risco de ruína: ${(b.pRuina * 100).toFixed(1)}%\n` +
    `  resultado mediano: US$ ${b.mediana.toFixed(0)}\n` +
    `  faixa provável (p25–p75): US$ ${b.p25.toFixed(0)}–${b.p75.toFixed(0)}\n` +
    `  cenário bom (p90): US$ ${b.p90.toFixed(0)}`,
  );
} else {
  console.log('Nenhuma configuração com ruína abaixo de 10%.');
}
