/**
 * Simula o barbell com dados REAIS de funding e a distribuição real de trades.
 *
 * Responde três perguntas de uma vez:
 *   1. Com que frequência há lucro SEMANAL? (o pedido explícito)
 *   2. Qual o piso? (a garantia de não perder tudo)
 *   3. Quanta volatilidade de alta o satélite entrega?
 */
import ccxt from 'ccxt';
import { loadSeries, hasSeries } from '../data/store.ts';
import { buildStrategy } from '../strategies/index.ts';
import { runBacktest } from '../backtest/engine.ts';
import { PERFIS, alocar, receberFunding, resultadoSatelite, rebalancear, total, pisoEstrutural } from '../funding/barbell.ts';
import { makeConfig } from '../config.ts';
import { parseArgs, num, str } from './args.ts';

const a = parseArgs();
const CAPITAL = num(a.equity, 100);
const SEMANAS = num(a.weeks, 52);
const SIMS = num(a.sims, 10000);
const RISCO_SAT = num(a.riscoSatelite, 0.15);

console.log(`\n${'='.repeat(88)}`);
console.log(`BARBELL — funding + satélite · US$ ${CAPITAL} · ${SEMANAS} semanas`);
console.log(`${'='.repeat(88)}\n`);

// ── funding real dos melhores candidatos ───────────────────────────────────
const ex = new (ccxt as any).binanceusdm({ enableRateLimit: true });
await ex.loadMarkets();
const alvos = str(a.funding, 'KOMA/USDT:USDT,1000RATS/USDT:USDT,AKE/USDT:USDT').split(',').map((s) => s.trim());

console.log('coletando funding real…\n');
const fundingPool: number[] = [];
for (const sym of alvos) {
  try {
    const h = await ex.fetchFundingRateHistory(sym, Date.now() - 180 * 86_400_000, 1000);
    const taxas = h.map((f: any) => f.fundingRate as number);
    if (taxas.length < 100) continue;
    fundingPool.push(...taxas);
    const m = taxas.reduce((x: number, y: number) => x + y, 0) / taxas.length;
    const pos = taxas.filter((t: number) => t > 0).length;
    console.log(`  ${sym.replace('/USDT:USDT', '').padEnd(10)} ${taxas.length} leituras · média ${(m * 100).toFixed(4)}%/8h · positivo ${((pos / taxas.length) * 100).toFixed(0)}%`);
  } catch { console.log(`  ${sym}: falhou`); }
}
if (!fundingPool.length) { console.log('sem dados de funding'); process.exit(1); }
const fundingMedio = fundingPool.reduce((x, y) => x + y, 0) / fundingPool.length;
const fundingPositivo = fundingPool.filter((t) => t > 0).length / fundingPool.length;

// ── distribuição real do satélite ──────────────────────────────────────────
const satPares = [
  { sym: 'TRX/USDT:USDT', st: 'body-breakout', tf: '5m' },
  { sym: 'KOMA/USDT:USDT', st: 'body-breakout', tf: '5m' },
].filter((p) => hasSeries('binanceusdm', p.sym, p.tf));

const cfg = makeConfig({ initialEquity: 100, costPreset: 'binance-futures-maker', riskProfile: 'seed', maxBarsInTrade: 100000 });
const satPool: number[] = [];
let tradesSatPorSemana = 0;
for (const p of satPares) {
  const s = loadSeries('binanceusdm', p.sym, p.tf);
  const r = runBacktest(s, buildStrategy(p.st, {}), { ...cfg, risk: { ...cfg.risk, maxDrawdownStop: 1, dailyLossLimit: 1 } });
  satPool.push(...r.trades.map((t) => t.rEquity / cfg.risk.riskPerTrade));
  const semanas = (s.bars.at(-1)!.t - s.bars[0].t) / (7 * 86_400_000);
  tradesSatPorSemana += r.trades.length / semanas;
}
tradesSatPorSemana = Math.min(tradesSatPorSemana, 8); // teto: 3 slots não dão mais que isso

console.log(
  `\n  funding: ${fundingPool.length} leituras · média ${(fundingMedio * 100).toFixed(4)}%/8h · positivo ${(fundingPositivo * 100).toFixed(0)}%\n` +
  `  satélite: ${satPool.length} trades · ~${tradesSatPorSemana.toFixed(1)}/semana\n`,
);

// ── simulação ──────────────────────────────────────────────────────────────
let seed = 4242;
const rnd = () => { seed ^= seed << 13; seed >>>= 0; seed ^= seed >> 17; seed ^= seed << 5; seed >>>= 0; return seed / 4294967296; };

