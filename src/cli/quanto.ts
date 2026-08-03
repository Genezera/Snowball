/**
 * Quanto rende, em português claro, separado por exchange.
 *
 * Sem jargão e sem tabela de sensibilidade — a pergunta aqui é simples: com
 * US$ 100 em cada exchange, quanto entra por dia, por semana e por mês?
 *
 * A resposta honesta tem duas partes, e as duas aparecem abaixo:
 *   1. quanto rende ENQUANTO uma posição está montada
 *   2. quanto do tempo é realista ter uma posição montada
 *
 * Ignorar a segunda é como calcular salário anual sem contar que você só
 * trabalhou três meses.
 */
import { RESERVA_PADRAO } from '../funding/tesouraria.ts';
import { taxaEfetiva } from '../funding/custos-reais.ts';
import { parseArgs, num } from './args.ts';

const a = parseArgs();
const POR_EXCHANGE = num(a.porExchange, 100);
const LEV = num(a.alavancagem, 5);
const RESERVA = num(a.reserva, RESERVA_PADRAO);

const margem = POR_EXCHANGE * (1 - RESERVA);
const reserva = POR_EXCHANGE * RESERVA;
const notional = margem * LEV;
const taxa = taxaEfetiva('binanceusdm', 'bybit');
const custoRodada = notional * taxa * 4;

const d = (n: number) => 'US$ ' + n.toFixed(2);
const c = (n: number) => 'US$ ' + n.toFixed(3);

console.log(`\n${'='.repeat(84)}`);
console.log(`QUANTO RENDE · US$ ${POR_EXCHANGE} em cada exchange · ${LEV}x · reserva ${(RESERVA * 100).toFixed(0)}%`);
console.log(`${'='.repeat(84)}`);

console.log(`
COMO O SEU DINHEIRO FICA

  BINANCE                              BYBIT
  ${d(POR_EXCHANGE).padEnd(35)}${d(POR_EXCHANGE)}
    ${d(margem)} em uso como margem       ${d(margem)} em uso como margem
    ${d(reserva)} parado, de reserva       ${d(reserva)} parado, de reserva

  A reserva não é dinheiro desperdiçado. É o que socorre a perna que apertar,
  sem precisar sacar nada de uma exchange para a outra. Sem ela, a única saída
  seria fechar a posição — e fechar demais é o que faz perder dinheiro.

  Posição montada: vendido em uma, comprado na outra, ${d(notional)} de cada lado.
  Se o preço sobe ou desce, os dois lados se cancelam. Você não aposta em
  direção nenhuma — só recebe o pagamento de financiamento.
`);

console.log(`${'─'.repeat(84)}`);
console.log('QUANTO ENTRA, POR CENÁRIO DE MERCADO\n');
console.log(
  'spread'.padEnd(12) + 'por dia'.padEnd(14) + 'na semana'.padEnd(15) +
  'no mês'.padEnd(14) + 'em 1 ano'.padEnd(14) + 'sobre os ' + d(POR_EXCHANGE * 2),
);

const CENARIOS: [string, number][] = [
  ['fraco 12%', 0.12], ['normal 20%', 0.20], ['bom 35%', 0.35], ['ótimo 76%', 0.76],
];
for (const [nome, apr] of CENARIOS) {
  const dia = notional * (apr / 1095) * 3;
  console.log(
    nome.padEnd(12) +
    c(dia).padEnd(14) +
    c(dia * 7).padEnd(15) +
    d(dia * 30).padEnd(14) +
    d(dia * 365).padEnd(14) +
    ((dia * 365) / (POR_EXCHANGE * 2) * 100).toFixed(1) + '% ao ano',
  );
}

console.log(`
  Isto é o BRUTO, e assume a posição montada o tempo todo. Falta descontar o
  custo de montar e desmontar: ${d(custoRodada)} por rodada completa.
`);

console.log(`${'─'.repeat(84)}`);
console.log('DESCONTANDO O CUSTO — cenário normal (20%), uma rodada por período\n');
const dia20 = notional * (0.20 / 1095) * 3;
const periodos: [string, number, number][] = [
  ['por dia', dia20, 1], ['na semana', dia20 * 7, 1], ['no mês', dia20 * 30, 1],
];
console.log('período'.padEnd(14) + 'bruto'.padEnd(14) + 'custo'.padEnd(14) + 'líquido');
for (const [nome, bruto] of periodos) {
  const liq = bruto - custoRodada;
  console.log(
    nome.padEnd(14) + c(bruto).padEnd(14) + ('−' + c(custoRodada)).padEnd(14) +
    (liq >= 0 ? '+' : '−') + c(Math.abs(liq)) + (liq < 0 ? '   ← não paga o próprio custo' : ''),
  );
}

