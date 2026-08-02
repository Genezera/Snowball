/**
 * Compara portfólio contra as pernas isoladas, e mede a correlação real.
 *
 * A pergunta que ele responde não é "o portfólio rende mais?" — renderia
 * trivialmente, por ter mais trades. É: **o portfólio rende mais POR UNIDADE
 * DE RISCO?** Se três posições correlacionadas apenas triplicam retorno e
 * drawdown juntos, não houve diversificação nenhuma, só tamanho maior.
 */
import fs from 'node:fs';
import path from 'node:path';
import { loadSeries, hasSeries, ROOT } from '../data/store.ts';
import { buildStrategy } from '../strategies/index.ts';
import { runBacktest } from '../backtest/engine.ts';
import { runPortfolio, correlationMatrix, effectiveHeat, type Leg } from '../backtest/portfolio.ts';
import { computeMetrics } from '../backtest/metrics.ts';
import { monteCarlo } from '../validate/montecarlo.ts';
import { makeConfig } from '../config.ts';
import { parseArgs, num, str } from './args.ts';

const a = parseArgs();
const exchange = str(a.exchange, 'binanceusdm');
const timeframe = str(a.timeframe, '4h');
const maxHeat = num(a.maxHeat, 0.012);

// pares (ativo:estrategia). Padrão: os que passaram no walk-forward.
const spec = str(a.pairs, 'BTC/USDT:USDT=body-breakout,ETH/USDT:USDT=momentum-breakout,DOT/USDT:USDT=body-breakout,XRP/USDT:USDT=body-breakout')
  .split(',').map((s) => { const [sym, st] = s.split('='); return { sym: sym.trim(), st: st.trim() }; })
  .filter((p) => hasSeries(exchange, p.sym, timeframe));

const base = makeConfig({
  initialEquity: num(a.equity, 100),
  costPreset: str(a.cost, 'binance-futures-maker'),
  riskProfile: str(a.risk, 'seed'),
  maxBarsInTrade: num(a.maxBars, 100000),
});
// O perfil `seed` traz maxConcurrent=1, herdado de quando o motor só suportava
// uma posição. Sem sobrescrever isto o "portfólio" vira rotação entre ativos.
const concurrent = num(a.concurrent, 3);
const autoscale = str(a.autoscale, 'true') !== 'false';

const legs: Leg[] = spec.map((p) => ({
  symbol: p.sym,
  series: loadSeries(exchange, p.sym, timeframe),
  strategy: buildStrategy(p.st, {}),
}));

console.log(`\n${'='.repeat(76)}`);
console.log(`PORTFÓLIO  ·  US$ ${base.initialEquity}  ·  ${timeframe}  ·  teto de calor ${(maxHeat * 100).toFixed(2)}%`);
console.log(`${'='.repeat(76)}\n`);

// ── correlação, antes de qualquer resultado ────────────────────────────────
const C = correlationMatrix(legs);
console.log('### CORRELAÇÃO MEDIDA entre os ativos (retorno por barra)\n');
const short = legs.map((l) => l.symbol.replace('/USDT:USDT', ''));
console.log('       ' + short.map((s) => s.padStart(7)).join(''));
for (let i = 0; i < legs.length; i++) {
  console.log(short[i].padEnd(7) + C[i].map((v) => v.toFixed(2).padStart(7)).join(''));
}
let sum = 0, cnt = 0;
for (let i = 0; i < legs.length; i++) for (let j = i + 1; j < legs.length; j++) { sum += C[i][j]; cnt++; }
const avgCorr = cnt ? sum / cnt : 0;

const risks = legs.map(() => base.risk.riskPerTrade);
const idxs = legs.map((_, i) => i);
const heatIndep = Math.sqrt(risks.reduce((acc, r) => acc + r * r, 0));
const heatReal = effectiveHeat(risks, idxs, C);
const heatNaive = risks.reduce((a, b) => a + b, 0);

/**
 * DIMENSIONAMENTO AJUSTADO POR CORRELAÇÃO — a defesa contra ruína.
 *
 * Com correlação 0,84, duas posições de 0,5% dão risco efetivo de 0,96%. Rodar
 * assim é operar com risco DOBRADO achando que diversificou. O ajuste reduz o
 * risco por trade até que o risco efetivo de N posições correlacionadas iguale
 * o de UMA posição isolada.
 *
 * O custo disso é retorno menor. O benefício é que o número de posições deixa
 * de ser uma forma disfarçada de aumentar alavancagem.
 */
