/**
 * O PROBLEMA INVERTIDO: em vez de "o que meus dados dão?", pergunta
 * "o que seria NECESSÁRIO?" — e depois procura isso nos dados de verdade.
 *
 * A álgebra: para multiplicar o capital por M em N operações, o crescimento
 * médio por operação precisa ser exp(ln(M)/N). Com risco `r` por operação e
 * expectancy `E` em múltiplos de R, o crescimento é aproximadamente E·r.
 *
 * Logo:  E · r = ln(M) / N
 *
 * Isso expõe algo que eu tinha deixado passar: **N está no denominador**. Com
 * 20 operações por mês o requisito é brutal. Com 400, fica ordens de grandeza
 * menor. Eu havia descartado alta frequência por causa do custo — mas nunca
 * calculei o ponto onde o ganho de frequência supera a perda por taxa.
 *
 * Este arquivo faz as duas coisas: calcula o requisito e varre TODOS os dados
 * disponíveis procurando algo que chegue perto.
 */
import fs from 'node:fs';
import path from 'node:path';
import { loadSeries, DATA_DIR } from '../data/store.ts';
import { buildStrategy, REGISTRY } from '../strategies/index.ts';
import { runBacktest } from '../backtest/engine.ts';
import { computeMetrics } from '../backtest/metrics.ts';
import { makeConfig, COSTS } from '../config.ts';
import { parseArgs, num, str } from './args.ts';

const a = parseArgs();
const M = num(a.mult, 50);
const meses = num(a.months, 1);

console.log(`\n${'='.repeat(86)}`);
console.log(`REQUISITO: multiplicar por ${M}x em ${meses} mês(es)`);
console.log(`${'='.repeat(86)}\n`);

// ── PARTE 1: o requisito em função da frequência ──────────────────────────
console.log('PARTE 1 — quanto de vantagem é preciso, por frequência\n');
console.log(
  'A conta: E·r = ln(M)/N, onde E é expectancy em R, r é o risco por operação\n' +
  'e N o número de operações no período.\n',
);
console.log('trades/mês'.padEnd(13) + 'N total'.padEnd(10) + 'E·r necessário'.padEnd(18) + 'com r=5%'.padEnd(13) + 'com r=10%'.padEnd(13) + 'com r=20%');
const alvoLog = Math.log(M);
for (const tm of [20, 50, 100, 200, 400, 800, 1600, 3200]) {
  const N = tm * meses;
  const req = alvoLog / N;
  const f = (r: number) => {
    const E = req / r;
    return E > 3 ? `${E.toFixed(1)}R ✗` : `${E.toFixed(2)}R`;
  };
  console.log(
    String(tm).padEnd(13) + String(N).padEnd(10) + req.toFixed(4).padEnd(18) +
    f(0.05).padEnd(13) + f(0.10).padEnd(13) + f(0.20),
  );
}
console.log(
  `\n  Referência: a melhor expectancy que este projeto já mediu foi 0,17R.\n` +
  `  Valores acima de ~0,5R não existem de forma sustentada em mercado líquido.\n`,
);

// ── PARTE 2: mas a taxa cresce com a frequência ───────────────────────────
console.log(`${'─'.repeat(86)}`);
console.log('PARTE 2 — o custo que a frequência cobra\n');
console.log(
  'Cada operação paga o pedágio de ida e volta. Mais operações = mais pedágio.\n' +
  'A expectancy LÍQUIDA é a bruta menos o custo dividido pela distância do stop.\n',
);
const custoMaker = 2 * COSTS['binance-futures-maker'].takerFee + 2 * COSTS['binance-futures-maker'].slippage;
const custoTaker = 2 * COSTS['binance-futures'].takerFee + 2 * COSTS['binance-futures'].slippage;
console.log('stop'.padEnd(9) + 'custo/R (maker)'.padEnd(19) + 'custo/R (taker)'.padEnd(19) + 'expectancy bruta necessária p/ líquida 0,17R');
for (const stop of [0.003, 0.005, 0.01, 0.015, 0.03]) {
  const cm = custoMaker / stop;
  const ct = custoTaker / stop;
  console.log(
    ((stop * 100).toFixed(1) + '%').padEnd(9) + cm.toFixed(3).padEnd(19) + ct.toFixed(3).padEnd(19) +
    `${(0.17 + cm).toFixed(3)}R (maker) · ${(0.17 + ct).toFixed(3)}R (taker)`,
  );
}
console.log(
  `\n  É esta tabela que condena alta frequência: com stop de 0,3% e custo maker,\n` +
  `  o pedágio sozinho consome 0,17R por operação — exatamente a vantagem inteira\n` +
  `  que este projeto conseguiu medir. Para lucrar, a estratégia precisaria de\n` +
  `  0,34R bruto, o dobro do melhor já visto.\n`,
);

