/**
 * Varredura de spread de funding entre exchanges.
 *
 * A estrutura mais eficiente encontrada até agora: as duas pernas são
 * perpétuos em exchanges diferentes, então nenhum capital fica parado no spot.
 */
import { varrerSpreads, dimensionarSpread, rendaSemanal, riscoDesbalanceamento } from '../funding/spread.ts';
import { parseArgs, num } from './args.ts';

const a = parseArgs();
const CAPITAL = num(a.equity, 100);
const LEV = num(a.alavancagem, 3);

console.log(`\n${'='.repeat(84)}`);
console.log(`SPREAD DE FUNDING ENTRE EXCHANGES — US$ ${CAPITAL} · ${LEV}x por perna`);
console.log(`${'='.repeat(84)}\n`);

const ops = await varrerSpreads({
  onProgresso: (ex, n) => console.log(`  ${ex.padEnd(14)} ${n} ativos`),
});

if (!ops.length) { console.log('\nNenhuma oportunidade com liquidez suficiente agora.'); process.exit(0); }

console.log(`\n${'─'.repeat(84)}`);
console.log('ativo'.padEnd(9) + 'vendido em'.padEnd(15) + 'comprado em'.padEnd(15) + 'spread'.padEnd(12) + 'APR'.padEnd(10) + 'renda/semana');
for (const o of ops.slice(0, 12)) {
  const r = rendaSemanal(o, CAPITAL, LEV);
  console.log(
    o.symbol.replace('/USDT:USDT', '').padEnd(9) +
    o.exchangeShort.padEnd(15) + o.exchangeLong.padEnd(15) +
    ((o.spread * 100).toFixed(4) + '%').padEnd(12) +
    ((o.aprSpread * 100).toFixed(1) + '%').padEnd(10) +
    '$' + r.bruta.toFixed(4),
  );
}

const b = ops[0];
const d = dimensionarSpread(CAPITAL, LEV);
const r = rendaSemanal(b, CAPITAL, LEV);
const risco = riscoDesbalanceamento(LEV);

console.log(`\n${'='.repeat(84)}`);
console.log(
  `MELHOR: ${b.symbol.replace('/USDT:USDT', '')} — vendido na ${b.exchangeShort}, comprado na ${b.exchangeLong}\n\n` +
  `  margem por perna     US$ ${d.margemPorPerna.toFixed(2)}\n` +
  `  notional por perna   US$ ${d.notionalPorPerna.toFixed(2)}\n` +
  `  capital produtivo    100% — nada parado no spot\n` +
  `  renda bruta/semana   US$ ${r.bruta.toFixed(4)}\n` +
  `  custo de montagem    US$ ${r.custo.toFixed(4)} (se paga em ${r.diasParaPagarCusto.toFixed(1)} dias)\n` +
  `  liquidez mínima      US$ ${(b.volumeMinimo / 1e6).toFixed(0)}M/dia\n\n` +
  `  RISCO: ${risco.descricao}`,
);

// comparação com a estrutura atual
const rendaSpotPerp = 75 * 0.000189 * 21;
console.log(
  `\n${'─'.repeat(84)}\n` +
  `COMPARAÇÃO\n\n` +
  `  spot + perp (atual)      US$ ${rendaSpotPerp.toFixed(4)}/semana · 75% do capital parado no spot\n` +
  `  spread entre exchanges   US$ ${r.bruta.toFixed(4)}/semana · 100% do capital produtivo\n` +
  `  diferença                ${r.bruta > rendaSpotPerp ? '+' : ''}${(((r.bruta / rendaSpotPerp) - 1) * 100).toFixed(0)}%`,
);
