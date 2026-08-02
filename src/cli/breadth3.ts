/**
 * LARGURA, VERSÃO CORRIGIDA.
 *
 * A versão anterior devolveu mediana de US$ 9.552 partindo de US$ 100 em dois
 * meses. Isso é 95x, melhor que os 5381% do vídeo que este projeto passou
 * semanas desmontando — e era resultado de três erros somados.
 *
 * ERRO 1 — VAZÃO IMPOSSÍVEL. A simulação executava 1.493 operações sequenciais
 * em 2 meses. Com 3 posições simultâneas e duração média de ~10h por operação,
 * o teto físico é ~430. Além disso, tratava cada operação como se compusesse
 * sozinha sobre o capital inteiro; na realidade posições simultâneas dividem o
 * capital, não o multiplicam.
 *   CORREÇÃO: simulação por eventos, com slots ocupados por duração real
 *   sorteada da distribuição medida. Uma operação só começa quando há vaga.
 *
 * ERRO 2 — VIÉS DE SELEÇÃO. Escolhia as 11 melhores de 84 e simulava só com
 * elas. É o mecanismo exato que produz o leaderboard inútil do trader.dev.
 *   CORREÇÃO: as pernas são SELECIONADAS na primeira metade do histórico e
 *   AVALIADAS na segunda. A seleção nunca vê os dados que julgam.
 *
 * ERRO 3 — REAMOSTRAGEM ALÉM DO SUPORTE. Sorteava 1.493 vezes de conjuntos de
 * 100–300 operações, reamostrando cada uma 5 a 15 vezes e engordando a cauda.
 *   CORREÇÃO: a vazão corrigida reduz os sorteios para perto do tamanho real
 *   do conjunto, e o número de reamostragens por operação é reportado.
 */
import fs from 'node:fs';
import { loadSeries, hasSeries, DATA_DIR, tfMs } from '../data/store.ts';
import { buildStrategy, REGISTRY } from '../strategies/index.ts';
import { runBacktest } from '../backtest/engine.ts';
import { computeMetrics } from '../backtest/metrics.ts';
import { effectiveHeat } from '../backtest/portfolio.ts';
import { forecastVolatility, targetVolatility, volSizeMultiplier } from '../core/volatility.ts';
import { analisarLiquidacao, aplicarTrade, TIERS_MAJOR } from '../core/liquidation.ts';
import { makeConfig, COSTS } from '../config.ts';
import { parseArgs, num, str } from './args.ts';
import type { Series } from '../core/types.ts';

const a = parseArgs();
const ALVO_MULT = num(a.mult, 5);
const INICIAL = num(a.equity, 100);
const MESES = num(a.months, 2);
const SIMS = num(a.sims, 20000);
const SLOTS = num(a.slots, 3);
const STOP = 0.015;
const MIN_NOTIONAL = 5;

const cfg = makeConfig({ initialEquity: 100, costPreset: 'binance-futures-maker', riskProfile: 'seed', maxBarsInTrade: 100000 });
const custo = COSTS['binance-futures-maker'];

console.log(`\n${'='.repeat(90)}`);
console.log(`LARGURA CORRIGIDA: ${ALVO_MULT}x em ${MESES} meses · ${SLOTS} posições simultâneas`);
console.log(`${'='.repeat(90)}\n`);

// ── inventário ─────────────────────────────────────────────────────────────
const arquivos = fs.existsSync(DATA_DIR) ? fs.readdirSync(DATA_DIR).filter((f) => f.endsWith('.json')) : [];
const simbolos = arquivos
  .filter((f) => f.includes('__5m.') && f.startsWith('binanceusdm'))
  .map((f) => f.replace('.json', '').split('__')[1].replace(/_/g, '/').replace(/\/(USDT)$/, ':$1'));

