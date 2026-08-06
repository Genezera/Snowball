import { test } from 'node:test';
import assert from 'node:assert/strict';
import { precoNoToque, avaliarPreenchimento, classificarReacao, agregarEstatisticas } from './preenchimento.ts';

test('precoNoToque: vender posta no ask, comprar posta no bid', () => {
  assert.equal(precoNoToque('venda', 100, 101), 101);
  assert.equal(precoNoToque('compra', 100, 101), 100);
});

test('avaliarPreenchimento: venda preenche no primeiro tick que atinge o preço', () => {
  const ordem = { lado: 'venda' as const, preco: 105, abertaEm: 1000 };
  const ticks = [
    { ts: 1000, last: 103 },
    { ts: 2000, last: 104 },
    { ts: 3000, last: 105 },
    { ts: 4000, last: 106 },
  ];
  const r = avaliarPreenchimento(ordem, ticks, 60_000);
  assert.equal(r.preenchido, true);
  assert.equal(r.ts, 3000);
  assert.equal(r.msParaEncher, 2000);
});

test('avaliarPreenchimento: compra preenche quando o preço cai até o nível', () => {
  const ordem = { lado: 'compra' as const, preco: 95, abertaEm: 1000 };
  const ticks = [
    { ts: 1000, last: 100 },
    { ts: 2000, last: 97 },
    { ts: 3000, last: 94 },
  ];
  const r = avaliarPreenchimento(ordem, ticks, 60_000);
  assert.equal(r.preenchido, true);
  assert.equal(r.ts, 3000);
});

test('avaliarPreenchimento: expira sem preencher se o preço nunca toca o nível dentro da janela', () => {
  const ordem = { lado: 'venda' as const, preco: 110, abertaEm: 1000 };
  const ticks = [
    { ts: 1000, last: 100 },
    { ts: 2000, last: 101 },
  ];
  const r = avaliarPreenchimento(ordem, ticks, 60_000);
  assert.equal(r.preenchido, false);
  assert.match(r.motivo, /expirou/);
});

test('avaliarPreenchimento: ticks fora da janela (depois do limite) não contam', () => {
  const ordem = { lado: 'venda' as const, preco: 105, abertaEm: 1000 };
  const ticks = [
    { ts: 1000, last: 100 },
    { ts: 70_000, last: 105 }, // depois da janela de 60s
  ];
  const r = avaliarPreenchimento(ordem, ticks, 60_000);
  assert.equal(r.preenchido, false);
});

test('avaliarPreenchimento: ticks antes da abertura da ordem são ignorados', () => {
  const ordem = { lado: 'venda' as const, preco: 100, abertaEm: 5000 };
  const ticks = [
    { ts: 1000, last: 100 }, // antes de abrir — não conta, mesmo tocando o preço
    { ts: 6000, last: 99 },
    { ts: 7000, last: 100 },
  ];
  const r = avaliarPreenchimento(ordem, ticks, 60_000);
  assert.equal(r.ts, 7000);
});

test('classificarReacao: venda seguida de alta é seleção adversa (desfavorável)', () => {
  const r = classificarReacao(100, 'venda', [{ ts: 1, last: 100 }, { ts: 2, last: 103 }]);
  assert.ok(r);
  assert.ok(r!.retornoPct > 0);
  assert.equal(r!.favoravel, false);
});

test('classificarReacao: venda seguida de queda é favorável', () => {
  const r = classificarReacao(100, 'venda', [{ ts: 1, last: 97 }]);
  assert.ok(r!.retornoPct < 0);
  assert.equal(r!.favoravel, true);
});

test('classificarReacao: compra seguida de queda é seleção adversa (desfavorável)', () => {
  const r = classificarReacao(100, 'compra', [{ ts: 1, last: 96 }]);
  assert.ok(r!.retornoPct > 0);
  assert.equal(r!.favoravel, false);
});

test('classificarReacao: sem ticks depois, devolve null', () => {
  assert.equal(classificarReacao(100, 'venda', []), null);
});

test('agregarEstatisticas: lista vazia não quebra', () => {
  const s = agregarEstatisticas([]);
  assert.equal(s.amostras, 0);
  assert.equal(s.taxaPreenchimento, 0);
  assert.equal(s.msParaEncherMediana, null);
});

test('agregarEstatisticas: taxa de preenchimento e mediana de tempo calculadas corretamente', () => {
  const s = agregarEstatisticas([
    { preenchido: true, msParaEncher: 1000 },
    { preenchido: true, msParaEncher: 3000 },
    { preenchido: true, msParaEncher: 2000 },
    { preenchido: false },
  ]);
  assert.equal(s.amostras, 4);
  assert.equal(s.taxaPreenchimento, 0.75);
  assert.equal(s.msParaEncherMediana, 2000);
});

test('agregarEstatisticas: agrega reação pós-preenchimento só dos que preencheram', () => {
  const s = agregarEstatisticas([
    { preenchido: true, msParaEncher: 1000, reacao: { retornoPct: 0.01, favoravel: false } },
    { preenchido: true, msParaEncher: 2000, reacao: { retornoPct: -0.02, favoravel: true } },
    { preenchido: false },
  ]);
  assert.equal(s.retornoPosPreenchimentoMedio, (0.01 - 0.02) / 2);
  assert.equal(s.fracaoFavoravel, 0.5);
});
