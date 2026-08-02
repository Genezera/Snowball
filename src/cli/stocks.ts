/**
 * Baixa e testa os ativos de ação do vídeo (F, COIN). ALTR está deslistada.
 *
 * A janela é curta (~60 dias) por limitação da fonte gratuita, então este CLI
 * NÃO roda walk-forward — seria fingir rigor onde não há amostra. Roda apenas a
 * comparação de custos, que é o teste que a amostra suporta.
 */
import { downloadStock, sessionReport } from '../data/stocks.ts';
import { buildStrategy, REGISTRY } from '../strategies/index.ts';
import { runBacktest } from '../backtest/engine.ts';
import { computeMetrics } from '../backtest/metrics.ts';
import { makeConfig, COSTS } from '../config.ts';
import { parseArgs, num, str } from './args.ts';

const a = parseArgs();
const timeframe = str(a.timeframe, '5m');
const symbols = str(a.symbol, 'F,COIN').split(',').map((s) => s.trim());
const stratNames = str(a.strategy, Object.keys(REGISTRY).join(',')).split(',').map((s) => s.trim());

// Corretora de ação nos EUA: comissão zero em varejo (Robinhood, Schwab), mas o
// spread e o slippage continuam existindo e sao maiores que em cripto liquido.
const STOCK_COSTS = {
  'stock-zero-commission': { takerFee: 0, slippage: 0.0005, fundingPer8h: 0 },
  'stock-realistic': { takerFee: 0.0001, slippage: 0.001, fundingPer8h: 0 },
};
Object.assign(COSTS, STOCK_COSTS);

for (const symbol of symbols) {
  console.log(`\n########## ${symbol} ${timeframe}`);
  let series;
  try {
    series = await downloadStock({ symbol, timeframe });
  } catch (e) {
    console.log(`  FALHOU: ${(e as Error).message}`);
    continue;
  }

  const rep = sessionReport(series);
  console.log(
    `  ${rep.bars} barras em ${rep.sessions} pregoes (${rep.barsPerSession}/pregao)  ` +
      `gaps overnight: ${rep.overnightGaps}, mediana ${(rep.medianOvernightGapPct * 100).toFixed(2)}%, ` +
      `maior ${(rep.maxOvernightGapPct * 100).toFixed(2)}%`,
  );
  console.log(
    `  AVISO: ${rep.sessions} pregoes e amostra pequena. Serve para checagem direcional, nao para conclusao.`,
  );

  for (const name of stratNames) {
    for (const preset of ['zero-cost', 'stock-zero-commission', 'stock-realistic']) {
      const cfg = makeConfig({
        initialEquity: num(a.equity, 100),
        costPreset: preset,
        riskProfile: str(a.risk, 'seed'),
        maxBarsInTrade: num(a.maxBars, 78), // 78 barras de 5min = 1 pregao
      });
      const res = runBacktest(series, buildStrategy(name, {}), cfg);
      const m = computeMetrics(res, cfg.initialEquity);
      if (!m.trades) continue;
      console.log(
        `  ${name.padEnd(19)} ${preset.padEnd(22)} ` +
          `trades ${String(m.trades).padStart(4)}  PF ${m.profitFactor === Infinity ? ' inf ' : m.profitFactor.toFixed(3)}  ` +
          `exp ${m.expectancyR.toFixed(3)}R  ret ${(m.totalReturn * 100).toFixed(1)}%  ` +
          `taxas/bruto ${(m.feesAsPctOfGross * 100).toFixed(0)}%`,
      );
    }
  }
}

console.log(
  `\nNota sobre ALTR: a Altair Engineering foi adquirida pela Siemens e o ativo\n` +
    `foi deslistado, entao a estrategia 2 do video nao e mais verificavel no\n` +
    `ativo original. Isso tambem e um lembrete de vies de sobrevivencia: um\n` +
    `backtest so pode ser feito em ativos que ainda existem.`,
);