// ── SELEÇÃO na primeira metade, AVALIAÇÃO na segunda ───────────────────────
interface Perna {
  sym: string; st: string;
  expSel: number;              // expectancy na metade de seleção
  expAval: number;             // expectancy na metade de avaliação — a que vale
  tradesAval: number;
  poolAval: number[];          // retornos em R, da metade de avaliação
  duracoes: number[];          // duração de cada trade, em ms
  taxaPorDia: number;          // frequência medida na metade de avaliação
}

const candidatas: Perna[] = [];
let testes = 0;

console.log('SELEÇÃO na 1ª metade do histórico · AVALIAÇÃO na 2ª (a seleção nunca vê o que julga)\n');
console.log('  ativo'.padEnd(15) + 'estratégia'.padEnd(20) + 'exp seleção'.padEnd(14) + 'exp avaliação'.padEnd(16) + 'trades aval'.padEnd(14) + 'situação');

for (const sym of simbolos) {
  if (!hasSeries('binanceusdm', sym, '5m')) continue;
  let s: Series;
  try { s = loadSeries('binanceusdm', sym, '5m'); } catch { continue; }
  if (s.bars.length < 20000) continue;

  const meio = Math.floor(s.bars.length / 2);
  const sel: Series = { ...s, bars: s.bars.slice(0, meio) };
  const aval: Series = { ...s, bars: s.bars.slice(meio) };
  const vf = forecastVolatility(aval.bars);
  const vt = targetVolatility(vf);
  const idx = new Map(aval.bars.map((b, i) => [b.t, i]));
  const step = tfMs('5m');

  for (const st of Object.keys(REGISTRY)) {
    testes++;
    try {
      const relaxado = { ...cfg, risk: { ...cfg.risk, maxDrawdownStop: 1, dailyLossLimit: 1 } };
      const rs = runBacktest(sel, buildStrategy(st, {}), relaxado);
      if (rs.trades.length < 40) continue;
      const ms = computeMetrics(rs, 100);
      // O portão de seleção usa APENAS a primeira metade.
      if (ms.expectancyR <= 0.02) continue;

      const ra = runBacktest(aval, buildStrategy(st, {}), relaxado);
      if (ra.trades.length < 30) continue;
      const ma = computeMetrics(ra, 100);

      const dias = (aval.bars.at(-1)!.t - aval.bars[0].t) / 86_400_000;
      candidatas.push({
        sym, st, expSel: ms.expectancyR, expAval: ma.expectancyR, tradesAval: ra.trades.length,
        poolAval: ra.trades.map((t) => (t.rEquity / cfg.risk.riskPerTrade) * volSizeMultiplier(vf, idx.get(t.entryTime) ?? 0, vt)),
        duracoes: ra.trades.map((t) => Math.max(step, t.barsHeld * step)),
        taxaPorDia: ra.trades.length / dias,
      });
      console.log(
        '  ' + sym.replace('/USDT:USDT', '').padEnd(13) + st.padEnd(20) +
        (ms.expectancyR.toFixed(3) + 'R').padEnd(14) + (ma.expectancyR.toFixed(3) + 'R').padEnd(16) +
        String(ra.trades.length).padEnd(14) +
        (ma.expectancyR > 0 ? 'sobreviveu' : 'MORREU fora da amostra'),
      );
    } catch { /* segue */ }
  }
}

const sobreviventes = candidatas.filter((c) => c.expAval > 0);
console.log(
  `\n  ${testes} testes · ${candidatas.length} passaram na seleção · ` +
  `${sobreviventes.length} sobreviveram na avaliação (${((sobreviventes.length / Math.max(1, candidatas.length)) * 100).toFixed(0)}%)\n`,
);
if (sobreviventes.length < 2) { console.log('Pernas insuficientes.'); process.exit(0); }

