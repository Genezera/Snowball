/**
 * Modo agressivo — ts-momentum ao vivo, papel, multi-ativo, 24h.
 * NENHUMA ORDEM É ENVIADA — as exchanges são apenas lidas.
 */
import { MotorMomentum } from '../live/motor-momentum.ts';
import { parseArgs, num } from './args.ts';

const a = parseArgs();
const capital = num(a.equity, 200);
const riscoPorPosicao = num(a.risco, 0.005);
const alavancagemMaxima = num(a.alavancagem, 2);
const intervalo = num(a.intervalo, 20) * 60_000;

const motor = new MotorMomentum({ capital, riscoPorPosicao, alavancagemMaxima });

console.log(`\n${'='.repeat(78)}`);
console.log(`MODO AGRESSIVO — ts-momentum multi-ativo, papel`);
console.log(`${'='.repeat(78)}\n`);
console.log(
  `capital           US$ ${capital.toFixed(2)}\n` +
  `risco/posição     ${(riscoPorPosicao * 100).toFixed(2)}% do capital (fração fixa, não dividida por concorrência)\n` +
  `alavancagem máx.  ${alavancagemMaxima}x\n` +
  `ciclo             a cada ${intervalo / 60000} minutos (barras diárias — a maioria dos ciclos não vê barra nova)\n` +
  `\nBaseado no Resultado 12 (docs/RESULTADOS.md): ~9-13% de chance de bater a\n` +
  `meta em anos, ~15-45% de chance de perder o capital, dependendo do risco.\n` +
  `NÃO é lucro garantido em 30 dias — nenhuma estratégia deste projeto é.\n` +
  `\nNENHUMA ORDEM SERÁ ENVIADA.\nDiário: momentum/diario.jsonl\n`,
);

await motor.init();

async function loop() {
  try {
    await motor.ciclo();
  } catch (e) {
    console.error(`[erro no ciclo] ${(e as Error).message}`);
  }
  setTimeout(loop, intervalo);
}

process.on('SIGINT', () => {
  console.log('\nmodo agressivo interrompido. Estado salvo.');
  process.exit(0);
});

await loop();
