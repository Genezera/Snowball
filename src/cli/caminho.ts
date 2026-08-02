/**
 * O caminho semana a semana, com aportes mensais.
 *
 * Três cenários de spread, porque o spread NÃO é constante — ele abre e fecha
 * conforme o desequilíbrio entre comprados e vendidos em cada exchange:
 *
 *   atual       o que o motor pegou agora (INJ, 44,8% APR). É o topo da
 *               varredura no momento, e topo não se sustenta indefinidamente.
 *   mediano     a mediana dos spreads encontrados na varredura. É o que se
 *               espera de um motor que roda o tempo todo trocando de ativo.
 *   conservador o nível dos majors (BTC, DOGE). É o piso do que existe.
 *
 * A estrutura: notional por perna = 2,5 × capital (metade em cada perna,
 * alavancada 5x). O retorno sobre o capital é, portanto, 2,5 × o APR do spread.
 */
import { parseArgs, num } from './args.ts';

const a = parseArgs();
const CAPITAL = num(a.equity, 100);
const APORTE = num(a.aporte, 100);
const SEMANAS = num(a.weeks, 52);
const LEV = 5;
const TAXA_PERP = 0.0005;

/** notional por perna = margem × alavancagem = (capital/2) × 5 */
const notionalDe = (capital: number) => (capital / 2) * LEV;

interface Cenario { nome: string; aprSpread: number; nota: string }
const CENARIOS: Cenario[] = [
  { nome: 'atual', aprSpread: 0.448, nota: 'INJ agora — topo da varredura' },
  { nome: 'mediano', aprSpread: 0.200, nota: 'mediana dos spreads encontrados' },
  { nome: 'conservador', aprSpread: 0.120, nota: 'nível dos majors (BTC, DOGE)' },
];

interface Semana {
  n: number; capitalInicio: number; notional: number; renda: number;
  aporte: number; capitalFim: number; acumulado: number;
}

function simular(aprSpread: number, comAporte: boolean): Semana[] {
  const spreadPor8h = aprSpread / (3 * 365);
  let capital = CAPITAL;
  // custo de montagem inicial
  capital -= notionalDe(capital) * TAXA_PERP * 2;
  let aportado = CAPITAL;
  const saida: Semana[] = [];

  for (let w = 1; w <= SEMANAS; w++) {
    const inicio = capital;
    const notional = notionalDe(capital);
    const renda = notional * spreadPor8h * 21;
    capital += renda;

    // custo de reinvestir o lucro em notional novo
    capital -= notionalDe(renda) * TAXA_PERP * 2;
    // transferências de margem: ~1 por semana a 5x
    capital -= notional * TAXA_PERP * 0.25;

    let aporte = 0;
    if (comAporte && w % 4 === 0) {
      aporte = APORTE;
      capital += aporte;
      aportado += aporte;
      // montar o notional do aporte novo
      capital -= notionalDe(aporte) * TAXA_PERP * 2;
    }

    saida.push({
      n: w, capitalInicio: inicio, notional, renda, aporte,
      capitalFim: capital, acumulado: capital - aportado,
    });
  }
  return saida;
}

console.log(`\n${'='.repeat(84)}`);
console.log(`O CAMINHO — US$ ${CAPITAL} inicial · ${LEV}x · notional 2,5× o capital`);
console.log(`${'='.repeat(84)}\n`);

// ── as 8 primeiras semanas, sem aporte ────────────────────────────────────
console.log('PRIMEIRAS 8 SEMANAS (sem aporte, cenário atual)\n');
const s0 = simular(CENARIOS[0].aprSpread, false);
console.log('semana'.padEnd(9) + 'começa com'.padEnd(14) + 'notional/perna'.padEnd(17) + 'renda'.padEnd(11) + 'termina com');
for (const w of s0.slice(0, 8)) {
  console.log(
    String(w.n).padEnd(9) + ('$' + w.capitalInicio.toFixed(2)).padEnd(14) +
    ('$' + w.notional.toFixed(2)).padEnd(17) +
    ('+$' + w.renda.toFixed(3)).padEnd(11) + '$' + w.capitalFim.toFixed(2),
  );
}

