/**
 * Varredura ao vivo de candidatos a basis trade (spot + perp, mesma
 * exchange). NÃO abre posição nenhuma — só mede e reporta.
 *
 * Diferente da varredura de spread entre exchanges: aqui cada listagem com
 * funding positivo já é candidata por conta própria, sem precisar de duas
 * exchanges divergindo. Confirma ao vivo se existe mercado à vista
 * correspondente antes de contar como candidato de verdade — um perp sem
 * par à vista na mesma exchange não é executável desta forma.
 */
import ccxt from 'ccxt';
import { lerUniverso } from '../funding/universo.ts';
import { candidatosBasis, avaliarBasis } from '../funding/basis.ts';
import { parseArgs, num } from './args.ts';

const a = parseArgs();
const VOL_MIN = num(a.volumeMinimo, 1e6);
const TOP_N = num(a.top, 15);

/** binanceusdm (perp) tem mercado à vista na binance (spot) — ids diferentes no ccxt. */
const SPOT_DA_EXCHANGE_PERP: Record<string, string> = {
  binanceusdm: 'binance', bybit: 'bybit', okx: 'okx', gate: 'gate', bitget: 'bitget', bingx: 'bingx',
};

/** Taxa taker à vista, medida ou de tabela pública — geralmente maior que a de perp. */
const TAXA_SPOT: Record<string, number> = {
  binance: 0.001, bybit: 0.001, okx: 0.001, gate: 0.002, bitget: 0.001, bingx: 0.001,
};
const TAXA_PERP: Record<string, number> = {
  binanceusdm: 0.0005, bybit: 0.00055, okx: 0.0005, gate: 0.0005, bitget: 0.0006, bingx: 0.0005,
};

console.log(`\n${'='.repeat(88)}`);
console.log('VARREDURA DE BASIS TRADE — spot + perp, mesma exchange');
console.log(`${'='.repeat(88)}\n`);
console.log('NENHUMA ORDEM É ENVIADA — só leitura de mercado.\n');
console.log(`volume mínimo US$ ${(VOL_MIN / 1e6).toFixed(1)}M · top ${TOP_N}\n`);

const pares = await lerUniverso({
  onProgresso: (ex, n, ms) => console.log(`  ${ex}: ${n} pares em ${ms}ms`),
});
console.log();

const brutos = candidatosBasis(pares, VOL_MIN).slice(0, TOP_N * 3); // folga pra descartar sem spot

const poolSpot: Record<string, any> = {};
async function exchangeSpot(id: string) {
  if (!poolSpot[id]) {
    poolSpot[id] = new (ccxt as any)[id]({ enableRateLimit: true });
    await poolSpot[id].loadMarkets();
  }
  return poolSpot[id];
}

const resultados: { c: typeof brutos[0]; temSpot: boolean; payback: number }[] = [];
for (const c of brutos) {
  const spotId = SPOT_DA_EXCHANGE_PERP[c.exchange];
  let temSpot = false;
  if (spotId) {
    try {
      const ex = await exchangeSpot(spotId);
      const spotSymbol = c.symbol.replace(':USDT', '');
      temSpot = !!ex.markets[spotSymbol];
    } catch { /* exchange indisponível agora; conta como sem confirmação */ }
  }
  const taxaPerp = TAXA_PERP[c.exchange] ?? 0.0006;
  const taxaSpot = TAXA_SPOT[spotId ?? ''] ?? 0.001;
  const v = avaliarBasis({ funding8h: c.funding8h, taxaPerp, taxaSpot });
  resultados.push({ c, temSpot, payback: v.paybackHoras });
  if (resultados.filter((r) => r.temSpot).length >= TOP_N) break;
}

const comSpot = resultados.filter((r) => r.temSpot);
const semSpot = resultados.filter((r) => !r.temSpot);

console.log(`${'─'.repeat(88)}`);
console.log(`CANDIDATOS COM MERCADO À VISTA CONFIRMADO · ${comSpot.length}`);
console.log(`${'─'.repeat(88)}`);
console.log(
  'ativo'.padEnd(18) + 'exchange'.padEnd(14) + 'APR funding'.padEnd(13) +
  'volume'.padEnd(12) + 'payback'.padEnd(10) + 'portão (1,5x)',
);
for (const { c, payback } of comSpot) {
  console.log(
    c.symbol.replace('/USDT:USDT', '').padEnd(18) +
    c.exchange.padEnd(14) +
    (c.aprFunding * 100).toFixed(1).padStart(6) + '%'.padEnd(6) +
    ('US$' + (c.volume24h / 1e6).toFixed(1) + 'M').padEnd(12) +
    (payback < 10000 ? payback.toFixed(1) + 'h' : '—').padEnd(10) +
    (payback < 10000 ? (payback * 1.5).toFixed(1) + 'h' : '—'),
  );
}

if (semSpot.length) {
  console.log(`\n${semSpot.length} candidato(s) com funding bom mas SEM mercado à vista confirmado na mesma exchange — descartados:`);
  for (const { c } of semSpot.slice(0, 5)) {
    console.log(`  ${c.symbol.replace('/USDT:USDT', '')} · ${c.exchange} · APR ${(c.aprFunding * 100).toFixed(1)}%`);
  }
}

console.log(`\n${'='.repeat(88)}`);
console.log('⚠ Isto é um retrato do agora, não uma promessa. Payback aqui é "quanto tempo o funding');
console.log('  precisaria se manter" — não existe ainda dado de quanto tempo o funding de uma');
console.log('  exchange só costuma durar (só medimos isso pra spread ENTRE exchanges até agora).');
console.log('  E: as duas pernas ficam na MESMA exchange — concentra custódia, risco não mitigado.');
console.log(`${'='.repeat(88)}\n`);
