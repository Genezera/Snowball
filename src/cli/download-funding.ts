import { baixarHistoricoFunding, salvarHistoricoFunding } from '../data/funding-history.ts';
import { parseArgs, num, str } from './args.ts';

const a = parseArgs();
const exchange = str(a.exchange, 'binanceusdm');
const dias = num(a.dias, 730);
const symbols = str(a.symbol, 'BTC/USDT:USDT').split(',').map((s) => s.trim());

for (const symbol of symbols) {
  process.stdout.write(`baixando funding de ${symbol} (${dias}d) de ${exchange}... `);
  try {
    const registros = await baixarHistoricoFunding(exchange, symbol, dias);
    salvarHistoricoFunding(exchange, symbol, registros);
    const dias_reais = registros.length ? (registros[registros.length - 1].t - registros[0].t) / 86_400_000 : 0;
    console.log(`ok  ${registros.length} registros  ${dias_reais.toFixed(0)}d de cobertura`);
  } catch (e) {
    console.log(`FALHOU: ${(e as Error).message}`);
  }
}
