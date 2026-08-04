/**
 * Testes do basis trade (spot + perp na mesma exchange).
 *
 * Rodar: node --test src/funding/basis.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { avaliarBasis, capitalNecessario, notionalSustentavel, candidatosBasis } from './basis.ts';

test('payback é independente do notional — só depende de taxa e funding', () => {
  const r = avaliarBasis({ funding8h: 0.001, taxaPerp: 0.0005, taxaSpot: 0.001 });
  assert.ok(r.paybackHoras > 0 && isFinite(r.paybackHoras));
  // a mesma entrada, sem notional nenhum no cálculo — a assinatura do tipo já garante isso,
  // aqui só confirma que o valor bate com a fórmula fechada
  const taxaMedia = (0.0005 + 0.001) / 2;
  const esperado = (taxaMedia * 4) / (0.001 * (3 / 24));
  assert.ok(Math.abs(r.paybackHoras - esperado) < 1e-9);
});

test('funding zero ou negativo dá payback infinito — nunca vale abrir', () => {
  assert.equal(avaliarBasis({ funding8h: 0, taxaPerp: 0.0005, taxaSpot: 0.001 }).paybackHoras, Infinity);
  assert.equal(avaliarBasis({ funding8h: -0.001, taxaPerp: 0.0005, taxaSpot: 0.001 }).paybackHoras, Infinity);
});

test('funding maior sempre paga mais rápido, tudo mais igual', () => {
  const baixo = avaliarBasis({ funding8h: 0.0005, taxaPerp: 0.0005, taxaSpot: 0.001 });
  const alto = avaliarBasis({ funding8h: 0.002, taxaPerp: 0.0005, taxaSpot: 0.001 });
  assert.ok(alto.paybackHoras < baixo.paybackHoras);
});

test('capital necessário é 3x o do perp-perp na mesma alavancagem', () => {
  const alavancagem = 5;
  const notional = 250;
  const basis = capitalNecessario(notional, alavancagem);
  const perpPerp = notional * (2 / alavancagem);
  assert.equal(basis, notional * 1.2);
  assert.equal(perpPerp, notional * 0.4);
  assert.ok(Math.abs(basis / perpPerp - 3) < 1e-9);
});

test('notionalSustentavel é o inverso exato de capitalNecessario', () => {
  const alavancagem = 5, capital = 200;
  const notional = notionalSustentavel(capital, alavancagem);
  const capitalDeVolta = capitalNecessario(notional, alavancagem);
  assert.ok(Math.abs(capitalDeVolta - capital) < 1e-9);
});

test('candidatosBasis filtra funding negativo e volume baixo', () => {
  const pares = [
    { symbol: 'A', exchange: 'x', funding: 0.001, intervaloHoras: 8, volume24h: 2e6 },
    { symbol: 'B', exchange: 'x', funding: -0.001, intervaloHoras: 8, volume24h: 5e6 }, // negativo, fora
    { symbol: 'C', exchange: 'x', funding: 0.001, intervaloHoras: 8, volume24h: 100 },  // volume baixo, fora
  ];
  const out = candidatosBasis(pares, 1e6);
  assert.deepEqual(out.map((o) => o.symbol), ['A']);
});

test('candidatosBasis normaliza intervalo diferente de 8h antes de ordenar', () => {
  const pares = [
    { symbol: 'lento', exchange: 'x', funding: 0.001, intervaloHoras: 8, volume24h: 2e6 },
    { symbol: 'rapido', exchange: 'x', funding: 0.0006, intervaloHoras: 4, volume24h: 2e6 }, // vira 0.0012 em 8h
  ];
  const out = candidatosBasis(pares, 1e6);
  assert.equal(out[0].symbol, 'rapido', 'depois de normalizar, rapido tem funding8h maior');
});

test('candidatosBasis ordena por APR decrescente', () => {
  const pares = [
    { symbol: 'baixo', exchange: 'x', funding: 0.0002, intervaloHoras: 8, volume24h: 2e6 },
    { symbol: 'alto', exchange: 'x', funding: 0.002, intervaloHoras: 8, volume24h: 2e6 },
  ];
  const out = candidatosBasis(pares, 1e6);
  assert.deepEqual(out.map((o) => o.symbol), ['alto', 'baixo']);
});
