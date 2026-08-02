import { loadSeries, auditSeries } from '../data/store.ts';
import { buildStrategy, REGISTRY } from '../strategies/index.ts';
import { runBacktest } from '../backtest/engine.ts';
import { computeMetrics, formatMetrics, riskOfRuin } from '../backtest/metrics.ts';
import { makeConfig, COSTS } from '../config.ts';
import { parseArgs, num, str, bool, parseParams } from './args.ts';

const a = parseArgs();
const exchange = str(a.exchange, 'binance');
const timeframe = str(a.timeframe, '5m');
const symbols = str(a.symbol, 'BTC/USDT').split(',').map((s) => s.trim());
const stratNames = str(a.strategy, Object.keys(REGISTRY).join(',')).split(',').map((s) => s.trim());
const params = parseParams(a.params);
const compareCosts = bool(a['compare-costs'], false);

const cfgBase = {
  initialEquity: num(a.equity, 100),
  costPreset: str(a.cost, 'binance-futures'),
  riskProfile: str(a.risk, 'seed'),
  maxBarsInTrade: num(a.maxBars, 48),
  pessimisticIntrabar: bool(a.pessimistic, true),
  riskPerTrade: a.riskPerTrade != null ? Number(a.riskPerTrade) : undefined,
};

for (const symbol of symbols) {
  const series = loadSeries(exchange, symbol, timeframe);
  const audit = auditSeries(series);
  console.log(
    `\n########## ${symbol} ${timeframe} | ${audit.bars} barras | ${audit.from.slice(0, 10)} -> ${audit.to.slice(0, 10)} | cobertura ${(audit.coverage * 100).toFixed(1)}%`,
  );

  for (const name of stratNames) {
    const presets = compareCosts ? ['zero-cost', 'binance-futures', 'stress'] : [cfgBase.costPreset];
    for (const preset of presets) {
      const cfg = makeConfig({ ...cfgBase, costPreset: preset });
      const strat = buildStrategy(name, params);
      const res = runBacktest(series, strat, cfg);
      const m = computeMetrics(res, cfg.initialEquity);
      const ror = riskOfRuin(res.trades, 0.5);
      console.log(
        '\n' +
          formatMetrics(
            m,
            `${strat.name} | custos=${preset} (taker ${(COSTS[preset].takerFee * 100).toFixed(3)}%/lado)`,
          ),
      );
      console.log(`Risco de ruina    ${(ror * 100).toFixed(1)}% (perder 50% em 500 trades)`);
    }
  }
}
