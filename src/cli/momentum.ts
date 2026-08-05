/**
 * VALIDAÇÃO DO ts-momentum (time-series momentum) — descoberta + holdout cego.
 *
 * Roda os parâmetros FIXOS (`PARAMS_VALIDADOS`) contra os dois conjuntos do
 * universo. A descoberta é onde a região de parâmetros foi encontrada; o
 * holdout nunca participou disso. Reportar os dois lado a lado é o que este
 * projeto aprendeu faltar em `body-breakout` — testar só o conjunto em que se
 * iterou mede a seleção, não a estratégia.
 */
import { loadSeries } from '../data/store.ts';
import { buildStrategy } from '../strategies/index.ts';
import { runBacktest } from '../backtest/engine.ts';
import { computeMetrics } from '../backtest/metrics.ts';
import { makeConfig } from '../config.ts';
import { DESCOBERTA, HOLDOUT, PARAMS_VALIDADOS, MAX_BARS_VALIDADO } from '../data/momentum-universe.ts';
import { parseArgs, num, str } from './args.ts';

const a = parseArgs();
const equity = num(a.equity, 10_000); // grande de propósito: separa "a vantagem existe" de "cabe em US$200"
const cost = str(a.cost, 'binance-futures-maker');
const cfg = makeConfig({ initialEquity: equity, costPreset: cost, riskProfile: 'seed', maxBarsInTrade: MAX_BARS_VALIDADO });

function rodar(symbols: string[], rotulo: string) {
  let pos = 0, total = 0;
  const linhas: string[] = [];
  for (const sym of symbols) {
    let series;
    try { series = loadSeries('binanceusdm', sym, '1d'); } catch { continue; }
    const res = runBacktest(series, buildStrategy('ts-momentum', PARAMS_VALIDADOS), cfg);
    const m = computeMetrics(res, cfg.initialEquity);
    if (m.trades < 5) { linhas.push(sym.replace('/USDT:USDT', '').padEnd(10) + '— poucos trades'); continue; }
    total++;
    if (m.expectancyR > 0) pos++;
    linhas.push(
      sym.replace('/USDT:USDT', '').padEnd(10) +
      m.expectancyR.toFixed(3).padEnd(9) +
      String(m.trades).padEnd(8) +
      (m.cagr * 100).toFixed(1) + '%',
    );
  }
  console.log(`\n${'─'.repeat(80)}`);
  console.log(`${rotulo} · ${symbols.length} ativos`);
  console.log(`${'─'.repeat(80)}`);
  console.log('ativo'.padEnd(10) + 'expect'.padEnd(9) + 'trades'.padEnd(8) + 'CAGR');
  for (const l of linhas) console.log(l);
  console.log(`\n${pos} positivos de ${total} (${total ? (pos / total * 100).toFixed(0) : 0}%)`);
  return { pos, total };
}

console.log(`\n${'='.repeat(80)}`);
console.log('TS-MOMENTUM — descoberta + holdout cego, parâmetros FIXOS');
console.log(`${'='.repeat(80)}`);
console.log(`\nparâmetros: ${JSON.stringify(PARAMS_VALIDADOS)} · maxBars ${MAX_BARS_VALIDADO}`);
console.log('NENHUMA ORDEM É ENVIADA. Backtest sobre dado histórico.\n');

const d = rodar(DESCOBERTA, 'DESCOBERTA (onde a região de parâmetros foi encontrada)');
const h = rodar(HOLDOUT, 'HOLDOUT (nunca visto durante o ajuste — teste cego)');

const totalPos = d.pos + h.pos, totalAtivos = d.total + h.total;
function binomTailUpper(n: number, k: number, p: number): number {
  let s = 0;
  for (let i = k; i <= n; i++) {
    let c = 1;
    for (let j = 0; j < i; j++) c = (c * (n - j)) / (j + 1);
    s += c * Math.pow(p, i) * Math.pow(1 - p, n - i);
  }
  return s;
}
const pValor = binomTailUpper(totalAtivos, totalPos, 0.5);

console.log(`\n${'='.repeat(80)}`);
console.log(`COMBINADO: ${totalPos} de ${totalAtivos} positivos (${(totalPos / totalAtivos * 100).toFixed(0)}%)`);
console.log(`P sob H0 de moeda justa (50/50): ${pValor.toExponential(2)}`);
const taxaD = d.pos / d.total, taxaH = h.pos / h.total;
console.log(`\ntaxa na descoberta: ${(taxaD * 100).toFixed(0)}% · taxa no holdout: ${(taxaH * 100).toFixed(0)}%`);
console.log(
  taxaH >= taxaD - 0.15
    ? 'O holdout não caiu (mais que ruído) em relação à descoberta — é o padrão OPOSTO ao\n' +
      'de um falso positivo, onde a taxa desaba fora da amostra em que se ajustou.'
    : 'O holdout caiu de forma notável em relação à descoberta — sinal de que a região de\n' +
      'parâmetros pode ter capturado ruído específico da descoberta. Tratar com desconfiança.',
);
console.log(`${'='.repeat(80)}\n`);
