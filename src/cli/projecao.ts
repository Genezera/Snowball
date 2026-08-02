/**
 * Projeção para um horizonte qualquer, com marcos calculados e não fixos.
 *
 * Substitui o `caminho.ts`, que tinha índices de semana embutidos (26, 52) e
 * quebrava em horizontes menores.
 */
import { parseArgs, num, str } from './args.ts';

const a = parseArgs();
const CAPITAL = num(a.equity, 100);
const APORTE = num(a.aporte, 100);
const LEV = num(a.alavancagem, 5);
const TAXA = 0.0005;
const dataFim = str(a.ate, '2026-12-31');

const hoje = new Date('2026-08-02');
const fim = new Date(dataFim);
const dias = Math.round((fim.getTime() - hoje.getTime()) / 86_400_000);
const SEMANAS = num(a.weeks, Math.floor(dias / 7));

const notionalDe = (c: number) => (c / 2) * LEV;

const CENARIOS = [
  { nome: 'atual (44,8%)', apr: 0.448 },
  { nome: 'mediano (20%)', apr: 0.200 },
  { nome: 'conservador (12%)', apr: 0.120 },
];

interface Sem { n: number; inicio: number; notional: number; renda: number; aporte: number; fim: number }

function simular(apr: number, aporteMensal: number): Sem[] {
  const por8h = apr / (3 * 365);
  let cap = CAPITAL - notionalDe(CAPITAL) * TAXA * 2;
  const out: Sem[] = [];
  for (let w = 1; w <= SEMANAS; w++) {
    const ini = cap;
    const not = notionalDe(cap);
    const renda = not * por8h * 21;
    cap += renda;
    cap -= notionalDe(renda) * TAXA * 2;   // reinvestir
    cap -= not * TAXA * 0.25;              // transferências de margem
    let ap = 0;
    if (aporteMensal > 0 && w % 4 === 0) {
      ap = aporteMensal;
      cap += ap - notionalDe(ap) * TAXA * 2;
    }
    out.push({ n: w, inicio: ini, notional: not, renda, aporte: ap, fim: cap });
  }
  return out;
}

console.log(`\n${'='.repeat(86)}`);
console.log(`PROJEÇÃO — US$ ${CAPITAL} inicial · aporte US$ ${APORTE}/mês · ${LEV}x`);
console.log(`de 02/08/2026 até ${fim.toLocaleDateString('pt-BR')} · ${dias} dias · ${SEMANAS} semanas`);
console.log(`${'='.repeat(86)}\n`);

const marcos = [1, 4, 8, 12, 16, SEMANAS].filter((m, i, arr) => m <= SEMANAS && arr.indexOf(m) === i);

console.log('cenário'.padEnd(20) + marcos.map((m) => `sem ${m}`.padEnd(12)).join('') + 'renda/sem no fim');
for (const c of CENARIOS) {
  const s = simular(c.apr, APORTE);
  console.log(
    c.nome.padEnd(20) +
    marcos.map((m) => ('$' + s[m - 1].fim.toFixed(0)).padEnd(12)).join('') +
    '$' + s[SEMANAS - 1].renda.toFixed(2),
  );
}

const totalAportado = CAPITAL + APORTE * Math.floor(SEMANAS / 4);
console.log(`\n  Total depositado por você: US$ ${totalAportado}`);
for (const c of CENARIOS) {
  const s = simular(c.apr, APORTE);
  const gerado = s[SEMANAS - 1].fim - totalAportado;
  console.log(`  ${c.nome.padEnd(20)} o motor gerou US$ ${gerado.toFixed(2)}`);
}

// ── detalhe mês a mês, cenário mediano ────────────────────────────────────
console.log(`\n${'─'.repeat(86)}`);
console.log('MÊS A MÊS — cenário mediano\n');
const sm = simular(0.20, APORTE);
console.log('mês'.padEnd(7) + 'capital no fim'.padEnd(18) + 'renda da semana'.padEnd(19) + 'renda do mês'.padEnd(16) + 'notional/perna');
for (let mes = 1; mes * 4 <= SEMANAS; mes++) {
  const w = sm[mes * 4 - 1];
  const rendaMes = sm.slice((mes - 1) * 4, mes * 4).reduce((x, y) => x + y.renda, 0);
  console.log(
    String(mes).padEnd(7) + ('$' + w.fim.toFixed(2)).padEnd(18) +
    ('$' + w.renda.toFixed(2)).padEnd(19) + ('$' + rendaMes.toFixed(2)).padEnd(16) +
    '$' + w.notional.toFixed(0),
  );
}

console.log(
  `\n${'='.repeat(86)}\n` +
  `Em ${fim.toLocaleDateString('pt-BR')}, cenário mediano: US$ ${sm[SEMANAS - 1].fim.toFixed(2)}\n` +
  `  renda na última semana: US$ ${sm[SEMANAS - 1].renda.toFixed(2)}\n` +
  `  renda no último mês:    US$ ${sm.slice(-4).reduce((x, y) => x + y.renda, 0).toFixed(2)}`,
);
