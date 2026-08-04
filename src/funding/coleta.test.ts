/**
 * Testes da coleta de longo prazo.
 *
 * Rodar: node --test src/funding/coleta.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { observacoesNovas, ciclosParaArquivar, custodiaEhNova } from './coleta.ts';

test('observacoesNovas só pega o que é mais novo que o cursor', () => {
  const linhas = [
    JSON.stringify({ ts: 100, k: 'A', spread: 0.001, apr: 0.1, vol: 1e7 }),
    JSON.stringify({ ts: 200, k: 'B', spread: 0.002, apr: 0.2, vol: 1e7 }),
    JSON.stringify({ ts: 300, k: 'C', spread: 0.003, apr: 0.3, vol: 1e7 }),
  ];
  const { novas, maiorTs } = observacoesNovas(linhas, 150);
  assert.equal(novas.length, 2);
  assert.deepEqual(novas.map((o) => o.k), ['B', 'C']);
  assert.equal(maiorTs, 300);
});

test('observacoesNovas com cursor zero pega tudo — primeira coleta', () => {
  const linhas = [JSON.stringify({ ts: 50, k: 'A', spread: 0.001, apr: 0.1, vol: 1e7 })];
  const { novas, maiorTs } = observacoesNovas(linhas, 0);
  assert.equal(novas.length, 1);
  assert.equal(maiorTs, 50);
});

test('observacoesNovas ignora linha corrompida sem derrubar o resto', () => {
  const linhas = ['{quebrada', JSON.stringify({ ts: 100, k: 'A', spread: 0.001, apr: 0.1, vol: 1e7 })];
  const { novas } = observacoesNovas(linhas, 0);
  assert.equal(novas.length, 1);
});

test('observacoesNovas sem nada novo devolve maiorTs igual ao cursor', () => {
  const linhas = [JSON.stringify({ ts: 100, k: 'A', spread: 0.001, apr: 0.1, vol: 1e7 })];
  const { novas, maiorTs } = observacoesNovas(linhas, 500);
  assert.equal(novas.length, 0);
  assert.equal(maiorTs, 500);
});

test('ciclosParaArquivar pega só os que fecharam e ainda não foram vistos', () => {
  const ciclos = {
    aberto: { fechadoEm: undefined },
    fechado1: { fechadoEm: 1000 },
    fechado2: { fechadoEm: 2000 },
  };
  const out = ciclosParaArquivar(ciclos as any, {});
  assert.deepEqual(out.sort(), ['fechado1', 'fechado2']);
});

test('ciclosParaArquivar não repete o que já foi arquivado', () => {
  const ciclos = { par: { fechadoEm: 1000 } };
  const out = ciclosParaArquivar(ciclos, { par: 1000 });
  assert.deepEqual(out, []);
});

test('ciclosParaArquivar pega de novo se a mesma chave reabriu e fechou depois', () => {
  const ciclos = { par: { fechadoEm: 2000 } };
  const out = ciclosParaArquivar(ciclos, { par: 1000 });
  assert.deepEqual(out, ['par']);
});

test('custodiaEhNova compara contra a última arquivada', () => {
  assert.equal(custodiaEhNova(2000, 1000), true);
  assert.equal(custodiaEhNova(1000, 1000), false);
  assert.equal(custodiaEhNova(500, 1000), false);
});
