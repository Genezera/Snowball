/**
 * Varredura de universo. Executa os portoes em cascata, do mais barato ao mais
 * caro, e reporta quantos ativos morreram em cada um.
 *
 * O relatorio de funil e tao importante quanto a lista final: ele mostra
 * quantos testes NAO precisaram acontecer, que e o que mantem a correcao de
 * teste multiplo administravel.
 */
import fs from 'node:fs';
import path from 'node:path';
import { screenLiquidity, assessTradeability, testBudget, crossSectionalConsistency } from '../scan/universe.ts';
import { downloadSeries, hasSeries, loadSeries, ROOT } from '../data/store.ts';
import { buildStrategy, REGISTRY } from '../strategies/index.ts';
import { runBacktest } from '../backtest/engine.ts';
import { computeMetrics } from '../backtest/metrics.ts';
import { makeConfig, COSTS } from '../config.ts';
import { parseArgs, num, str, bool } from './args.ts';

const a = parseArgs();
const exchange = str(a.exchange, 'binanceusdm');
const timeframe = str(a.timeframe, '4h');
const minVol = num(a.minVolume, 50e6);
const maxAssets = num(a.max, 40);
const days = num(a.days, 730);
const doBacktest = bool(a.backtest, true);
const costPreset = str(a.cost, 'binance-futures-maker');

const cfg = makeConfig({
  initialEquity: num(a.equity, 100),
  costPreset,
  riskProfile: str(a.risk, 'seed'),
  maxBarsInTrade: num(a.maxBars, 100000),
});
const cost = COSTS[costPreset];
const stratNames = str(a.strategy, Object.keys(REGISTRY).join(',')).split(',').map((s) => s.trim());

console.log(`### PORTAO 1 -- liquidez (volume 24h >= USD ${(minVol / 1e6).toFixed(0)}M)\n`);
const { candidates, totalActive } = await screenLiquidity({ exchange, minQuoteVolume24h: minVol, max: maxAssets });
console.log(`${totalActive} perpetuos ativos -> ${candidates.length} passaram (limitado a ${maxAssets})`);
const byKind = candidates.reduce((m, c) => ({ ...m, [c.kind]: (m[c.kind] ?? 0) + 1 }), {} as Record<string, number>);
console.log(`composicao: ${JSON.stringify(byKind)}\n`);

console.log(`### PORTAO 2 e 3 -- qualidade de dado e viabilidade economica (${timeframe})\n`);
const tradeable: string[] = [];
const reports: any[] = [];

for (const c of candidates) {
  if (!hasSeries(exchange, c.symbol, timeframe)) {
    try {
      process.stdout.write(`  baixando ${c.symbol}... `);
      await downloadSeries({ exchange, symbol: c.symbol, timeframe, days });
      process.stdout.write('ok\n');
    } catch (e) {
      console.log(`falhou (${(e as Error).message})`);
      continue;
    }
  }
  let series;
  try { series = loadSeries(exchange, c.symbol, timeframe); } catch { continue; }

  const r = assessTradeability(series, cost, {
    horizon: num(a.horizon, 12),
    minCostToMove: num(a.minCostToMove, 8),
    minBars: num(a.minBars, 2000),
  });
  reports.push({ ...r, kind: c.kind, quoteVolume24h: c.quoteVolume24h });
  if (r.passed) tradeable.push(c.symbol);
}

console.log('\nativo'.padEnd(16) + 'tipo'.padEnd(15) + 'barras'.padEnd(9) + 'mov.med'.padEnd(10) + 'custo/mov'.padEnd(12) + 'ER med'.padEnd(9) + 'vol.anual'.padEnd(11) + 'status');
for (const r of reports.sort((x, y) => y.costToMove - x.costToMove)) {
  console.log(
    r.symbol.replace('/USDT:USDT', '').padEnd(16) +
      r.kind.padEnd(15) + String(r.bars).padEnd(9) +
      ((r.medianMove * 100).toFixed(2) + '%').padEnd(10) +
      (r.costToMove.toFixed(1) + 'x').padEnd(12) +
      r.medianER.toFixed(2).padEnd(9) +
      ((r.annualVol * 100).toFixed(0) + '%').padEnd(11) +
      (r.passed ? 'OK' : r.reasons[0]),
  );
}
console.log(`\n${reports.length} avaliados -> ${tradeable.length} viaveis`);

