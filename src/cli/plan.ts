/**
 * Imprime a escada da bola de neve e as projeções sob três hipóteses de edge.
 *
 * A terceira hipótese (edge = 0) não é pessimismo decorativo. Nenhum par
 * sobreviveu ao funil completo até agora, então "não existe edge" continua
 * sendo o cenário base até que 90 dias de paper digam o contrário.
 */
import { buildLadder, project } from '../team/snowball-plan.ts';
import { COSTS, RISK_PROFILES } from '../config.ts';
import { parseArgs, num, str } from './args.ts';

const a = parseArgs();
const cost = COSTS[str(a.cost, 'binance-futures-maker')];
const risk = RISK_PROFILES[str(a.risk, 'seed')];
const start = num(a.equity, 100);
const months = num(a.months, 24);
const tradesPerMonth = num(a.tradesPerMonth, 36);

console.log(`\n${'='.repeat(76)}`);
console.log(`PLANO DA BOLA DE NEVE  ·  US$ ${start}  ·  risco ${(risk.riskPerTrade * 100).toFixed(2)}%/trade`);
console.log(`${'='.repeat(76)}\n`);

for (const s of buildLadder(cost, risk)) {
  const faixa = s.to === Infinity ? `US$ ${s.from}+` : s.from === s.to ? `US$ ${s.from}` : `US$ ${s.from}–${s.to}`;
  console.log(`── ${s.id}  ${s.name}   (${faixa})`);
  console.log(`   ${s.positions} posições · US$ ${s.notionalPerPosition.toFixed(2)} cada · risco ${(s.riskPerTrade * 100).toFixed(2)}%`);
  console.log(`   objetivo: ${s.objetivo}`);
  for (const r of s.regras) console.log(`     · ${r}`);
  console.log(`   AVANÇA:  ${s.avancarQuando}`);
  console.log(`   RECUA:   ${s.recuarQuando}\n`);
}

console.log(`${'='.repeat(76)}`);
console.log(`PROJEÇÃO  ·  ${months} meses  ·  ${tradesPerMonth} trades/mês com 3 posições\n`);

const cenarios: [string, number, string][] = [
  ['edge medido (0,15R)', 0.15, 'expectancy dos pares que passaram no walk-forward'],
  ['edge fraco (0,07R)',  0.07, 'metade do medido — o que sobra se a seleção adversa comer parte'],
  ['SEM edge (0,00R)',    0.00, 'cenário base até 90 dias de paper dizerem o contrário'],
];

console.log('cenário'.padEnd(24) + 'p5'.padEnd(10) + 'mediana'.padEnd(11) + 'p95'.padEnd(11) + 'prejuízo'.padEnd(11) + 'chega $150'.padEnd(12) + 'chega $400'.padEnd(12) + 'morre');
for (const [nome, exp] of cenarios) {
  const p = project({ start, expectancyR: exp, sdR: 1.0, tradesPerMonth, months, cost, risk, sims: 5000 });
  console.log(
    nome.padEnd(24) +
    ('$' + p.p5.toFixed(0)).padEnd(10) +
    ('$' + p.median.toFixed(0)).padEnd(11) +
    ('$' + p.p95.toFixed(0)).padEnd(11) +
    ((p.probAbaixoDoInicial * 100).toFixed(0) + '%').padEnd(11) +
    ((p.probAtinge150 * 100).toFixed(0) + '%').padEnd(12) +
    ((p.probAtinge400 * 100).toFixed(0) + '%').padEnd(12) +
    (p.probMorte * 100).toFixed(0) + '%',
  );
}

console.log(`\n${'─'.repeat(76)}`);
for (const [nome, exp, desc] of cenarios) console.log(`  ${nome}: ${desc}`);
console.log(
  `\n"morre" = bateu o circuit breaker de ${(risk.maxDrawdownStop * 100).toFixed(0)}% de drawdown\n` +
  `e o sistema desligou sozinho. Não é ruína total — é a proteção funcionando.`,
);
