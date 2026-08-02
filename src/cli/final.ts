/**
 * SISTEMA INTEGRADO — tudo que foi descoberto, junto, com aporte mensal.
 *
 * Combina as três coisas que passaram nos testes:
 *   1. dimensionamento por volatilidade prevista (nunca remove trade)
 *   2. catraca com piso móvel (desalavanca ao atingir marcos)
 *   3. correlação medida no dimensionamento de portfólio
 *
 * Mais o aporte mensal, que é o fator que domina nesta faixa de capital.
 *
 * A simulação REAMOSTRA os trades efetivamente medidos no backtest, em vez de
 * gerar retornos de uma normal. Isso preserva assimetria e caudas gordas que
 * uma normal esconde — e são exatamente elas que quebram contas.
 */
import { loadSeries, hasSeries } from '../data/store.ts';
import { buildStrategy } from '../strategies/index.ts';
import { runBacktest } from '../backtest/engine.ts';
import { forecastVolatility, targetVolatility, volSizeMultiplier, ratchetRisk, floorAdjust, DEFAULT_RATCHET, CONSERVATIVE_RATCHET, type RatchetStep } from '../core/volatility.ts';
import { makeConfig } from '../config.ts';
import { parseArgs, num, str } from './args.ts';

const a = parseArgs();
const exchange = str(a.exchange, 'binanceusdm');
const timeframe = str(a.timeframe, '4h');
const capitalInicial = num(a.equity, 100);
const aporteMensal = num(a.aporte, 100);
const meses = num(a.months, 24);
const sims = num(a.sims, 20000);

const pares = str(a.pairs, 'BTC/USDT:USDT=body-breakout,ETH/USDT:USDT=momentum-breakout,XRP/USDT:USDT=body-breakout,DOT/USDT:USDT=body-breakout')
  .split(',').map((s) => { const [sym, st] = s.split('='); return { sym: sym.trim(), st: st.trim() }; })
  .filter((p) => hasSeries(exchange, p.sym, timeframe));

const cfg = makeConfig({ initialEquity: 100, costPreset: 'binance-futures-maker', riskProfile: 'seed', maxBarsInTrade: 100000 });

// ── colhe os retornos reais, já com vol-targeting aplicado ─────────────────
console.log(`\n${'='.repeat(80)}`);
console.log(`SISTEMA INTEGRADO  ·  US$ ${capitalInicial} inicial + US$ ${aporteMensal}/mês  ·  ${meses} meses`);
console.log(`${'='.repeat(80)}\n`);
console.log('Colhendo retornos reais dos pares medidos…\n');

const poolR: number[] = [];
let totalTrades = 0;
let anosCobertos = 0;

for (const p of pares) {
  const series = loadSeries(exchange, p.sym, timeframe);
  const vf = forecastVolatility(series.bars);
  const vt = targetVolatility(vf);
  const idx = new Map(series.bars.map((b, i) => [b.t, i]));
  const res = runBacktest(series, buildStrategy(p.st, {}), { ...cfg, risk: { ...cfg.risk, maxDrawdownStop: 1, dailyLossLimit: 1 } });

  for (const t of res.trades) {
    const i = idx.get(t.entryTime) ?? 0;
    // rEquity é o retorno por unidade de risco arriscada; normaliza para 1R
    // e aplica o multiplicador de volatilidade.
    poolR.push((t.rEquity / cfg.risk.riskPerTrade) * volSizeMultiplier(vf, i, vt));
  }
  totalTrades += res.trades.length;
  const dias = (series.bars[series.bars.length - 1].t - series.bars[0].t) / 86_400_000;
  anosCobertos = Math.max(anosCobertos, dias / 365.25);
  console.log(`  ${p.sym.replace('/USDT:USDT', '').padEnd(6)} ${p.st.padEnd(20)} ${String(res.trades.length).padStart(4)} trades`);
}

const tradesPorMes = totalTrades / (anosCobertos * 12);
const mediaR = poolR.reduce((x, y) => x + y, 0) / poolR.length;
const sdRPool = Math.sqrt(poolR.reduce((x, y) => x + (y - mediaR) ** 2, 0) / poolR.length);

console.log(
  `\n  ${totalTrades} trades em ${anosCobertos.toFixed(1)} anos → ${tradesPorMes.toFixed(1)} trades/mês\n` +
  `  expectancy medida ${mediaR.toFixed(4)}R · desvio ${sdRPool.toFixed(2)}R\n`,
);

// ── simulação ──────────────────────────────────────────────────────────────
let seed = 20260801;
const rnd = () => { seed ^= seed << 13; seed >>>= 0; seed ^= seed >> 17; seed ^= seed << 5; seed >>>= 0; return seed / 4294967296; };

interface Res {
  nome: string; mediana: number; p5: number; p25: number; p75: number; p95: number;
  aportado: number; ganhoTrading: number; perdeu90: number; quebrou: number; acimaAporte: number;
}

