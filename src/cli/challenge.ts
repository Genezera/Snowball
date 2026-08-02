/**
 * O DESAFIO: US$ 100 → US$ 5.000 SEM QUEBRAR, com toda a realidade modelada.
 *
 * "Sem quebrar" transforma isto de maximização em otimização COM RESTRIÇÃO, e
 * as duas têm respostas completamente diferentes. Maximizar a chance de tocar
 * o alvo leva a apostar tudo; adicionar a restrição de sobreviver muda o ótimo.
 *
 * Realidade modelada, item por item:
 *   · distribuição real dos 1.186 trades medidos (reamostrada, não normal)
 *   · taxa maker 0,02%/lado + slippage
 *   · LIQUIDAÇÃO: alavancagem = risco/stop; a exchange fecha antes do stop
 *     quando a alavancagem é alta demais
 *   · teto de alavancagem por ativo (125x majors, 50x alts)
 *   · taxa de liquidação 0,5% + slippage forçado 0,3%
 *   · notional mínimo de US$ 5 — abaixo disso a conta simplesmente não opera
 *   · catraca: o risco desce conforme o capital sobe
 *   · piso de desistência: para de operar antes de zerar
 *
 * O otimizador varre políticas e reporta a fronteira entre chance de alvo e
 * probabilidade de ruína. Nenhum número é opinião.
 */
import { loadSeries, hasSeries } from '../data/store.ts';
import { buildStrategy } from '../strategies/index.ts';
import { runBacktest } from '../backtest/engine.ts';
import { forecastVolatility, targetVolatility, volSizeMultiplier } from '../core/volatility.ts';
import { analisarLiquidacao, aplicarTrade, TIERS_MAJOR } from '../core/liquidation.ts';
import { makeConfig, COSTS } from '../config.ts';
import { parseArgs, num, str } from './args.ts';

const a = parseArgs();
const ALVO = num(a.alvo, 5000);
const INICIAL = num(a.equity, 100);
const SIMS = num(a.sims, 30000);
const STOP = num(a.stop, 0.015);
const MIN_NOTIONAL = 5;

const pares = [
  { sym: 'BTC/USDT:USDT', st: 'body-breakout' },
  { sym: 'ETH/USDT:USDT', st: 'momentum-breakout' },
  { sym: 'XRP/USDT:USDT', st: 'body-breakout' },
  { sym: 'DOT/USDT:USDT', st: 'body-breakout' },
].filter((p) => hasSeries('binanceusdm', p.sym, '4h'));

const cfg = makeConfig({ initialEquity: 100, costPreset: 'binance-futures-maker', riskProfile: 'seed', maxBarsInTrade: 100000 });
const custo = COSTS['binance-futures-maker'];

// ── distribuição real ──────────────────────────────────────────────────────
const pool: number[] = [];
let nTrades = 0, anos = 0;
for (const p of pares) {
  const s = loadSeries('binanceusdm', p.sym, '4h');
  const vf = forecastVolatility(s.bars);
  const vt = targetVolatility(vf);
  const idx = new Map(s.bars.map((b, i) => [b.t, i]));
  const r = runBacktest(s, buildStrategy(p.st, {}), { ...cfg, risk: { ...cfg.risk, maxDrawdownStop: 1, dailyLossLimit: 1 } });
  for (const t of r.trades) pool.push((t.rEquity / cfg.risk.riskPerTrade) * volSizeMultiplier(vf, idx.get(t.entryTime) ?? 0, vt));
  nTrades += r.trades.length;
  anos = Math.max(anos, (s.bars.at(-1)!.t - s.bars[0].t) / (365.25 * 86_400_000));
}
const tradesMes = nTrades / (anos * 12);
const media = pool.reduce((x, y) => x + y, 0) / pool.length;

let seed = 987123;
const rnd = () => { seed ^= seed << 13; seed >>>= 0; seed ^= seed >> 17; seed ^= seed << 5; seed >>>= 0; return seed / 4294967296; };

