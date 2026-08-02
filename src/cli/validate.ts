/**
 * Pipeline de validacao. Esta e a porta de entrada para dinheiro real: nada
 * passa daqui sem sobreviver a walk-forward, ao Sharpe deflacionado e ao
 * Monte Carlo.
 */
import fs from 'node:fs';
import path from 'node:path';
import { loadSeries, ROOT } from '../data/store.ts';
import { walkForward } from '../validate/walkforward.ts';
import { GRIDS } from '../validate/grids.ts';
import { monteCarlo, formatMonteCarlo } from '../validate/montecarlo.ts';
import { formatMetrics, deflatedSharpe } from '../backtest/metrics.ts';
import { makeConfig } from '../config.ts';
import { parseArgs, num, str, bool } from './args.ts';

const a = parseArgs();
const exchange = str(a.exchange, 'binance');
const timeframe = str(a.timeframe, '5m');
const symbols = str(a.symbol, 'BTC/USDT').split(',').map((s) => s.trim());
const stratNames = str(a.strategy, Object.keys(GRIDS).join(',')).split(',').map((s) => s.trim());
const folds = num(a.folds, 6);
const save = bool(a.save, true);

const cfg = makeConfig({
  initialEquity: num(a.equity, 100),
  costPreset: str(a.cost, 'binance-futures'),
  riskProfile: str(a.risk, 'seed'),
  maxBarsInTrade: num(a.maxBars, 288),
});

interface Verdict {
  symbol: string;
  strategy: string;
  params: Record<string, unknown>;
  oosTrades: number;
  oosExpectancyR: number;
  oosSharpe: number;
  oosReturn: number;
  oosMaxDd: number;
  efficiency: number;
  deflatedSharpeProb: number;
  mcProbLoss: number;
  mcProbRuin: number;
  approved: boolean;
  reasons: string[];
}

const verdicts: Verdict[] = [];

for (const symbol of symbols) {
  const series = loadSeries(exchange, symbol, timeframe);
  for (const name of stratNames) {
    const grid = GRIDS[name];
    if (!grid) continue;
    process.stdout.write(`\n\n########## ${symbol} ${timeframe} :: ${name}\n`);

    const wf = walkForward({
      series,
      strategyName: name,
      grid,
      cfg,
      folds,
      onFold: (f) => {
        console.log(
          `  fold ${f.index}  IS ${f.isFrom}..${f.isTo} (exp ${f.isMetrics.expectancyR.toFixed(3)}R, ${f.isMetrics.trades}t)` +
            `  ->  OOS ${f.oosFrom}..${f.oosTo} (exp ${f.oosMetrics.expectancyR.toFixed(3)}R, ${f.oosMetrics.trades}t, ret ${(f.oosMetrics.totalReturn * 100).toFixed(1)}%)` +
            `  params ${JSON.stringify(f.bestParams)}`,
        );
      },
    });

    if (!wf.folds.length) {
      console.log('  nenhum fold produziu trades suficientes.');
      continue;
    }

    console.log('\n' + formatMetrics(wf.combined, `OOS CONCATENADO ${symbol} ${name}`));
    console.log(`Eficiencia WF     ${wf.efficiency.toFixed(2)}  (OOS/IS; abaixo de 0.5 = sobreajustado)`);

    const dsr = deflatedSharpe(wf.combined.sharpe, wf.totalCombosTested, wf.combined.trades);
    console.log(`Sharpe deflacionado ${dsr.toFixed(3)} apos ${wf.totalCombosTested} tentativas de parametro`);

    const mc = monteCarlo(wf.combinedTrades, { sims: 5000, ddStop: cfg.risk.maxDrawdownStop });
    console.log('\n' + formatMonteCarlo(mc));

    // --- criterio de aprovacao. Todos precisam passar, sem excecao. ---
    const reasons: string[] = [];
    if (wf.combined.trades < 100) reasons.push(`poucos trades OOS (${wf.combined.trades} < 100)`);
    if (wf.combined.expectancyR <= 0) reasons.push(`expectancy OOS nao positiva (${wf.combined.expectancyR.toFixed(3)}R)`);
    if (wf.efficiency < 0.4) reasons.push(`eficiencia WF baixa (${wf.efficiency.toFixed(2)} < 0.40)`);
    if (dsr < 0.9) reasons.push(`Sharpe deflacionado ${dsr.toFixed(2)} < 0.90 (indistinguivel de sorte)`);
    if (mc.pRuin50 > 0.01) reasons.push(`risco de perder 50% da conta ${(mc.pRuin50 * 100).toFixed(1)}% > 1%`);
    if (mc.p5Return < -0.3) reasons.push(`cenario p5 pior que -30% (${(mc.p5Return * 100).toFixed(0)}%)`);
    const approved = reasons.length === 0;

    console.log(
      `\n>>> VEREDITO: ${approved ? 'APROVADO para paper trading' : 'REPROVADO'}` +
        (approved ? '' : '\n    ' + reasons.join('\n    ')),
    );

    // Parametros recomendados: os do ultimo fold, que sao os treinados nos
    // dados mais recentes. E o que voce levaria para producao hoje.
    const last = wf.folds[wf.folds.length - 1];
    verdicts.push({
      symbol,
      strategy: name,
      params: last.bestParams as Record<string, unknown>,
      oosTrades: wf.combined.trades,
      oosExpectancyR: wf.combined.expectancyR,
      oosSharpe: wf.combined.sharpe,
      oosReturn: wf.combined.totalReturn,
      oosMaxDd: wf.combined.maxDrawdown,
      efficiency: wf.efficiency,
      deflatedSharpeProb: dsr,
      mcProbLoss: mc.pLoss,
      mcProbRuin: mc.pRuin50,
      approved,
      reasons,
    });
  }
}

console.log('\n\n============ RESUMO ============');
verdicts.sort((x, y) => y.oosExpectancyR - x.oosExpectancyR);
for (const v of verdicts) {
  console.log(
    `${v.approved ? 'OK  ' : 'NAO '} ${v.symbol.padEnd(10)} ${v.strategy.padEnd(18)} ` +
      `exp ${v.oosExpectancyR.toFixed(3)}R  ret ${(v.oosReturn * 100).toFixed(1)}%  dd ${(v.oosMaxDd * 100).toFixed(1)}%  ` +
      `eff ${v.efficiency.toFixed(2)}  DSR ${v.deflatedSharpeProb.toFixed(2)}  ruina ${(v.mcProbRuin * 100).toFixed(1)}%`,
  );
}

if (save && verdicts.length) {
  const dir = path.join(ROOT, 'reports');
  fs.mkdirSync(dir, { recursive: true });
  const p = path.join(dir, `validation-${timeframe}.json`);
  fs.writeFileSync(p, JSON.stringify({ cfg, verdicts }, null, 2));
  console.log(`\nrelatorio salvo em ${p}`);
}
