/**
 * O PROBLEMA DO ALVO: qual risco maximiza a chance de US$ 100 virarem US$ 5.000
 * em um mês?
 *
 * Isto NÃO é uma pergunta retórica — tem resposta matemática exata. Num
 * processo com vantagem positiva e um alvo a atingir, existe um risco ótimo:
 * baixo demais e você não chega no prazo; alto demais e você quebra antes.
 *
 * O que este arquivo faz é achar esse ótimo e mostrar o preço dele. Usa a
 * distribuição REAL dos 1.186 trades medidos — reamostrada, não uma normal —
 * porque as caudas gordas são exatamente o que decide um problema de alvo.
 *
 * Nenhum número aqui é opinião. São contagens de simulação.
 */
import { loadSeries, hasSeries } from '../data/store.ts';
import { buildStrategy } from '../strategies/index.ts';
import { runBacktest } from '../backtest/engine.ts';
import { forecastVolatility, targetVolatility, volSizeMultiplier } from '../core/volatility.ts';
import { makeConfig } from '../config.ts';
import { parseArgs, num, str } from './args.ts';

const a = parseArgs();
const alvo = num(a.alvo, 5000);
const inicial = num(a.equity, 100);
const meses = num(a.months, 1);
const sims = num(a.sims, 100000);

const pares = [
  { sym: 'BTC/USDT:USDT', st: 'body-breakout' },
  { sym: 'ETH/USDT:USDT', st: 'momentum-breakout' },
  { sym: 'XRP/USDT:USDT', st: 'body-breakout' },
  { sym: 'DOT/USDT:USDT', st: 'body-breakout' },
].filter((p) => hasSeries('binanceusdm', p.sym, '4h'));

const cfg = makeConfig({ initialEquity: 100, costPreset: 'binance-futures-maker', riskProfile: 'seed', maxBarsInTrade: 100000 });

// ── colhe a distribuição real de retornos, em múltiplos de R ───────────────
const poolR: number[] = [];
let totalTrades = 0, anos = 0;
for (const p of pares) {
  const series = loadSeries('binanceusdm', p.sym, '4h');
  const vf = forecastVolatility(series.bars);
  const vt = targetVolatility(vf);
  const idx = new Map(series.bars.map((b, i) => [b.t, i]));
  const res = runBacktest(series, buildStrategy(p.st, {}), { ...cfg, risk: { ...cfg.risk, maxDrawdownStop: 1, dailyLossLimit: 1 } });
  for (const t of res.trades) {
    const i = idx.get(t.entryTime) ?? 0;
    poolR.push((t.rEquity / cfg.risk.riskPerTrade) * volSizeMultiplier(vf, i, vt));
  }
  totalTrades += res.trades.length;
  anos = Math.max(anos, (series.bars.at(-1)!.t - series.bars[0].t) / (365.25 * 86_400_000));
}
const tradesMes = totalTrades / (anos * 12);
const media = poolR.reduce((x, y) => x + y, 0) / poolR.length;
const sd = Math.sqrt(poolR.reduce((x, y) => x + (y - media) ** 2, 0) / poolR.length);

let seed = 31337;
const rnd = () => { seed ^= seed << 13; seed >>>= 0; seed ^= seed >> 17; seed ^= seed << 5; seed >>>= 0; return seed / 4294967296; };

interface R {
  risco: number; pAlvo: number; pDobra: number; pQuebra: number; pPerde90: number;
  mediana: number; media: number; melhorPico: number;
}

function sim(risco: number, semEdge = false): R {
  let chegou = 0, dobrou = 0, quebrou = 0, perdeu = 0, somaPico = 0;
  const finais: number[] = [];
  const n = Math.round(tradesMes * meses);

  for (let s = 0; s < sims; s++) {
    let eq = inicial, pico = inicial;
    for (let k = 0; k < n; k++) {
      const bruto = poolR[Math.floor(rnd() * poolR.length)];
      const r = semEdge ? bruto - media : bruto;
      eq += Math.max(-eq, r * eq * risco);
      if (eq > pico) pico = eq;
      if (eq <= 1) break;
    }
    finais.push(eq);
    somaPico += pico;
    if (pico >= alvo) chegou++;
    if (pico >= inicial * 2) dobrou++;
    if (eq <= 1) quebrou++;
    if (eq <= inicial * 0.1) perdeu++;
  }
  finais.sort((x, y) => x - y);
  return {
    risco, pAlvo: chegou / sims, pDobra: dobrou / sims, pQuebra: quebrou / sims,
    pPerde90: perdeu / sims, mediana: finais[Math.floor(sims / 2)],
    media: finais.reduce((x, y) => x + y, 0) / sims, melhorPico: somaPico / sims,
  };
}