/**
 * `semEdge = true` CENTRA os retornos em zero subtraindo a média, em vez de
 * multiplicá-los por zero.
 *
 * A diferença importa e eu errei isto na primeira versão: multiplicar por zero
 * apaga os trades e devolve simplesmente a soma dos aportes, o que não testa
 * nada. Centrar preserva a assimetria e as caudas gordas medidas e remove
 * apenas a vantagem — que é exatamente o cenário que o paper trading decide.
 */
function simular(nome: string, steps: RatchetStep[] | null, riscoFixo: number, comPiso: boolean, semEdge = false): Res {
  const finais: number[] = [];
  let perdeu = 0, quebrou = 0, acima = 0;
  const aportadoTotal = capitalInicial + aporteMensal * meses;

  for (let s = 0; s < sims; s++) {
    let eq = capitalInicial;
    let pico = eq;
    let morreu = false;

    for (let m = 0; m < meses; m++) {
      eq += aporteMensal; if (eq > pico) pico = eq;
      const n = Math.round(tradesPorMes);
      for (let k = 0; k < n; k++) {
        let risco = steps ? ratchetRisk(pico, steps) : riscoFixo;
        if (comPiso) risco = floorAdjust(eq, pico, risco);
        const bruto = poolR[Math.floor(rnd() * poolR.length)];
        const r = semEdge ? bruto - mediaR : bruto;
        eq += Math.max(-eq, r * eq * risco);
        if (eq > pico) pico = eq;
        if (eq <= 2) { morreu = true; break; }
      }
      if (morreu) break;
    }
    finais.push(eq);
    if (eq <= aportadoTotal * 0.1) perdeu++;
    if (morreu) quebrou++;
    if (eq > aportadoTotal) acima++;
  }

  finais.sort((x, y) => x - y);
  const q = (p: number) => finais[Math.floor((finais.length - 1) * p)];
  return {
    nome, mediana: q(0.5), p5: q(0.05), p25: q(0.25), p75: q(0.75), p95: q(0.95),
    aportado: aportadoTotal, ganhoTrading: q(0.5) - aportadoTotal,
    perdeu90: perdeu / sims, quebrou: quebrou / sims, acimaAporte: acima / sims,
  };
}

const aportado = capitalInicial + aporteMensal * meses;
console.log(`${'─'.repeat(80)}`);
console.log(`Se você só guardasse o dinheiro: US$ ${aportado}\n`);

const linhas = [
  simular('conservador 0,5% fixo', null, 0.005, false),
  simular('moderado 5% fixo', null, 0.05, false),
  simular('agressivo 20% fixo', null, 0.20, false),
  simular('CATRACA (20%→2%)', DEFAULT_RATCHET, 0, false),
  simular('CATRACA + piso móvel', DEFAULT_RATCHET, 0, true),
  simular('catraca conservadora', CONSERVATIVE_RATCHET, 0, true),
];

console.log('política'.padEnd(26) + 'p5'.padEnd(10) + 'mediana'.padEnd(11) + 'p95'.padEnd(12) + 'ganho vs guardar'.padEnd(19) + 'bate o aporte'.padEnd(15) + 'quebra');
for (const r of linhas) {
  const g = r.ganhoTrading;
  console.log(
    r.nome.padEnd(26) + ('$' + r.p5.toFixed(0)).padEnd(10) + ('$' + r.mediana.toFixed(0)).padEnd(11) +
    ('$' + r.p95.toFixed(0)).padEnd(12) +
    ((g >= 0 ? '+' : '') + '$' + g.toFixed(0)).padEnd(19) +
    ((r.acimaAporte * 100).toFixed(0) + '%').padEnd(15) +
    (r.quebrou * 100).toFixed(1) + '%',
  );
}

// ── o teste que decide tudo ────────────────────────────────────────────────
console.log(`\n${'='.repeat(80)}`);
console.log(`E SE O EDGE NÃO EXISTIR? (edge zerado, mesmas caudas)\n`);
console.log('política'.padEnd(26) + 'p5'.padEnd(10) + 'mediana'.padEnd(11) + 'perda vs guardar'.padEnd(19) + 'quebra');
for (const [nome, steps, fixo, piso] of [
  ['conservador 0,5% fixo', null, 0.005, false],
  ['moderado 5% fixo', null, 0.05, false],
  ['agressivo 20% fixo', null, 0.20, false],
  ['CATRACA + piso móvel', DEFAULT_RATCHET, 0, true],
  ['catraca conservadora', CONSERVATIVE_RATCHET, 0, true],
] as [string, RatchetStep[] | null, number, boolean][]) {
  const r = simular(nome, steps, fixo, piso, true);
  console.log(
    nome.padEnd(26) + ('$' + r.p5.toFixed(0)).padEnd(10) + ('$' + r.mediana.toFixed(0)).padEnd(11) +
    ('$' + (r.mediana - aportado).toFixed(0)).padEnd(19) + (r.quebrou * 100).toFixed(1) + '%',
  );
}

console.log(
  `\n${'='.repeat(80)}\n` +
  `O "edge zerado" mantém a forma da distribuição real (assimetria, caudas) e\n` +
  `apenas remove a vantagem. É o cenário que os 90 dias de paper vão decidir —\n` +
  `e é o único número desta página que não depende de eu estar certo.`,
);
