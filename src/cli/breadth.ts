/**
 * LARGURA: muitos pares em paralelo, alta frequência.
 *
 * A tese que este arquivo testa, e que eu nunca tinha testado:
 *
 *   Para multiplicar por M em N operações é preciso E·r = ln(M)/N. Eu sempre
 *   tentei aumentar E (vantagem) ou r (risco), e bati no teto nos dois. Mas N
 *   também é uma alavanca — e N cresce com o NÚMERO DE PARES rodando em
 *   paralelo, não só com o timeframe.
 *
 *   Oito pares a 25 operações/mês somam 200 operações/mês. O requisito por
 *   operação cai proporcionalmente, sem exigir estratégia melhor nem risco maior.
 *
 * O que pode derrubar a tese, e é o que este arquivo mede:
 *
 *   1. CORRELAÇÃO. Oito posições simultâneas em cripto não são oito apostas.
 *      Se caem juntas, o risco efetivo explode e a ruína volta.
 *   2. CAPITAL. Com US$ 100 e notional mínimo de US$ 5, existe um teto duro de
 *      posições simultâneas. Não adianta achar 20 pares se cabem 3.
 *   3. CUSTO. 5 minutos exige stop curto, e stop curto amplifica o pedágio.
 *
 * O resultado é honesto nos dois sentidos: se a largura resolver, aparece aqui;
 * se a correlação matar, também.
 */
import ccxt from 'ccxt';
import { loadSeries, hasSeries, downloadSeries } from '../data/store.ts';
import { buildStrategy, REGISTRY } from '../strategies/index.ts';
import { runBacktest } from '../backtest/engine.ts';
import { computeMetrics } from '../backtest/metrics.ts';
import { effectiveHeat } from '../backtest/portfolio.ts';
import { forecastVolatility, targetVolatility, volSizeMultiplier } from '../core/volatility.ts';
import { analisarLiquidacao, aplicarTrade, TIERS_MAJOR } from '../core/liquidation.ts';
import { makeConfig, COSTS } from '../config.ts';
import { parseArgs, num, str, bool } from './args.ts';

const a = parseArgs();
const ALVO_MULT = num(a.mult, 5);
const INICIAL = num(a.equity, 100);
const TF = str(a.timeframe, '5m');
const SIMS = num(a.sims, 20000);
const STOP = 0.015;
const MIN_NOTIONAL = 5;
const baixar = bool(a.download, false);

const cfg = makeConfig({ initialEquity: 100, costPreset: 'binance-futures-maker', riskProfile: 'seed', maxBarsInTrade: 100000 });
const custo = COSTS['binance-futures-maker'];

console.log(`\n${'='.repeat(88)}`);
console.log(`LARGURA: ${ALVO_MULT}x em 1 mês via muitos pares em ${TF}`);
console.log(`${'='.repeat(88)}\n`);

const produtoNecessario = Math.log(ALVO_MULT) / 0.10;
console.log(`Produto necessário (expectancy × trades/mês) com risco 10%: ${produtoNecessario.toFixed(2)}\n`);

// ── 1. universo líquido ────────────────────────────────────────────────────
const candidatos = str(a.symbol, '').trim()
  ? str(a.symbol, '').split(',').map((s) => s.trim())
  : await (async () => {
      const ex = new (ccxt as any).binanceusdm({ enableRateLimit: true });
      await ex.loadMarkets();
      const tk = await ex.fetchTickers();
      return Object.values(ex.markets)
        .filter((m: any) => m.swap && m.quote === 'USDT' && m.active)
        .map((m: any) => ({ s: m.symbol, v: tk[m.symbol]?.quoteVolume ?? 0 }))
        .filter((x: any) => x.v > 150e6)
        .sort((x: any, y: any) => y.v - x.v)
        .slice(0, num(a.max, 14))
        .map((x: any) => x.s);
    })();

console.log(`${candidatos.length} candidatos líquidos\n`);

if (baixar) {
  for (const s of candidatos) {
    if (hasSeries('binanceusdm', s, TF)) continue;
    try { process.stdout.write(`  baixando ${s}… `); await downloadSeries({ exchange: 'binanceusdm', symbol: s, timeframe: TF, days: 365 }); console.log('ok'); }
    catch (e) { console.log(`falhou`); }
  }
  console.log('');
}

// ── 2. mede cada par ───────────────────────────────────────────────────────
interface Perna { sym: string; st: string; expectancy: number; tradesMes: number; produto: number; pool: number[] }
const pernas: Perna[] = [];

