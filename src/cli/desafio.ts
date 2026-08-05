/**
 * O DESAFIO: US$ 200 → a viagem, sem aporte nenhum, só com lucro.
 *
 * Responde a pergunta que importa quando não há aporte para diluir o risco:
 * **com que agressividade é preciso operar, e qual a chance de quebrar antes
 * de chegar?**
 *
 * ── dois métodos, porque um modelo errado engana mais que nenhum modelo ────
 *
 * A primeira versão deste arquivo usava aposta BINÁRIA (ganha W×r com
 * probabilidade p, perde r com probabilidade 1−p) para todo cenário. Isso é
 * razoável para estratégia de stop/alvo fixo, mas MENTE para `ts-momentum`:
 * a saída dela é por TEMPO, o retorno é contínuo, e a distribuição real tem
 * cauda direita gorda — poucos trades grandes carregam o resultado, não uma
 * moeda com dois desfechos.
 *
 * Por isso o cenário de ações usa o modelo binário (é a aproximação certa lá:
 * saída por stop/alvo), e o de `ts-momentum` usa BOOTSTRAP dos trades reais
 * que ele produziu no universo validado (38 de 57 positivos, 67%, p=0,008 —
 * `npm run momentum`) — reamostra a distribuição que de fato aconteceu, sem
 * impor forma nenhuma. Ver `src/backtest/bootstrap.ts`.
 *
 * ── o piso de ruína, e por que não é zero ─────────────────────────────────
 *
 * Aposta fracionária nunca zera matematicamente. Mas existe um piso PRÁTICO:
 * abaixo de um certo capital, o tamanho mínimo de posição da exchange e o
 * custo fixo por operação tornam impossível continuar. Modelo isso como
 * ruína em US$ 40 — 20% do inicial.
 */
import { loadSeries } from '../data/store.ts';
import { buildStrategy } from '../strategies/index.ts';
import { runBacktest } from '../backtest/engine.ts';
import { makeConfig } from '../config.ts';
import { paraRMultiplos, simularBootstrap } from '../backtest/bootstrap.ts';
import { UNIVERSO_MOMENTUM, PARAMS_VALIDADOS, MAX_BARS_VALIDADO } from '../data/momentum-universe.ts';
import { parseArgs, num } from './args.ts';

const a = parseArgs();

const CAPITAL = num(a.capital, 200);
const ALVO = num(a.alvo, 2234);          // viagem econômica, ver `npm run meta`
const PISO_RUINA = num(a.piso, 40);
const CAMINHOS = num(a.caminhos, 20_000);
const HORIZONTE_MESES = num(a.horizonte, 60);
const RISCOS = [0.01, 0.02, 0.03, 0.05, 0.08, 0.10, 0.15, 0.20, 0.30];

console.log(`\n${'='.repeat(100)}`);
console.log(`DESAFIO · US$ ${CAPITAL} → US$ ${ALVO} sem aporte, só com lucro · ${(ALVO / CAPITAL).toFixed(1)}x`);
console.log(`${'='.repeat(100)}\n`);
console.log(`horizonte ${HORIZONTE_MESES} meses · ruína abaixo de US$ ${PISO_RUINA} · ${CAMINHOS.toLocaleString('pt-BR')} caminhos\n`);

function fmtTempo(m: number): string {
  return !isFinite(m) ? '—' : m < 24 ? `${m.toFixed(0)} meses` : `${(m / 12).toFixed(1)} anos`;
}

function imprimirTabela(rows: { risco: number; s: ReturnType<typeof simularBootstrap> }[]) {
  console.log(
    'risco/op'.padEnd(11) + 'chega na meta'.padEnd(16) + 'QUEBRA'.padEnd(11) +
    'ainda tentando'.padEnd(17) + 'tempo mediano'.padEnd(16) + 'capital mediano',
  );
  console.log('-'.repeat(100));
  for (const { risco, s } of rows) {
    console.log(
      ((risco * 100).toFixed(0) + '%').padEnd(11) +
      ((s.pSucesso * 100).toFixed(1) + '%').padEnd(16) +
      ((s.pRuina * 100).toFixed(1) + '%').padEnd(11) +
      ((s.pArrastando * 100).toFixed(1) + '%').padEnd(17) +
      fmtTempo(s.mesesMediano).padEnd(16) +
      'US$ ' + s.capitalMediano.toFixed(0),
    );
  }
  let melhor = rows[0];
  for (const row of rows) if (row.s.pSucesso > melhor.s.pSucesso) melhor = row;
  console.log(`\n  melhor chance de sucesso: risco ${(melhor.risco * 100).toFixed(0)}% por operação → ${(melhor.s.pSucesso * 100).toFixed(1)}%\n`);
}

