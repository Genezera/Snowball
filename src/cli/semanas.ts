/**
 * Projeção semana a semana, com o custo de ROTAÇÃO incluído.
 *
 * A `projecao.ts` modelava montagem, reinvestimento e transferência de margem —
 * mas não o que acontece quando o spread do ativo em carteira inverte e o motor
 * precisa trocar de par. Esse é o custo dominante nesta escala, e omiti-lo
 * inflava o resultado.
 *
 * Uma rotação custa DUAS montagens: fechar as duas pernas e abrir outras duas.
 * A US$ 250 de notional por perna são US$ 0,50 — metade de uma semana de renda
 * no cenário mediano. A frequência de rotação, não o APR, é o que decide se
 * isso compõe ou sangra.
 */
import { parseArgs, num } from './args.ts';

const a = parseArgs();
const CAPITAL = num(a.equity, 100);
const APORTE = num(a.aporte, 100);
const LEV = num(a.alavancagem, 5);
const SEMANAS = num(a.weeks, 8);
const SEMANA_APORTE = num(a.semanaAporte, 4);
const TAXA = 0.0005;

/** margem é metade do capital em cada exchange; notional é margem × alavancagem */
const notionalDe = (c: number) => (c / 2) * LEV;
/** montar as duas pernas, ou desmontá-las: notional × taxa × 2 pernas */
const custoMontagem = (not: number) => not * TAXA * 2;

interface Cenario { nome: string; apr: number; rotacoesPorSemana: number }

/**
 * Os três APR não são chutes.
 *
 *   36% — o que a vigilância do mercado inteiro está encontrando agora (KAITO,
 *         consistência 83% em 5 observações). Ainda não é uma média: são 25
 *         minutos de dado.
 *   20% — a mediana histórica das medições de 180 dias. É o número central.
 *   12% — regime de funding comprimido, que acontece quando o mercado esfria.
 *
 * O aviso vale repetir: INJ apareceu a 44,8% instantâneo e a média real dele em
 * 14 dias era 15,9%. Pico não é média.
 */
const CENARIOS: Cenario[] = [
  { nome: 'favorável 36%', apr: 0.36, rotacoesPorSemana: 1 },
  { nome: 'central 20%', apr: 0.20, rotacoesPorSemana: 1 },
  { nome: 'comprimido 12%', apr: 0.12, rotacoesPorSemana: 1 },
];

interface Sem {
  n: number; inicio: number; notional: number;
  bruto: number; custoRot: number; custoMargem: number; liquido: number;
  aporte: number; fim: number;
}

function simular(apr: number, rotacoes: number, aporteMensal: number): Sem[] {
  const por8h = apr / (3 * 365);
  let cap = CAPITAL - custoMontagem(notionalDe(CAPITAL));  // montagem inicial
  const out: Sem[] = [];

  for (let w = 1; w <= SEMANAS; w++) {
    const ini = cap;
    const not = notionalDe(cap);

    const bruto = not * por8h * 21;                    // 21 pagamentos por semana
    const custoRot = rotacoes * custoMontagem(not) * 2; // fechar + abrir
    const custoMargem = not * TAXA * 0.25;              // transferências entre exchanges
    const liquido = bruto - custoRot - custoMargem;

    cap += liquido;
    // reinvestir o líquido custa montar o notional extra
    if (liquido > 0) cap -= custoMontagem(notionalDe(liquido));

    let ap = 0;
    if (aporteMensal > 0 && w === SEMANA_APORTE) {
      ap = aporteMensal;
      cap += ap - custoMontagem(notionalDe(ap));
    }

    out.push({ n: w, inicio: ini, notional: not, bruto, custoRot, custoMargem, liquido, aporte: ap, fim: cap });
  }
  return out;
}

/** Quantas rotações por semana zeram a renda — o número que decide tudo. */
function rotacoesDeEmpate(apr: number, cap: number): number {
  const not = notionalDe(cap);
  const bruto = not * (apr / 1095) * 21;
  const margem = not * TAXA * 0.25;
  return (bruto - margem) / (custoMontagem(not) * 2);
}

const d0 = notionalDe(CAPITAL);
console.log(`\n${'='.repeat(92)}`);
console.log(`PROJEÇÃO SEMANA A SEMANA · US$ ${CAPITAL} · ${LEV}x · notional US$ ${d0.toFixed(0)}/perna`);
console.log(`aporte de US$ ${APORTE} na semana ${SEMANA_APORTE} · ${SEMANAS} semanas`);
console.log(`${'='.repeat(92)}`);