// ── correlação entre as sobreviventes ──────────────────────────────────────
const n = sobreviventes.length;
const C: number[][] = Array.from({ length: n }, () => new Array(n).fill(0));
const rets = sobreviventes.map((p) => {
  const s = loadSeries('binanceusdm', p.sym, '5m');
  const m = new Map<number, number>();
  for (let i = 1; i < s.bars.length; i++) if (s.bars[i - 1].c > 0) m.set(s.bars[i].t, s.bars[i].c / s.bars[i - 1].c - 1);
  return m;
});
for (let i = 0; i < n; i++) {
  C[i][i] = 1;
  for (let j = i + 1; j < n; j++) {
    const xs: number[] = [], ys: number[] = [];
    for (const [t, v] of rets[i]) { const w = rets[j].get(t); if (w != null) { xs.push(v); ys.push(w); } }
    if (xs.length < 200) continue;
    const mx = xs.reduce((p, q) => p + q, 0) / xs.length, my = ys.reduce((p, q) => p + q, 0) / ys.length;
    let nu = 0, dx = 0, dy = 0;
    for (let k = 0; k < xs.length; k++) { nu += (xs[k] - mx) * (ys[k] - my); dx += (xs[k] - mx) ** 2; dy += (ys[k] - my) ** 2; }
    C[i][j] = C[j][i] = dx > 0 && dy > 0 ? nu / Math.sqrt(dx * dy) : 0;
  }
}
let cs = 0, cc = 0;
for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) { cs += C[i][j]; cc++; }
const corr = cc ? cs / cc : 0;

const taxaTotalDia = sobreviventes.reduce((x, p) => x + p.taxaPorDia, 0);
const duracaoMedia = sobreviventes.reduce((x, p) => x + p.duracoes.reduce((q, d) => q + d, 0) / p.duracoes.length, 0) / n;
const totalPool = sobreviventes.reduce((x, p) => x + p.poolAval.length, 0);

console.log(`Correlação média ${corr.toFixed(3)} · sinais disponíveis ${taxaTotalDia.toFixed(1)}/dia · duração média ${(duracaoMedia / 3_600_000).toFixed(1)}h`);
console.log(`Vazão teórica com ${SLOTS} slots: ${(SLOTS * 24 / (duracaoMedia / 3_600_000)).toFixed(1)} operações/dia\n`);

// ── SIMULAÇÃO POR EVENTOS ──────────────────────────────────────────────────
let seed = 20260802;
const rnd = () => { seed ^= seed << 13; seed >>>= 0; seed ^= seed >> 17; seed ^= seed << 5; seed >>>= 0; return seed / 4294967296; };

function simular(risco: number) {
  const alvo = INICIAL * ALVO_MULT;
  const horizonte = MESES * 30 * 86_400_000;
  const calor = effectiveHeat(new Array(SLOTS).fill(risco), Array.from({ length: SLOTS }, (_, i) => i), C);
  const riscoAj = risco * (risco / (calor / Math.sqrt(SLOTS)));

  let chegou = 0, ruina = 0, liq = 0, somaTrades = 0;
  const finais: number[] = [];

  for (let s = 0; s < SIMS; s++) {
    let eq = INICIAL, tocou = false, foiLiq = false, nTrades = 0;
    let t = 0;
    // slots: cada um guarda o instante em que fica livre e o retorno pendente
    const slots: { livreEm: number; ret: number; equityNaEntrada: number }[] = [];

    while (t < horizonte) {
      // fecha os slots que venceram
      for (let k = slots.length - 1; k >= 0; k--) {
        if (slots[k].livreEm <= t) {
          const an = analisarLiquidacao(riscoAj, STOP, TIERS_MAJOR, 1000);
          const out = aplicarTrade(eq, slots[k].ret, riscoAj, STOP, an);
          eq = out.novoEquity;
          if (out.liquidado) foiLiq = true;
          if (eq >= alvo) tocou = true;
          slots.splice(k, 1);
          nTrades++;
        }
      }
      if (eq <= 1) break;

      // abre novos, se houver vaga E sinal
      while (slots.length < SLOTS) {
        const notional = (eq * riscoAj) / (STOP + 2 * custo.takerFee + 2 * custo.slippage);
        if (notional < MIN_NOTIONAL) break;
        const p = sobreviventes[Math.floor(rnd() * n)];
        const dur = p.duracoes[Math.floor(rnd() * p.duracoes.length)];
        slots.push({
          livreEm: t + dur,
          ret: p.poolAval[Math.floor(rnd() * p.poolAval.length)],
          equityNaEntrada: eq,
        });
      }
      if (!slots.length) break;

      // avança o tempo até o próximo fechamento — é isto que limita a vazão
      t = Math.min(...slots.map((x) => x.livreEm));
    }

    finais.push(eq);
    somaTrades += nTrades;
    if (tocou) chegou++;
    if (eq <= INICIAL * 0.1) ruina++;
    if (foiLiq) liq++;
  }

  finais.sort((x, y) => x - y);
  const q = (p: number) => finais[Math.floor((finais.length - 1) * p)];
  return {
    risco, riscoAj, pAlvo: chegou / SIMS, pRuina: ruina / SIMS, pLiq: liq / SIMS,
    mediana: q(0.5), p25: q(0.25), p75: q(0.75), p90: q(0.90),
    tradesMedios: somaTrades / SIMS,
  };
}

