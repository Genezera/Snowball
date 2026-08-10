/**
 * Testes de marcacao.ts — read-only por desenho. Cada caso confere a física
 * mínima: perna vendida lucra quando o preço cai, comprada lucra quando sobe,
 * e o lado executável nunca é melhor que o mark (cruzar o book custa).
 *
 * Rodar: node --test src/funding/marcacao.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { marcarPerna, marcarPosicao, resumirMarcacao } from './marcacao.ts';

test('perna vendida: preço caindo é lucro', () => {
  const r = marcarPerna({ lado: 'venda', precoEntrada: 100, notional: 1000, ticker: { bid: 89, ask: 91, mark: 90 } });
  assert.ok(r.pnlNaoRealizadoMark > 0, 'preço caiu 10%, vendido deveria lucrar');
  assert.ok(Math.abs(r.pnlNaoRealizadoMark - 100) < 1e-9);
});

test('perna comprada: preço subindo é lucro', () => {
  const r = marcarPerna({ lado: 'compra', precoEntrada: 100, notional: 1000, ticker: { bid: 109, ask: 111, mark: 110 } });
  assert.ok(r.pnlNaoRealizadoMark > 0, 'preço subiu 10%, comprado deveria lucrar');
});

test('perna vendida: preço subindo é prejuízo', () => {
  const r = marcarPerna({ lado: 'venda', precoEntrada: 100, notional: 1000, ticker: { bid: 109, ask: 111, mark: 110 } });
  assert.ok(r.pnlNaoRealizadoMark < 0);
});

test('lado executável de quem vende (fecha comprando) é o ASK, sempre pior ou igual ao mark', () => {
  const r = marcarPerna({ lado: 'venda', precoEntrada: 100, notional: 1000, ticker: { bid: 95, ask: 97, mark: 96 } });
  assert.equal(r.precoExecutavel, 97);
  // fechar comprando no ask (97) é pior pra quem vendeu que fechar no mark (96)
  assert.ok(r.pnlNaoRealizadoExecutavel <= r.pnlNaoRealizadoMark);
});

test('lado executável de quem compra (fecha vendendo) é o BID, sempre pior ou igual ao mark', () => {
  const r = marcarPerna({ lado: 'compra', precoEntrada: 100, notional: 1000, ticker: { bid: 103, ask: 105, mark: 104 } });
  assert.equal(r.precoExecutavel, 103);
  assert.ok(r.pnlNaoRealizadoExecutavel <= r.pnlNaoRealizadoMark);
});

test('mark ausente cai para o meio do book (bid+ask)/2', () => {
  const r = marcarPerna({ lado: 'compra', precoEntrada: 100, notional: 1000, ticker: { bid: 100, ask: 102 } });
  assert.equal(r.markPrice, 101);
});

test('posição delta-neutra: pernas iguais e opostas quase se cancelam no mark', () => {
  // spread perfeitamente simétrico ao redor do preço de entrada: o resíduo é
  // pequeno, não zero (as duas pernas usam preços de entrada e ticks
  // possivelmente diferentes) — mas não deve ser grande
  const pos = marcarPosicao({
    symbol: 'TEST/USDT:USDT', notionalPorPerna: 1000,
    precoEntradaShort: 100, precoEntradaLong: 100,
    tickerShort: { bid: 104, ask: 106, mark: 105 },
    tickerLong: { bid: 104, ask: 106, mark: 105 },
    fundingAcumulado: 0.5, taxasPagas: 0.2, taxaEfetiva: 0.0005,
  });
  // preço subiu 5% pros dois: short perde ~50, long ganha ~50 — quase se cancela
  assert.ok(Math.abs(pos.pnlNaoRealizadoTotal) < 1, `residual deveria ser pequeno, foi ${pos.pnlNaoRealizadoTotal}`);
});

test('custo estimado de fechamento é positivo e proporcional ao notional', () => {
  const pos = marcarPosicao({
    symbol: 'TEST/USDT:USDT', notionalPorPerna: 1000,
    precoEntradaShort: 100, precoEntradaLong: 100,
    tickerShort: { bid: 99, ask: 101, mark: 100 },
    tickerLong: { bid: 99, ask: 101, mark: 100 },
    fundingAcumulado: 0, taxasPagas: 0, taxaEfetiva: 0.0005,
  });
  assert.equal(pos.custoEstimadoFechamento, 1000 * 0.0005 * 2);
});

test('resumirMarcacao: equityLiquidacao nunca é maior que equityMark quando o mercado favorece a saída', () => {
  const pos = marcarPosicao({
    symbol: 'TEST/USDT:USDT', notionalPorPerna: 1000,
    precoEntradaShort: 100, precoEntradaLong: 100,
    tickerShort: { bid: 95, ask: 97, mark: 96 },
    tickerLong: { bid: 95, ask: 97, mark: 96 },
    fundingAcumulado: 0, taxasPagas: 0, taxaEfetiva: 0.001,
  });
  const r = resumirMarcacao(600, [pos]);
  assert.ok(r.equityLiquidacao <= r.equityMark);
  assert.equal(r.equityMark, 600 + pos.pnlNaoRealizadoTotal);
  assert.equal(r.custoEstimadoFechamentoTotal, pos.custoEstimadoFechamento);
});

test('resumirMarcacao sem posições: equityMark e equityLiquidacao iguais ao capital realizado', () => {
  const r = resumirMarcacao(603.27, []);
  assert.equal(r.equityMark, 603.27);
  assert.equal(r.equityLiquidacao, 603.27);
});
