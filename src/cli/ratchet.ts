/**
 * POLÍTICA DE CATRACA — risco que desce sozinho conforme o capital sobe.
 *
 * Testa a ideia: "por que não começar agressivo, e assim que tocar a meta,
 * desalavancar para proteger o ganho?"
 *
 * Isto NÃO é prever o mercado. É reagir ao que já aconteceu, o que é uma coisa
 * completamente diferente e muito mais defensável. A política não precisa
 * adivinhar qual sequência de trades virá — ela só precisa mudar de marcha
 * quando o capital cruza um marco que já foi atingido.
 *
 * É também a resposta sistemática ao problema humano: o operador que dobra a
 * conta QUER continuar no mesmo risco, ou aumentar. A catraca desce o risco
 * automaticamente, sem consultar o entusiasmo de ninguém.
 *
 * Três políticas comparadas:
 *   plana        — risco fixo o tempo todo (o que a maioria faz)
 *   catraca      — risco cai ao cruzar marcos de capital, para cima
 *   catraca+piso — idem, mais um piso móvel: nunca devolver mais que X% do pico
 */
import { parseArgs, num } from './args.ts';

const a = parseArgs();
const tradesPerMonth = num(a.trades, 36);
const expectancyR = num(a.expectancy, 0.15);
const sdR = num(a.sd, 1.0);
const sims = num(a.sims, 50000);
const meses = num(a.months, 6);

let seed = 777001;
const rnd = () => { seed ^= seed << 13; seed >>>= 0; seed ^= seed >> 17; seed ^= seed << 5; seed >>>= 0; return seed / 4294967296; };
const gauss = () => Math.sqrt(-2 * Math.log(Math.max(1e-12, rnd()))) * Math.cos(2 * Math.PI * rnd());

/** Degraus da catraca: ao cruzar `acima`, o risco passa a ser `risco`. */
const DEGRAUS = [
  { acima: 0, risco: 0.20 },
  { acima: 200, risco: 0.12 },
  { acima: 350, risco: 0.07 },
  { acima: 500, risco: 0.04 },
  { acima: 1000, risco: 0.02 },
  { acima: 2500, risco: 0.01 },
];

function riscoNaCatraca(pico: number): number {
  let r = DEGRAUS[0].risco;
  for (const d of DEGRAUS) if (pico >= d.acima) r = d.risco;
  return r;
}

interface Resultado {
  nome: string;
  mediana: number;
  p5: number;
  p25: number;
  p75: number;
  p95: number;
  tocou500: number;
  terminou500: number;
  perdeu90: number;
  quebrou: number;
  acimaDoInicial: number;
}

function simular(politica: 'plana' | 'catraca' | 'catraca-piso', riscoFixo = 0.20): Resultado {
  const finais: number[] = [];
  let tocou = 0, terminou = 0, perdeu = 0, quebrou = 0, acima = 0;

  for (let s = 0; s < sims; s++) {
    let eq = 100;
    let pico = 100;
    let morreu = false;
    let tocou500 = false;

    for (let i = 0; i < tradesPerMonth * meses; i++) {
      // O risco é decidido pelo PICO já atingido, não pelo equity atual.
      // Assim uma queda temporária não faz a catraca voltar a ser agressiva.
      let risco = politica === 'plana' ? riscoFixo : riscoNaCatraca(pico);

      // Piso móvel: se já devolveu 25% do pico, corta o risco pela metade
      // até recuperar. É o freio que impede devolver o lucro inteiro.
      if (politica === 'catraca-piso' && eq < pico * 0.75) risco *= 0.5;

      const r = expectancyR + sdR * gauss();
      eq += Math.max(-eq, r * eq * risco);
      if (eq > pico) pico = eq;
      if (eq >= 500) tocou500 = true;
      if (eq <= 2) { morreu = true; break; }
    }

    finais.push(eq);
    if (tocou500) tocou++;
    if (eq >= 500) terminou++;
    if (eq <= 10) perdeu++;
    if (morreu) quebrou++;
    if (eq > 100) acima++;
  }

  finais.sort((x, y) => x - y);
  const q = (p: number) => finais[Math.floor((finais.length - 1) * p)];
  return {
    nome: politica,
    mediana: q(0.5), p5: q(0.05), p25: q(0.25), p75: q(0.75), p95: q(0.95),
    tocou500: tocou / sims, terminou500: terminou / sims,
    perdeu90: perdeu / sims, quebrou: quebrou / sims, acimaDoInicial: acima / sims,
  };
}

