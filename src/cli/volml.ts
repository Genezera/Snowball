/**
 * Avalia se o ML prevê volatilidade melhor que o EWMA — e, mais importante, se
 * essa melhora vira resultado de trading.
 *
 * As duas perguntas são separadas de propósito. Um modelo pode ter erro menor
 * e não melhorar nada, se a melhora estiver em regiões que não afetam o
 * dimensionamento. Reportar só a primeira seria enganoso.
 */
import { loadSeries, hasSeries } from '../data/store.ts';
import { buildStrategy } from '../strategies/index.ts';
import { runBacktest } from '../backtest/engine.ts';
import { computeMetrics } from '../backtest/metrics.ts';
import { evaluateVolModel, mlVolForecast } from '../ml/volmodel.ts';
import { forecastVolatility, targetVolatility, volSizeMultiplier } from '../core/volatility.ts';
import { makeConfig } from '../config.ts';
import { parseArgs, num, str } from './args.ts';
import type { Trade } from '../core/types.ts';

const a = parseArgs();
const exchange = str(a.exchange, 'binanceusdm');
const timeframe = str(a.timeframe, '4h');
const symbols = str(a.symbol, 'BTC/USDT:USDT,ETH/USDT:USDT,XRP/USDT:USDT,DOT/USDT:USDT')
  .split(',').map((s) => s.trim()).filter((s) => hasSeries(exchange, s, timeframe));
const strat = str(a.strategy, 'body-breakout');
const cfg = makeConfig({ initialEquity: 100, costPreset: 'binance-futures-maker', riskProfile: 'seed', maxBarsInTrade: 100000 });

console.log(`\n${'='.repeat(78)}`);
console.log(`ML DE VOLATILIDADE  ·  GBDT vs EWMA  ·  ${timeframe}`);
console.log(`${'='.repeat(78)}\n`);

console.log('PARTE 1 — o modelo prevê melhor? (erro fora da amostra, em log-vol)\n');
console.log('ativo'.padEnd(9) + 'n teste'.padEnd(10) + 'MSE GBDT'.padEnd(12) + 'MSE EWMA'.padEnd(12) + 'MSE média'.padEnd(12) + 'corr GBDT'.padEnd(12) + 'ganho vs EWMA');

const forecasts = new Map<string, number[]>();
for (const symbol of symbols) {
  const series = loadSeries(exchange, symbol, timeframe);
  const ev = evaluateVolModel(series.bars, num(a.horizon, 12));
  forecasts.set(symbol, mlVolForecast(series.bars, num(a.horizon, 12)));
  console.log(
    symbol.replace('/USDT:USDT', '').padEnd(9) + String(ev.nTest).padEnd(10) +
    ev.mseModel.toFixed(4).padEnd(12) + ev.mseEwma.toFixed(4).padEnd(12) + ev.mseBaseline.toFixed(4).padEnd(12) +
    ev.corrModel.toFixed(3).padEnd(12) + (ev.ganhoSobreEwma >= 0 ? '+' : '') + ev.ganhoSobreEwma.toFixed(1) + '%',
  );
  if (symbol === symbols[0]) {
    console.log(`  └ features mais usadas: ${ev.importancia.map((f) => `${f.name}(${f.count})`).join(', ')}`);
  }
}

console.log(`\n${'─'.repeat(78)}`);
console.log('PARTE 2 — a melhora vira resultado? (dimensionamento com cada previsão)\n');
console.log('ativo'.padEnd(9) + 'trades'.padEnd(9) + 'Calmar fixo'.padEnd(14) + 'Calmar EWMA'.padEnd(14) + 'Calmar ML'.padEnd(13) + 'melhor');

let somaFixo = 0, somaEwma = 0, somaMl = 0, n = 0;
for (const symbol of symbols) {
  const series = loadSeries(exchange, symbol, timeframe);
  const idx = new Map(series.bars.map((b, i) => [b.t, i]));
  const vfEwma = forecastVolatility(series.bars);
  const vtEwma = targetVolatility(vfEwma);
  const vfMl = forecasts.get(symbol)!;
  const vtMl = targetVolatility(vfMl);

  const res = runBacktest(series, buildStrategy(strat, {}), cfg);
  if (res.trades.length < 30) continue;

  const rescale = (mult: (i: number) => number) => {
    let eq = 100;
    const ts: Trade[] = [];
    for (const t of res.trades) {
      const i = idx.get(t.entryTime) ?? 0;
      const m = mult(i);
      const r = t.rEquity * m;
      eq += r * eq;
      ts.push({ ...t, rEquity: r, pnl: r * eq, equityAfter: eq });
    }
    const curve = ts.map((t) => ({ t: t.exitTime, equity: t.equityAfter }));
    if (curve.length) curve.unshift({ t: ts[0].entryTime, equity: 100 });
    return computeMetrics({ trades: ts, equityCurve: curve, finalEquity: eq }, 100);
  };

  const mFixo = rescale(() => 1);
  const mEwma = rescale((i) => volSizeMultiplier(vfEwma, i, vtEwma));
  // Onde o ML não tem previsão (período de treino), cai para o EWMA.
  const mMl = rescale((i) => (isFinite(vfMl[i]) ? volSizeMultiplier(vfMl, i, vtMl) : volSizeMultiplier(vfEwma, i, vtEwma)));

  const cal = (m: any) => (m.maxDrawdown > 0 ? m.cagr / m.maxDrawdown : 0);
  const cF = cal(mFixo), cE = cal(mEwma), cM = cal(mMl);
  somaFixo += cF; somaEwma += cE; somaMl += cM; n++;

  const melhor = cM > cE && cM > cF ? 'ML' : cE > cF ? 'EWMA' : 'fixo';
  console.log(
    symbol.replace('/USDT:USDT', '').padEnd(9) + String(mFixo.trades).padEnd(9) +
    cF.toFixed(2).padEnd(14) + cE.toFixed(2).padEnd(14) + cM.toFixed(2).padEnd(13) + melhor,
  );
}

console.log(`\n${'─'.repeat(78)}`);
console.log(`Calmar médio:  fixo ${(somaFixo / n).toFixed(2)}  ·  EWMA ${(somaEwma / n).toFixed(2)}  ·  ML ${(somaMl / n).toFixed(2)}`);

const mlVence = somaMl / n > somaEwma / n * 1.05;
console.log(
  `\n${'='.repeat(78)}\n` +
  (mlVence
    ? `VEREDICTO: o ML supera o EWMA em resultado de trading. Vale substituir.`
    : somaMl / n > somaEwma / n * 0.95
      ? `VEREDICTO: EMPATE. O ML pode prever melhor, mas não se traduz em vantagem\n` +
        `de trading. Mantenho o EWMA — é mais simples, não precisa de treino, e\n` +
        `não tem risco de sobreajuste. Complexidade sem retorno não entra.`
      : `VEREDICTO: o ML PIORA o resultado. Fica documentado como testado e\n` +
        `descartado. O EWMA continua em produção.`) +
  `\n${'='.repeat(78)}`,
);
