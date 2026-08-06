/**
 * Motor de pares cointegrados, ao vivo, papel, mercado-neutro.
 * NENHUMA ORDEM É ENVIADA — as exchanges são apenas lidas.
 */
import { MotorPares } from '../live/motor-pares.ts';
import { parseArgs, num } from './args.ts';

const a = parseArgs();
const capital = num(a.equity, 200);
const riscoPorPosicao = num(a.risco, 0.05);
const intervalo = num(a.intervalo, 20) * 60_000;

const motor = new MotorPares({ capital, riscoPorPosicao });

console.log(`\n${'='.repeat(78)}`);
console.log(`MOTOR DE PARES COINTEGRADOS — mercado-neutro, papel`);
console.log(`${'='.repeat(78)}\n`);
console.log(
  `capital           US$ ${capital.toFixed(2)}\n` +
  `risco/posição     ${(riscoPorPosicao * 100).toFixed(1)}% do capital, dividido igual nas 2 pernas\n` +
  `alavancagem       1x (validado como o limite seguro — src/pairs/liquidacao.ts)\n` +
  `ciclo             a cada ${intervalo / 60000} minutos (barras diárias — a maioria dos ciclos não vê barra nova)\n` +
  `\nBaseado no Resultado 14 (docs/RESULTADOS.md): misturar momentum+pares corta\n` +
  `a chance de ruína de ~46% para ~15% mantendo a chance de sucesso quase igual.\n` +
  `NÃO é lucro garantido — é diversificação real medida por bootstrap.\n` +
  `\nNENHUMA ORDEM SERÁ ENVIADA.\nDiário: pares/diario.jsonl\n`,
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
  console.log('\nmotor de pares interrompido. Estado salvo.');
  process.exit(0);
});

await loop();
