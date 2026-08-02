/**
 * "Qual estrategia deveria estar rodando agora?"
 *
 * Esta e a metade que FUNCIONA do experimento adaptativo (ver
 * docs/ADAPTATIVO.md). O filtro de ML por trade nao se provou; o portao de
 * pool sim -- ele identificou corretamente as estrategias que prestam e
 * descartou `ma-cross` em 100% dos folds, em todos os ativos.
 *
 * Uso pretendido: rodar uma vez por trimestre (ou por mes) sobre a janela mais
 * recente, e manter no ar apenas o que aparecer como APROVADO. Nao rode isto
 * toda barra -- a licao do projeto e que o retorno esta nas decisoes de baixa
 * frequencia.
 */
import { loadSeries } from '../data/store.ts';
import { buildStrategy, REGISTRY } from '../strategies/index.ts';
import { buildRegimeContext, labelRegime, REGIME_FEATURES } from '../ml/regime.ts';
import { collectTrainingData, trainAllocator, type AllocatorConfig } from '../ml/allocator.ts';
import { runBacktest } from '../backtest/engine.ts';
import { computeMetrics } from '../backtest/metrics.ts';
import { makeConfig } from '../config.ts';
import { parseArgs, num, str } from './args.ts';
import type { Series } from '../core/types.ts';

const a = parseArgs();
const exchange = str(a.exchange, 'binanceusdm');
const timeframe = str(a.timeframe, '4h');
const symbols = str(a.symbol, 'BTC/USDT:USDT,ETH/USDT:USDT,TRX/USDT:USDT,SOL/USDT:USDT,DOT/USDT:USDT')
  .split(',').map((s) => s.trim());
const lookbackDays = num(a.lookback, 540);

const cfg = makeConfig({
  initialEquity: num(a.equity, 100),
  costPreset: str(a.cost, 'binance-futures-maker'),
  riskProfile: str(a.risk, 'seed'),
  maxBarsInTrade: num(a.maxBars, 100000),
});
const acfg: AllocatorConfig = {
  minExpectedR: 0.0005,
  minTrainExpectancy: num(a.minTrainExpectancy, 0.02),
  minModelAuc: num(a.minModelAuc, 0.52),
};

const strategies = Object.keys(REGISTRY).map((n) => buildStrategy(n, {}));

console.log(
  `Janela de avaliacao: ultimos ${lookbackDays} dias  |  timeframe ${timeframe}  |  custo ${str(a.cost, 'binance-futures-maker')}\n` +
    `Criterio: expectancy >= ${acfg.minTrainExpectancy}R sozinha, E modelo de regime com AUC >= ${acfg.minModelAuc}\n`,
);

const recommendations: { symbol: string; approved: string[]; regime: string }[] = [];

for (const symbol of symbols) {
  let full: Series;
  try {
    full = loadSeries(exchange, symbol, timeframe);
  } catch (e) {
    console.log(`${symbol}: ${(e as Error).message}`);
    continue;
  }

  const cutoff = full.bars[full.bars.length - 1].t - lookbackDays * 86_400_000;
  const series: Series = { ...full, bars: full.bars.filter((b) => b.t >= cutoff) };
  if (series.bars.length < 500) {
    console.log(`${symbol}: historico insuficiente na janela.`);
    continue;
  }

  const ctx = buildRegimeContext(series.bars);
  const regimeNow = labelRegime(ctx, ctx.rows.length - 1);

  const data = collectTrainingData(series, strategies, cfg, ctx);
  const models = trainAllocator(data, [...REGIME_FEATURES], acfg, num(a.minTrades, 60));

  console.log(`########## ${symbol}   regime atual: ${regimeNow}`);
  console.log('  estrategia'.padEnd(24) + 'trades'.padEnd(9) + 'expectancy'.padEnd(13) + 'retorno'.padEnd(11) + 'DD'.padEnd(9) + 'AUC'.padEnd(8) + 'status');

  const approved: string[] = [];
  for (const s of strategies) {
    const d = data.get(s.name);
    const short = s.name.split('(')[0];
    if (!d || !d.trades.length) {
      console.log(`  ${short.padEnd(22)}${'0'.padEnd(9)}${'-'.padEnd(13)}${'-'.padEnd(11)}${'-'.padEnd(9)}${'-'.padEnd(8)}sem sinais`);
      continue;
    }
    const res = runBacktest(series, s, { ...cfg, risk: { ...cfg.risk, maxDrawdownStop: 1, dailyLossLimit: 1 } });
    const m = computeMetrics(res, cfg.initialEquity);
    const mdl = models.get(s.name);
    const ok = !!mdl;
    if (ok) approved.push(short);
    console.log(
      `  ${short.padEnd(22)}${String(m.trades).padEnd(9)}${m.expectancyR.toFixed(3).padEnd(13)}` +
        `${((m.totalReturn * 100).toFixed(1) + '%').padEnd(11)}${((m.maxDrawdown * 100).toFixed(1) + '%').padEnd(9)}` +
        `${(mdl?.trainAuc != null ? mdl.trainAuc.toFixed(2) : 'n/d').padEnd(8)}` +
        `${ok ? (mdl!.modelTrusted ? 'APROVADA (+ML)' : 'APROVADA (sem ML)') : 'fora do pool'}`,
    );
  }

  console.log(
    approved.length
      ? `  >>> RODAR: ${approved.join(', ')}\n`
      : `  >>> NAO RODAR NADA neste ativo. Nenhuma estrategia passou no portao.\n`,
  );
  recommendations.push({ symbol, approved, regime: regimeNow });
}

console.log('============ RECOMENDACAO ============');
const any = recommendations.filter((r) => r.approved.length);
if (!any.length) {
  console.log('Nenhum ativo tem estrategia aprovada na janela atual. Ficar de fora e uma posicao.');
} else {
  for (const r of any) console.log(`${r.symbol.padEnd(18)} ${r.regime.padEnd(18)} -> ${r.approved.join(', ')}`);
}
console.log(
  `\nLembrete: aprovacao aqui significa "vale colocar em PAPER TRADING", nao\n` +
    `"vale colocar dinheiro". O portao de 90 dias de paper continua valendo.`,
);
