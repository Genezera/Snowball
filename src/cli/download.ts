import { downloadSeries, auditSeries, loadSeries } from '../data/store.ts';
import { parseArgs, num, str } from './args.ts';

const a = parseArgs();
const exchange = str(a.exchange, 'binance');
const timeframe = str(a.timeframe, '5m');
const days = num(a.days, 365);
const symbols = str(a.symbol, 'BTC/USDT,ETH/USDT,SOL/USDT')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

for (const symbol of symbols) {
  process.stdout.write(`baixando ${symbol} ${timeframe} (${days}d) de ${exchange}... `);
  try {
    await downloadSeries({ exchange, symbol, timeframe, days });
    const audit = auditSeries(loadSeries(exchange, symbol, timeframe));
    console.log(
      `ok  ${audit.bars} barras  ${audit.from.slice(0, 10)} -> ${audit.to.slice(0, 10)}  ` +
        `cobertura ${(audit.coverage * 100).toFixed(2)}%  gaps ${audit.gaps} (maior ${audit.worstGapBars})  ohlc-ruim ${audit.badOhlc}`,
    );
  } catch (e) {
    console.log(`FALHOU: ${(e as Error).message}`);
  }
}
