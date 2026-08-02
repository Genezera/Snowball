/**
 * Treina e valida o alocador adaptativo.
 *
 * O criterio de sucesso NAO e "o alocador deu lucro". E: **o alocador bate a
 * melhor estrategia isolada out-of-sample?** Se nao bater, ele e complexidade
 * sem retorno, e a resposta certa e rodar a estrategia unica.
 *
 * Isso e importante porque um alocador tem uma vantagem injusta em qualquer
 * teste mal feito: ele escolhe entre N estrategias, entao no in-sample ele
 * sempre parece genial. O walk-forward abaixo treina os modelos SO com trades
 * cuja saida aconteceu antes do inicio da janela de teste.
 */
import fs from 'node:fs';
import path from 'node:path';
import { loadSeries, ROOT } from '../data/store.ts';
import { buildStrategy, REGISTRY } from '../strategies/index.ts';
import { runBacktest } from '../backtest/engine.ts';
import { runMultiBacktest } from '../backtest/multi.ts';
import { computeMetrics, formatMetrics } from '../backtest/metrics.ts';
import { monteCarlo, formatMonteCarlo } from '../validate/montecarlo.ts';
import { buildRegimeContext, REGIME_FEATURES } from '../ml/regime.ts';
import { collectTrainingData, trainAllocator, type AllocatorConfig } from '../ml/allocator.ts';
import { makeConfig } from '../config.ts';
import { parseArgs, num, str } from './args.ts';
import type { Series, Trade } from '../core/types.ts';

const a = parseArgs();
const exchange = str(a.exchange, 'binanceusdm');
const timeframe = str(a.timeframe, '4h');
const symbols = str(a.symbol, 'BTC/USDT:USDT').split(',').map((s) => s.trim());
const stratNames = str(a.strategy, Object.keys(REGISTRY).join(',')).split(',').map((s) => s.trim());
const folds = num(a.folds, 5);
const minExpectedR = num(a.minExpectedR, 0);

const cfg = makeConfig({
  initialEquity: num(a.equity, 100),
  costPreset: str(a.cost, 'binance-futures-maker'),
  riskProfile: str(a.risk, 'seed'),
  maxBarsInTrade: num(a.maxBars, 100000),
});
const acfg: AllocatorConfig = {
  minExpectedR,
  minTrainExpectancy: num(a.minTrainExpectancy, 0.02),
  minModelAuc: num(a.minModelAuc, 0.52),
  gbdt: { nTrees: 100, maxDepth: 3, learningRate: 0.05, minSamplesLeaf: 30, lambda: 8 },
};

const strategies = stratNames.map((n) => buildStrategy(n, {}));
const summary: any[] = [];