console.log(`\n${'='.repeat(82)}`);
console.log(`DESAFIO: US$ ${inicial} → US$ ${alvo} em ${meses} mês(es) — qual risco maximiza a chance?`);
console.log(`${'='.repeat(82)}\n`);
console.log(
  `Distribuição real: ${totalTrades} trades medidos · ${tradesMes.toFixed(1)}/mês · ` +
  `expectancy ${media.toFixed(4)}R · desvio ${sd.toFixed(2)}R\n` +
  `${sims.toLocaleString('pt-BR')} simulações por linha, reamostrando os trades reais\n`,
);

const riscos = [0.05, 0.10, 0.20, 0.30, 0.40, 0.50, 0.60, 0.70, 0.80, 0.90, 0.95, 0.99];
const linhas = riscos.map((r) => sim(r));

console.log('risco'.padEnd(9) + `chega a ${alvo}`.padEnd(15) + 'dobra'.padEnd(10) + 'perde 90%'.padEnd(12) + 'quebra'.padEnd(10) + 'mediana'.padEnd(11) + 'média');
for (const l of linhas) {
  console.log(
    ((l.risco * 100).toFixed(0) + '%').padEnd(9) +
    ((l.pAlvo * 100).toFixed(2) + '%').padEnd(15) +
    ((l.pDobra * 100).toFixed(1) + '%').padEnd(10) +
    ((l.pPerde90 * 100).toFixed(1) + '%').padEnd(12) +
    ((l.pQuebra * 100).toFixed(1) + '%').padEnd(10) +
    ('$' + l.mediana.toFixed(0)).padEnd(11) +
    '$' + l.media.toFixed(0),
  );
}

const otimo = linhas.reduce((b, l) => (l.pAlvo > b.pAlvo ? l : b));
console.log(`\n${'─'.repeat(82)}`);
console.log(`ÓTIMO: risco de ${(otimo.risco * 100).toFixed(0)}% por trade\n`);
console.log(`  chance de tocar US$ ${alvo}       ${(otimo.pAlvo * 100).toFixed(2)}%   → 1 em ${Math.round(1 / Math.max(otimo.pAlvo, 1e-9))}`);
console.log(`  chance de perder 90%+       ${(otimo.pPerde90 * 100).toFixed(1)}%`);
console.log(`  chance de zerar             ${(otimo.pQuebra * 100).toFixed(1)}%`);
console.log(`  resultado mediano           US$ ${otimo.mediana.toFixed(2)}`);

// ── o teste que separa sistema de loteria ──────────────────────────────────
console.log(`\n${'='.repeat(82)}`);
console.log(`O MESMO RISCO, SE A VANTAGEM NÃO EXISTIR (retornos centrados em zero)\n`);
console.log('risco'.padEnd(9) + `chega a ${alvo}`.padEnd(15) + 'perde 90%'.padEnd(12) + 'quebra'.padEnd(10) + 'mediana');
for (const r of [0.20, otimo.risco, 0.90]) {
  const l = sim(r, true);
  console.log(
    ((r * 100).toFixed(0) + '%').padEnd(9) + ((l.pAlvo * 100).toFixed(2) + '%').padEnd(15) +
    ((l.pPerde90 * 100).toFixed(1) + '%').padEnd(12) + ((l.pQuebra * 100).toFixed(1) + '%').padEnd(10) +
    '$' + l.mediana.toFixed(2),
  );
}

console.log(
  `\n${'='.repeat(82)}\n` +
  `A comparação acima é o teste decisivo. Se a chance de atingir o alvo é\n` +
  `parecida COM e SEM vantagem, então o alvo não está sendo atingido pela\n` +
  `estratégia — está sendo atingido pela variância. Nesse caso o sistema não\n` +
  `é um sistema: é um bilhete de loteria com passos extras.`,
);
