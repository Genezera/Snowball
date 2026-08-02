/**
 * Trilha de ações — walk-forward completo, agora que há 3 anos de histórico.
 *
 * Por que esta trilha existe: a comissão de varejo nos EUA é zero, o que
 * elimina o pedágio que condenou o scalping em cripto. O primeiro teste (60
 * pregões, amostra pequena demais) deu PF 2,006 em Ford. Com 730 pregões dá
 * para saber se aquilo era real.
 *
 * Mede também o RISCO DE GAP, que é o custo específico de ação que não existe
 * em cripto: o mercado fecha às 16h e reabre num preço diferente, sem que nada
 * tenha sido negociado no meio. Um stop de 1,5% não protege contra um gap de
 * 8%.
 */
import fs from 'node:fs';
import path from 'node:path';
import { loadSeries, ROOT } from '../data/store.ts';
import { EQUITY_UNIVERSE, TOKENIZED } from '../data/stocks.ts';
import { buildStrategy, REGISTRY } from '../strategies/index.ts';
import { runBacktest } from '../backtest/engine.ts';
import { computeMetrics, deflatedSharpe } from '../backtest/metrics.ts';
import { walkForward } from '../validate/walkforward.ts';
import { GRIDS } from '../validate/grids.ts';
import { monteCarlo } from '../validate/montecarlo.ts';
import { crossSectionalConsistency } from '../scan/universe.ts';
import { makeConfig } from '../config.ts';
import { parseArgs, num, str, bool } from './args.ts';

const a = parseArgs();
const timeframe = str(a.timeframe, '1h');
const costPreset = str(a.cost, 'acao-varejo');
const symbols = str(a.symbol, EQUITY_UNIVERSE.join(',')).split(',').map((s) => s.trim());
const strats = str(a.strategy, 'body-breakout,momentum-breakout,zscore-dip,vwma-dip,ma-cross').split(',').map((s) => s.trim());

const cfg = makeConfig({
  initialEquity: num(a.equity, 100),
  costPreset,
  riskProfile: 'seed',
  // 7 barras por pregão: 14 = 2 dias. Segurar ação por mais tempo acumula
  // risco de gap sem contrapartida.
  maxBarsInTrade: num(a.maxBars, 14),
});

console.log(`\n${'='.repeat(78)}`);
console.log(`AÇÕES  ·  ${timeframe}  ·  custo ${costPreset}  ·  ${symbols.length} ativos`);
console.log(`${'='.repeat(78)}\n`);

// ── PARTE 1: risco de gap, que é o custo específico desta trilha ───────────
console.log('PARTE 1 — quanto os gaps overnight custam\n');
console.log('ativo'.padEnd(8) + 'trades'.padEnd(9) + 'stops'.padEnd(8) + 'por gap'.padEnd(10) + '% dos stops'.padEnd(13) + 'perda média no stop'.padEnd(21) + 'vs stop nominal');

for (const sym of symbols) {
  let series;
  try { series = loadSeries('yahoo', sym, timeframe); } catch { continue; }
  const res = runBacktest(series, buildStrategy('body-breakout', {}), { ...cfg, risk: { ...cfg.risk, maxDrawdownStop: 1, dailyLossLimit: 1 } });
  const stops = res.trades.filter((t) => t.exitReason === 'stop');
  if (!stops.length) continue;

  // gap-through: a perda no preço excedeu o stop nominal de 1,5%
  const nominal = 0.015;
  const gapped = stops.filter((t) => Math.abs(t.rPrice) > nominal * 1.15);
  const perdaMedia = stops.reduce((x, t) => x + Math.abs(t.rPrice), 0) / stops.length;

  console.log(
    sym.padEnd(8) + String(res.trades.length).padEnd(9) + String(stops.length).padEnd(8) +
    String(gapped.length).padEnd(10) + ((gapped.length / stops.length) * 100).toFixed(0).padEnd(13) +
    (perdaMedia * 100).toFixed(2).padEnd(21) + '+' + (((perdaMedia / nominal) - 1) * 100).toFixed(0) + '%',
  );
}

// ── PARTE 2: walk-forward ──────────────────────────────────────────────────
console.log(`\n${'─'.repeat(78)}`);
console.log('PARTE 2 — walk-forward com 3 anos de histórico\n');