interface Politica {
  nome: string;
  riscoInicial: number;
  /** desce o risco ao cruzar cada múltiplo do capital inicial */
  catraca: boolean;
  /** para de operar abaixo deste equity, preservando o resto */
  piso: number;
  meses: number;
}

interface Resultado {
  pol: Politica;
  pAlvo: number; pRuina: number; pAbaixoPiso: number; pLiquidado: number;
  mediana: number; p25: number; p75: number; mesesAteAlvo: number;
  alavancagemMax: number; impossivel: boolean;
}

function risco(pol: Politica, pico: number): number {
  if (!pol.catraca) return pol.riscoInicial;
  const mult = pico / INICIAL;
  if (mult >= 25) return pol.riscoInicial * 0.05;
  if (mult >= 10) return pol.riscoInicial * 0.12;
  if (mult >= 5) return pol.riscoInicial * 0.25;
  if (mult >= 2) return pol.riscoInicial * 0.5;
  return pol.riscoInicial;
}

function simular(pol: Politica): Resultado {
  const an = analisarLiquidacao(pol.riscoInicial, STOP, TIERS_MAJOR, 1000);
  let chegou = 0, ruina = 0, abaixoPiso = 0, liq = 0, somaMeses = 0;
  const finais: number[] = [];

  for (let s = 0; s < SIMS; s++) {
    let eq = INICIAL, pico = INICIAL;
    let tocouAlvo = false, foiLiquidado = false, parou = false;
    let mesAlvo = 0;
    const n = Math.round(tradesMes * pol.meses);

    for (let k = 0; k < n; k++) {
      // notional mínimo: abaixo disso a conta não consegue operar
      const r = risco(pol, pico);
      const notional = (eq * r) / (STOP + 2 * custo.takerFee + 2 * custo.slippage);
      if (notional < MIN_NOTIONAL) { parou = true; break; }
      if (eq < pol.piso) { parou = true; break; }

      const anK = analisarLiquidacao(r, STOP, TIERS_MAJOR, notional);
      const ret = pool[Math.floor(rnd() * pool.length)];
      const out = aplicarTrade(eq, ret, r, STOP, anK);
      eq = out.novoEquity;
      if (out.liquidado) foiLiquidado = true;

      if (eq > pico) pico = eq;
      if (!tocouAlvo && eq >= ALVO) { tocouAlvo = true; mesAlvo = (k / tradesMes); }
      if (eq <= 1) break;
    }

    finais.push(eq);
    if (tocouAlvo) { chegou++; somaMeses += mesAlvo; }
    if (eq <= INICIAL * 0.1) ruina++;
    if (parou) abaixoPiso++;
    if (foiLiquidado) liq++;
  }

  finais.sort((x, y) => x - y);
  const q = (p: number) => finais[Math.floor((finais.length - 1) * p)];
  return {
    pol, pAlvo: chegou / SIMS, pRuina: ruina / SIMS, pAbaixoPiso: abaixoPiso / SIMS,
    pLiquidado: liq / SIMS, mediana: q(0.5), p25: q(0.25), p75: q(0.75),
    mesesAteAlvo: chegou ? somaMeses / chegou : 0,
    alavancagemMax: an.alavancagemNecessaria, impossivel: an.impossivel,
  };
}

console.log(`\n${'='.repeat(88)}`);
console.log(`DESAFIO COM RESTRIÇÃO: US$ ${INICIAL} → US$ ${ALVO} SEM QUEBRAR`);
console.log(`${'='.repeat(88)}\n`);
console.log(
  `Realidade modelada: ${nTrades} trades reais · ${tradesMes.toFixed(1)}/mês · expectancy ${media.toFixed(4)}R\n` +
  `taxa maker ${(custo.takerFee * 100).toFixed(3)}%/lado · liquidação com taxa 0,5% + slippage 0,3%\n` +
  `teto de alavancagem 125x (majors) · notional mínimo US$ ${MIN_NOTIONAL} · stop ${(STOP * 100).toFixed(1)}%\n`,
);