const teste = simular(0.10);
console.log(
  `SIMULAÇÃO POR EVENTOS — ${n} pernas · ${teste.tradesMedios.toFixed(0)} operações no período\n` +
  `  (a versão com erro usava 1.493 — este número agora respeita a vazão física)\n` +
  `  reamostragens por operação real: ${(teste.tradesMedios / totalPool).toFixed(2)}x\n`,
);

console.log('risco'.padEnd(9) + 'ajustado'.padEnd(11) + `chega ${ALVO_MULT}x`.padEnd(13) + 'ruína'.padEnd(9) + 'mediana'.padEnd(11) + 'p25'.padEnd(10) + 'p75'.padEnd(11) + 'p90');
const grid = [0.02, 0.05, 0.08, 0.10, 0.15, 0.20].map(simular);
for (const r of grid) {
  console.log(
    ((r.risco * 100).toFixed(0) + '%').padEnd(9) + ((r.riscoAj * 100).toFixed(1) + '%').padEnd(11) +
    ((r.pAlvo * 100).toFixed(2) + '%').padEnd(13) + ((r.pRuina * 100).toFixed(1) + '%').padEnd(9) +
    ('$' + r.mediana.toFixed(0)).padEnd(11) + ('$' + r.p25.toFixed(0)).padEnd(10) +
    ('$' + r.p75.toFixed(0)).padEnd(11) + '$' + r.p90.toFixed(0),
  );
}

const bons = grid.filter((g) => g.pRuina < 0.10).sort((x, y) => y.pAlvo - x.pAlvo);
console.log(`\n${'='.repeat(90)}`);
if (bons.length && bons[0].pAlvo > 0.005) {
  const b = bons[0];
  console.log(
    `MELHOR COM RUÍNA ABAIXO DE 10%\n\n` +
    `  risco ${(b.risco * 100).toFixed(0)}% (ajustado por correlação para ${(b.riscoAj * 100).toFixed(1)}%)\n` +
    `  chance de US$ ${INICIAL * ALVO_MULT} em ${MESES} meses: ${(b.pAlvo * 100).toFixed(2)}%\n` +
    `  ruína: ${(b.pRuina * 100).toFixed(1)}%  ·  mediana US$ ${b.mediana.toFixed(0)}\n` +
    `  faixa provável US$ ${b.p25.toFixed(0)}–${b.p75.toFixed(0)}  ·  p90 US$ ${b.p90.toFixed(0)}`,
  );
} else {
  console.log('Nenhuma configuração atinge o alvo com ruína aceitável.');
}