// ── os três cenários, sem aporte ──────────────────────────────────────────
console.log(`\n${'─'.repeat(84)}`);
console.log('SEM APORTE — só os US$ 100 iniciais\n');
console.log('cenário'.padEnd(15) + 'sem 1'.padEnd(11) + 'sem 4'.padEnd(11) + 'sem 13'.padEnd(11) + 'sem 26'.padEnd(11) + 'sem 52'.padEnd(11) + 'renda/sem no fim');
for (const c of CENARIOS) {
  const s = simular(c.aprSpread, false);
  const m = (n: number) => '$' + s[n - 1].capitalFim.toFixed(2);
  console.log(
    c.nome.padEnd(15) + m(1).padEnd(11) + m(4).padEnd(11) + m(13).padEnd(11) +
    m(26).padEnd(11) + m(52).padEnd(11) + '$' + s[51].renda.toFixed(3),
  );
}

// ── com aporte mensal ─────────────────────────────────────────────────────
console.log(`\n${'─'.repeat(84)}`);
console.log(`COM APORTE DE US$ ${APORTE} A CADA 4 SEMANAS\n`);
console.log('cenário'.padEnd(15) + 'sem 4'.padEnd(11) + 'sem 13'.padEnd(11) + 'sem 26'.padEnd(11) + 'sem 52'.padEnd(12) + 'só aportes'.padEnd(13) + 'o motor gerou');
for (const c of CENARIOS) {
  const s = simular(c.aprSpread, true);
  const m = (n: number) => '$' + s[n - 1].capitalFim.toFixed(2);
  const aportadoTotal = CAPITAL + APORTE * Math.floor(52 / 4);
  console.log(
    c.nome.padEnd(15) + m(4).padEnd(11) + m(13).padEnd(11) + m(26).padEnd(11) +
    m(52).padEnd(12) + ('$' + aportadoTotal).padEnd(13) + '+$' + s[51].acumulado.toFixed(2),
  );
}

// ── o mês 1 em detalhe ────────────────────────────────────────────────────
console.log(`\n${'─'.repeat(84)}`);
console.log('O PRIMEIRO MÊS, SEMANA A SEMANA (cenário mediano, com aporte na semana 4)\n');
const sm = simular(CENARIOS[1].aprSpread, true);
console.log('semana'.padEnd(9) + 'começa'.padEnd(12) + 'renda'.padEnd(11) + 'aporte'.padEnd(10) + 'termina'.padEnd(12) + 'notional');
for (const w of sm.slice(0, 5)) {
  console.log(
    String(w.n).padEnd(9) + ('$' + w.capitalInicio.toFixed(2)).padEnd(12) +
    ('+$' + w.renda.toFixed(3)).padEnd(11) +
    (w.aporte ? '+$' + w.aporte : '—').padEnd(10) +
    ('$' + w.capitalFim.toFixed(2)).padEnd(12) + '$' + w.notional.toFixed(0),
  );
}

console.log(`\n${'='.repeat(84)}`);
const fim = simular(CENARIOS[1].aprSpread, true);
console.log(
  `RESUMO — cenário mediano, aportando US$ ${APORTE}/mês\n\n` +
  `  fim do mês 1     US$ ${fim[3].capitalFim.toFixed(2)}\n` +
  `  fim do mês 3     US$ ${fim[12].capitalFim.toFixed(2)}\n` +
  `  fim do mês 6     US$ ${fim[25].capitalFim.toFixed(2)}\n` +
  `  fim do ano       US$ ${fim[51].capitalFim.toFixed(2)}\n\n` +
  `  Você terá depositado US$ ${CAPITAL + APORTE * 13}.\n` +
  `  O motor gerou US$ ${fim[51].acumulado.toFixed(2)} em cima disso.\n` +
  `  Renda na última semana: US$ ${fim[51].renda.toFixed(3)} (contra US$ ${fim[0].renda.toFixed(3)} na primeira).`,
);

console.log(
  `\n  RESSALVA: o spread não é constante. O cenário "atual" usa o INJ a 44,8%\n` +
  `  que o motor pegou agora, e topo de varredura não se sustenta — quando o\n` +
  `  desequilíbrio entre exchanges se corrige, o spread fecha. O motor troca de\n` +
  `  ativo quando isso acontece, e é por isso que o cenário mediano é o mais\n` +
  `  próximo do que se deve esperar.`,
);
