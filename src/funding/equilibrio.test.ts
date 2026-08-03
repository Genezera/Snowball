/**
 * Testes do equilíbrio de direção entre exchanges.
 *
 * Rodar: node --test src/funding/equilibrio.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { piorDreno, drenoLiquido, exposicaoDirecional, deltaEquilibrio, bonusEquilibrio } from './equilibrio.ts';

const pos = (s: string, l: string, n = 350) => ({ exchangeShort: s, exchangeLong: l, notionalPorPerna: n });

test('sem posição, o dreno é zero', () => {
  assert.equal(piorDreno([]), 0);
});

test('uma posição drena a exchange vendida e alivia a comprada', () => {
  const d = drenoLiquido(exposicaoDirecional([pos('binanceusdm', 'bybit')]));
  assert.equal(d.binanceusdm, 350);
  assert.equal(d.bybit, -350);
});

test('duas posições na MESMA direção dobram o dreno', () => {
  const p = [pos('binanceusdm', 'bybit'), pos('binanceusdm', 'bybit')];
  assert.equal(piorDreno(p), 700);
});

test('duas posições em direções OPOSTAS se cancelam', () => {
  const p = [pos('binanceusdm', 'bybit'), pos('bybit', 'binanceusdm')];
  assert.equal(piorDreno(p), 0, 'cada exchange vende tanto quanto compra');
});

test('o equilíbrio corta o dreno de pico pela metade', () => {
  const concentrado = piorDreno([pos('binanceusdm', 'bybit'), pos('binanceusdm', 'bybit')]);
  const equilibrado = piorDreno([pos('binanceusdm', 'bybit'), pos('bybit', 'binanceusdm')]);
  assert.ok(equilibrado < concentrado);
});

// ── o desempate ────────────────────────────────────────────────────────────

test('a candidata que equilibra tem delta NEGATIVO', () => {
  const atual = [pos('binanceusdm', 'bybit')];
  const equilibra = pos('bybit', 'binanceusdm');
  const concentra = pos('binanceusdm', 'bybit');
  assert.ok(deltaEquilibrio(atual, equilibra) < 0, 'reduz o pior dreno');
  assert.ok(deltaEquilibrio(atual, concentra) > 0, 'aumenta o pior dreno');
});

test('o bônus premia quem equilibra e penaliza quem concentra', () => {
  const atual = [pos('binanceusdm', 'bybit')];
  assert.ok(bonusEquilibrio(atual, pos('bybit', 'binanceusdm')) > 0);
  assert.ok(bonusEquilibrio(atual, pos('binanceusdm', 'bybit')) < 0);
});

test('a primeira posição não recebe bônus — não há o que equilibrar', () => {
  assert.equal(bonusEquilibrio([], pos('binanceusdm', 'bybit')), 0);
});

test('o bônus é limitado, para desempatar e não para inverter', () => {
  const atual = [pos('binanceusdm', 'bybit')];
  for (const c of [pos('bybit', 'binanceusdm'), pos('binanceusdm', 'bybit'), pos('okx', 'gate')]) {
    const b = bonusEquilibrio(atual, c);
    assert.ok(Math.abs(b) <= 0.07 + 1e-9, `bônus ${b} passou do teto`);
  }
});

test('uma diferença real de valor não é invertida pelo bônus', () => {
  // O bônus é BIDIRECIONAL: quem equilibra ganha +i, quem concentra leva −i.
  // A faixa é 2i, não i. Com i = 0,07 o limite de inversão é (1+i)/(1−i) = 1,15.
  //
  // A primeira versão usava 0,15, o que dava limite 1,353 — o desempate
  // invertia diferenças de valor de até 35%. Este teste reprovou e a
  // intensidade caiu para 0,07.
  const atual = [pos('binanceusdm', 'bybit')];
  const valorA = 1.30, valorB = 1.00;
  const finalA = valorA * (1 + bonusEquilibrio(atual, pos('binanceusdm', 'bybit')));
  const finalB = valorB * (1 + bonusEquilibrio(atual, pos('bybit', 'binanceusdm')));
  assert.ok(finalA > finalB, `A ${finalA.toFixed(3)} deveria vencer B ${finalB.toFixed(3)}`);
});

test('uma diferença pequena de valor É invertida — que é o objetivo', () => {
  const atual = [pos('binanceusdm', 'bybit')];
  const finalA = 1.02 * (1 + bonusEquilibrio(atual, pos('binanceusdm', 'bybit')));
  const finalB = 1.00 * (1 + bonusEquilibrio(atual, pos('bybit', 'binanceusdm')));
  assert.ok(finalB > finalA, 'com valores parecidos, quem equilibra passa na frente');
});
