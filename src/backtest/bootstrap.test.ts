/**
 * Testes do bootstrap de trades reais.
 *
 * Rodar: node --test src/backtest/bootstrap.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { paraRMultiplos, simularBootstrap } from './bootstrap.ts';
import type { Trade } from '../core/types.ts';

function trade(rEquity: number): Trade {
  return {
    symbol: 'X', side: 'long', entryTime: 0, entryPrice: 1, exitTime: 1, exitPrice: 1,
    exitReason: 'timeout', barsHeld: 1, notional: 100, cost: 0, pnl: rEquity * 100,
    rEquity, rPrice: rEquity, equityAfter: 100 * (1 + rEquity),
  };
}

test('paraRMultiplos divide rEquity pelo risco planejado', () => {
  const trades = [trade(0.01), trade(-0.005), trade(0.02)];
  const r = paraRMultiplos(trades, 0.005);
  assert.deepEqual(r, [2, -1, 4]);
});

test('paraRMultiplos rejeita risco não positivo', () => {
  assert.throws(() => paraRMultiplos([trade(0.01)], 0));
  assert.throws(() => paraRMultiplos([trade(0.01)], -0.01));
});

test('pool só de vitórias nunca produz ruína nem arrasto', () => {
  const r = simularBootstrap({
    rMultiplos: [1, 2, 3], capitalInicial: 200, alvo: 300, pisoRuina: 40,
    opsPorMes: 10, horizonteMeses: 12, riscoFracao: 0.05, caminhos: 500,
  });
  assert.equal(r.pRuina, 0);
  assert.ok(r.pSucesso > 0.9);
});

test('pool só de perdas sempre quebra, nunca chega na meta', () => {
  const r = simularBootstrap({
    rMultiplos: [-1, -0.5, -1], capitalInicial: 200, alvo: 300, pisoRuina: 40,
    opsPorMes: 10, horizonteMeses: 24, riscoFracao: 0.05, caminhos: 500,
  });
  assert.equal(r.pSucesso, 0);
  assert.ok(r.pRuina > 0.9);
});

test('as três frações (sucesso, ruína, arrastando) somam 1', () => {
  const r = simularBootstrap({
    rMultiplos: [1, -1, 2, -1, 0.5, -1], capitalInicial: 200, alvo: 2000, pisoRuina: 40,
    opsPorMes: 20, horizonteMeses: 24, riscoFracao: 0.05, caminhos: 2000,
  });
  assert.ok(Math.abs(r.pSucesso + r.pRuina + r.pArrastando - 1) < 1e-9);
});

test('risco maior aumenta tanto sucesso quanto ruína, no mesmo pool', () => {
  const pool = [2, -1, -1, 1.5, -1, 3, -1, -1, 0.8, -1]; // expectancy positiva, maioria de perdas pequenas
  const baixo = simularBootstrap({
    rMultiplos: pool, capitalInicial: 200, alvo: 2000, pisoRuina: 40,
    opsPorMes: 20, horizonteMeses: 60, riscoFracao: 0.02, caminhos: 3000,
  });
  const alto = simularBootstrap({
    rMultiplos: pool, capitalInicial: 200, alvo: 2000, pisoRuina: 40,
    opsPorMes: 20, horizonteMeses: 60, riscoFracao: 0.20, caminhos: 3000,
  });
  assert.ok(alto.pRuina > baixo.pRuina, 'risco maior quebra mais');
});

test('mesma semente produz o mesmo resultado — reprodutível', () => {
  const pool = [1, -1, 2, -0.5, 1.5, -1];
  const a = simularBootstrap({
    rMultiplos: pool, capitalInicial: 200, alvo: 1000, pisoRuina: 40,
    opsPorMes: 15, horizonteMeses: 36, riscoFracao: 0.05, caminhos: 1000, semente: 42,
  });
  const b = simularBootstrap({
    rMultiplos: pool, capitalInicial: 200, alvo: 1000, pisoRuina: 40,
    opsPorMes: 15, horizonteMeses: 36, riscoFracao: 0.05, caminhos: 1000, semente: 42,
  });
  assert.deepEqual(a, b);
});

test('rejeita pool vazio', () => {
  assert.throws(() => simularBootstrap({
    rMultiplos: [], capitalInicial: 200, alvo: 1000, pisoRuina: 40,
    opsPorMes: 10, horizonteMeses: 12, riscoFracao: 0.05,
  }));
});