// ── PARTE 1: o teto físico da alavancagem ─────────────────────────────────
console.log('PARTE 1 — até onde a exchange deixa ir\n');
console.log('risco/trade'.padEnd(14) + 'alavancagem'.padEnd(14) + 'liquidação em'.padEnd(16) + 'stop protege?'.padEnd(16) + 'montável?');
for (const r of [0.05, 0.10, 0.20, 0.50, 0.75, 1.0, 1.5, 2.0]) {
  const an = analisarLiquidacao(r, STOP, TIERS_MAJOR, 1000);
  console.log(
    ((r * 100).toFixed(0) + '%').padEnd(14) +
    (an.alavancagemNecessaria.toFixed(1) + 'x').padEnd(14) +
    ((an.distanciaLiquidacao * 100).toFixed(2) + '%').padEnd(16) +
    (an.liquidaAntesDoStop ? 'NÃO — liquida antes' : 'sim').padEnd(16) +
    (an.impossivel ? `NÃO (máx ${an.alavancagemPermitida}x)` : 'sim'),
  );
}

// ── PARTE 2: políticas ────────────────────────────────────────────────────
console.log(`\n${'─'.repeat(88)}`);
console.log('PARTE 2 — políticas, com liquidação e piso modelados\n');

const politicas: Politica[] = [];
for (const meses of [1, 3, 6, 12, 24]) {
  for (const r of [0.05, 0.10, 0.20, 0.35, 0.50]) {
    politicas.push({ nome: `${(r * 100).toFixed(0)}% catraca ${meses}m`, riscoInicial: r, catraca: true, piso: 20, meses });
  }
}

const res = politicas.map(simular);

console.log('política'.padEnd(20) + 'chega 5000'.padEnd(13) + 'ruína'.padEnd(10) + 'liquidado'.padEnd(12) + 'mediana'.padEnd(11) + 'p25'.padEnd(10) + 'p75');
for (const meses of [1, 3, 6, 12, 24]) {
  for (const r of res.filter((x) => x.pol.meses === meses)) {
    console.log(
      r.pol.nome.padEnd(20) +
      ((r.pAlvo * 100).toFixed(2) + '%').padEnd(13) +
      ((r.pRuina * 100).toFixed(1) + '%').padEnd(10) +
      ((r.pLiquidado * 100).toFixed(1) + '%').padEnd(12) +
      ('$' + r.mediana.toFixed(0)).padEnd(11) +
      ('$' + r.p25.toFixed(0)).padEnd(10) +
      '$' + r.p75.toFixed(0),
    );
  }
  console.log('');
}

// ── PARTE 3: a fronteira ──────────────────────────────────────────────────
console.log(`${'─'.repeat(88)}`);
console.log('PARTE 3 — a melhor política com ruína abaixo de 5%\n');

const viaveis = res.filter((r) => r.pRuina < 0.05).sort((x, y) => y.pAlvo - x.pAlvo);
if (!viaveis.length) {
  console.log('  NENHUMA política atinge ruína abaixo de 5%.');
} else {
  const top = viaveis.slice(0, 5);
  console.log('política'.padEnd(20) + 'chega 5000'.padEnd(13) + 'ruína'.padEnd(10) + 'mediana'.padEnd(11) + 'tempo médio até o alvo');
  for (const r of top) {
    console.log(
      r.pol.nome.padEnd(20) + ((r.pAlvo * 100).toFixed(2) + '%').padEnd(13) +
      ((r.pRuina * 100).toFixed(1) + '%').padEnd(10) + ('$' + r.mediana.toFixed(0)).padEnd(11) +
      (r.pAlvo > 0 ? r.mesesAteAlvo.toFixed(1) + ' meses' : '—'),
    );
  }
  const melhor = top[0];
  console.log(
    `\n  MELHOR: ${melhor.pol.nome} — ${(melhor.pAlvo * 100).toFixed(2)}% de chance de chegar\n` +
    `  a US$ ${ALVO} com ${(melhor.pRuina * 100).toFixed(1)}% de risco de ruína.`,
  );
}
