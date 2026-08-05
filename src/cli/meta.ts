/**
 * A META: um Audi RS3 ou RS6.
 *
 * Este arquivo existe para que o objetivo tenha uma conta visível em vez de uma
 * intenção. Ele não promete nada — pega o alvo, pega o que o projeto MEDIU, e
 * responde quanto tempo leva em cada cenário.
 *
 * ── as referências, todas externas e verificáveis ─────────────────────────
 *
 *   S&P 500, longo prazo                    ~10% ao ano
 *   Citadel (um dos melhores do mundo)      ~20% bruto
 *   Medallion / Renaissance                  39% líquido, 62% bruto
 *
 * O Medallion é o teto histórico da atividade: o melhor fundo já construído,
 * com os melhores matemáticos, dados e infraestrutura do mundo, fechado a
 * investidores externos desde 1993. Nada acima disso existe de forma
 * sustentada, e usar um número maior num plano é planejar sobre ficção.
 *
 * ── o que este projeto mediu ──────────────────────────────────────────────
 *
 * Depois de testar arbitragem de funding (0 de 341 ciclos), captura de
 * liquidação (0 operações no backtest), direcional em cripto (3 aprovados em
 * 11 ativos) e direcional em ações (3 positivos em 20 ativos independentes),
 * a melhor expectancy validada foi da ordem de 0,1R com ~4 operações por mês
 * por ativo. Ver docs/O-QUE-FALHOU.md.
 *
 * ── a conta que decide ────────────────────────────────────────────────────
 *
 * Com aporte mensal A, capital inicial C e retorno mensal r, o capital em n
 * meses é:
 *
 *   V(n) = C·(1+r)^n + A·[((1+r)^n − 1)/r]
 *
 * O segundo termo domina quando C é pequeno. É por isso que, partindo de
 * US$ 200, o aporte decide o prazo e o retorno decide a margem — e não o
 * contrário, que é como a intuição costuma tratar.
 */
import { parseArgs, num, str } from './args.ts';

const a = parseArgs();

/** Preço no Brasil, com imposto de importação — a ordem de grandeza que importa. */
const CARROS: Record<string, { nome: string; brl: number }> = {
  rs3: { nome: 'Audi RS3', brl: 600_000 },
  rs6: { nome: 'Audi RS6', brl: 1_000_000 },
};

const alvoChave = str(a.carro, 'rs6').toLowerCase();
const carro = CARROS[alvoChave] ?? CARROS.rs6;
const USD_BRL = num(a.cambio, 5.5);
const CAPITAL = num(a.capital, 200);
const alvoUSD = carro.brl / USD_BRL;

console.log(`\n${'='.repeat(92)}`);
console.log(`META · ${carro.nome} · R$ ${carro.brl.toLocaleString('pt-BR')} ≈ US$ ${Math.round(alvoUSD).toLocaleString('pt-BR')} (câmbio ${USD_BRL})`);
console.log(`${'='.repeat(92)}\n`);
console.log(`capital atual: US$ ${CAPITAL} · fator necessário: ${(alvoUSD / CAPITAL).toFixed(0)}x\n`);

/** Meses até V(n) ≥ alvo. Devolve Infinity se não converge em 100 anos. */
function mesesAte(capital: number, aporteMensal: number, cagr: number, alvo: number): number {
  const r = Math.pow(1 + cagr, 1 / 12) - 1;
  let v = capital;
  for (let n = 1; n <= 1200; n++) {
    v = v * (1 + r) + aporteMensal;
    if (v >= alvo) return n;
  }
  return Infinity;
}

const fmt = (m: number) => {
  if (!isFinite(m)) return 'nunca (>100 anos)';
  const anos = m / 12;
  return anos >= 1 ? `${anos.toFixed(1)} anos` : `${m} meses`;
};

// ── Parte 1: sem aporte ───────────────────────────────────────────────────
console.log('─'.repeat(92));
console.log('PARTE 1 — só com o capital atual, sem aporte nenhum\n');
console.log('cenário'.padEnd(42) + 'CAGR'.padEnd(10) + 'tempo até a meta');
console.log('-'.repeat(92));
const CENARIOS: [string, number][] = [
  ['S&P 500 (só comprar e segurar)', 0.10],
  ['bom sistema sistemático', 0.20],
  ['excepcional, sustentado por anos', 0.50],
  ['Medallion — o melhor da história', 0.39],
  ['dobrar todo ano (não existe sustentado)', 1.00],
];
for (const [nome, cagr] of CENARIOS.sort((x, y) => x[1] - y[1])) {
  console.log(nome.padEnd(42) + ((cagr * 100).toFixed(0) + '%').padEnd(10) + fmt(mesesAte(CAPITAL, 0, cagr, alvoUSD)));
}

// ── Parte 2: com aporte, que é onde a conta muda ──────────────────────────
console.log(`\n${'─'.repeat(92)}`);
console.log('PARTE 2 — com aporte mensal, que é o termo que realmente decide\n');
const APORTES = [100, 300, 500, 1000, 2000];
const CAGRS = [0.10, 0.20, 0.39];
console.log('aporte/mês'.padEnd(14) + CAGRS.map((c) => `${(c * 100).toFixed(0)}% a.a.`.padEnd(16)).join(''));
console.log('-'.repeat(92));
for (const ap of APORTES) {
  console.log(
    (`US$ ${ap}`).padEnd(14) +
    CAGRS.map((c) => fmt(mesesAte(CAPITAL, ap, c, alvoUSD)).padEnd(16)).join(''),
  );
}

// ── Parte 3: o que o retorno realmente compra ─────────────────────────────
console.log(`\n${'─'.repeat(92)}`);
console.log('PARTE 3 — o que cada peça contribui, no mesmo prazo\n');
const PRAZO = num(a.anos, 10) * 12;
console.log(`em ${PRAZO / 12} anos, partindo de US$ ${CAPITAL}:\n`);
console.log('aporte/mês'.padEnd(14) + 'total aportado'.padEnd(18) + CAGRS.map((c) => `${(c * 100).toFixed(0)}% a.a.`.padEnd(16)).join(''));
console.log('-'.repeat(92));
for (const ap of APORTES) {
  const linha = CAGRS.map((c) => {
    const r = Math.pow(1 + c, 1 / 12) - 1;
    let v = CAPITAL;
    for (let n = 0; n < PRAZO; n++) v = v * (1 + r) + ap;
    return (`US$ ${Math.round(v).toLocaleString('pt-BR')}`).padEnd(16);
  }).join('');
  console.log((`US$ ${ap}`).padEnd(14) + (`US$ ${(ap * PRAZO).toLocaleString('pt-BR')}`).padEnd(18) + linha);
}

console.log(`\n${'='.repeat(92)}`);
console.log('A LEITURA HONESTA\n');
const semAporte39 = mesesAte(CAPITAL, 0, 0.39, alvoUSD);
console.log(`Partindo de US$ ${CAPITAL} sem aporte, no ritmo do MELHOR FUNDO DA HISTÓRIA,`);
console.log(`a meta leva ${fmt(semAporte39)}. Não é pessimismo — é o teto da atividade.`);
console.log();
console.log('O que muda o prazo de verdade é o aporte. O que o sistema de trading precisa');
console.log('fazer não é multiplicar: é NÃO PERDER o que entra, e adicionar alguns pontos');
console.log('percentuais por ano em cima. Um sistema que rende 20% ao ano sobre aportes');
console.log('consistentes chega; um que promete 300% ao ano quebra antes do primeiro ano.');
console.log(`${'='.repeat(92)}\n`);