for (const sym of candidatos) {
  if (!hasSeries('binanceusdm', sym, TF)) continue;
  const serie = loadSeries('binanceusdm', sym, TF);
  const anos = (serie.bars.at(-1)!.t - serie.bars[0].t) / (365.25 * 86_400_000);
  if (anos < 0.4) continue;
  const vf = forecastVolatility(serie.bars);
  const vt = targetVolatility(vf);
  const idx = new Map(serie.bars.map((b, i) => [b.t, i]));

  let melhor: Perna | null = null;
  for (const st of Object.keys(REGISTRY)) {
    try {
      const r = runBacktest(serie, buildStrategy(st, {}), { ...cfg, risk: { ...cfg.risk, maxDrawdownStop: 1, dailyLossLimit: 1 } });
      if (r.trades.length < 60) continue;
      const m = computeMetrics(r, 100);
      if (m.expectancyR <= 0) continue;
      const tradesMes = r.trades.length / (anos * 12);
      const prod = m.expectancyR * tradesMes;
      if (!melhor || prod > melhor.produto) {
        melhor = {
          sym, st, expectancy: m.expectancyR, tradesMes, produto: prod,
          pool: r.trades.map((t) => (t.rEquity / cfg.risk.riskPerTrade) * volSizeMultiplier(vf, idx.get(t.entryTime) ?? 0, vt)),
        };
      }
    } catch { /* segue */ }
  }
  if (melhor) pernas.push(melhor);
}

pernas.sort((x, y) => y.produto - x.produto);
console.log('PERNAS COM VANTAGEM POSITIVA\n');
console.log('  ativo'.padEnd(14) + 'estratégia'.padEnd(22) + 'expect'.padEnd(10) + 'trades/mês'.padEnd(13) + 'produto');
for (const p of pernas) {
  console.log('  ' + p.sym.replace('/USDT:USDT', '').padEnd(12) + p.st.padEnd(22) + (p.expectancy.toFixed(3) + 'R').padEnd(10) + p.tradesMes.toFixed(1).padEnd(13) + p.produto.toFixed(3));
}

const produtoTotal = pernas.reduce((x, p) => x + p.produto, 0);
console.log(
  `\n  ${pernas.length} pernas · produto somado ${produtoTotal.toFixed(2)} · necessário ${produtoNecessario.toFixed(2)}\n` +
  `  ${produtoTotal >= produtoNecessario ? '  A LARGURA ALCANÇA O REQUISITO EM TEORIA' : `  Ainda ${(produtoNecessario / produtoTotal).toFixed(1)}x abaixo`}\n`,
);

if (!pernas.length) process.exit(0);

// ── 3. correlação: o que derruba a tese ────────────────────────────────────
const series = pernas.map((p) => loadSeries('binanceusdm', p.sym, TF));
const n = pernas.length;
const C: number[][] = Array.from({ length: n }, () => new Array(n).fill(0));
const rets = series.map((s) => {
  const m = new Map<number, number>();
  for (let i = 1; i < s.bars.length; i++) if (s.bars[i - 1].c > 0) m.set(s.bars[i].t, s.bars[i].c / s.bars[i - 1].c - 1);
  return m;
});
for (let i = 0; i < n; i++) {
  C[i][i] = 1;
  for (let j = i + 1; j < n; j++) {
    const xs: number[] = [], ys: number[] = [];
    for (const [t, v] of rets[i]) { const w = rets[j].get(t); if (w != null) { xs.push(v); ys.push(w); } }
    if (xs.length < 100) continue;
    const mx = xs.reduce((p, q) => p + q, 0) / xs.length, my = ys.reduce((p, q) => p + q, 0) / ys.length;
    let nu = 0, dx = 0, dy = 0;
    for (let k = 0; k < xs.length; k++) { nu += (xs[k] - mx) * (ys[k] - my); dx += (xs[k] - mx) ** 2; dy += (ys[k] - my) ** 2; }
    C[i][j] = C[j][i] = dx > 0 && dy > 0 ? nu / Math.sqrt(dx * dy) : 0;
  }
}
let cs = 0, cc = 0;
for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) { cs += C[i][j]; cc++; }
const corrMedia = cc ? cs / cc : 0;

console.log(`${'─'.repeat(88)}`);
console.log(`CORRELAÇÃO MÉDIA ENTRE AS PERNAS: ${corrMedia.toFixed(3)}\n`);

// ── 4. simulação com todas as restrições ───────────────────────────────────
let seed = 5150;
const rnd = () => { seed ^= seed << 13; seed >>>= 0; seed ^= seed >> 17; seed ^= seed << 5; seed >>>= 0; return seed / 4294967296; };

