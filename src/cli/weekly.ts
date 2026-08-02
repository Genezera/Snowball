/**
 * Análise de frequência: com que frequência as SEMANAS são positivas?
 *
 * Existe porque "quero lucro semanal" é um pedido comum e a resposta honesta
 * não é sim nem não — é uma distribuição. Uma estratégia com expectancy
 * positiva ainda tem semanas negativas, e saber QUANTAS é a diferença entre
 * aguentar o processo e abandoná-lo no pior momento possível.
 */
import { loadSeries, hasSeries } from '../data/store.ts';
import { buildStrategy } from '../strategies/index.ts';
import { runPortfolio, correlationMatrix, effectiveHeat, type Leg } from '../backtest/portfolio.ts';
import { makeConfig } from '../config.ts';
import { parseArgs, num, str } from './args.ts';

const a = parseArgs();
const exchange = str(a.exchange, 'binanceusdm');
const timeframe = str(a.timeframe, '4h');

const spec = str(a.pairs, 'BTC/USDT:USDT=body-breakout,ETH/USDT:USDT=momentum-breakout,DOT/USDT:USDT=body-breakout,XRP/USDT:USDT=body-breakout')
  .split(',').map((s) => { const [sym, st] = s.split('='); return { sym: sym.trim(), st: st.trim() }; })
  .filter((p) => hasSeries(exchange, p.sym, timeframe));

const base = makeConfig({
  initialEquity: num(a.equity, 100),
  costPreset: str(a.cost, 'binance-futures-maker'),
  riskProfile: 'seed',
  maxBarsInTrade: 100000,
});

const legs: Leg[] = spec.map((p) => ({
  symbol: p.sym, series: loadSeries(exchange, p.sym, timeframe), strategy: buildStrategy(p.st, {}),
}));

const C = correlationMatrix(legs);
const nConc = Math.min(3, legs.length);
const effAtN = effectiveHeat(new Array(nConc).fill(base.risk.riskPerTrade), legs.map((_, i) => i).slice(0, nConc), C);
const riskAdj = base.risk.riskPerTrade * (base.risk.riskPerTrade / effAtN);

const res = runPortfolio(legs, {
  ...base,
  risk: { ...base.risk, maxConcurrent: 3, riskPerTrade: riskAdj, maxDrawdownStop: 1 },
  maxHeat: 0.012, correlationThreshold: 0.7,
});

// agrupa retornos por semana ISO
const byWeek = new Map<string, number>();
for (const t of res.trades) {
  const d = new Date(t.exitTime);
  const y = d.getUTCFullYear();
  const week = Math.floor((d.getTime() - Date.UTC(y, 0, 1)) / (7 * 86_400_000));
  const key = `${y}-W${String(week).padStart(2, '0')}`;
  byWeek.set(key, (byWeek.get(key) ?? 0) + t.rEquity);
}
const weeks = [...byWeek.entries()].sort();
const rets = weeks.map(([, v]) => v);
const pos = rets.filter((r) => r > 0).length;
const neg = rets.filter((r) => r < 0).length;

// pior sequência de semanas negativas
let streak = 0, worstStreak = 0;
for (const r of rets) { if (r <= 0) { streak++; worstStreak = Math.max(worstStreak, streak); } else streak = 0; }

const sorted = [...rets].sort((x, y) => x - y);
const q = (p: number) => sorted[Math.floor((sorted.length - 1) * p)] ?? 0;
const mean = rets.reduce((x, y) => x + y, 0) / (rets.length || 1);

// meses positivos
const byMonth = new Map<string, number>();
for (const t of res.trades) {
  const d = new Date(t.exitTime);
  const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
  byMonth.set(key, (byMonth.get(key) ?? 0) + t.rEquity);
}
const months = [...byMonth.values()];
const posM = months.filter((r) => r > 0).length;

console.log(`\n${'='.repeat(70)}`);
console.log(`FREQUÊNCIA DE SEMANAS POSITIVAS — portfólio protegido, ${timeframe}`);
console.log(`${'='.repeat(70)}\n`);
console.log(`  período analisado          ${weeks[0]?.[0]} a ${weeks[weeks.length - 1]?.[0]}`);
console.log(`  semanas com trade fechado  ${weeks.length}`);
console.log(`  trades totais              ${res.trades.length}  (~${(res.trades.length / weeks.length).toFixed(1)} por semana)\n`);
console.log(`  SEMANAS POSITIVAS          ${pos} (${((pos / weeks.length) * 100).toFixed(1)}%)`);
console.log(`  semanas negativas          ${neg} (${((neg / weeks.length) * 100).toFixed(1)}%)`);
console.log(`  pior sequência negativa    ${worstStreak} semanas seguidas\n`);
console.log(`  retorno semanal médio      ${(mean * 100).toFixed(3)}%`);
console.log(`  pior semana                ${(q(0) * 100).toFixed(2)}%`);
console.log(`  p5 (1 em 20 semanas)       ${(q(0.05) * 100).toFixed(2)}%`);
console.log(`  mediana                    ${(q(0.5) * 100).toFixed(3)}%`);
console.log(`  melhor semana              ${(q(1) * 100).toFixed(2)}%\n`);
console.log(`  MESES POSITIVOS            ${posM} de ${months.length} (${((posM / months.length) * 100).toFixed(1)}%)`);

console.log(`\n${'─'.repeat(70)}`);
console.log(
  `Em US$ 100, o retorno semanal médio de ${(mean * 100).toFixed(3)}% equivale a\n` +
  `US$ ${(mean * 100).toFixed(2)} por semana. A pior semana custaria US$ ${(Math.abs(q(0)) * 100).toFixed(2)}.`,
);
