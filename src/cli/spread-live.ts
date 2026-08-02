/**
 * Motor de spread entre exchanges, 24h.
 * NENHUMA ORDEM É ENVIADA — as exchanges são apenas lidas.
 */
import { MotorSpread } from '../funding/spread-live.ts';
import { riscoDesbalanceamento } from '../funding/spread.ts';
import { parseArgs, num } from './args.ts';

const a = parseArgs();
const capital = num(a.equity, 100);
const alavancagem = num(a.alavancagem, 3);
const intervalo = num(a.intervalo, 20) * 60_000;

const motor = new MotorSpread({ capital, alavancagem });

console.log(`\n${'='.repeat(78)}`);
console.log(`MOTOR DE SPREAD ENTRE EXCHANGES  ·  US$ ${capital}  ·  ${alavancagem}x`);
console.log(`${'='.repeat(78)}\n`);

await motor.init();

const r = riscoDesbalanceamento(alavancagem);
console.log(
  `\nexchanges       binance · bybit · okx · gate\n` +
  `estrutura       duas pernas de perpétuo, exchanges diferentes\n` +
  `capital parado  ZERO — as duas pernas são margem\n` +
  `ciclo           a cada ${intervalo / 60000} minutos\n` +
  `\nExposição a preço: ZERO. As pernas se cancelam.\n` +
  `Risco: ${r.descricao}\n` +
  `\nNENHUMA ORDEM SERÁ ENVIADA.\nDiário: spread/diario.jsonl\n`,
);

async function loop() {
  try {
    await motor.ciclo();
  } catch (e) {
    console.error(`[erro] ${(e as Error).message}`);
  }
  console.log(`  ${motor.status()}`);
  setTimeout(loop, intervalo);
}

process.on('SIGINT', () => {
  console.log(`\n${motor.status()}`);
  console.log('Estado salvo.');
  process.exit(0);
});

await loop();
