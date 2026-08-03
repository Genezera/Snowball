/**
 * Os dois cenários de alocação, comparados na mesma base.
 *
 *   UMA EXCHANGE     US$ 100 na binance. Sem par de exchanges, não há spread de
 *                    funding entre elas — a estrutura possível é spot + perp na
 *                    mesma casa (cash and carry).
 *
 *   DUAS EXCHANGES   US$ 100 na binance e US$ 100 na bybit. Duas pernas de
 *                    perpétuo, capturando a diferença de funding entre elas.
 *
 * A comparação honesta não é "qual rende mais" — a de duas exchanges usa o
 * dobro do dinheiro. É **quanto cada dólar depositado rende, e a que risco**.
 *
 * NENHUMA ORDEM É ENVIADA.
 */
import { RESERVA_PADRAO } from '../funding/tesouraria.ts';
import { taxaEfetiva, ESCORREGAMENTO_PERNA } from '../funding/custos-reais.ts';
import { MMR_ALT } from '../funding/protecao.ts';
import { parseArgs, num } from './args.ts';

const a = parseArgs();
const POR_EXCHANGE = num(a.porExchange, 100);
const LEV = num(a.alavancagem, 5);
const RESERVA = num(a.reserva, RESERVA_PADRAO);
const APR_SPREAD = num(a.aprSpread, 0.20);
/**
 * Funding absoluto do perpétuo, para o cenário de uma exchange.
 *
 * No cash and carry você recebe o funding INTEIRO do lado vendido, não a
 * diferença entre duas exchanges. Em regime normal ele é positivo e menor que
 * os spreads que a vigilância encontra; uso 10% como cenário central.
 */
const APR_FUNDING = num(a.aprFunding, 0.10);

const linha = (n = 96) => '─'.repeat(n);

console.log(`\n${'='.repeat(96)}`);
console.log(`DOIS CENÁRIOS DE ALOCAÇÃO · US$ ${POR_EXCHANGE} por exchange · ${LEV}x · reserva ${(RESERVA * 100).toFixed(0)}%`);
console.log(`${'='.repeat(96)}`);

// ── cenário A: uma exchange, spot + perp ───────────────────────────────────
//
// Sem uma segunda exchange não existe spread de funding para arbitrar. A
// estrutura que sobra é comprar o ativo à vista e vender o perpétuo dele na
// mesma casa. As duas pernas se cancelam em preço, e o vendido recebe funding.
//
// A diferença crucial de capital: o spot NÃO é margem. Ele fica parado
// sustentando a perna comprada. Só o perpétuo usa alavancagem, e ele precisa
// de margem própria. Então o mesmo dólar rende bem menos notional.
const taxaA = taxaEfetiva('binanceusdm', 'binanceusdm');
// divisão: X em spot, (100−X) como margem do perp. Para ficar neutro,
// notional do perp = valor do spot → (100−X)·L = X → X = 100·L/(L+1)
const spotA = POR_EXCHANGE * (1 - RESERVA) * LEV / (LEV + 1);
const margemA = POR_EXCHANGE * (1 - RESERVA) - spotA;
const notionalA = spotA;
const reservaA = POR_EXCHANGE * RESERVA;
const rendaSemanaA = notionalA * (APR_FUNDING / 1095) * 21;
const distA = margemA / notionalA - MMR_ALT;

console.log(`\n${linha()}`);
console.log('CENÁRIO A — UMA EXCHANGE (spot + perp na mesma casa)\n');
console.log(`  depositado                US$ ${POR_EXCHANGE.toFixed(2)}  (só binance)`);
console.log(`  reserva livre             US$ ${reservaA.toFixed(2)}`);
console.log(`  comprado à vista          US$ ${spotA.toFixed(2)}   ← capital parado, NÃO é margem`);
console.log(`  margem do perpétuo        US$ ${margemA.toFixed(2)}`);
console.log(`  notional neutro           US$ ${notionalA.toFixed(2)}`);
console.log(`  distância até liquidar    ${(distA * 100).toFixed(1)}% de movimento`);
console.log(`  renda semanal a ${(APR_FUNDING * 100).toFixed(0)}% APR   US$ ${rendaSemanaA.toFixed(3)}`);
console.log(
  `\n  Vantagens: nenhuma dependência de segunda exchange, nenhum saque, nenhum\n` +
  `  risco de perna solta entre casas diferentes. A liquidação do perp é coberta\n` +
  `  pelo spot na mesma conta — algumas exchanges compensam automaticamente.\n` +
  `  Desvantagem: o spot come ${(spotA / POR_EXCHANGE * 100).toFixed(0)}% do depósito sem gerar alavancagem, e você\n` +
  `  depende do funding ser positivo, não de um spread entre duas casas.`,
);