function simular(risco: number, maxSimult: number) {
  const alvo = INICIAL * ALVO_MULT;
  let chegou = 0, ruina = 0, liq = 0;
  const finais: number[] = [];
  const tradesMesTotal = pernas.reduce((x, p) => x + p.tradesMes, 0);

  for (let s = 0; s < SIMS; s++) {
    let eq = INICIAL, pico = INICIAL, tocou = false, foiLiq = false;
    const nTrades = Math.round(tradesMesTotal);

    for (let k = 0; k < nTrades; k++) {
      const notional = (eq * risco) / (STOP + 2 * custo.takerFee + 2 * custo.slippage);
      if (notional < MIN_NOTIONAL) break;

      // risco efetivo ajustado por correlação e por quantas posições cabem
      const simult = Math.min(maxSimult, n);
      const riscos = new Array(simult).fill(risco);
      const idxs = Array.from({ length: simult }, (_, i) => i);
      const calorEfetivo = effectiveHeat(riscos, idxs, C);
      const riscoAjustado = risco * (risco / (calorEfetivo / Math.sqrt(simult)));

      const an = analisarLiquidacao(riscoAjustado, STOP, TIERS_MAJOR, notional);
      const perna = pernas[Math.floor(rnd() * pernas.length)];
      const ret = perna.pool[Math.floor(rnd() * perna.pool.length)];
      const out = aplicarTrade(eq, ret, riscoAjustado, STOP, an);
      eq = out.novoEquity;
      if (out.liquidado) foiLiq = true;
      if (eq > pico) pico = eq;
      if (eq >= alvo) { tocou = true; }
      if (eq <= 1) break;
    }
    finais.push(eq);
    if (tocou) chegou++;
    if (eq <= INICIAL * 0.1) ruina++;
    if (foiLiq) liq++;
  }
  finais.sort((x, y) => x - y);
  return {
    risco, maxSimult, pAlvo: chegou / SIMS, pRuina: ruina / SIMS, pLiq: liq / SIMS,
    mediana: finais[Math.floor(SIMS / 2)], p25: finais[Math.floor(SIMS * 0.25)], p75: finais[Math.floor(SIMS * 0.75)],
  };
}

console.log(`SIMULAÇÃO — ${pernas.length} pernas, correlação ${corrMedia.toFixed(2)}, alvo US$ ${INICIAL * ALVO_MULT}\n`);
console.log('risco'.padEnd(9) + 'simult'.padEnd(9) + `chega ${ALVO_MULT}x`.padEnd(13) + 'ruína'.padEnd(10) + 'liquidado'.padEnd(12) + 'mediana'.padEnd(11) + 'p25'.padEnd(10) + 'p75');
const grid: any[] = [];
for (const risco of [0.02, 0.05, 0.10, 0.15, 0.20, 0.30]) {
  for (const simult of [3]) {
    const r = simular(risco, simult);
    grid.push(r);
    console.log(
      ((risco * 100).toFixed(0) + '%').padEnd(9) + String(simult).padEnd(9) +
      ((r.pAlvo * 100).toFixed(2) + '%').padEnd(13) + ((r.pRuina * 100).toFixed(1) + '%').padEnd(10) +
      ((r.pLiq * 100).toFixed(1) + '%').padEnd(12) + ('$' + r.mediana.toFixed(0)).padEnd(11) +
      ('$' + r.p25.toFixed(0)).padEnd(10) + '$' + r.p75.toFixed(0),
    );
  }
}

const viaveis = grid.filter((g) => g.pRuina < 0.10).sort((x, y) => y.pAlvo - x.pAlvo);
console.log(`\n${'='.repeat(88)}`);
if (viaveis.length && viaveis[0].pAlvo > 0.01) {
  const b = viaveis[0];
  console.log(
    `MELHOR COM RUÍNA ABAIXO DE 10%: risco ${(b.risco * 100).toFixed(0)}%\n` +
    `  chance de ${ALVO_MULT}x no mês: ${(b.pAlvo * 100).toFixed(2)}%  ·  ruína ${(b.pRuina * 100).toFixed(1)}%\n` +
    `  mediana US$ ${b.mediana.toFixed(0)}  ·  faixa provável US$ ${b.p25.toFixed(0)}–${b.p75.toFixed(0)}`,
  );
} else {
  console.log(`Nenhuma configuração atinge ${ALVO_MULT}x com ruína aceitável.`);
}