// ── PARTE 3: varredura exaustiva dos dados que existem ────────────────────
console.log(`${'─'.repeat(86)}`);
console.log('PARTE 3 — varrendo TODOS os dados disponíveis atrás de vantagem alta\n');

const arquivos = fs.existsSync(DATA_DIR) ? fs.readdirSync(DATA_DIR).filter((f) => f.endsWith('.json')) : [];
const series = arquivos.map((f) => {
  const [ex, sym, tf] = f.replace('.json', '').split('__');
  return { ex, sym: sym.replace(/_/g, '/').replace(/\/(USDT)$/, ':$1'), tf, arquivo: f };
});

console.log(`  ${series.length} séries em cache · ${Object.keys(REGISTRY).length} estratégias · ${series.length * Object.keys(REGISTRY).length} combinações\n`);

interface Achado {
  sym: string; tf: string; st: string; expectancy: number; trades: number;
  tradesMes: number; anos: number; produto: number;
}
const achados: Achado[] = [];

for (const s of series) {
  let serie;
  try { serie = loadSeries(s.ex, s.sym, s.tf); } catch { continue; }
  if (serie.bars.length < 1500) continue;
  const anos = (serie.bars.at(-1)!.t - serie.bars[0].t) / (365.25 * 86_400_000);
  if (anos < 0.5) continue;

  const preset = s.ex === 'yahoo' ? 'acao-varejo' : 'binance-futures-maker';
  const cfg = makeConfig({ initialEquity: 100, costPreset: preset, riskProfile: 'seed', maxBarsInTrade: 100000 });

  for (const st of Object.keys(REGISTRY)) {
    try {
      const r = runBacktest(serie, buildStrategy(st, {}), { ...cfg, risk: { ...cfg.risk, maxDrawdownStop: 1, dailyLossLimit: 1 } });
      if (r.trades.length < 50) continue;
      const m = computeMetrics(r, 100);
      const tradesMes = r.trades.length / (anos * 12);
      achados.push({
        sym: s.sym, tf: s.tf, st, expectancy: m.expectancyR, trades: m.trades,
        tradesMes, anos, produto: m.expectancyR * tradesMes,
      });
    } catch { /* segue */ }
  }
}

// O que importa não é expectancy sozinha nem frequência sozinha — é o PRODUTO.
const ordenado = achados.sort((x, y) => y.produto - x.produto);
console.log('  TOP 15 por expectancy × frequência (o que realmente compõe)\n');
console.log('  ativo'.padEnd(22) + 'tf'.padEnd(6) + 'estratégia'.padEnd(22) + 'expect'.padEnd(10) + 'trades/mês'.padEnd(13) + 'produto'.padEnd(11) + 'meses p/ 50x');
for (const x of ordenado.slice(0, 15)) {
  const mesesPara50 = x.produto > 0 ? alvoLog / (x.produto * 0.10) : Infinity;
  console.log(
    ('  ' + x.sym.replace('/USDT:USDT', '')).padEnd(22) + x.tf.padEnd(6) + x.st.padEnd(22) +
    (x.expectancy.toFixed(3) + 'R').padEnd(10) + x.tradesMes.toFixed(1).padEnd(13) +
    x.produto.toFixed(4).padEnd(11) +
    (isFinite(mesesPara50) && mesesPara50 < 1000 ? mesesPara50.toFixed(0) : '∞'),
  );
}

const melhor = ordenado[0];
if (melhor) {
  console.log(`\n${'='.repeat(86)}`);
  console.log(
    `MELHOR COMBINAÇÃO ENCONTRADA em ${achados.length} testadas:\n` +
    `  ${melhor.sym} ${melhor.tf} ${melhor.st}\n` +
    `  expectancy ${melhor.expectancy.toFixed(3)}R · ${melhor.tradesMes.toFixed(1)} trades/mês · produto ${melhor.produto.toFixed(4)}\n\n` +
    `Para 50x em 1 mês seria preciso um produto de ${(alvoLog / (0.10 * 1)).toFixed(2)} com risco de 10%.\n` +
    `O melhor encontrado é ${melhor.produto.toFixed(4)} — ` +
    `${(alvoLog / (0.10) / melhor.produto).toFixed(0)}x menor que o necessário.`,
  );
}