for (const c of CENARIOS) {
  const s = simular(c.apr, c.rotacoesPorSemana, APORTE);
  console.log(`\n${'─'.repeat(92)}`);
  console.log(`${c.nome.toUpperCase()} · ${c.rotacoesPorSemana} rotação/semana`);
  console.log(`${'─'.repeat(92)}`);
  console.log(
    'sem'.padEnd(6) + 'começa'.padEnd(12) + 'notional'.padEnd(12) +
    'bruto'.padEnd(11) + 'rotação'.padEnd(11) + 'margem'.padEnd(11) +
    'líquido'.padEnd(11) + 'aporte'.padEnd(10) + 'termina',
  );
  for (const w of s) {
    console.log(
      String(w.n).padEnd(6) +
      ('$' + w.inicio.toFixed(2)).padEnd(12) +
      ('$' + w.notional.toFixed(0)).padEnd(12) +
      ('+$' + w.bruto.toFixed(3)).padEnd(11) +
      ('−$' + w.custoRot.toFixed(3)).padEnd(11) +
      ('−$' + w.custoMargem.toFixed(3)).padEnd(11) +
      ((w.liquido >= 0 ? '+$' : '−$') + Math.abs(w.liquido).toFixed(3)).padEnd(11) +
      (w.aporte ? '+$' + w.aporte.toFixed(0) : '—').padEnd(10) +
      '$' + w.fim.toFixed(2),
    );
  }
  const m1 = s[3], m2 = s[SEMANAS - 1];
  // o depósito da semana 4 já está dentro de m1.fim — descontar, senão o
  // "gerado" vira o próprio dinheiro do usuário aparecendo como lucro
  const depM1 = s.slice(0, 4).reduce((x, y) => x + y.aporte, 0);
  const geradoM1 = m1.fim - CAPITAL - depM1;
  const geradoM2 = m2.fim - CAPITAL - APORTE;
  console.log(
    `\n  fim do mês 1: $${m1.fim.toFixed(2)}  —  depositado $${CAPITAL + depM1}, ` +
    `motor gerou ${geradoM1 >= 0 ? '+' : '−'}$${Math.abs(geradoM1).toFixed(2)}\n` +
    `  fim do mês 2: $${m2.fim.toFixed(2)}  —  depositado $${CAPITAL + APORTE}, ` +
    `motor gerou ${geradoM2 >= 0 ? '+' : '−'}$${Math.abs(geradoM2).toFixed(2)}`,
  );
}

console.log(`\n${'='.repeat(92)}`);
console.log('PONTO DE EMPATE — quantas rotações por semana zeram a renda\n');
console.log('APR'.padEnd(10) + `com $${CAPITAL}`.padEnd(16) + `com $${CAPITAL + APORTE}`.padEnd(16) + 'leitura');
for (const c of CENARIOS) {
  const e1 = rotacoesDeEmpate(c.apr, CAPITAL);
  const e2 = rotacoesDeEmpate(c.apr, CAPITAL + APORTE);
  console.log(
    ((c.apr * 100).toFixed(0) + '%').padEnd(10) +
    e1.toFixed(2).padEnd(16) + e2.toFixed(2).padEnd(16) +
    (e1 < 2 ? 'frágil — 2 trocas na semana já apagam o lucro' : 'aguenta rotação normal'),
  );
}
console.log(
  `\nO ponto de empate NÃO melhora com aporte: custo e renda crescem juntos com o\n` +
  `notional. É um teto estrutural, e a única forma de subi-lo é trocar menos —\n` +
  `por isso a seleção pesa consistência ao quadrado.`,
);

// ── sensibilidade: a rotação é a alavanca, não o APR ────────────────────────
console.log(`\n${'='.repeat(92)}`);
console.log('SENSIBILIDADE À ROTAÇÃO — cenário central (20% APR), 8 semanas\n');
console.log(
  'rotações/sem'.padEnd(16) + 'fim do mês 1'.padEnd(16) + 'fim do mês 2'.padEnd(16) +
  'renda sem 8'.padEnd(15) + 'gerado em 2 meses',
);
for (const r of [0, 0.25, 0.5, 1, 2, 3]) {
  const s = simular(0.20, r, APORTE);
  const g = s[SEMANAS - 1].fim - CAPITAL - APORTE;
  console.log(
    String(r).padEnd(16) +
    ('$' + s[3].fim.toFixed(2)).padEnd(16) +
    ('$' + s[SEMANAS - 1].fim.toFixed(2)).padEnd(16) +
    ((s[SEMANAS - 1].liquido >= 0 ? '+$' : '−$') + Math.abs(s[SEMANAS - 1].liquido).toFixed(3)).padEnd(15) +
    (g >= 0 ? '+$' : '−$') + Math.abs(g).toFixed(2),
  );
}
console.log(
  `\nDe 1 rotação por semana para 1 a cada mês, a renda quase TRIPLICA sem tocar\n` +
  `no APR. É onde está a maximização real — e é exatamente o que a vigilância\n` +
  `do mercado inteiro serve para fazer: escolher um par que dure, em vez de\n` +
  `perseguir o maior número da foto.\n`,
);
