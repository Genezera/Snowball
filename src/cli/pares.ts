/**
 * VALIDAÇÃO DE PARES COINTEGRADOS — descoberta + holdout cego.
 *
 * Mesmo protocolo do `ts-momentum` (npm run momentum): a grade de parâmetros
 * é buscada só na DESCOBERTA, e o HOLDOUT nunca participa do ajuste — testado
 * com o que a descoberta escolheu, sem reajuste por par.
 *
 * Usa `rodarPares` (src/pairs/validado.ts), que já aplica as duas correções
 * que derrubaram e depois resgataram este resultado: seleção sem sobreposição
 * de perna (`selecionarSemSobreposicao`) e filtro ex-ante de meia-vida
 * compatível com o prazo de saída. Ver o histórico completo no topo de
 * validado.ts e em docs/RESULTADOS.md, item 7.
 *
 * NENHUMA ORDEM É ENVIADA. Backtest sobre dado histórico.
 */
import { rodarPares, MAX_MEIA_VIDA_PARES } from '../pairs/validado.ts';
import type { ParametrosPar } from '../pairs/backtest.ts';
import { DESCOBERTA, HOLDOUT } from '../data/momentum-universe.ts';
import { parseArgs, num } from './args.ts';

const a = parseArgs();
const MAX_MEIA_VIDA = num(a.maxMeiaVida, MAX_MEIA_VIDA_PARES);

const GRADE: ParametrosPar[] = [];
for (const zEntrada of [1.5, 2.0, 2.5]) {
  for (const zSaida of [0.3, 0.5]) {
    for (const maxBarras of [15, 30]) {
      for (const janelaZ of [20, 30]) {
        for (const zStop of [Infinity, 3.5, 4.0]) {
          GRADE.push({ zEntrada, zSaida, maxBarras, janelaZ, taxaTaker: 0.0005, slippage: 0.0003, zStop });
        }
      }
    }
  }
}

function metricas(trades: { retorno: number }[]) {
  if (!trades.length) return { n: 0, expectancy: 0, winRate: 0 };
  const soma = trades.reduce((s, t) => s + t.retorno, 0);
  const ganhos = trades.filter((t) => t.retorno > 0).length;
  return { n: trades.length, expectancy: soma / trades.length, winRate: ganhos / trades.length };
}

console.log(`\n${'='.repeat(90)}`);
console.log('PARES COINTEGRADOS — descoberta + holdout cego, mercado-neutro');
console.log(`${'='.repeat(90)}\n`);
console.log('NENHUMA ORDEM É ENVIADA. Backtest sobre dado histórico.\n');
console.log(`sem sobreposição de perna · meia-vida máxima ${MAX_MEIA_VIDA} barras`);
console.log(`buscando melhor conjunto de parâmetros na DESCOBERTA (${GRADE.length} combinações)...\n`);

let melhor = { params: GRADE[0], score: -Infinity, m: metricas([]) };
for (const params of GRADE) {
  const { trades } = rodarPares(DESCOBERTA, 0.5, params, true, MAX_MEIA_VIDA);
  const m = metricas(trades);
  if (m.n < 10) continue;
  const score = m.expectancy * Math.sqrt(m.n); // pune expectancy alta com poucochíssimos trades
  if (score > melhor.score) melhor = { params, score, m };
}

console.log(`parâmetros escolhidos: ${JSON.stringify(melhor.params)}`);
console.log(`descoberta: ${melhor.m.n} trades · expectancy ${melhor.m.expectancy.toFixed(4)} · win rate ${(melhor.m.winRate * 100).toFixed(1)}%\n`);

console.log('─'.repeat(90));
console.log('HOLDOUT — mesmos parâmetros, ativos nunca vistos, sem reajuste\n');
const rHoldout = rodarPares(HOLDOUT, 0.5, melhor.params, true, MAX_MEIA_VIDA);
const mHoldout = metricas(rHoldout.trades);
console.log(`holdout: ${mHoldout.n} trades · expectancy ${mHoldout.expectancy.toFixed(4)} · win rate ${(mHoldout.winRate * 100).toFixed(1)}% · ${rHoldout.candidatos.length} pares\n`);

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
  const { trades } = rodarPares(DESCOBERTA, frac, melhor.params, true, MAX_MEIA_VIDA);
  const m = metricas(trades);
  console.log(`formação ${(frac * 100).toFixed(0)}% · ${m.n} trades · expectancy ${m.expectancy.toFixed(4)} · win ${(m.winRate * 100).toFixed(1)}%`);
}

// ── de onde vêm os trades bons e ruins ──────────────────────────────────────
console.log(`\n${'─'.repeat(90)}`);
console.log('SAÍDA POR MOTIVO (holdout) — o que sustenta e o que corrói o resultado\n');
const porMotivo: Record<string, { n: number; soma: number }> = {};
for (const t of rHoldout.trades) {
  const k = t.motivo;
  porMotivo[k] = porMotivo[k] || { n: 0, soma: 0 };
  porMotivo[k].n++; porMotivo[k].soma += t.retorno;
}
for (const [k, v] of Object.entries(porMotivo)) {
  console.log(`  ${k.padEnd(18)} n=${String(v.n).padEnd(6)} soma=${v.soma.toFixed(3).padEnd(10)} média=${(v.soma / v.n).toFixed(4)}`);
}
console.log(`\n${'='.repeat(90)}\n`);