function simular(nomePerfil: string) {
  const perfil = PERFIS[nomePerfil];
  const finais: number[] = [];
  let somaSemanasPositivas = 0, somaSemanas = 0;
  let zerou = 0, abaixoMetade = 0, dobrou = 0, quintuplicou = 0, satDesligado = 0;
  const pisosObservados: number[] = [];

  for (let s = 0; s < SIMS; s++) {
    let e = alocar(CAPITAL, perfil);
    let minimo = CAPITAL;
    let positivas = 0;

    for (let w = 0; w < SEMANAS; w++) {
      const antes = total(e);

      // 21 pagamentos de funding por semana
      for (let f = 0; f < 21; f++) {
        e = receberFunding(e, fundingPool[Math.floor(rnd() * fundingPool.length)]);
      }
      // trades do satélite
      const nSat = Math.round(tradesSatPorSemana);
      for (let k = 0; k < nSat; k++) {
        e = resultadoSatelite(e, satPool[Math.floor(rnd() * satPool.length)], RISCO_SAT);
      }
      const rb = rebalancear(e, perfil, CAPITAL);
      e = rb.estado;

      const depois = total(e);
      if (depois > antes) positivas++;
      somaSemanas++;
      minimo = Math.min(minimo, depois);
      if (depois <= 1) break;
    }

    const t = total(e);
    finais.push(t);
    somaSemanasPositivas += positivas;
    pisosObservados.push(minimo);
    if (t <= 1) zerou++;
    if (t < CAPITAL * 0.5) abaixoMetade++;
    if (t >= CAPITAL * 2) dobrou++;
    if (t >= CAPITAL * 5) quintuplicou++;
    if (e.satelliteDesligado) satDesligado++;
  }

  finais.sort((x, y) => x - y);
  pisosObservados.sort((x, y) => x - y);
  const q = (arr: number[], p: number) => arr[Math.floor((arr.length - 1) * p)];
  return {
    nome: nomePerfil,
    semanasPositivas: somaSemanasPositivas / somaSemanas,
    mediana: q(finais, 0.5), p5: q(finais, 0.05), p25: q(finais, 0.25),
    p75: q(finais, 0.75), p95: q(finais, 0.95),
    pisoMedio: pisosObservados.reduce((x, y) => x + y, 0) / pisosObservados.length,
    piorPiso: pisosObservados[0],
    pZerou: zerou / SIMS, pAbaixoMetade: abaixoMetade / SIMS,
    pDobrou: dobrou / SIMS, pQuintuplicou: quintuplicou / SIMS,
    pSatDesligado: satDesligado / SIMS,
    pisoTeorico: pisoEstrutural(CAPITAL, PERFIS[nomePerfil]),
  };
}

const linhas = ['fortaleza', 'equilibrado', 'agressivo'].map(simular);

console.log(`${'─'.repeat(88)}`);
console.log('O PEDIDO: lucro toda semana\n');
console.log('perfil'.padEnd(15) + 'semanas positivas'.padEnd(20) + 'mediana'.padEnd(11) + 'p5'.padEnd(10) + 'p95');
for (const l of linhas) {
  console.log(
    l.nome.padEnd(15) + ((l.semanasPositivas * 100).toFixed(1) + '%').padEnd(20) +
    ('$' + l.mediana.toFixed(0)).padEnd(11) + ('$' + l.p5.toFixed(0)).padEnd(10) + '$' + l.p95.toFixed(0),
  );
}

console.log(`\n${'─'.repeat(88)}`);
console.log('O PEDIDO: não perder tudo\n');
console.log('perfil'.padEnd(15) + 'zerou'.padEnd(10) + 'abaixo de 50%'.padEnd(16) + 'pior piso visto'.padEnd(18) + 'piso teórico');
for (const l of linhas) {
  console.log(
    l.nome.padEnd(15) + ((l.pZerou * 100).toFixed(2) + '%').padEnd(10) +
    ((l.pAbaixoMetade * 100).toFixed(1) + '%').padEnd(16) +
    ('$' + l.piorPiso.toFixed(2)).padEnd(18) + '$' + l.pisoTeorico.toFixed(0),
  );
}

console.log(`\n${'─'.repeat(88)}`);
console.log('O PEDIDO: volatilidade de alta\n');
console.log('perfil'.padEnd(15) + 'dobra'.padEnd(11) + '5x'.padEnd(11) + 'p75'.padEnd(11) + 'satélite desligado');
for (const l of linhas) {
  console.log(
    l.nome.padEnd(15) + ((l.pDobrou * 100).toFixed(1) + '%').padEnd(11) +
    ((l.pQuintuplicou * 100).toFixed(1) + '%').padEnd(11) +
    ('$' + l.p75.toFixed(0)).padEnd(11) + (l.pSatDesligado * 100).toFixed(1) + '%',
  );
}

const rec = linhas.find((l) => l.nome === 'equilibrado')!;
console.log(
  `\n${'='.repeat(88)}\n` +
  `EQUILIBRADO (70% núcleo / 30% satélite):\n\n` +
  `  lucro em ${(rec.semanasPositivas * 100).toFixed(1)}% das semanas\n` +
  `  mediana US$ ${rec.mediana.toFixed(0)} · faixa US$ ${rec.p25.toFixed(0)}–${rec.p75.toFixed(0)}\n` +
  `  chance de zerar: ${(rec.pZerou * 100).toFixed(2)}%\n` +
  `  pior piso em ${SIMS.toLocaleString('pt-BR')} simulações: US$ ${rec.piorPiso.toFixed(2)}\n\n` +
  `  O piso existe porque o núcleo é delta-neutro: ele não perde por movimento\n` +
  `  de preço, só por funding negativo — que corrói devagar, não zera.`,
);