const nConc = Math.min(concurrent, legs.length);
const effAtN = effectiveHeat(
  new Array(nConc).fill(base.risk.riskPerTrade),
  idxs.slice(0, nConc), C,
);
const scale = effAtN > 0 ? base.risk.riskPerTrade / effAtN : 1;
const riskAdjusted = autoscale ? base.risk.riskPerTrade * scale : base.risk.riskPerTrade;

const cfg = {
  ...base,
  risk: { ...base.risk, maxConcurrent: concurrent, riskPerTrade: riskAdjusted },
  maxHeat,
  correlationThreshold: 0.7,
};

console.log(
  `\n  correlação média ${avgCorr.toFixed(2)}\n\n` +
  `  Se as ${legs.length} posições fossem independentes: risco efetivo ${(heatIndep * 100).toFixed(3)}%\n` +
  `  Com a correlação REAL medida:                     risco efetivo ${(heatReal * 100).toFixed(3)}%\n` +
  `  Somando ingenuamente (correlação = 1):            risco efetivo ${(heatNaive * 100).toFixed(3)}%\n`,
);
const diversificacao = (heatNaive - heatReal) / (heatNaive - heatIndep);
console.log(
  `  Diversificação capturada: ${(diversificacao * 100).toFixed(0)}% do máximo teórico.\n` +
  (autoscale
    ? `\n  AJUSTE POR CORRELAÇÃO ativo: risco por trade reduzido de ` +
      `${(base.risk.riskPerTrade * 100).toFixed(3)}% para ${(riskAdjusted * 100).toFixed(3)}%,\n` +
      `  para que ${nConc} posições correlacionadas tenham o mesmo risco efetivo que UMA isolada.\n`
    : `\n  AJUSTE POR CORRELAÇÃO DESLIGADO — risco efetivo será ~${(effAtN / base.risk.riskPerTrade).toFixed(2)}x o de uma posição.\n`) +
  (avgCorr > 0.7
    ? `  ALERTA: correlação acima de 0,70 — estes ativos praticamente não diversificam.\n`
    : avgCorr > 0.5
      ? `  Correlação alta. Há alguma diversificação, mas muito menos do que o número de pares sugere.\n`
      : `  Correlação moderada — a diversificação é real.\n`),
);

// ── pernas isoladas ────────────────────────────────────────────────────────
console.log('### PERNAS ISOLADAS (cada uma com o capital inteiro)\n');
console.log('  par'.padEnd(34) + 'trades'.padEnd(9) + 'retorno'.padEnd(11) + 'DD'.padEnd(9) + 'expect'.padEnd(10) + 'Calmar');
const singles: { name: string; ret: number; dd: number; trades: number }[] = [];
for (const l of legs) {
  const r = runBacktest(l.series, l.strategy, base);
  const m = computeMetrics(r, base.initialEquity);
  const name = `${l.symbol.replace('/USDT:USDT', '')} ${l.strategy.name.split('(')[0]}`;
  singles.push({ name, ret: m.totalReturn, dd: m.maxDrawdown, trades: m.trades });
  console.log(
    ('  ' + name).padEnd(34) + String(m.trades).padEnd(9) +
    ((m.totalReturn * 100).toFixed(1) + '%').padEnd(11) +
    ((m.maxDrawdown * 100).toFixed(1) + '%').padEnd(9) +
    (m.expectancyR.toFixed(3) + 'R').padEnd(10) +
    (m.maxDrawdown > 0 ? (m.cagr / m.maxDrawdown).toFixed(2) : '—'),
  );
}
const bestSingle = singles.reduce((x, y) => (y.ret > x.ret ? y : x));

// ── portfólio ──────────────────────────────────────────────────────────────
const res = runPortfolio(legs, cfg);
const pm = computeMetrics(
  { trades: res.trades, equityCurve: res.equityCurve, finalEquity: res.finalEquity, haltedAt: res.haltedAt },
  base.initialEquity,
);