// ── cenário 1: ts-momentum, BOOTSTRAP dos trades reais ────────────────────
console.log('─'.repeat(100));
console.log('CENÁRIO: ts-momentum (bootstrap de trades reais)\n');
console.log('carregando os 57 ativos do universo validado e rodando o backtest...');

const RISCO_BACKTEST = 0.005;
const cfg = makeConfig({ initialEquity: 10_000, costPreset: 'binance-futures-maker', riskProfile: 'seed', maxBarsInTrade: MAX_BARS_VALIDADO });
const rMultiplos: number[] = [];
for (const sym of UNIVERSO_MOMENTUM) {
  let series;
  try { series = loadSeries('binanceusdm', sym, '1d'); } catch { continue; }
  const res = runBacktest(series, buildStrategy('ts-momentum', PARAMS_VALIDADOS), cfg);
  rMultiplos.push(...paraRMultiplos(res.trades, RISCO_BACKTEST));
}
const OPS_POR_MES = num(a.opsPorMes, 20); // ~8 ativos em paralelo, ~30 trades/ano cada
const expectancy = rMultiplos.reduce((s, r) => s + r, 0) / rMultiplos.length;
console.log(`${rMultiplos.length} trades reais pooled · expectancy ${expectancy.toFixed(3)}R · ${OPS_POR_MES} op/mês assumidas\n`);

const linhasMomentum = RISCOS.map((risco) => ({
  risco,
  s: simularBootstrap({
    rMultiplos, capitalInicial: CAPITAL, alvo: ALVO, pisoRuina: PISO_RUINA,
    opsPorMes: OPS_POR_MES, horizonteMeses: HORIZONTE_MESES, riscoFracao: risco, caminhos: CAMINHOS,
  }),
}));
imprimirTabela(linhasMomentum);

// ── cenário 2: ações, modelo binário (saída por stop/alvo — a aproximação certa lá) ──
console.log('─'.repeat(100));
console.log('CENÁRIO: ações (walk-forward, modelo binário — saída por stop/alvo fixo)\n');
const E_ACOES = 0.066, POR_MES_ACOES = 12, W = 2;
const p = (E_ACOES + 1) / (W + 1);
console.log(`expectancy ${E_ACOES}R · ${POR_MES_ACOES} op/mês · payoff ${W}:1 · acerto implícito ${(p * 100).toFixed(1)}%\n`);

function criarRng(semente: number) {
  let s = semente >>> 0;
  return () => { s ^= s << 13; s >>>= 0; s ^= s >> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
}
function simularBinario(risco: number, semente = 12345) {
  const totalOps = Math.round(POR_MES_ACOES * HORIZONTE_MESES);
  const rng = criarRng(semente);
  let sucessos = 0, ruinas = 0;
  const mesesAteSucesso: number[] = [], finais: number[] = [];
  for (let c = 0; c < CAMINHOS; c++) {
    let v = CAPITAL, terminou = false;
    for (let i = 1; i <= totalOps; i++) {
      v += rng() < p ? v * risco * W : -v * risco;
      if (v >= ALVO) { sucessos++; mesesAteSucesso.push(i / POR_MES_ACOES); finais.push(v); terminou = true; break; }
      if (v <= PISO_RUINA) { ruinas++; finais.push(v); terminou = true; break; }
    }
    if (!terminou) finais.push(v);
  }
  mesesAteSucesso.sort((x, y) => x - y); finais.sort((x, y) => x - y);
  return {
    pSucesso: sucessos / CAMINHOS, pRuina: ruinas / CAMINHOS,
    pArrastando: (CAMINHOS - sucessos - ruinas) / CAMINHOS,
    mesesMediano: mesesAteSucesso.length ? mesesAteSucesso[Math.floor(mesesAteSucesso.length / 2)] : Infinity,
    capitalMediano: finais[Math.floor(finais.length / 2)],
  };
}
imprimirTabela(RISCOS.map((risco) => ({ risco, s: simularBinario(risco) })));

console.log('='.repeat(100));
console.log('COMO LER ISTO\n');
console.log('A coluna que decide não é "chega na meta" — é ela ao lado de "QUEBRA". Risco alto');
console.log('aumenta as duas ao mesmo tempo, e existe um ponto onde quebrar cresce mais rápido');
console.log('que chegar. "Ainda tentando" no fim do horizonte é capital preso sem ter chegado');
console.log('nem quebrado — o desfecho mais comum quando o risco é baixo demais para a meta.');
console.log();
console.log('O cenário ts-momentum usa os R-múltiplos REAIS de 7.634 trades, não uma forma');
console.log('assumida — a cauda direita gorda dele (poucos trades grandes) muda o resultado');
console.log('de forma que o modelo binário não capturaria.');
console.log('='.repeat(100) + '\n');