console.log(`\n${'='.repeat(80)}`);
console.log(`CATRACA — desalavancar ao atingir a meta, sistematicamente`);
console.log(`${'='.repeat(80)}`);
console.log(
  `\nEdge ${expectancyR}R · ${tradesPerMonth} trades/mês · ${meses} meses · ` +
  `${sims.toLocaleString('pt-BR')} simulações\n`,
);
console.log('Degraus da catraca:');
for (const d of DEGRAUS) console.log(`  acima de US$ ${String(d.acima).padStart(4)}  →  risco ${(d.risco * 100).toFixed(0)}%`);

const linhas: Resultado[] = [
  { ...simular('plana', 0.20), nome: 'plana 20% (agressiva fixa)' },
  { ...simular('plana', 0.05), nome: 'plana 5% (moderada fixa)' },
  { ...simular('catraca'), nome: 'CATRACA (20% → 2%)' },
  { ...simular('catraca-piso'), nome: 'CATRACA + piso móvel' },
];

console.log(`\n${'─'.repeat(80)}`);
console.log('política'.padEnd(28) + 'mediana'.padEnd(10) + 'p5'.padEnd(9) + 'p95'.padEnd(11) + 'tocou 500'.padEnd(12) + 'terminou 500'.padEnd(14) + 'perdeu 90%');
for (const r of linhas) {
  console.log(
    r.nome.padEnd(28) +
    ('$' + r.mediana.toFixed(0)).padEnd(10) +
    ('$' + r.p5.toFixed(0)).padEnd(9) +
    ('$' + r.p95.toFixed(0)).padEnd(11) +
    ((r.tocou500 * 100).toFixed(1) + '%').padEnd(12) +
    ((r.terminou500 * 100).toFixed(1) + '%').padEnd(14) +
    (r.perdeu90 * 100).toFixed(1) + '%',
  );
}

console.log(`\n${'─'.repeat(80)}`);
console.log('A pergunta que decide: quem TOCOU em 500 conseguiu SEGURAR?\n');
console.log('política'.padEnd(28) + 'tocou'.padEnd(10) + 'terminou'.padEnd(11) + 'taxa de retenção');
for (const r of linhas) {
  const ret = r.tocou500 > 0 ? r.terminou500 / r.tocou500 : 0;
  console.log(
    r.nome.padEnd(28) + ((r.tocou500 * 100).toFixed(1) + '%').padEnd(10) +
    ((r.terminou500 * 100).toFixed(1) + '%').padEnd(11) + (ret * 100).toFixed(0) + '%',
  );
}

// ── o teste que importa: e se o edge não existir? ───────────────────────────
console.log(`\n${'='.repeat(80)}`);
console.log('E SE O EDGE FOR ZERO? (o cenário que o paper trading vai decidir)\n');
const expSalvo = expectancyR;
(globalThis as any).__e = expSalvo;
console.log('política'.padEnd(28) + 'mediana'.padEnd(10) + 'perdeu 90%'.padEnd(13) + 'quebrou');
for (const [nome, pol, rf] of [
  ['plana 20%', 'plana', 0.20], ['plana 5%', 'plana', 0.05],
  ['CATRACA', 'catraca', 0.20], ['CATRACA + piso', 'catraca-piso', 0.20],
] as [string, 'plana' | 'catraca' | 'catraca-piso', number][]) {
  // re-simula com expectancy zero
  const finais: number[] = [];
  let perdeu = 0, quebrou = 0;
  for (let s = 0; s < sims; s++) {
    let eq = 100, pico = 100, morreu = false;
    for (let i = 0; i < tradesPerMonth * meses; i++) {
      let risco = pol === 'plana' ? rf : riscoNaCatraca(pico);
      if (pol === 'catraca-piso' && eq < pico * 0.75) risco *= 0.5;
      const r = 0 + sdR * gauss();
      eq += Math.max(-eq, r * eq * risco);
      if (eq > pico) pico = eq;
      if (eq <= 2) { morreu = true; break; }
    }
    finais.push(eq);
    if (eq <= 10) perdeu++;
    if (morreu) quebrou++;
  }
  finais.sort((x, y) => x - y);
  console.log(
    nome.padEnd(28) + ('$' + finais[Math.floor(finais.length / 2)].toFixed(0)).padEnd(10) +
    ((perdeu / sims * 100).toFixed(1) + '%').padEnd(13) + (quebrou / sims * 100).toFixed(1) + '%',
  );
}
