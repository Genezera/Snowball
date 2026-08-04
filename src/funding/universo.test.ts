/**
 * Testes da correção de intervalo de funding suspeito.
 *
 * Rodar: node --test src/funding/universo.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { candidatosParaVerificarIntervalo, LIMIAR_FUNDING_SUSPEITO, type ParUniverso } from './universo.ts';

function par(over: Partial<ParUniverso>): ParUniverso {
  return { symbol: 'X/USDT:USDT', exchange: 'binanceusdm', funding: 0, intervaloHoras: 8, volume24h: 1e7, marca: 1, ...over };
}

test('funding acima do limiar na exchange alvo entra na lista de suspeitos', () => {
  const pares = [par({ funding: LIMIAR_FUNDING_SUSPEITO + 0.0001 })];
  assert.equal(candidatosParaVerificarIntervalo(pares, 'binanceusdm').length, 1);
});

test('funding abaixo do limiar não entra', () => {
  const pares = [par({ funding: LIMIAR_FUNDING_SUSPEITO - 0.0001 })];
  assert.equal(candidatosParaVerificarIntervalo(pares, 'binanceusdm').length, 0);
});

test('funding negativo grande também é suspeito — o que importa é a magnitude', () => {
  const pares = [par({ funding: -(LIMIAR_FUNDING_SUSPEITO + 0.001) })];
  assert.equal(candidatosParaVerificarIntervalo(pares, 'binanceusdm').length, 1);
});

test('só considera a exchange alvo, mesmo com funding suspeito em outra', () => {
  const pares = [par({ exchange: 'bybit', funding: 0.01 })];
  assert.equal(candidatosParaVerificarIntervalo(pares, 'binanceusdm').length, 0);
});

test('exatamente no limiar conta como suspeito ("acima ou igual")', () => {
  const pares = [par({ funding: LIMIAR_FUNDING_SUSPEITO })];
  assert.equal(candidatosParaVerificarIntervalo(pares, 'binanceusdm').length, 1);
});

test('lista mista filtra só os dois critérios ao mesmo tempo', () => {
  const pares = [
    par({ symbol: 'A/USDT:USDT', funding: 0.005 }),                 // suspeito, exchange certa
    par({ symbol: 'B/USDT:USDT', funding: 0.005, exchange: 'gate' }), // suspeito, exchange errada
    par({ symbol: 'C/USDT:USDT', funding: 0.0001 }),                 // não suspeito
  ];
  const out = candidatosParaVerificarIntervalo(pares, 'binanceusdm');
  assert.deepEqual(out.map((p) => p.symbol), ['A/USDT:USDT']);
});
