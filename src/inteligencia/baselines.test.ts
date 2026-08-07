/**
 * Testes de baselines.ts — a garantia central é que cada baseline compra UMA
 * vez, nunca decide de novo, e que "cash" nunca gera custo nem posição.
 *
 * Rodar: node --test src/inteligencia/baselines.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  novoEstadoBaseline, cicloBaseline, resumirBaseline, salvarEstadoBaseline, carregarEstadoBaseline,
  BASELINE_CASH, BASELINE_BTC_BUY_HOLD, BASELINE_EQUAL_WEIGHT,
} from './baselines.ts';

function tmpDir() { return fs.mkdtempSync(path.join(os.tmpdir(), 'snowball-baseline-')); }
const precoFixo = async () => 100;

test('baseline-cash nunca compra nada, equity fica igual ao capital inicial pra sempre', async () => {
  const e = novoEstadoBaseline(BASELINE_CASH);
  assert.equal(e.comprado, true, 'cash nasce "comprado" — nunca há decisão de compra');
  await cicloBaseline(BASELINE_CASH, e, precoFixo);
  const r = resumirBaseline(BASELINE_CASH, e, {});
  assert.equal(r.equityAtual, BASELINE_CASH.capitalInicial);
  assert.equal(r.pnl, 0);
  assert.equal(e.posicoes.length, 0);
});

test('buy-hold compra uma vez e nunca mais decide, mesmo chamado de novo', async () => {
  const e = novoEstadoBaseline(BASELINE_BTC_BUY_HOLD);
  await cicloBaseline(BASELINE_BTC_BUY_HOLD, e, precoFixo);
  assert.equal(e.comprado, true);
  assert.equal(e.posicoes.length, 1);
  const precoEntrada = e.posicoes[0].precoEntrada;

  // chama de novo — não deveria comprar segunda vez nem duplicar custo
  const custoAntes = e.custoEntrada;
  await cicloBaseline(BASELINE_BTC_BUY_HOLD, e, precoFixo);
  assert.equal(e.custoEntrada, custoAntes, 'não deveria ter cobrado entrada de novo');
  assert.equal(e.posicoes.length, 1);
  assert.equal(e.posicoes[0].precoEntrada, precoEntrada);
});

test('buy-hold: preço sobe 10%, equity reflete a alta menos o custo de entrada', async () => {
  const e = novoEstadoBaseline(BASELINE_BTC_BUY_HOLD);
  await cicloBaseline(BASELINE_BTC_BUY_HOLD, e, precoFixo); // entra a US$100
  const r = resumirBaseline(BASELINE_BTC_BUY_HOLD, e, { 'binanceusdm|BTC/USDT:USDT': 110 });
  assert.ok(r.pnl > 0, 'preço subiu, PnL deveria ser positivo');
  assert.ok(r.equityAtual < BASELINE_BTC_BUY_HOLD.capitalInicial * 1.10, 'custo de entrada deveria ter tirado uma fatia do ganho bruto');
});

test('equal-weight: compra os dois ativos com metade do capital cada', async () => {
  const e = novoEstadoBaseline(BASELINE_EQUAL_WEIGHT);
  await cicloBaseline(BASELINE_EQUAL_WEIGHT, e, precoFixo);
  assert.equal(e.posicoes.length, 2);
  const somaBruta = e.posicoes.reduce((s, p) => s + p.notionalLiquido, 0) + e.custoEntrada;
  assert.ok(Math.abs(somaBruta - BASELINE_EQUAL_WEIGHT.capitalInicial) < 1e-6);
});

test('drawdown acumula corretamente conforme o preço cai depois de subir', async () => {
  const e = novoEstadoBaseline(BASELINE_BTC_BUY_HOLD);
  await cicloBaseline(BASELINE_BTC_BUY_HOLD, e, precoFixo);
  resumirBaseline(BASELINE_BTC_BUY_HOLD, e, { 'binanceusdm|BTC/USDT:USDT': 120 }); // sobe — novo pico
  const r = resumirBaseline(BASELINE_BTC_BUY_HOLD, e, { 'binanceusdm|BTC/USDT:USDT': 90 }); // cai forte
  assert.ok(r.drawdownMaxPct > 0);
});

test('persistência: salva e recarrega sem perder posição nem custo já pago', async () => {
  const dir = tmpDir();
  const e = novoEstadoBaseline(BASELINE_BTC_BUY_HOLD);
  await cicloBaseline(BASELINE_BTC_BUY_HOLD, e, precoFixo);
  salvarEstadoBaseline(dir, e);
  const recarregado = carregarEstadoBaseline(dir, BASELINE_BTC_BUY_HOLD);
  assert.equal(recarregado.comprado, true);
  assert.equal(recarregado.posicoes.length, 1);
  assert.equal(recarregado.custoEntrada, e.custoEntrada);
  fs.rmSync(dir, { recursive: true, force: true });
});
