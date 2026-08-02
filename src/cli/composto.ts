/**
 * Renda semanal COMPOSTA — mostra o lucro da semana crescendo.
 *
 * Usa o funding real medido, aplica composição por limiar, e reporta semana a
 * semana quanto entrou.
 */
import ccxt from 'ccxt';
import { projetar } from '../funding/compound.ts';
import { CONFIG_PADRAO } from '../funding/engine.ts';
import { parseArgs, num, str } from './args.ts';

const a = parseArgs();
const CAPITAL = num(a.equity, 100);
const SEMANAS = num(a.weeks, 104);
const alvo = str(a.symbol, '1000RATS/USDT:USDT');
const cfg = CONFIG_PADRAO;

console.log(`\n${'='.repeat(80)}`);
console.log(`RENDA SEMANAL COMPOSTA — US$ ${CAPITAL}`);
console.log(`${'='.repeat(80)}\n`);

const ex = new (ccxt as any).binanceusdm({ enableRateLimit: true });
await ex.loadMarkets();

const h = await ex.fetchFundingRateHistory(alvo, Date.now() - 180 * 86_400_000, 1000);
const taxas = h.map((f: any) => f.fundingRate as number);
const media = taxas.reduce((x: number, y: number) => x + y, 0) / taxas.length;
const positivos = taxas.filter((t: number) => t > 0).length;

console.log(
  `Funding real de ${alvo.replace('/USDT:USDT', '')}: ${taxas.length} leituras\n` +
  `  média ${(media * 100).toFixed(4)}%/8h · positivo em ${((positivos / taxas.length) * 100).toFixed(0)}% dos períodos\n`,
);

const proj = projetar({ capitalInicial: CAPITAL, fundingPor8h: media, semanas: SEMANAS, cfg });

console.log(`${'─'.repeat(80)}`);
console.log('semana'.padEnd(10) + 'capital'.padEnd(13) + 'notional'.padEnd(13) + 'renda da semana'.padEnd(19) + 'acumulado');
const marcos = [1, 2, 4, 8, 13, 26, 39, 52, 78, 104].filter((m) => m <= SEMANAS);
for (const m of marcos) {
  const p = proj[m - 1];
  console.log(
    String(p.semana).padEnd(10) + ('$' + p.capital.toFixed(2)).padEnd(13) +
    ('$' + p.notional.toFixed(2)).padEnd(13) +
    ('$' + p.rendaSemana.toFixed(4)).padEnd(19) + '$' + p.acumulado.toFixed(2),
  );
}

const s1 = proj[0], sFim = proj[proj.length - 1];
const crescimento = (sFim.rendaSemana / s1.rendaSemana - 1) * 100;
const positivasProj = proj.filter((p) => p.rendaSemana > 0).length;

console.log(`\n${'='.repeat(80)}`);
console.log(
  `  semanas com lucro:      ${positivasProj} de ${proj.length}  (${((positivasProj / proj.length) * 100).toFixed(0)}%)\n` +
  `  renda na semana 1:      US$ ${s1.rendaSemana.toFixed(4)}\n` +
  `  renda na semana ${sFim.semana}:    US$ ${sFim.rendaSemana.toFixed(4)}   (+${crescimento.toFixed(1)}%)\n` +
  `  capital final:          US$ ${sFim.capital.toFixed(2)}\n` +
  `  total acumulado:        US$ ${sFim.acumulado.toFixed(2)}\n\n` +
  `  A renda semanal cresce porque cada pagamento vira notional novo,\n` +
  `  e notional maior gera pagamento maior.`,
);

// ── acelerar: e se o capital inicial for maior? ────────────────────────────
console.log(`\n${'─'.repeat(80)}`);
console.log('A MESMA MÁQUINA COM MAIS CAPITAL\n');
console.log('capital'.padEnd(12) + 'renda semana 1'.padEnd(18) + 'renda semana 52'.padEnd(19) + 'capital em 1 ano');
for (const c of [100, 250, 500, 1000, 2500, 5000]) {
  const p = projetar({ capitalInicial: c, fundingPor8h: media, semanas: 52, cfg });
  console.log(
    ('$' + c).padEnd(12) + ('$' + p[0].rendaSemana.toFixed(3)).padEnd(18) +
    ('$' + p[51].rendaSemana.toFixed(3)).padEnd(19) + '$' + p[51].capital.toFixed(2),
  );
}
