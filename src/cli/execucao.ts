/**
 * Maker compensa? Depende de quanto a ordem limite executa.
 *
 * NENHUMA ORDEM É ENVIADA.
 */
import { custoTaker, custoMaker, preenchimentoMinimo, TAXA_TAKER, TAXA_MAKER } from '../funding/execucao.ts';
import { parseArgs, num } from './args.ts';

const a = parseArgs();
const NOTIONAL = num(a.notional, 250);
const DERIVA = num(a.deriva, 0.002);

console.log(`\n${'='.repeat(94)}`);
console.log(`EXECUÇÃO: MAKER × TAKER · notional US$ ${NOTIONAL}/perna · deriva na janela ${(DERIVA * 100).toFixed(2)}%`);
console.log(`${'='.repeat(94)}\n`);

const t = custoTaker(NOTIONAL);
console.log(`taker  US$ ${t.esperado.toFixed(4)}  (${(t.fracaoNotional * 100).toFixed(4)}% do notional) — ${t.detalhe}\n`);

console.log(
  'preench.'.padEnd(11) + 'custo'.padEnd(12) + '% notional'.padEnd(14) +
  'vs taker'.padEnd(13) + 'composição',
);
for (const p of [0.50, 0.70, 0.80, 0.90, 0.95, 0.99, 1.00]) {
  const m = custoMaker({ probPreenchimento: p, derivaJanela: DERIVA, notional: NOTIONAL });
  const razao = m.esperado / t.esperado;
  console.log(
    ((p * 100).toFixed(0) + '%').padEnd(11) +
    ('US$ ' + m.esperado.toFixed(4)).padEnd(12) +
    ((m.fracaoNotional * 100).toFixed(4) + '%').padEnd(14) +
    ((razao < 1 ? '−' : '+') + ((Math.abs(1 - razao)) * 100).toFixed(0) + '%').padEnd(13) +
    m.detalhe,
  );
}

console.log(`\n${'─'.repeat(94)}`);
console.log('PONTO DE VIRADA — preenchimento mínimo para maker compensar\n');
console.log('deriva na janela'.padEnd(20) + 'preenchimento mínimo'.padEnd(24) + 'leitura');
for (const d of [0.0005, 0.001, 0.002, 0.005, 0.010]) {
  const pm = preenchimentoMinimo(d, NOTIONAL);
  console.log(
    ((d * 100).toFixed(2) + '%').padEnd(20) +
    ((pm * 100).toFixed(1) + '%').padEnd(24) +
    (pm > 0.95 ? 'exigente demais — fique no taker' : pm > 0.85 ? 'viável com livro fundo' : 'maker compensa fácil'),
  );
}

console.log(`\n${'─'.repeat(94)}`);
console.log('EFEITO NO PAYBACK — o que realmente importa\n');
console.log('APR'.padEnd(9) + 'taker'.padEnd(16) + 'maker puro'.padEnd(18) + 'maker a 90% de preench.');
for (const apr of [0.20, 0.35, 0.50, 0.76]) {
  const s = apr / 1095;
  const hT = (TAXA_TAKER * 4 / s) * 8;
  const hM = (TAXA_MAKER * 4 / s) * 8;
  const m90 = custoMaker({ probPreenchimento: 0.90, derivaJanela: DERIVA, notional: NOTIONAL });
  const taxaEfetiva = m90.fracaoNotional / 2;
  const h90 = (taxaEfetiva * 4 / s) * 8;
  console.log(
    ((apr * 100).toFixed(0) + '%').padEnd(9) +
    ((hT / 24).toFixed(1) + ' dias').padEnd(16) +
    ((hM / 24).toFixed(1) + ' dias').padEnd(18) +
    (h90 / 24).toFixed(1) + ' dias',
  );
}

console.log(
  `\n${'='.repeat(94)}\n` +
  `O risco que não aparece na taxa: se uma perna executa e a outra não, o que\n` +
  `resta é uma posição DIRECIONAL a 5x — exatamente o que a estrutura existe\n` +
  `para evitar. A política é cancelar a pendente e fechar a executada a mercado\n` +
  `na hora. O custo desse seguro está embutido nas contas acima.\n`,
);
