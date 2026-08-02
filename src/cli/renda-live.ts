/**
 * Motor de renda delta-neutra, rodando 24h.
 *
 * NENHUMA ORDEM É ENVIADA. A exchange é lida, nunca escrita.
 */
import { MotorRenda } from '../funding/live.ts';
import { CONFIG_PADRAO } from '../funding/engine.ts';
import { parseArgs, num, str } from './args.ts';

const a = parseArgs();
const capital = num(a.equity, 100);
const intervalo = num(a.intervalo, 20) * 60_000;
const candidatos = str(a.symbol, '1000RATS/USDT:USDT,KOMA/USDT:USDT,AKE/USDT:USDT,GIGGLE/USDT:USDT')
  .split(',').map((s) => s.trim());

const motor = new MotorRenda({ candidatos, capital, cfg: CONFIG_PADRAO });

console.log(`\n${'='.repeat(78)}`);
console.log(`MOTOR DE RENDA DELTA-NEUTRA  ·  US$ ${capital}`);
console.log(`${'='.repeat(78)}\n`);

await motor.init();

console.log(
  `\ncandidatos      ${candidatos.map((c) => c.replace('/USDT:USDT', '')).join(', ')}\n` +
  `alavancagem     ${CONFIG_PADRAO.alavancagemShort}x na perna vendida\n` +
  `troca mínima    ${CONFIG_PADRAO.diasMinimos} dias na posição\n` +
  `ciclo           a cada ${intervalo / 60000} minutos\n` +
  `\nExposição a preço: ZERO. Comprado no spot, vendido igual no perpétuo.\n` +
  `NENHUMA ORDEM SERÁ ENVIADA — a exchange é apenas lida.\n` +
  `Diário: renda/diario.jsonl\n`,
);

async function loop() {
  try {
    await motor.ciclo();
  } catch (e) {
    console.error(`[erro no ciclo] ${(e as Error).message}`);
  }
  console.log(`  ${motor.status()}`);
  setTimeout(loop, intervalo);
}

process.on('SIGINT', () => {
  console.log(`\n${motor.status()}`);
  console.log('Estado salvo. Reiniciar retoma de onde parou.');
  process.exit(0);
});

await loop();