// ── cenário B: duas exchanges, perp + perp ─────────────────────────────────
const totalB = POR_EXCHANGE * 2;
const taxaB = taxaEfetiva('binanceusdm', 'bybit');
const margemB = POR_EXCHANGE * (1 - RESERVA);
const notionalB = margemB * LEV;
const reservaB = POR_EXCHANGE * RESERVA;
const rendaSemanaB = notionalB * (APR_SPREAD / 1095) * 21;
const distB = margemB / notionalB - MMR_ALT;
const distMaxB = (margemB + reservaB) / notionalB - MMR_ALT;

console.log(`\n${linha()}`);
console.log('CENÁRIO B — DUAS EXCHANGES (perpétuo em cada, sem saque entre elas)\n');
console.log(`  depositado                US$ ${totalB.toFixed(2)}  (US$ ${POR_EXCHANGE} em cada)`);
console.log(`  reserva livre por casa    US$ ${reservaB.toFixed(2)}`);
console.log(`  margem por perna          US$ ${margemB.toFixed(2)}`);
console.log(`  notional por perna        US$ ${notionalB.toFixed(2)}   ← capital PARADO: zero`);
console.log(`  distância até liquidar    ${(distB * 100).toFixed(1)}% → ${(distMaxB * 100).toFixed(1)}% usando a reserva`);
console.log(`  renda semanal a ${(APR_SPREAD * 100).toFixed(0)}% APR   US$ ${rendaSemanaB.toFixed(3)}`);
console.log(
  `\n  Vantagem: nenhum dólar fica parado — as duas pernas são margem. Vantagem\n` +
  `  dobrada quando o funding é negativo numa das casas: recebe-se nos dois lados.\n` +
  `  Desvantagem: metade do capital em cada exchange, então falência ou\n` +
  `  congelamento de uma custa 50% — contra 100% no cenário A, que é pior.`,
);

// ── comparação por dólar depositado ────────────────────────────────────────
console.log(`\n${linha()}`);
console.log('POR DÓLAR DEPOSITADO — a comparação que importa\n');
console.log(
  'cenário'.padEnd(28) + 'depositado'.padEnd(14) + 'notional'.padEnd(13) +
  'renda/semana'.padEnd(15) + 'por dólar'.padEnd(13) + 'fôlego',
);
const linhas = [
  ['A · uma exchange', POR_EXCHANGE, notionalA, rendaSemanaA, distA],
  ['B · duas exchanges', totalB, notionalB, rendaSemanaB, distMaxB],
];
for (const [nome, dep, not, renda, dist] of linhas as [string, number, number, number, number][]) {
  console.log(
    nome.padEnd(28) +
    ('US$ ' + dep.toFixed(0)).padEnd(14) +
    ('US$ ' + not.toFixed(0)).padEnd(13) +
    ('US$ ' + renda.toFixed(3)).padEnd(15) +
    (((renda / dep) * 100).toFixed(3) + '%').padEnd(13) +
    (dist * 100).toFixed(0) + '%',
  );
}

// ── payback, que decide se abre ────────────────────────────────────────────
console.log(`\n${linha()}`);
console.log('PAYBACK — quanto uma posição precisa viver para pagar o próprio custo\n');
console.log('cenário'.padEnd(28) + 'taxa efetiva'.padEnd(16) + 'APR'.padEnd(9) + 'payback');
for (const [nome, taxa, apr] of [
  ['A · uma exchange', taxaA, APR_FUNDING],
  ['B · duas exchanges', taxaB, APR_SPREAD],
] as [string, number, number][]) {
  const h = (taxa * 4 / (apr / 1095)) * 8;
  console.log(
    nome.padEnd(28) +
    ((taxa * 100).toFixed(4) + '%').padEnd(16) +
    ((apr * 100).toFixed(0) + '%').padEnd(9) +
    (h / 24).toFixed(1) + ' dias',
  );
}
console.log(
  `\n  A taxa efetiva inclui ${(ESCORREGAMENTO_PERNA * 100).toFixed(2)}% de escorregamento por perna, medido no livro real.`,
);

console.log(
  `\n${'='.repeat(96)}\n` +
  `LEITURA\n\n` +
  `  Com US$ 100 numa exchange só, ${(spotA / POR_EXCHANGE * 100).toFixed(0)}% viram spot parado e o notional cai para\n` +
  `  US$ ${notionalA.toFixed(0)}. Com US$ 100 em duas, o notional por perna é US$ ${notionalB.toFixed(0)} — ${(notionalB / notionalA).toFixed(1)}× mais,\n` +
  `  com o dobro do depósito. Por dólar, o cenário B rende ${(rendaSemanaB / totalB / (rendaSemanaA / POR_EXCHANGE)).toFixed(1)}× o A no\n` +
  `  cenário central, porque o spread entre casas costuma superar o funding\n` +
  `  absoluto de uma só.\n\n` +
  `  O cenário A não é inferior em tudo: ele elimina completamente o risco de\n` +
  `  perna solta entre exchanges, que é o maior buraco de execução aberto.\n\n` +
  `NENHUMA ORDEM É ENVIADA.\n`,
);
