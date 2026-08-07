/**
 * Testes de decomposicao-custo.ts.
 * Rodar: node --test src/funding/decomposicao-custo.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { decompor, feeToGross, decomporPorEstrategia } from './decomposicao-custo.ts';

test('classifica por evento quando falta o campo categoria (histórico antigo)', () => {
  const d = decompor([
    { evento: 'abre', custo: 1.0 },
    { evento: 'fecha', custo: 1.5 },
    { evento: 'escalona', custo: 0.5 },
    { evento: 'apara', custo: 0.2 },
    { evento: 'reinveste', custo: 0.02 },
    { evento: 'socorre', custo: 0 },
  ]);
  assert.equal(d.taxaEntrada, 1.0);
  assert.equal(d.taxaSaida, 1.5);
  assert.equal(d.custoEscalonamento, 0.5);
  assert.equal(d.custoApara, 0.2);
  assert.equal(d.custoReinvestimento, 0.02);
  assert.equal(d.custoRebalanceamento, 0);
  assert.ok(Math.abs(d.custoTradingPuro - 2.5) < 1e-9);
  assert.ok(Math.abs(d.custoGerenciamento - 0.72) < 1e-9);
  assert.ok(Math.abs(d.custoTotal - 3.22) < 1e-9);
});

test('respeita o campo categoria explícito quando presente, sem depender do nome do evento', () => {
  const d = decompor([{ evento: 'abre-captura', custo: 0.1, categoria: 'trade' }]);
  assert.equal(d.taxaEntrada, 0.1);
});

test('eventos sem custo não quebram (custo ausente = 0)', () => {
  const d = decompor([{ evento: 'leitura' }, { evento: 'bloqueado' }]);
  assert.equal(d.custoTotal, 0);
});

test('feeToGross: divide pelo funding bruto, Infinity se funding for zero', () => {
  const d = decompor([{ evento: 'abre', custo: 1 }, { evento: 'fecha', custo: 1 }]);
  const f = feeToGross(d, 10);
  assert.ok(Math.abs(f.feeToGrossTrading - 0.2) < 1e-9);
  const f0 = feeToGross(d, 0);
  assert.equal(f0.feeToGrossTrading, Infinity);
});

test('decomporPorEstrategia separa captura de persistência mesmo sem strategyId explícito', () => {
  const grupos = decomporPorEstrategia([
    { evento: 'abre', custo: 1, modo: 'persistencia' },
    { evento: 'abre-captura', custo: 0.2, modo: 'captura' },
  ]);
  assert.equal(grupos.funding_standard.taxaEntrada, 1);
  assert.equal(grupos.settlement_capture.taxaEntrada, 0.2);
});

test('reconciliação: soma da decomposição bate com soma bruta dos custos originais', () => {
  const eventos = [
    { evento: 'abre', custo: 0.5075 }, { evento: 'fecha', custo: 0.166 },
    { evento: 'escalona', custo: 0.2306 }, { evento: 'apara', custo: 0.1838 },
    { evento: 'reinveste', custo: 0.0008 },
  ];
  const somaBruta = eventos.reduce((s, e) => s + e.custo, 0);
  const d = decompor(eventos);
  assert.ok(Math.abs(d.custoTotal - somaBruta) < 1e-9);
});
