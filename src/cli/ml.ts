/**
 * Treina e AVALIA o filtro de meta-labeling.
 *
 * O teste honesto nao e "o modelo tem AUC alto". E: depois de filtrar com
 * probabilidades que vieram de folds onde o modelo NUNCA viu aqueles trades, a
 * expectancy fica positiva o suficiente para pagar as taxas?
 */
import fs from 'node:fs';
import path from 'node:path';
import { loadSeries, ROOT } from '../data/store.ts';
import { buildStrategy } from '../strategies/index.ts';
import { runBacktest } from '../backtest/engine.ts';
import { computeMetrics } from '../backtest/metrics.ts';
import { makeConfig } from '../config.ts';
import { buildDataset, purgedWalkForwardCV, thresholdSweep, pickThreshold, trainFinal } from '../ml/metalabel.ts';
import { monteCarlo, formatMonteCarlo } from '../validate/montecarlo.ts';
import { parseArgs, num, str, parseParams } from './args.ts';

const a = parseArgs();
const exchange = str(a.exchange, 'binance');
const timeframe = str(a.timeframe, '5m');
const symbols = str(a.symbol, 'BTC/USDT').split(',').map((s) => s.trim());
const stratNames = str(a.strategy, 'momentum-breakout,ma-cross,zscore-breakout,body-breakout,vwma-dip')
  .split(',').map((s) => s.trim());
const params = parseParams(a.params);

const cfg = makeConfig({
  initialEquity: num(a.equity, 100),
  costPreset: str(a.cost, 'binance-futures'),
  riskProfile: str(a.risk, 'seed'),
  maxBarsInTrade: num(a.maxBars, 288),
});
// Para gerar dataset de ML precisamos de TODOS os sinais historicos, entao o
// circuit breaker de drawdown fica desligado aqui. Ele volta na simulacao final.
const cfgCollect = { ...cfg, risk: { ...cfg.risk, maxDrawdownStop: 1, dailyLossLimit: 1 } };

const summary: any[] = [];

for (const symbol of symbols) {
  const series = loadSeries(exchange, symbol, timeframe);
  for (const name of stratNames) {
    console.log(`\n\n########## ML meta-label :: ${symbol} ${timeframe} :: ${name}`);
    const res = runBacktest(series, buildStrategy(name, params), cfgCollect);
    if (res.trades.length < 300) {
      console.log(`  so ${res.trades.length} trades, insuficiente para ML. Pulando.`);
      continue;
    }

    const ds = buildDataset(res.trades);
    const base = computeMetrics(res, cfg.initialEquity);
    console.log(`  base: ${ds.trades.length} trades, win rate ${(base.winRate * 100).toFixed(1)}%, expectancy ${base.expectancyR.toFixed(3)}R`);

    let cv;
    try {
      cv = purgedWalkForwardCV(ds, { folds: 5, embargoPct: 0.01 });
    } catch (e) {
      console.log(`  ${(e as Error).message}`);
      continue;
    }
    if (!cv.folds.length) {
      console.log('  nenhum fold de ML valido.');
      continue;
    }

    console.log(`  AUC out-of-sample por fold: ${cv.folds.map((f) => f.auc.toFixed(3)).join(', ')}`);
    console.log(`  AUC medio ${cv.meanAuc.toFixed(3)}  (0.50 = o modelo nao sabe nada)`);

    const rows = thresholdSweep(cv.allScored);
    console.log('\n  limiar   mantidos   win%    expectancy    soma R    PF');
    for (const r of rows.filter((_, i) => i % 2 === 0)) {
      console.log(
        `  ${r.threshold.toFixed(3)}    ${String(r.kept).padStart(5)}/${r.trades}   ` +
          `${(r.winRate * 100).toFixed(1)}%   ${r.expectancyR.toFixed(3)}R      ` +
          `${(r.sumR * 100).toFixed(1)}%   ${r.profitFactor === Infinity ? 'inf' : r.profitFactor.toFixed(3)}`,
      );
    }

    const pick = pickThreshold(rows);
    const noFilter = rows.length ? rows[0] : null;
    if (!pick) {
      console.log('\n  >>> nenhum limiar retem trades suficientes. ML nao ajuda aqui.');
      continue;
    }

    console.log(
      `\n  Limiar escolhido ${pick.threshold}: mantem ${pick.kept}/${pick.trades} trades, ` +
        `expectancy ${pick.expectancyR.toFixed(3)}R (sem filtro: ${noFilter?.expectancyR.toFixed(3)}R)`,
    );

    const keptTrades = cv.allScored.filter((s) => s.p >= pick.threshold).map((s) => s.trade);
    const mc = monteCarlo(keptTrades, { sims: 5000, ddStop: cfg.risk.maxDrawdownStop });
    console.log('\n' + formatMonteCarlo(mc));

    const helps = pick.expectancyR > 0 && (noFilter ? pick.expectancyR > noFilter.expectancyR : true);
    const tradeable = pick.expectancyR > 0 && cv.meanAuc > 0.55 && mc.pLoss < 0.4;
    console.log(
      `\n  >>> ${tradeable ? 'O FILTRO TORNA A ESTRATEGIA VIAVEL' : helps ? 'o filtro melhora mas nao o bastante' : 'o filtro NAO salva esta estrategia'}`,
    );

    const model = trainFinal(ds);
    console.log(`  features mais usadas: ${model.featureImportance().slice(0, 6).map((f) => `${f.name}(${f.count})`).join(', ')}`);

    if (tradeable) {
      const dir = path.join(ROOT, 'models');
      fs.mkdirSync(dir, { recursive: true });
      const p = path.join(dir, `${symbol.replace('/', '_')}__${name}__${timeframe}.json`);
      fs.writeFileSync(p, JSON.stringify({ model: model.toJSON(), threshold: pick.threshold, params, cfg }, null, 2));
      console.log(`  modelo salvo em ${p}`);
    }

    summary.push({
      symbol, strategy: name, auc: cv.meanAuc,
      baseExpectancy: noFilter?.expectancyR ?? 0,
      filteredExpectancy: pick.expectancyR,
      threshold: pick.threshold, kept: pick.kept, total: pick.trades, tradeable,
    });
  }
}

console.log('\n\n============ RESUMO ML ============');
for (const s of summary) {
  console.log(
    `${s.tradeable ? 'VIAVEL' : 'nao   '} ${s.symbol.padEnd(10)} ${s.strategy.padEnd(18)} ` +
      `AUC ${s.auc.toFixed(3)}  exp ${s.baseExpectancy.toFixed(3)}R -> ${s.filteredExpectancy.toFixed(3)}R  ` +
      `(mantem ${s.kept}/${s.total} @ p>=${s.threshold})`,
  );
}
