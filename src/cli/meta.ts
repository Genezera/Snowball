/**
 * A META do projeto, com conta visível em vez de intenção.
 *
 * Meta atual: 10 dias em Teerã, ida e volta, vivendo tranquilo.
 *
 * ── por que esta meta é diferente das anteriores ──────────────────────────
 *
 * O alvo do Audi exigia multiplicar o capital por ~900x. Nenhum retorno
 * sustentado do mundo real chega perto disso partindo de US$ 200 — no ritmo do
 * Medallion, o melhor fundo já construído, levava 20,8 anos.
 *
 * A viagem exige ~11x. Isso está dentro do que existe. A conta muda de
 * "impossível" para "quanto tempo, e com qual aporte" — que é uma pergunta
 * respondível.
 *
 * ── os custos, pesquisados em 08/2026, não estimados ──────────────────────
 *
 * PASSAGEM GRU → THR (ida e volta)
 *   melhor preço encontrado          R$ 7.407
 *   média dos últimos 12 meses       R$ 9.611
 *   outubro é 17% mais barato que a média anual
 *   comprando com 7+ semanas de antecedência: −41% em média
 *   Turkish Airlines costuma ser a rota mais barata
 *
 * DIÁRIA EM TEERÃ (fontes de orçamento de viagem)
 *   mochileiro          US$ 25–50/dia
 *   intermediário       US$ 60–100/dia   ← "viver tranquilamente"
 *   hostel a partir de US$ 10/noite; hotel simples US$ 20; refeição
 *   econômica US$ 5, restaurante médio US$ 15–20
 *
 * ── a restrição prática que muda o planejamento financeiro ────────────────
 *
 * CARTÃO INTERNACIONAL NÃO FUNCIONA NO IRÃ. Visa e Mastercard não operam lá
 * por causa das sanções, e caixas eletrônicos não aceitam cartão estrangeiro.
 * O dinheiro precisa entrar em ESPÉCIE (euro ou dólar), trocado nas casas de
 * câmbio locais ("sarafi"), ou carregado num cartão pré-pago iraniano de
 * turista.
 *
 * Isso não é detalhe de viagem — é requisito do plano. A meta não é "ter o
 * saldo na conta", é "ter em espécie, em euro, antes de embarcar". Um sistema
 * que rende bem mas deixa o dinheiro preso numa exchange não cumpre a meta.
 */
import { parseArgs, num, str } from './args.ts';

const a = parseArgs();

interface Meta {
  nome: string;
  brl: number;
  detalhe: [string, number][];
}

const USD_BRL = num(a.cambio, 5.5);

const METAS: Record<string, Meta> = {
  'teera-economico': {
    nome: 'Teerã · 10 dias · econômico',
    brl: 0,
    detalhe: [
      ['passagem GRU↔THR (melhor preço, outubro, 7+ semanas antes)', 7_407],
      ['10 dias a US$ 45/dia (hotel simples + refeições)', 45 * 10 * USD_BRL],
      ['visto, seguro e taxas', 800],
      ['reserva de 15% (câmbio, imprevisto)', 0],
    ],
  },
  'teera': {
    nome: 'Teerã · 10 dias · tranquilo',
    brl: 0,
    detalhe: [
      ['passagem GRU↔THR (média de 12 meses)', 8_500],
      ['10 dias a US$ 75/dia (hotel bom + restaurantes + passeios)', 75 * 10 * USD_BRL],
      ['visto, seguro e taxas', 900],
      ['reserva de 15% (câmbio, imprevisto)', 0],
    ],
  },
  rs3: { nome: 'Audi RS3', brl: 600_000, detalhe: [] },
  rs6: { nome: 'Audi RS6', brl: 1_000_000, detalhe: [] },
};

const chave = str(a.meta, 'teera').toLowerCase();
const meta = METAS[chave] ?? METAS.teera;

// fecha a conta das metas detalhadas (reserva é % do resto)
if (meta.detalhe.length) {
  const subtotal = meta.detalhe.slice(0, -1).reduce((s, [, v]) => s + v, 0);
  meta.detalhe[meta.detalhe.length - 1][1] = subtotal * 0.15;
  meta.brl = subtotal * 1.15;
}

const CAPITAL = num(a.capital, 200);
const alvoUSD = meta.brl / USD_BRL;

console.log(`\n${'='.repeat(92)}`);
console.log(`META · ${meta.nome}`);
console.log(`${'='.repeat(92)}\n`);

if (meta.detalhe.length) {
  console.log('composição do custo (pesquisado em 08/2026):\n');
  for (const [item, v] of meta.detalhe) {
    console.log('  ' + item.padEnd(58) + ('R$ ' + Math.round(v).toLocaleString('pt-BR')).padStart(12));
  }
  console.log('  ' + '-'.repeat(70));
  console.log('  ' + 'TOTAL'.padEnd(58) + ('R$ ' + Math.round(meta.brl).toLocaleString('pt-BR')).padStart(12));
  console.log('  ' + ''.padEnd(58) + ('US$ ' + Math.round(alvoUSD).toLocaleString('pt-BR')).padStart(12));
} else {
  console.log(`R$ ${meta.brl.toLocaleString('pt-BR')} ≈ US$ ${Math.round(alvoUSD).toLocaleString('pt-BR')}`);
}

