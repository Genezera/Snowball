/**
 * DIMENSIONAMENTO POR VOLATILIDADE PREVISTA.
 *
 * A mudança de abordagem: parar de tentar prever QUAL trade ganha, e passar a
 * prever a VOLATILIDADE do período — que é uma das coisas mais previsíveis que
 * existem em finanças.
 *
 * Por que isso é diferente de tudo que falhou antes:
 *
 *   O filtro de ML tentava prever direção/resultado e REMOVIA trades. Removia
 *   inclusive os lucrativos, e por isso está fora de produção.
 *
 *   Isto não remove trade nenhum. Todos os sinais continuam sendo executados.
 *   O que muda é o TAMANHO: menor quando a volatilidade prevista está alta,
 *   maior quando está baixa. O objetivo é manter o risco em dólares constante
 *   em vez de deixá-lo variar com o humor do mercado.
 *
 * O fato empírico que sustenta: volatilidade se agrupa. Períodos agitados são
 * seguidos por períodos agitados. Isso é robusto, replicado há décadas, e não
 * depende de acertar direção nenhuma.
 */
import { loadSeries, hasSeries } from '../data/store.ts';
import { buildStrategy } from '../strategies/index.ts';
import { runBacktest } from '../backtest/engine.ts';
import { computeMetrics } from '../backtest/metrics.ts';
import { monteCarlo } from '../validate/montecarlo.ts';
import { atr, closes } from '../core/indicators.ts';
import { makeConfig } from '../config.ts';
import { parseArgs, num, str } from './args.ts';
import type { Trade } from '../core/types.ts';

const a = parseArgs();
const exchange = str(a.exchange, 'binanceusdm');
const timeframe = str(a.timeframe, '4h');
const symbols = str(a.symbol, 'BTC/USDT:USDT,ETH/USDT:USDT,XRP/USDT:USDT,DOT/USDT:USDT')
  .split(',').map((s) => s.trim()).filter((s) => hasSeries(exchange, s, timeframe));
const strat = str(a.strategy, 'body-breakout');

const cfg = makeConfig({
  initialEquity: num(a.equity, 100),
  costPreset: str(a.cost, 'binance-futures-maker'),
  riskProfile: 'seed',
  maxBarsInTrade: 100000,
});

console.log(`\n${'='.repeat(78)}`);
console.log(`DIMENSIONAMENTO POR VOLATILIDADE PREVISTA — ${strat} ${timeframe}`);
console.log(`${'='.repeat(78)}\n`);
console.log(
  `Método: prever a volatilidade do próximo período com EWMA da volatilidade\n` +
  `realizada, e escalar o tamanho por (vol alvo / vol prevista), limitado a\n` +
  `[0,4x , 2,5x]. NENHUM trade é removido — só o tamanho muda.\n`,
);

console.log('ativo'.padEnd(10) + 'trades'.padEnd(9) + 'ret fixo'.padEnd(11) + 'ret vol-alvo'.padEnd(14) + 'DD fixo'.padEnd(10) + 'DD vol-alvo'.padEnd(13) + 'Calmar fixo'.padEnd(13) + 'Calmar vol-alvo');

let somaFixo = 0, somaVol = 0, n = 0;
const todosFixo: Trade[] = [], todosVol: Trade[] = [];