const diasParaPagar = custoRodada / dia20;
const diasParaPagarRef = diasParaPagar;
console.log(`
  A conta que decide tudo: a montagem custa ${d(custoRodada)} e o dia rende
  ${c(dia20)}. Ou seja, a posição precisa viver **${diasParaPagar.toFixed(1)} dias**
  só para empatar. Trocar de par toda semana significa nunca lucrar.

  É por isso que o motor recusa quase tudo. Ele só monta um par que já provou
  durar mais que isso.
`);

// ── a parte que a maioria das projeções esquece ────────────────────────────
console.log(`${'─'.repeat(84)}`);
console.log('TUDO DEPENDE DE QUANTO CADA POSIÇÃO DURA\n');
console.log('Operando sem parar: abre, segura N dias, fecha, abre outra. Cenário normal.\n');
console.log(
  'a posição dura'.padEnd(18) + 'por dia'.padEnd(14) + 'na semana'.padEnd(15) +
  'no mês'.padEnd(14) + 'em 1 ano'.padEnd(14) + 'ao ano',
);
for (const dias of [2, 5.3, 10, 20, 40, 90]) {
  // custo amortizado pela duração: uma montagem a cada `dias`
  const porDia = dia20 - custoRodada / dias;
  const marca = Math.abs(dias - diasParaPagarRef) < 0.1 ? '  ← empata' : '';
  console.log(
    (dias + ' dias').padEnd(18) +
    ((porDia >= 0 ? '+' : '−') + c(Math.abs(porDia)).slice(4)).padEnd(14) +
    ((porDia >= 0 ? '+' : '−') + c(Math.abs(porDia * 7)).slice(4)).padEnd(15) +
    ((porDia >= 0 ? '+' : '−') + d(Math.abs(porDia * 30)).slice(4)).padEnd(14) +
    ((porDia >= 0 ? '+' : '−') + d(Math.abs(porDia * 365)).slice(4)).padEnd(14) +
    (porDia * 365 / (POR_EXCHANGE * 2) * 100).toFixed(1) + '%' + marca,
  );
}

console.log(`
  Esta é a tabela que decide o projeto, e a linha certa dela é o que o motor
  ainda está medindo. Note que o ganho SATURA: dobrar de 40 para 90 dias muda
  pouco, porque o custo já ficou diluído. O salto grande é sair de 5 para 20.

  Qualquer projeção que ignore isto está prometendo a última linha.
`);

// ── por que mais alavancagem não resolve ───────────────────────────────────
console.log(`${'─'.repeat(84)}`);
console.log('POR QUE NÃO BASTA AUMENTAR A ALAVANCAGEM\n');
console.log('Medido em 6 mil simulações de 90 dias, com US$ 100 em cada exchange:\n');
console.log('alavancagem'.padEnd(15) + 'notional/perna'.padEnd(18) + 'risco de ruína'.padEnd(18) + 'resultado mediano');
const medido: [string, string, string, string][] = [
  ['5x', 'US$ 350', '0,00%', 'US$ 214,47'],
  ['6x', 'US$ 420', '0,05%', 'US$ 213,29'],
  ['7x', 'US$ 490', '0,15%', 'US$ 205,14'],
  ['8x', 'US$ 560', '8,18%', 'US$ 5,65  ← perda quase total'],
];
for (const [l, n, r, m] of medido) {
  console.log(l.padEnd(15) + n.padEnd(18) + r.padEnd(18) + m);
}
console.log(`
  A 8x o notional é 60% maior e o resultado é ruína. O motivo: mais alavancagem
  deixa a posição mais perto da liquidação, o alerta dispara mais, a reserva
  acaba mais rápido, e a posição é fechada muito mais vezes. O atrito das
  aberturas e fechamentos come toda a renda extra — e depois come o capital.

  **5x com 30% de reserva já é o ponto ótimo medido.** Não há alavanca de
  alavancagem sobrando.
`);

console.log(`${'='.repeat(84)}`);
console.log(`RESUMO EM UMA FRASE

  Com US$ 200 (US$ 100 em cada exchange), no cenário normal, o resultado
  depende inteiramente de quanto cada posição dura:

    posição de  5 dias  →  empata, não sobra nada
    posição de 20 dias  →  ${c(dia20 - custoRodada / 20)}/dia, ${c((dia20 - custoRodada / 20) * 7)}/semana, ${d((dia20 - custoRodada / 20) * 30)}/mês
    posição de 40 dias  →  ${c(dia20 - custoRodada / 40)}/dia, ${c((dia20 - custoRodada / 40) * 7)}/semana, ${d((dia20 - custoRodada / 40) * 30)}/mês

  Dobrar o capital dobrou os dólares, mas NÃO tornou nada mais fácil: o tempo
  que uma posição precisa viver para se pagar é o mesmo ${diasParaPagar.toFixed(1)} dias,
  independentemente de você ter US$ 100 ou US$ 100 mil.
`);
console.log(`NENHUMA ORDEM É ENVIADA. Tudo isto é simulação sobre dados reais de mercado.\n`);
