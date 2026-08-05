/**
 * VALIDAÇÃO DE PARES COINTEGRADOS — descoberta + holdout cego.
 *
 * Mesmo protocolo do `ts-momentum` (npm run momentum): a grade de parâmetros
 * é buscada só na DESCOBERTA, e o HOLDOUT nunca participa do ajuste — testado
 * com o que a descoberta escolheu, sem reajuste por par.
 *
 * O par em si (quais dois ativos formar) é achado por `varrerPares` sobre a
 * METADE INICIAL de cada janela (formação); o backtest roda só na METADE
 * FINAL (o período de operação) — outra camada contra lookahead: o par não
 * pode ser escolhido olhando o período em que vai operar.
 *
 * NENHUMA ORDEM É ENVIADA. Backtest sobre dado histórico.
 */
import { loadSeries } from '../data/store.ts';
import { avaliarPar } from '../pairs/cointegracao.ts';
import { backtestPar, type ParametrosPar } from '../pairs/backtest.ts';
import { UNIVERSO_MOMENTUM, DESCOBERTA, HOLDOUT } from '../data/momentum-universe.ts';
import { parseArgs, num } from './args.ts';

const a = parseArgs();
const MAX_PARES_POR_CONJUNTO = num(a.maxPares, 20);

const GRADE: ParametrosPar[] = [];
for (const zEntrada of [1.5, 2.0, 2.5]) {
  for (const zSaida of [0.3, 0.5]) {
    for (const maxBarras of [15, 30]) {
      for (const janelaZ of [20, 30]) {
        GRADE.push({ zEntrada, zSaida, maxBarras, janelaZ, taxaTaker: 0.0005, slippage: 0.0003 });
      }
    }
  }
}

function carregarUniverso(symbols: string[]) {
  const out: Record<string, ReturnType<typeof loadSeries>['bars']> = {};
  for (const sym of symbols) {
    try { out[sym] = loadSeries('binanceusdm', sym, '1d').bars; } catch { /* sem dado */ }
  }
  return out;
}

function metricas(trades: { retorno: number }[]) {
  if (!trades.length) return { n: 0, expectancy: 0, winRate: 0 };
  const soma = trades.reduce((s, t) => s + t.retorno, 0);
  const ganhos = trades.filter((t) => t.retorno > 0).length;
  return { n: trades.length, expectancy: soma / trades.length, winRate: ganhos / trades.length };
}

/**
 * Acha os melhores pares na METADE de formação, testa na METADE de operação,
 * varrendo a grade de parâmetros — mas a ESCOLHA de parâmetro é feita pela
 * mesma metade de operação aqui (simplificação: sem walk-forward completo
 * dentro de cada conjunto, que seria caro com 30+27 ativos × grade × 2
 * metades). A defesa contra sobreajuste real é a separação DESCOBERTA/HOLDOUT
 * no nível de dataset inteiro, não dentro de cada metade.
 */
function rodarConjunto(symbols: string[], params: ParametrosPar, fracaoFormacao = 0.5) {
  const series = carregarUniverso(symbols);
  const nomes = Object.keys(series);
  if (nomes.length < 2) return { pares: [], trades: [] as ReturnType<typeof backtestPar> };

  const meio = Math.floor(Math.min(...nomes.map((n) => series[n].length)) * fracaoFormacao);
  const formacao: Record<string, typeof series[string]> = {};
  for (const nome of nomes) formacao[nome] = series[nome].slice(0, meio);

  const candidatos: ReturnType<typeof avaliarPar>[] = [];
  for (let i = 0; i < nomes.length; i++) {
    for (let j = i + 1; j < nomes.length; j++) {
      const c = avaliarPar(nomes[i], formacao[nomes[i]], nomes[j], formacao[nomes[j]]);
      if (c) candidatos.push(c);
    }
  }
  candidatos.sort((x, y) => x!.meiaVidaBarras - y!.meiaVidaBarras); // reverte mais rápido primeiro

  const top = candidatos.slice(0, MAX_PARES_POR_CONJUNTO).filter((c): c is NonNullable<typeof c> => !!c);
  const todosTrades: ReturnType<typeof backtestPar> = [];
  for (const c of top) {
    const opA = series[c.a].slice(meio);
    const opB = series[c.b].slice(meio);
    const trades = backtestPar(opA, opB, c.hedgeRatio, c.intercepto, params);
    todosTrades.push(...trades);
  }
  return { pares: top, trades: todosTrades };
}

