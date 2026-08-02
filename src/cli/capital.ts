import { minViableCapital, simulateSnowball } from '../risk/capital.ts';
import { COSTS, RISK_PROFILES } from '../config.ts';
import { parseArgs, num, str } from './args.ts';

const a = parseArgs();
const cost = COSTS[str(a.cost, 'binance-futures')];
const stopPct = num(a.stopPct, 0.01);

console.log(`Custos: taker ${(cost.takerFee * 100).toFixed(3)}%/lado, slippage ${(cost.slippage * 100).toFixed(3)}%/lado`);
console.log(`Stop assumido: ${(stopPct * 100).toFixed(2)}%\n`);

console.log('CAPITAL MINIMO VIAVEL POR PERFIL DE RISCO');
console.log('perfil    risco/trade   equity minimo   notional   alavancagem');
for (const [name, risk] of Object.entries(RISK_PROFILES)) {
  const c = minViableCapital(stopPct, cost, risk);
  console.log(
    `${name.padEnd(9)} ${(risk.riskPerTrade * 100).toFixed(2)}%         ` +
      `$${c.minViableEquity.toFixed(2).padStart(8)}    $${c.notionalAtMin.toFixed(2).padStart(7)}   ${c.leverageAtMin.toFixed(2)}x` +
      (c.warning ? `  <- ${c.warning}` : ''),
  );
}

console.log(
  '\nAbaixo desse equity a conta nao consegue montar a posicao do tamanho certo.\n' +
    'Operar mesmo assim significa arriscar mais por trade do que o plano diz, que\n' +
    'e exatamente o mecanismo pelo qual contas pequenas quebram.\n',
);

// --- projecao da bola de neve ---
const expectancyR = num(a.expectancy, 0.05);
const volR = num(a.vol, 1.0);
const tradesPerMonth = num(a.tradesPerMonth, 40);
const months = num(a.months, 24);
const startEquity = num(a.start, 100);
const profile = str(a.risk, 'seed');
const risk = RISK_PROFILES[profile];

console.log(
  `PROJECAO DA BOLA DE NEVE\n` +
    `  inicio $${startEquity}, perfil ${profile} (${(risk.riskPerTrade * 100).toFixed(2)}%/trade), ` +
    `${tradesPerMonth} trades/mes, ${months} meses\n` +
    `  expectancy assumida ${expectancyR}R com desvio ${volR}R por trade\n`,
);

const sim = simulateSnowball({
  startEquity, expectancyR, volR, tradesPerMonth, months, stopPct, cost, risk,
  monthlyWithdrawal: num(a.withdraw, 0),
});

console.log(`  mediana final     $${sim.medianFinal.toFixed(2)}`);
console.log(`  pessimista (p5)   $${sim.p5Final.toFixed(2)}`);
console.log(`  otimista (p95)    $${sim.p95Final.toFixed(2)}`);
console.log(`  prob. de bater o stop de drawdown e parar: ${(sim.pRuin * 100).toFixed(1)}%`);
console.log(`  trades perdidos por conta pequena demais:  ${(sim.pSkippedTrades * 100).toFixed(1)}%`);
console.log('\n  trajetoria mediana por mes:');
sim.monthlyMedian.forEach((v, i) => {
  if (i % Math.max(1, Math.floor(months / 12)) === 0 || i === months)
    console.log(`    mes ${String(i).padStart(2)}  $${v.toFixed(2)}`);
});

console.log(
  `\n  IMPORTANTE: isto assume que a expectancy de ${expectancyR}R e REAL e ESTAVEL.\n` +
    `  Nenhuma das estrategias testadas ate agora provou isso. Rode com --expectancy -0.05\n` +
    `  para ver o que acontece quando a suposicao esta errada por uma margem pequena.`,
);