for (const symbol of symbols) {
  const series = loadSeries(exchange, symbol, timeframe);
  const bars = series.bars;
  const c = closes(bars);

  // ── previsão de volatilidade: EWMA dos retornos ao quadrado ─────────────
  // Usa apenas informação até a barra i-1. Sem lookahead.
  const lambda = 0.94; // decaimento padrão de RiskMetrics
  const volPrev = new Array<number>(bars.length).fill(NaN);
  let ewma = 0;
  for (let i = 1; i < bars.length; i++) {
    const r = c[i - 1] > 0 ? c[i] / c[i - 1] - 1 : 0;
    // a previsão para a barra i usa dados ATÉ i-1
    volPrev[i] = i > 30 ? Math.sqrt(ewma) : NaN;
    ewma = lambda * ewma + (1 - lambda) * r * r;
  }

  const validos = volPrev.filter((v) => isFinite(v) && v > 0).sort((x, y) => x - y);
  const volAlvo = validos[Math.floor(validos.length / 2)]; // mediana como alvo

  // ── backtest com tamanho fixo ───────────────────────────────────────────
  const resFixo = runBacktest(series, buildStrategy(strat, {}), cfg);
  const mFixo = computeMetrics(resFixo, cfg.initialEquity);

  // ── reescala cada trade pelo fator de volatilidade ──────────────────────
  // Reconstrói a curva aplicando o multiplicador de tamanho vigente na entrada.
  const idx = new Map(bars.map((b, i) => [b.t, i]));
  let eq = cfg.initialEquity;
  const tradesVol: Trade[] = [];
  for (const t of resFixo.trades) {
    const i = idx.get(t.entryTime) ?? 0;
    const vp = volPrev[i];
    const mult = isFinite(vp) && vp > 0
      ? Math.min(2.5, Math.max(0.4, volAlvo / vp))
      : 1;
    // rEquity é o retorno sobre o equity na entrada; escalar o tamanho escala
    // proporcionalmente o resultado.
    const rEscalado = t.rEquity * mult;
    const pnl = rEscalado * eq;
    eq += pnl;
    tradesVol.push({ ...t, pnl, rEquity: rEscalado, equityAfter: eq, notional: t.notional * mult });
  }

  const curvaVol = tradesVol.map((t) => ({ t: t.exitTime, equity: t.equityAfter }));
  if (curvaVol.length) curvaVol.unshift({ t: tradesVol[0].entryTime, equity: cfg.initialEquity });
  const mVol = computeMetrics(
    { trades: tradesVol, equityCurve: curvaVol, finalEquity: eq },
    cfg.initialEquity,
  );

  const calFixo = mFixo.maxDrawdown > 0 ? mFixo.cagr / mFixo.maxDrawdown : 0;
  const calVol = mVol.maxDrawdown > 0 ? mVol.cagr / mVol.maxDrawdown : 0;

  console.log(
    symbol.replace('/USDT:USDT', '').padEnd(10) + String(mFixo.trades).padEnd(9) +
    ((mFixo.totalReturn * 100).toFixed(1) + '%').padEnd(11) +
    ((mVol.totalReturn * 100).toFixed(1) + '%').padEnd(14) +
    ((mFixo.maxDrawdown * 100).toFixed(1) + '%').padEnd(10) +
    ((mVol.maxDrawdown * 100).toFixed(1) + '%').padEnd(13) +
    calFixo.toFixed(2).padEnd(13) + calVol.toFixed(2),
  );

  somaFixo += calFixo; somaVol += calVol; n++;
  todosFixo.push(...resFixo.trades); todosVol.push(...tradesVol);
}

console.log(`\n${'─'.repeat(78)}`);
console.log(`Calmar médio:  fixo ${(somaFixo / n).toFixed(2)}   vol-alvo ${(somaVol / n).toFixed(2)}`);

const mcFixo = monteCarlo(todosFixo, { sims: 5000, ddStop: 0.15 });
const mcVol = monteCarlo(todosVol, { sims: 5000, ddStop: 0.15 });
console.log(`\nRisco (Monte Carlo sobre todos os trades):`);
console.log(`  prob. de bater o circuit breaker   fixo ${(mcFixo.pHitDdStop * 100).toFixed(1)}%   vol-alvo ${(mcVol.pHitDdStop * 100).toFixed(1)}%`);
console.log(`  drawdown p95                       fixo ${(mcFixo.p95MaxDd * 100).toFixed(1)}%   vol-alvo ${(mcVol.p95MaxDd * 100).toFixed(1)}%`);
console.log(`  retorno p5                         fixo ${(mcFixo.p5Return * 100).toFixed(1)}%   vol-alvo ${(mcVol.p5Return * 100).toFixed(1)}%`);

const melhor = somaVol / n > somaFixo / n;
console.log(
  `\n${'='.repeat(78)}\n` +
  (melhor
    ? `VEREDICTO: o dimensionamento por volatilidade MELHORA o retorno ajustado a\n` +
      `risco, e não removeu um único trade. É a primeira previsão que funciona\n` +
      `neste projeto — porque prevê volatilidade, não direção.`
    : `VEREDICTO: não melhorou. A previsão de volatilidade é real, mas nesta\n` +
      `estratégia e neste timeframe ela não se traduz em vantagem. Fica\n` +
      `documentado como testado e não aplicado.`) +
  `\n${'='.repeat(78)}`,
);
