/**
 * Testes de vigilancia-basis.ts — só a parte pura (processarPassada),
 * sem tocar disco. Mesmo padrão de vigilancia.test.ts.
 *
 * Rodar: node --test src/funding/vigilancia-basis.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { processarPassada, chaveBasis, TOLERANCIA_FALTAS_BASIS, type EstadoVigilanciaBasis } from './vigilancia-basis.ts';
import type { CandidatoBasis } from './basis.ts';

function estadoVazio(): EstadoVigilanciaBasis {
  return { iniciadoEm: 0, varreduras: 0, ciclos: {}, ultimaVarredura: 0 };
}

function candidato(over: Partial<CandidatoBasis> = {}): CandidatoBasis {
  return { symbol: 'BTC/USDT:USDT', exchange: 'binanceusdm', funding8h: 0.001, aprFunding: 1.0, volume24h: 2e6, ...over };
}

test('um candidato novo abre um ciclo e entra em novas', () => {
  const estado = estadoVazio();
  const { novas, fechadas } = processarPassada(estado, [candidato()], 1000);
  assert.equal(novas.length, 1);
  assert.equal(fechadas.length, 0);
  const c = estado.ciclos[chaveBasis(candidato())];
  assert.equal(c.abertoEm, 1000);
  assert.equal(c.observacoes, 1);
  assert.equal(c.funding8hMedio, 0.001);
});

test('reobservar o mesmo candidato atualiza a média, não abre ciclo novo', () => {
  const estado = estadoVazio();
  processarPassada(estado, [candidato({ funding8h: 0.001 })], 1000);
  processarPassada(estado, [candidato({ funding8h: 0.003 })], 2000);
  const c = estado.ciclos[chaveBasis(candidato())];
  assert.equal(c.observacoes, 2);
  assert.equal(c.funding8hMedio, 0.002);
  assert.equal(c.funding8hMax, 0.003);
  assert.equal(c.funding8hMin, 0.001);
  assert.equal(c.abertoEm, 1000, 'não reabre o ciclo');
});

test('faltar por menos que a tolerância não fecha o ciclo', () => {
  const estado = estadoVazio();
  processarPassada(estado, [candidato()], 1000);
  for (let i = 1; i < TOLERANCIA_FALTAS_BASIS; i++) {
    const { fechadas } = processarPassada(estado, [], 1000 + i * 1000);
    assert.equal(fechadas.length, 0);
  }
  const c = estado.ciclos[chaveBasis(candidato())];
  assert.equal(c.fechadoEm, undefined);
});

test('faltar por tolerância seguidas fecha o ciclo', () => {
  const estado = estadoVazio();
  processarPassada(estado, [candidato()], 1000);
  let fechadasFinal: unknown[] = [];
  for (let i = 1; i <= TOLERANCIA_FALTAS_BASIS; i++) {
    fechadasFinal = processarPassada(estado, [], 1000 + i * 1000).fechadas;
  }
  assert.equal(fechadasFinal.length, 1);
  const c = estado.ciclos[chaveBasis(candidato())];
  assert.ok(c.fechadoEm !== undefined);
});

test('reaparecer antes de estourar a tolerância zera as faltas', () => {
  const estado = estadoVazio();
  processarPassada(estado, [candidato()], 1000);
  processarPassada(estado, [], 2000); // 1 falta
  processarPassada(estado, [candidato()], 3000); // reaparece, zera
  const { fechadas } = processarPassada(estado, [], 4000); // 1 falta de novo, não 2
  assert.equal(fechadas.length, 0);
  const c = estado.ciclos[chaveBasis(candidato())];
  assert.equal(c.faltas, 1);
});

test('um candidato fechado que reaparece abre um ciclo novo, não reabre o velho', () => {
  const estado = estadoVazio();
  processarPassada(estado, [candidato()], 1000);
  for (let i = 1; i <= TOLERANCIA_FALTAS_BASIS; i++) processarPassada(estado, [], 1000 + i * 1000);
  const fechadoEm1 = estado.ciclos[chaveBasis(candidato())].fechadoEm;

  const { novas } = processarPassada(estado, [candidato()], 999_000);
  assert.equal(novas.length, 1);
  const c = estado.ciclos[chaveBasis(candidato())];
  assert.equal(c.abertoEm, 999_000);
  assert.equal(c.fechadoEm, undefined);
  assert.notEqual(fechadoEm1, undefined);
});

test('candidatos de exchanges diferentes com o mesmo symbol são ciclos separados', () => {
  const estado = estadoVazio();
  const a = candidato({ exchange: 'binanceusdm' });
  const b = candidato({ exchange: 'bybit' });
  const { novas } = processarPassada(estado, [a, b], 1000);
  assert.equal(novas.length, 2);
  assert.equal(Object.keys(estado.ciclos).length, 2);
});