const budget = testBudget(totalActive, candidates.length, tradeable.length, stratNames.length);
console.log(`\n### FUNIL`);
console.log(`  universo total            ${budget.assetsConsidered}`);
console.log(`  apos liquidez             ${budget.assetsAfterLiquidity}`);
console.log(`  apos viabilidade          ${budget.assetsAfterTradeability}`);
console.log(`  estrategias por ativo     ${budget.strategiesPerAsset}`);
console.log(`  TESTES EFETIVOS           ${budget.effectiveTests}  <- use este numero no Sharpe deflacionado`);
console.log(
  `  testes evitados           ${budget.assetsConsidered * budget.strategiesPerAsset - budget.effectiveTests}` +
    `  (cortados antes de qualquer backtest)`,
);

if (!doBacktest || !tradeable.length) {
  console.log('\n(backtest desligado ou nenhum ativo viavel)');
  process.exit(0);
}

console.log(`\n### PORTAO 4 -- ajuste de estrategia (custo ${costPreset})\n`);
const results: { symbol: string; strategy: string; expectancyR: number; ret: number; dd: number; trades: number }[] = [];

for (const symbol of tradeable) {
  const series = loadSeries(exchange, symbol, timeframe);
  for (const name of stratNames) {
    const res = runBacktest(series, buildStrategy(name, {}), {
      ...cfg,
      risk: { ...cfg.risk, maxDrawdownStop: 1, dailyLossLimit: 1 },
    });
    const m = computeMetrics(res, cfg.initialEquity);
    if (m.trades < 30) continue;
    results.push({
      symbol: symbol.replace('/USDT:USDT', ''), strategy: name.split('(')[0],
      expectancyR: m.expectancyR, ret: m.totalReturn, dd: m.maxDrawdown, trades: m.trades,
    });
  }
}

console.log('### PORTAO 5 -- consistencia transversal (a defesa mais forte)\n');
console.log('Um ativo isolado que passa e suspeito. Uma estrategia que funciona');
console.log('numa familia inteira de ativos e sinal.\n');
console.log('estrategia'.padEnd(22) + 'ativos'.padEnd(9) + 'positivos'.padEnd(12) + 'fracao'.padEnd(10) + 'expectancy mediana');
for (const c of crossSectionalConsistency(results)) {
  console.log(
    c.strategy.padEnd(22) + String(c.assets).padEnd(9) + String(c.positive).padEnd(12) +
      ((c.fraction * 100).toFixed(0) + '%').padEnd(10) + c.medianExpectancy.toFixed(3) + 'R',
  );
}

const top = results.filter((r) => r.expectancyR > 0).sort((x, y) => y.expectancyR - x.expectancyR).slice(0, 20);
console.log(`\n### MELHORES PARES ativo x estrategia (${results.filter((r) => r.expectancyR > 0).length} positivos de ${results.length})\n`);
console.log('ativo'.padEnd(14) + 'estrategia'.padEnd(22) + 'expectancy'.padEnd(13) + 'retorno'.padEnd(11) + 'DD'.padEnd(9) + 'trades');
for (const r of top) {
  console.log(
    r.symbol.padEnd(14) + r.strategy.padEnd(22) + (r.expectancyR.toFixed(3) + 'R').padEnd(13) +
      ((r.ret * 100).toFixed(1) + '%').padEnd(11) + ((r.dd * 100).toFixed(1) + '%').padEnd(9) + r.trades,
  );
}

const dir = path.join(ROOT, 'reports');
fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(
  path.join(dir, `scan-${timeframe}.json`),
  JSON.stringify({ budget, reports, results, consistency: crossSectionalConsistency(results) }, null, 2),
);
console.log(`\nrelatorio salvo em reports/scan-${timeframe}.json`);
console.log(
  `\nLEMBRETE: nada aqui e aprovacao. Estes pares sao CANDIDATOS que ainda\n` +
    `precisam passar por walk-forward (npm run validate) com ${budget.effectiveTests} testes\n` +
    `efetivos no Sharpe deflacionado, e depois por 90 dias de paper trading.`,
);