for (const symbol of symbols) {
  const series = loadSeries(exchange, symbol, timeframe);
  const ctx = buildRegimeContext(series.bars);
  const bars = series.bars;
  console.log(`\n\n########## ADAPTATIVO :: ${symbol} ${timeframe} :: ${bars.length} barras`);

  const block = Math.floor(bars.length / folds);
  const WARM = 300;

  // Acumuladores para as tres alternativas comparadas
  let eqAdaptive = cfg.initialEquity;
  const adaptiveTrades: Trade[] = [];
  const usageTotal: Record<string, number> = {};
  const regimeTotal: Record<string, number> = {};
  let skippedTotal = 0;

  const eqSingle: Record<string, number> = {};
  const singleTrades: Record<string, Trade[]> = {};
  for (const s of strategies) { eqSingle[s.name] = cfg.initialEquity; singleTrades[s.name] = []; }

  for (let f = 1; f < folds; f++) {
    const trainEnd = f * block;
    const testEnd = f === folds - 1 ? bars.length : (f + 1) * block;
    if (trainEnd < 1000 || testEnd - trainEnd < 200) continue;

    const trainSeries: Series = { ...series, bars: bars.slice(0, trainEnd) };
    const testStartTime = bars[trainEnd].t;

    // --- treino: SO com dados anteriores ao inicio do teste ---
    const trainCtx = buildRegimeContext(trainSeries.bars);
    const raw = collectTrainingData(trainSeries, strategies, cfg, trainCtx);
    // purge: descarta trades cuja saida invade a janela de teste
    const purged = new Map(
      [...raw].map(([name, d]) => {
        const keep = d.trades.map((t, i) => (t.exitTime < testStartTime ? i : -1)).filter((i) => i >= 0);
        return [name, {
          X: keep.map((i) => d.X[i]), y: keep.map((i) => d.y[i]),
          r: keep.map((i) => d.r[i]), trades: keep.map((i) => d.trades[i]),
        }];
      }),
    );
    const models = trainAllocator(purged, [...REGIME_FEATURES], acfg);
    if (!models.size) {
      console.log(`  fold ${f}: nenhum modelo treinavel (poucos trades). Pulando.`);
      continue;
    }

    // --- teste out-of-sample ---
    const testSeries: Series = { ...series, bars: bars.slice(Math.max(0, trainEnd - WARM), testEnd) };
    const testCtx = buildRegimeContext(testSeries.bars);
    const res = runMultiBacktest({
      series: testSeries, strategies, ctx: testCtx, models, acfg,
      cfg: { ...cfg, initialEquity: eqAdaptive },
      startIndex: WARM,
    });
    eqAdaptive = res.finalEquity;
    adaptiveTrades.push(...res.trades);
    skippedTotal += res.skipped;
    for (const [k, v] of Object.entries(res.usage)) usageTotal[k] = (usageTotal[k] ?? 0) + v;
    for (const [k, v] of Object.entries(res.regimeUsage)) regimeTotal[k] = (regimeTotal[k] ?? 0) + v;

    // --- mesma janela, cada estrategia sozinha, para comparacao justa ---
    const singleLine: string[] = [];
    for (const s of strategies) {
      const r = runBacktest(testSeries, s, { ...cfg, initialEquity: eqSingle[s.name] });
      eqSingle[s.name] = r.finalEquity;
      singleTrades[s.name].push(...r.trades);
      singleLine.push(`${s.name.split('(')[0]} ${((r.finalEquity / cfg.initialEquity - 1) * 100).toFixed(1)}%`);
    }

    const foldRet = ((res.finalEquity / cfg.initialEquity - 1) * 100).toFixed(1);
    console.log(
      `  fold ${f}  treino ate ${new Date(bars[trainEnd - 1].t).toISOString().slice(0, 10)}  ` +
        `teste ate ${new Date(bars[testEnd - 1].t).toISOString().slice(0, 10)}  |  ` +
        `adaptativo ${foldRet}% (${res.trades.length}t, ${res.skipped} pulados)  |  ${singleLine.join('  ')}`,
    );
    console.log(
      `         pool aprovado: ${[...models.values()].map((m) => `${m.name.split('(')[0]}(auc ${m.trainAuc?.toFixed(2)})`).join(', ')}`,
    );
    console.log(`         escolhas: ${JSON.stringify(res.usage)}`);
  }

  if (!adaptiveTrades.length) {
    console.log('  o alocador nao executou nenhum trade. Nada a comparar.');
    continue;
  }

  // --- resultado consolidado ---
  const mkCurve = (ts: Trade[]) => {
    const c = ts.map((t) => ({ t: t.exitTime, equity: t.equityAfter }));
    if (c.length) c.unshift({ t: ts[0].entryTime, equity: cfg.initialEquity });
    return c;
  };
  const adaptiveM = computeMetrics(
    { trades: adaptiveTrades, equityCurve: mkCurve(adaptiveTrades), finalEquity: eqAdaptive },
    cfg.initialEquity,
  );

  console.log('\n' + formatMetrics(adaptiveM, `ALOCADOR ADAPTATIVO ${symbol} ${timeframe} (OOS)`));
  console.log(`Sinais recusados  ${skippedTotal} (o alocador preferiu ficar de fora)`);
  console.log(`Uso por estrategia ${JSON.stringify(usageTotal)}`);
  console.log(`Regimes operados   ${JSON.stringify(regimeTotal)}`);

  console.log('\n--- comparacao out-of-sample, mesma janela, mesmo custo ---');
  const rows: { name: string; ret: number; exp: number; dd: number; trades: number }[] = [];
  for (const s of strategies) {
    const m = computeMetrics(
      { trades: singleTrades[s.name], equityCurve: mkCurve(singleTrades[s.name]), finalEquity: eqSingle[s.name] },
      cfg.initialEquity,
    );
    rows.push({ name: s.name.split('(')[0], ret: m.totalReturn, exp: m.expectancyR, dd: m.maxDrawdown, trades: m.trades });
  }
  rows.sort((x, y) => y.ret - x.ret);
  console.log('estrategia'.padEnd(22) + 'retorno'.padEnd(11) + 'expectancy'.padEnd(13) + 'drawdown'.padEnd(11) + 'trades');
  console.log(
    'ADAPTATIVO'.padEnd(22) +
      `${(adaptiveM.totalReturn * 100).toFixed(1)}%`.padEnd(11) +
      `${adaptiveM.expectancyR.toFixed(3)}R`.padEnd(13) +
      `${(adaptiveM.maxDrawdown * 100).toFixed(1)}%`.padEnd(11) +
      adaptiveM.trades,
  );
  for (const r of rows) {
    console.log(
      r.name.padEnd(22) + `${(r.ret * 100).toFixed(1)}%`.padEnd(11) +
        `${r.exp.toFixed(3)}R`.padEnd(13) + `${(r.dd * 100).toFixed(1)}%`.padEnd(11) + r.trades,
    );
  }

  const best = rows[0];
  const beatsBest = adaptiveM.totalReturn > best.ret;
  const betterRisk = adaptiveM.maxDrawdown < best.dd;

  const mc = monteCarlo(adaptiveTrades, { sims: 5000, ddStop: cfg.risk.maxDrawdownStop });
  console.log('\n' + formatMonteCarlo(mc));

  console.log(
    `\n>>> VEREDITO: ${
      beatsBest && betterRisk
        ? 'O ALOCADOR VALE A PENA (bate a melhor isolada em retorno E em risco)'
        : beatsBest
          ? 'o alocador rende mais, mas nao reduz risco -- avalie se compensa a complexidade'
          : betterRisk
            ? 'o alocador reduz risco mas rende menos que a melhor isolada'
            : `NAO VALE A PENA: a melhor isolada (${best.name}) supera o alocador. Rode a estrategia unica.`
    }`,
  );

  summary.push({
    symbol, timeframe,
    adaptive: { ret: adaptiveM.totalReturn, exp: adaptiveM.expectancyR, dd: adaptiveM.maxDrawdown, trades: adaptiveM.trades },
    bestSingle: best, usage: usageTotal, regimes: regimeTotal, skipped: skippedTotal, beatsBest, betterRisk,
  });
}

if (summary.length) {
  const dir = path.join(ROOT, 'reports');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `adaptive-${timeframe}.json`), JSON.stringify(summary, null, 2));
  console.log(`\nrelatorio salvo em reports/adaptive-${timeframe}.json`);
}