console.log(`\ncapital atual: US$ ${CAPITAL} (R$ ${Math.round(CAPITAL * USD_BRL).toLocaleString('pt-BR')}) · falta ${(alvoUSD / CAPITAL).toFixed(1)}x\n`);

function mesesAte(capital: number, aporteMensal: number, cagr: number, alvo: number): number {
  const r = Math.pow(1 + cagr, 1 / 12) - 1;
  let v = capital;
  for (let n = 1; n <= 1200; n++) {
    v = v * (1 + r) + aporteMensal;
    if (v >= alvo) return n;
  }
  return Infinity;
}
const fmt = (m: number) => !isFinite(m) ? '>100 anos' : m < 24 ? `${m} meses` : `${(m / 12).toFixed(1)} anos`;

// ── só com o capital, sem aporte ──────────────────────────────────────────
console.log('─'.repeat(92));
console.log('SEM APORTE — só o capital atual rendendo\n');
console.log('ritmo'.padEnd(46) + 'CAGR'.padEnd(10) + 'tempo até a meta');
console.log('-'.repeat(92));
for (const [nome, cagr] of [
  ['S&P 500, comprar e segurar', 0.10],
  ['sistema sistemático bom', 0.20],
  ['Medallion — o melhor fundo da história', 0.39],
] as [string, number][]) {
  console.log(nome.padEnd(46) + ((cagr * 100).toFixed(0) + '%').padEnd(10) + fmt(mesesAte(CAPITAL, 0, cagr, alvoUSD)));
}

// ── com aporte ────────────────────────────────────────────────────────────
console.log(`\n${'─'.repeat(92)}`);
console.log('COM APORTE MENSAL — o termo que decide o prazo\n');
const APORTES_BRL = [300, 500, 800, 1200, 2000];
const CAGRS = [0, 0.10, 0.20];
console.log('aporte/mês'.padEnd(16) + CAGRS.map((c) => (c === 0 ? 'guardado (0%)' : `${(c * 100).toFixed(0)}% a.a.`).padEnd(18)).join(''));
console.log('-'.repeat(92));
for (const brl of APORTES_BRL) {
  const usd = brl / USD_BRL;
  console.log(
    (`R$ ${brl}`).padEnd(16) +
    CAGRS.map((c) => fmt(mesesAte(CAPITAL, usd, c, alvoUSD)).padEnd(18)).join(''),
  );
}

// ── o que o sistema realmente adiciona ────────────────────────────────────
console.log(`\n${'─'.repeat(92)}`);
console.log('O QUE O SISTEMA DE TRADING ADICIONA, EM MESES ECONOMIZADOS\n');
console.log('aporte/mês'.padEnd(16) + 'só guardando'.padEnd(18) + 'com 20% a.a.'.padEnd(18) + 'ganho');
console.log('-'.repeat(92));
for (const brl of APORTES_BRL) {
  const usd = brl / USD_BRL;
  const semSistema = mesesAte(CAPITAL, usd, 0, alvoUSD);
  const comSistema = mesesAte(CAPITAL, usd, 0.20, alvoUSD);
  const ganho = semSistema - comSistema;
  console.log(
    (`R$ ${brl}`).padEnd(16) + fmt(semSistema).padEnd(18) + fmt(comSistema).padEnd(18) +
    (ganho > 0 ? `${ganho} ${ganho === 1 ? 'mês' : 'meses'} antes` : 'sem diferença'),
  );
}

console.log(`\n${'='.repeat(92)}`);
console.log('A LEITURA HONESTA\n');
const so200 = mesesAte(CAPITAL, 0, 0.20, alvoUSD);
console.log(`Esta meta é alcançável — diferente do Audi, ela cabe no que existe de retorno real.`);
console.log();
console.log(`Mas o capital de US$ ${CAPITAL} sozinho, mesmo a 20% ao ano, leva ${fmt(so200)}.`);
console.log(`O que decide o prazo continua sendo o aporte: guardar R$ 800/mês chega em`);
console.log(`${fmt(mesesAte(CAPITAL, 800 / USD_BRL, 0, alvoUSD))} sem trading nenhum, e em ${fmt(mesesAte(CAPITAL, 800 / USD_BRL, 0.20, alvoUSD))} com um sistema de 20% ao ano.`);
console.log();
console.log('O papel do sistema não é gerar a viagem. É encurtar o prazo e não destruir');
console.log('o que foi aportado. Um sistema que perde 30% num mês ruim atrasa a viagem');
console.log('mais do que qualquer sequência boa adianta.');
console.log();
console.log('LEMBRETE OPERACIONAL: cartão internacional não funciona no Irã. O dinheiro');
console.log('precisa sair em espécie (euro) antes de embarcar — planejar o saque junto');
console.log('com o prazo, não depois.');
console.log(`${'='.repeat(92)}\n`);