const totalTests = symbols.length * strats.length;
const resultados: { symbol: string; strategy: string; expectancyR: number }[] = [];
const aprovados: any[] = [];

console.log('ativo'.padEnd(8) + 'estratégia'.padEnd(22) + 'expect'.padEnd(10) + 'trades'.padEnd(9) + 'ret'.padEnd(10) + 'DD'.padEnd(9) + 'efic'.padEnd(8) + 'DSR'.padEnd(7) + 'veredicto');

for (const sym of symbols) {
  let series;
  try { series = loadSeries('yahoo', sym, timeframe); } catch { continue; }
  if (series.bars.length < 2000) { console.log(`${sym.padEnd(8)}histórico curto (${series.bars.length} barras) — pulando`); continue; }

  for (const name of strats) {
    const grid = GRIDS[name];
    if (!grid) continue;
    let wf;
    try { wf = walkForward({ series, strategyName: name, grid, cfg, folds: 5 }); } catch { continue; }
    if (!wf.folds.length || wf.combined.trades < 40) continue;

    const dsr = deflatedSharpe(wf.combined.sharpe, wf.totalCombosTested * totalTests, wf.combined.trades);
    const mc = monteCarlo(wf.combinedTrades, { sims: 3000, ddStop: cfg.risk.maxDrawdownStop });

    const reasons: string[] = [];
    if (wf.combined.expectancyR <= 0) reasons.push('expectancy não positiva');
    if (wf.efficiency < 0.4) reasons.push(`eficiência ${wf.efficiency.toFixed(2)}`);
    if (dsr < 0.9) reasons.push(`DSR ${dsr.toFixed(2)}`);
    if (mc.pRuin50 > 0.01) reasons.push('ruína > 1%');
    const ok = reasons.length === 0;

    resultados.push({ symbol: sym, strategy: name, expectancyR: wf.combined.expectancyR });
    if (ok) aprovados.push({ sym, name, wf, dsr, mc });

    console.log(
      sym.padEnd(8) + name.padEnd(22) +
      (wf.combined.expectancyR.toFixed(3) + 'R').padEnd(10) + String(wf.combined.trades).padEnd(9) +
      ((wf.combined.totalReturn * 100).toFixed(1) + '%').padEnd(10) +
      ((wf.combined.maxDrawdown * 100).toFixed(1) + '%').padEnd(9) +
      wf.efficiency.toFixed(2).padEnd(8) + dsr.toFixed(2).padEnd(7) +
      (ok ? 'APROVADO' : reasons[0]),
    );
  }
}

// ── PARTE 3: consistência transversal ──────────────────────────────────────
console.log(`\n${'─'.repeat(78)}`);
console.log('PARTE 3 — consistência entre ativos (a defesa contra falso positivo)\n');
console.log('estratégia'.padEnd(22) + 'ativos'.padEnd(9) + 'positivos'.padEnd(12) + 'fração'.padEnd(10) + 'expectancy mediana');
for (const c of crossSectionalConsistency(resultados)) {
  console.log(
    c.strategy.padEnd(22) + String(c.assets).padEnd(9) + String(c.positive).padEnd(12) +
    ((c.fraction * 100).toFixed(0) + '%').padEnd(10) + c.medianExpectancy.toFixed(3) + 'R',
  );
}

console.log(`\n${'='.repeat(78)}`);
console.log(
  `${aprovados.length} de ${resultados.length} pares aprovados · ${totalTests} testes efetivos no Sharpe deflacionado\n` +
  (aprovados.length
    ? `Aprovados: ${aprovados.map((x) => `${x.sym}/${x.name}`).join(', ')}\n` +
      `Tokenizados na Binance (operáveis com custo de cripto): ` +
      `${aprovados.filter((x) => TOKENIZED.has(x.sym)).map((x) => x.sym).join(', ') || 'nenhum'}`
    : `Nenhum par aprovado. A trilha de ações não sobrevive ao mesmo portão que\n` +
      `a de cripto — e o portão é o mesmo de propósito.`),
);

fs.mkdirSync(path.join(ROOT, 'reports'), { recursive: true });
fs.writeFileSync(path.join(ROOT, 'reports', `equity-${timeframe}.json`), JSON.stringify({ resultados, aprovados: aprovados.map((x) => ({ sym: x.sym, name: x.name, dsr: x.dsr })) }, null, 2));
