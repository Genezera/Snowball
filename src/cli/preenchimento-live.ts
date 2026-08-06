/**
 * Monitor de preenchimento de ordem maker, ao vivo.
 * NENHUMA ORDEM É ENVIADA — as exchanges são apenas lidas.
 */
import { rodar } from '../live/monitor-preenchimento.ts';
import { parseArgs, num } from './args.ts';

const a = parseArgs();
const intervalo = num(a.intervalo, 10) * 1000;

process.on('SIGINT', () => {
  console.log('\nmonitor de preenchimento interrompido. Estado salvo.');
  process.exit(0);
});

await rodar(intervalo);
