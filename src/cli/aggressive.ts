/**
 * Teste da hipótese "US$ 100 viram US$ 500 em um mês".
 *
 * Isto ACONTECE — não é mentira. A pergunta que este arquivo responde é: com
 * que frequência, e o que mais acontece nos outros caminhos?
 *
 * O método: pegar a expectancy MEDIDA do sistema (0,15R, que já é otimista por
 * não ter passado por paper trading) e aumentar o risco por trade até que
 * quadruplicar em um mês se torne possível. Depois olhar a distribuição
 * inteira, não só o ramo bonito.
 *
 * Nenhuma mágica é subtraída: o edge usado aqui é o melhor que este projeto
 * já mediu. O que muda é só o tamanho da aposta.
 */
import { parseArgs, num } from './args.ts';

const a = parseArgs();
const tradesPerMonth = num(a.trades, 36);
const expectancyR = num(a.expectancy, 0.15);
const sdR = num(a.sd, 1.0);
const sims = num(a.sims, 50000);

let seed = 20260801;
const rnd = () => { seed ^= seed << 13; seed >>>= 0; seed ^= seed >> 17; seed ^= seed << 5; seed >>>= 0; return seed / 4294967296; };
const gauss = () => Math.sqrt(-2 * Math.log(Math.max(1e-12, rnd()))) * Math.cos(2 * Math.PI * rnd());

interface Row {
  risco: number;
  p500: number;
  p1000: number;
  pDobra: number;
  pPerde90: number;
  pQuebra: number;
  mediana: number;
  media: number;
}

function simulate(riskPerTrade: number, months = 1): Row {
  let hit500 = 0, hit1000 = 0, dobrou = 0, perdeu90 = 0, quebrou = 0;
  const finais: number[] = [];

  for (let s = 0; s < sims; s++) {
    let eq = 100;
    let maxEq = 100;
    let morreu = false;
    const n = tradesPerMonth * months;

    for (let i = 0; i < n; i++) {
      const r = expectancyR + sdR * gauss();
      // O tamanho da perda é limitado ao capital: não dá para perder mais que
      // se tem. Com risco alto, um único trade ruim leva quase tudo.
      eq += Math.max(-eq, r * eq * riskPerTrade);
      if (eq > maxEq) maxEq = eq;
      if (eq <= 100 * 0.02) { morreu = true; break; }
    }
    if (maxEq >= 500) hit500++;
    if (maxEq >= 1000) hit1000++;
    if (maxEq >= 200) dobrou++;
    if (eq <= 10) perdeu90++;
    if (morreu) quebrou++;
    finais.push(eq);
  }

  finais.sort((x, y) => x - y);
  return {
    risco: riskPerTrade,
    p500: hit500 / sims, p1000: hit1000 / sims, pDobra: dobrou / sims,
    pPerde90: perdeu90 / sims, pQuebra: quebrou / sims,
    mediana: finais[Math.floor(finais.length / 2)],
    media: finais.reduce((x, y) => x + y, 0) / finais.length,
  };
}

console.log(`\n${'='.repeat(78)}`);
console.log(`TESTE: "US$ 100 viram US$ 500 em um mês"`);
console.log(`${'='.repeat(78)}`);
console.log(
  `\nEdge usado: ${expectancyR}R por trade — o MELHOR que este projeto já mediu,\n` +
  `e ainda otimista porque nunca passou por paper trading.\n` +
  `${tradesPerMonth} trades/mês · ${sims.toLocaleString('pt-BR')} simulações por linha\n`,
);

console.log('risco/trade'.padEnd(14) + 'chega $500'.padEnd(13) + 'chega $1000'.padEnd(14) + 'dobra'.padEnd(10) + 'perde 90%'.padEnd(12) + 'quebra'.padEnd(10) + 'mediana');
const riscos = [0.005, 0.02, 0.05, 0.10, 0.20, 0.35, 0.50, 0.75, 1.00];
const rows: Row[] = [];
for (const r of riscos) {
  const row = simulate(r);
  rows.push(row);
  console.log(
    ((r * 100).toFixed(1) + '%').padEnd(14) +
    ((row.p500 * 100).toFixed(1) + '%').padEnd(13) +
    ((row.p1000 * 100).toFixed(1) + '%').padEnd(14) +
    ((row.pDobra * 100).toFixed(1) + '%').padEnd(10) +
    ((row.pPerde90 * 100).toFixed(1) + '%').padEnd(12) +
    ((row.pQuebra * 100).toFixed(1) + '%').padEnd(10) +
    '$' + row.mediana.toFixed(0),
  );
}

// A pergunta central: no risco onde $500 fica plausível, o que mais acontece?
const alvo = rows.reduce((best, r) => (Math.abs(r.p500 - 0.25) < Math.abs(best.p500 - 0.25) ? r : best));
console.log(`\n${'─'.repeat(78)}`);
console.log(
  `\nNo risco de ${(alvo.risco * 100).toFixed(0)}% por trade, a chance de chegar a US$ 500 num mês é ` +
  `${(alvo.p500 * 100).toFixed(0)}%.\n` +
  `Nesse MESMO cenário:\n` +
  `  · ${(alvo.pPerde90 * 100).toFixed(0)}% das vezes você perde 90% ou mais\n` +
  `  · ${(alvo.pQuebra * 100).toFixed(0)}% das vezes a conta é destruída antes do fim do mês\n` +
  `  · o resultado MEDIANO é US$ ${alvo.mediana.toFixed(0)}\n`,
);

console.log(
  `A média é puxada por poucos caminhos extremos — é por isso que a MEDIANA\n` +
  `importa mais. Metade das pessoas fica abaixo dela.\n`,
);

// Repetição: o mesmo risco sustentado por 6 meses
console.log(`${'─'.repeat(78)}`);
console.log(`\nE se repetir o mesmo risco por 6 meses seguidos?\n`);
console.log('risco/trade'.padEnd(14) + 'chega $500'.padEnd(13) + 'perde 90%'.padEnd(12) + 'quebra'.padEnd(10) + 'mediana');
for (const r of [0.05, 0.20, 0.35, 0.50]) {
  const row = simulate(r, 6);
  console.log(
    ((r * 100).toFixed(1) + '%').padEnd(14) +
    ((row.p500 * 100).toFixed(1) + '%').padEnd(13) +
    ((row.pPerde90 * 100).toFixed(1) + '%').padEnd(12) +
    ((row.pQuebra * 100).toFixed(1) + '%').padEnd(10) +
    '$' + row.mediana.toFixed(0),
  );
}
console.log(
  `\nO ganho não se acumula: quem sobrevive ao mês 1 enfrenta o mesmo dado no\n` +
  `mês 2. A probabilidade de sobreviver a 6 meses é o produto, não a soma.`,
);