console.log(`\n${'='.repeat(90)}`);
console.log('PARES COINTEGRADOS — descoberta + holdout cego, mercado-neutro');
console.log(`${'='.repeat(90)}\n`);
console.log('NENHUMA ORDEM É ENVIADA. Backtest sobre dado histórico.\n');
console.log(`buscando melhor conjunto de parâmetros na DESCOBERTA (${GRADE.length} combinações)...\n`);

let melhor = { params: GRADE[0], score: -Infinity, m: metricas([]) };
for (const params of GRADE) {
  const { trades } = rodarConjunto(DESCOBERTA, params);
  const m = metricas(trades);
  if (m.n < 10) continue;
  const score = m.expectancy * Math.sqrt(m.n); // pune expectancy alta com poucochíssimos trades
  if (score > melhor.score) melhor = { params, score, m };
}

console.log(`parâmetros escolhidos: ${JSON.stringify(melhor.params)}`);
console.log(`descoberta: ${melhor.m.n} trades · expectancy ${melhor.m.expectancy.toFixed(4)} · win rate ${(melhor.m.winRate * 100).toFixed(1)}%\n`);

console.log('─'.repeat(90));
console.log('HOLDOUT — mesmos parâmetros, ativos nunca vistos, sem reajuste\n');
const { trades: tradesHoldout } = rodarConjunto(HOLDOUT, melhor.params);
const mHoldout = metricas(tradesHoldout);
console.log(`holdout: ${mHoldout.n} trades · expectancy ${mHoldout.expectancy.toFixed(4)} · win rate ${(mHoldout.winRate * 100).toFixed(1)}%\n`);

console.log('='.repeat(90));
if (mHoldout.n < 10) {
  console.log('POUCOS TRADES NO HOLDOUT — sem base para veredito. Resultado inconclusivo, não positivo.');
} else if (mHoldout.expectancy > 0 && melhor.m.expectancy > 0) {
  console.log(`AMBOS POSITIVOS: descoberta ${melhor.m.expectancy.toFixed(4)} · holdout ${mHoldout.expectancy.toFixed(4)}`);
  console.log(mHoldout.expectancy >= melhor.m.expectancy * 0.3
    ? 'O holdout não desabou em relação à descoberta — sinal de vantagem real.'
    : 'O holdout é bem mais fraco que a descoberta — tratar com desconfiança, pode ser sobreajuste.');
} else {
  console.log('HOLDOUT NÃO CONFIRMA: expectancy negativa ou nula fora da amostra ajustada.');
  console.log('Veredito: NÃO passa no teste que este projeto exige antes de declarar "funciona".');
}
console.log(`${'='.repeat(90)}\n`);

// ── robustez ao ponto de corte formação/operação ───────────────────────────
console.log('─'.repeat(90));
console.log('ROBUSTEZ AO PONTO DE CORTE (descoberta, mesmos parâmetros, formação/operação variando)\n');
for (const frac of [0.4, 0.5, 0.6, 0.7]) {
  const { trades } = rodarConjunto(DESCOBERTA, melhor.params, frac);
  const m = metricas(trades);
  console.log(`formação ${(frac * 100).toFixed(0)}% · ${m.n} trades · expectancy ${m.expectancy.toFixed(4)} · win ${(m.winRate * 100).toFixed(1)}%`);
}
console.log(`\n${'='.repeat(90)}\n`);
