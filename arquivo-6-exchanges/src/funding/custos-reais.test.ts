/**
 * Testes dos custos reais e da restrição de saque mínimo.
 *
 * Rodar: node --test src/funding/custos-reais.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  taxaDaOperacao, custoTransferencia, posicoesSustentaveis,
  SAQUE_MINIMO, TAXA_SAQUE, TAKER,
} from './custos-reais.ts';

test('a taxa da operação é a média das duas exchanges, não um valor fixo', () => {
  const binOkx = taxaDaOperacao('binanceusdm', 'okx');
  const binBitget = taxaDaOperacao('binanceusdm', 'bitget');
  assert.equal(binOkx, 0.0005);
  assert.ok(binBitget > binOkx, 'a bitget é 0,06% e puxa a média para cima');
});

test('exchange desconhecida usa o pior caso, não o melhor', () => {
  assert.ok(taxaDaOperacao('exchange-inventada', 'outra') >= Math.max(...Object.values(TAKER)));
});

test('transferir abaixo do saque mínimo é IMPOSSÍVEL, não caro', () => {
  const c = custoTransferencia(SAQUE_MINIMO - 0.01);
  assert.equal(c.possivel, false);
  assert.equal(c.custo, 0, 'não custa nada porque não acontece');
});

test('a taxa de saque é FIXA, então pesa muito mais em valor pequeno', () => {
  const pequena = custoTransferencia(10);
  const grande = custoTransferencia(1000);
  assert.equal(pequena.custo, grande.custo, 'mesma taxa em dólares');
  assert.ok(pequena.fracao > grande.fracao * 50, 'fração muito maior na pequena');
  assert.ok(pequena.fracao > 0.01, `${(pequena.fracao * 100).toFixed(2)}% — bem acima dos 0,05% assumidos antes`);
});

// ── a restrição que quebrou o desenho ──────────────────────────────────────

test('a US$ 100 e 5x, só UMA posição mantém a transferência viável', () => {
  const r = posicoesSustentaveis(100, 5, 0.12, 0.01, 3);
  assert.equal(r.posicoes, 1);
});

test('com capital suficiente, as três posições voltam', () => {
  // A fronteira exata é US$ 171,43 — em US$ 171 a transferência daria US$ 9,98,
  // dois centavos abaixo do mínimo. Escrevi 171 na primeira versão do teste e
  // ele reprovou: o código estava certo e a minha conta de cabeça, arredondada.
  assert.equal(posicoesSustentaveis(171, 5, 0.12, 0.01, 3).posicoes, 2, 'ainda não');
  assert.equal(posicoesSustentaveis(172, 5, 0.12, 0.01, 3).posicoes, 3, 'agora sim');
  assert.equal(posicoesSustentaveis(500, 5, 0.12, 0.01, 3).posicoes, 3, 'o teto continua sendo 3');
});

test('o número de posições cresce monotonicamente com o capital', () => {
  let anterior = 0;
  for (const cap of [50, 100, 150, 200, 400]) {
    const n = posicoesSustentaveis(cap, 5, 0.12, 0.01, 3).posicoes;
    assert.ok(n >= anterior, `caiu em ${cap}`);
    anterior = n;
  }
});

test('a transferência calculada de fato passa do mínimo, em todo capital', () => {
  // é a garantia que a fórmula existe para dar: se o motor abre N posições,
  // a transferência no alerta tem de ser executável
  for (const cap of [60, 100, 200, 500, 1000]) {
    for (const lev of [3, 4, 5]) {
      const r = posicoesSustentaveis(cap, lev, 0.12, 0.01, 3);
      const margemInicial = cap / (2 * r.posicoes);
      const transf = margemInicial * (1 - (0.12 + 0.01) * lev);
      assert.ok(transf >= SAQUE_MINIMO - 1e-9 || r.posicoes === 1,
        `cap=${cap} lev=${lev} pos=${r.posicoes} transf=${transf.toFixed(2)}`);
    }
  }
});

test('alavancagem alta demais devolve 1 posição e diz por quê', () => {
  // a 8x, (0,12+0,01)×8 = 1,04 > 1 — a posição nasce dentro do alerta e não há
  // margem para reequilibrar em tamanho nenhum
  const r = posicoesSustentaveis(1000, 8, 0.12, 0.01, 3);
  assert.equal(r.posicoes, 1);
  assert.match(r.motivo, /nasce dentro do alerta/);
});

test('capital minúsculo nunca devolve zero posições', () => {
  // devolver 0 travaria o motor sem explicação; devolver 1 deixa a decisão para
  // o portão de valor esperado, que é onde ela pertence
  assert.equal(posicoesSustentaveis(10, 5, 0.12, 0.01, 3).posicoes, 1);
});

test('a taxa de saque é pequena em dólares mas o mínimo é o que decide', () => {
  assert.ok(TAXA_SAQUE < 1, 'a taxa em si é barata');
  assert.equal(SAQUE_MINIMO, 10, 'o mínimo é a restrição real');
});
