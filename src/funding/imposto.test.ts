/**
 * Testes do modelo de imposto de renda.
 *
 * Rodar: node --test src/funding/imposto.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { calcularImpostoMes, ISENCAO_MENSAL_BRL, ALIQUOTA } from './imposto.ts';

test('nesta escala de capital, o volume de vendas fica bem abaixo da isenção', () => {
  // uma rotação por semana a US$ 250/perna: ~US$ 2.000/mês em vendas, longe
  // dos US$ ~6.600 (R$ 35.000) que disparam o imposto
  const r = calcularImpostoMes(2000, 4, 5.30);
  assert.equal(r.isento, true);
  assert.equal(r.impostoDevidoBRL, 0);
});

test('acima da isenção, o imposto é 15% do ganho do mês inteiro', () => {
  const fx = 5;
  const volumeUsd = (ISENCAO_MENSAL_BRL / fx) + 1; // 1 dólar acima do limiar
  const r = calcularImpostoMes(volumeUsd, 1000, fx);
  assert.equal(r.isento, false);
  assert.equal(r.impostoDevidoBRL, 1000 * fx * ALIQUOTA);
});

test('exatamente no limiar ainda é isento — o corte é "somando até"', () => {
  const fx = 5;
  const volumeUsd = ISENCAO_MENSAL_BRL / fx;
  const r = calcularImpostoMes(volumeUsd, 1000, fx);
  assert.equal(r.isento, true);
  assert.equal(r.impostoDevidoBRL, 0);
});

test('mês com prejuízo não gera imposto, mesmo acima da isenção', () => {
  const fx = 5;
  const volumeUsd = (ISENCAO_MENSAL_BRL / fx) + 1000;
  const r = calcularImpostoMes(volumeUsd, -50, fx);
  assert.equal(r.impostoDevidoBRL, 0);
  assert.ok(r.liquidoBRL < 0, 'o prejuízo passa direto, sem virar 0');
});

test('líquido é o ganho menos o imposto devido', () => {
  const fx = 5;
  const volumeUsd = (ISENCAO_MENSAL_BRL / fx) + 1;
  const r = calcularImpostoMes(volumeUsd, 1000, fx);
  assert.equal(r.liquidoBRL, r.ganhoBRL - r.impostoDevidoBRL);
});
