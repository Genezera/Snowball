/**
 * Motor de spread entre exchanges, 24h.
 * NENHUMA ORDEM É ENVIADA — as exchanges são apenas lidas.
 */
import { MotorSpread } from '../funding/spread-live.ts';
import { riscoDesbalanceamento } from '../funding/spread.ts';
import { LIMIARES_PADRAO, MMR_ALT, alavancagemMaxima } from '../funding/protecao.ts';
import { parseArgs, num } from './args.ts';

const a = parseArgs();
const capital = num(a.equity, 100);
const alavancagem = num(a.alavancagem, 3);
const intervalo = num(a.intervalo, 20) * 60_000;
// O piso absoluto acompanha o capital: fixá-lo em 80 tornaria a trava inócua
// com US$ 500 e paralisante com US$ 50.
const pisoAbsoluto = num(a.piso, capital * 0.8);
const fracaoPico = num(a.fracaoPico, 0.85);
// 0,05% é taxa de mercado (taker). Maker custa 0,02% e derruba o payback em
// 2,5×, mas exige ordem limite — que pode não executar, e uma perna executada
// sem a outra deixa a posição direcional. Não é troca de graça.
const taxaPerp = num(a.taxa, 0.0005);
const margemPayback = num(a.margemPayback, 1.5);

const motor = new MotorSpread({ capital, alavancagem, pisoAbsoluto, fracaoPico, taxaPerp, margemPayback });

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
  `Risco: ${r.descricao}\n`,
);

const dist = 1 / alavancagem - MMR_ALT;
console.log(
  `PROTEÇÃO CONTRA RUÍNA\n` +
  `  distância de liquidação inicial   ${(dist * 100).toFixed(1)}% de movimento\n` +
  `  transfere margem em               ${(LIMIARES_PADRAO.alerta * 100).toFixed(0)}% de distância restante\n` +
  `  fecha por emergência em           ${(LIMIARES_PADRAO.critico * 100).toFixed(0)}% de distância restante\n` +
  `  piso absoluto                     US$ ${pisoAbsoluto.toFixed(2)}\n` +
  `  piso móvel (catraca)              ${(fracaoPico * 100).toFixed(0)}% do maior capital já alcançado\n` +
  `  alavancagem máxima sustentável    ${alavancagemMaxima().toFixed(1)}x` +
  (alavancagem > alavancagemMaxima() ? '  ← ACIMA DO LIMITE' : '') + `\n` +
  `\nPORTÃO DE PAYBACK · taxa ${(taxaPerp * 100).toFixed(3)}% · margem ${margemPayback}×\n` +
  `  Uma posição só é montada se o par JÁ viveu o tempo de pagar o próprio custo.\n` +
  `  O notional se cancela na conta — alavancagem e capital não mudam o payback.\n` +
  [0.20, 0.35, 0.76].map((apr) => {
    const s = apr / 1095;
    const h = (taxaPerp * 4 / s) * 8;
    return `    APR ${(apr * 100).toFixed(0).padStart(3)}%  →  empata em ${(h / 24).toFixed(1)} dias  ` +
           `·  exige ${(h * margemPayback).toFixed(0)}h de vida provada`;
  }).join('\n') + `\n` +
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
