import { test } from 'node:test';
import assert from 'node:assert/strict';
import { avaliarCicloArquivado, type CicloArquivado } from './rotulo-ciclo.ts';

const HORA = 3_600_000;

function ciclo(over: Partial<CicloArquivado> = {}): CicloArquivado {
  return {
    chave: 'X/USDT:USDT|a|b', symbol: 'X/USDT:USDT', exchangeShort: 'a', exchangeLong: 'b',
    abertoEm: 0, fechadoEm: 10 * HORA, observacoes: 120, spreadMedio: 0.001, consistencia: 0.9,
    ...over,
  };
}

test('ciclo com poucas observações pra sua duração não é confiável, mesmo com spread bom', () => {
  const r = avaliarCicloArquivado(ciclo({ observacoes: 1, fechadoEm: 20 * HORA }));
  assert.equal(r.confiavel, false);
  assert.equal(r.positivo, false);
});

test('ciclo confiável com vida esperada bem acima do payback é positivo', () => {
  // duracaoHoras=10, esperadas=120, observacoes=120 -> densidade 1.0, confiável
  // spread alto o bastante pra payback curto
  const r = avaliarCicloArquivado(ciclo({ spreadMedio: 0.01, consistencia: 0.95 }));
  assert.equal(r.confiavel, true);
  assert.equal(r.positivo, true);
});

test('ciclo confiável mas com vida esperada abaixo do payback exigido não é positivo', () => {
  const r = avaliarCicloArquivado(ciclo({ spreadMedio: 0.00001, consistencia: 0.9 }));
  assert.equal(r.confiavel, true);
  assert.equal(r.positivo, false);
});

test('spreadMedio zero ou negativo dá payback infinito — nunca positivo', () => {
  const r = avaliarCicloArquivado(ciclo({ spreadMedio: 0 }));
  assert.equal(r.paybackHoras, Infinity);
  assert.equal(r.positivo, false);
});

test('margem maior exige folga maior — o mesmo ciclo pode virar positivo com margem menor', () => {
  const c = ciclo({ spreadMedio: 0.00267, consistencia: 0.7 });
  const comMargemAlta = avaliarCicloArquivado(c, undefined, undefined, undefined, 3.0);
  const comMargemBaixa = avaliarCicloArquivado(c, undefined, undefined, undefined, 1.0);
  assert.equal(comMargemAlta.positivo, false);
  assert.equal(comMargemBaixa.positivo, true);
});