console.log(`\n### PORTFÓLIO\n`);
console.log(`  trades                 ${pm.trades}   (soma das pernas: ${singles.reduce((a, s) => a + s.trades, 0)})`);
console.log(`  retorno                ${(pm.totalReturn * 100).toFixed(1)}%`);
console.log(`  CAGR                   ${(pm.cagr * 100).toFixed(1)}%`);
console.log(`  max drawdown           ${(pm.maxDrawdown * 100).toFixed(1)}%`);
console.log(`  expectancy             ${pm.expectancyR.toFixed(3)}R`);
console.log(`  Calmar                 ${pm.maxDrawdown > 0 ? (pm.cagr / pm.maxDrawdown).toFixed(2) : '—'}`);
console.log(`  Sharpe                 ${pm.sharpe.toFixed(2)}`);
console.log(`  pico de posições       ${res.peakPositions}`);
console.log(`  pico de calor nominal  ${(res.peakHeat * 100).toFixed(2)}%`);
console.log(`  pico de calor EFETIVO  ${(res.peakEffectiveHeat * 100).toFixed(2)}%  (ajustado por correlação)`);
console.log(`  sinais barrados        ${res.blockedByHeat} por calor, ${res.blockedBySymbol} por já ter posição no ativo`);
if (pm.halted) console.log(`  PARADO: ${pm.halted}`);

console.log(`\n  contribuição por perna:`);
for (const [k, v] of Object.entries(res.perLeg)) {
  const [sym, st] = k.split('|');
  console.log(`    ${sym.replace('/USDT:USDT', '').padEnd(8)} ${st.split('(')[0].padEnd(20)} ${String(v.trades).padStart(4)} trades  US$ ${v.pnl.toFixed(2)}`);
}

const mc = monteCarlo(res.trades, { sims: 5000, ddStop: base.risk.maxDrawdownStop });
console.log(`\n### RISCO DE RUÍNA DO PORTFÓLIO\n`);
console.log(`  prob. de perder 50% da conta        ${(mc.pRuin50 * 100).toFixed(1)}%`);
console.log(`  prob. de bater o circuit breaker    ${(mc.pHitDdStop * 100).toFixed(1)}%`);
console.log(`  drawdown p95 simulado              ${(mc.p95MaxDd * 100).toFixed(1)}%`);
console.log(`  pior drawdown simulado             ${(mc.worstMaxDd * 100).toFixed(1)}%`);
console.log(`  retorno pessimista (p5)            ${(mc.p5Return * 100).toFixed(1)}%`);

// ── o veredicto que importa ────────────────────────────────────────────────
const calmarPort = pm.maxDrawdown > 0 ? pm.cagr / pm.maxDrawdown : 0;
const bestSingleCalmar = bestSingle.dd > 0
  ? (Math.pow(1 + bestSingle.ret, 1 / 5) - 1) / bestSingle.dd : 0;

console.log(`\n${'='.repeat(76)}`);
console.log(
  `VEREDICTO: o portfólio rende ${(pm.totalReturn * 100).toFixed(1)}% contra ${(bestSingle.ret * 100).toFixed(1)}% da melhor perna,\n` +
  `com drawdown de ${(pm.maxDrawdown * 100).toFixed(1)}% contra ${(bestSingle.dd * 100).toFixed(1)}%.\n\n` +
  (calmarPort > bestSingleCalmar * 1.1
    ? `O portfólio entrega MAIS RETORNO POR UNIDADE DE RISCO. A diversificação é real.`
    : calmarPort > bestSingleCalmar * 0.9
      ? `Retorno por unidade de risco praticamente igual. O portfólio adiciona trades, não\n` +
        `diversificação — o ganho é de velocidade de composição, não de eficiência.`
      : `O portfólio é PIOR por unidade de risco que a melhor perna isolada. Isto acontece\n` +
        `quando os ativos são correlacionados demais: você triplicou o tamanho, não\n` +
        `diversificou. Reduza para menos pares ou busque ativos descorrelacionados.`),
);
console.log(`${'='.repeat(76)}`);

fs.mkdirSync(path.join(ROOT, 'reports'), { recursive: true });
fs.writeFileSync(path.join(ROOT, 'reports', `portfolio-${timeframe}.json`), JSON.stringify({
  pairs: spec, correlation: C, avgCorrelation: avgCorr,
  heat: { independent: heatIndep, real: heatReal, naive: heatNaive },
  portfolio: pm, singles, monteCarlo: mc, peakEffectiveHeat: res.peakEffectiveHeat,
}, null, 2));
console.log(`\nrelatório salvo em reports/portfolio-${timeframe}.json`);
