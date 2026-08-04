/**
 * Testes da simulação de posição escalonada.
 *
 * Rodar: node --test src/funding/escalonado.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { simularAtual, simularEscalonado, compararEstrategias, type ParametrosSimulacao } from './escalonado.ts';

const P: ParametrosSimulacao = { notional: 250, taxa: 0.0005, margemPayback: 1.5, fracaoEstagio1: 0.25 };

test('ciclo curto demais: nem o portão atual nem o escalonado abrem', () => {
  const c = { duracaoHoras: 0.5, spreadMedio: 0.0002, consistencia: 1 };
  assert.equal(simularAtual(c, P).abriu, false);
  assert.equal(simularEscalonado(c, P).abriu, false);
});

test('ciclo longo e consistente: os dois abrem, e o valor é positivo', () => {
  const c = { duracaoHoras: 400, spreadMedio: 0.001, consistencia: 1 };
  const a = simularAtual(c, P);
  const e = simularEscalonado(c, P);
  assert.equal(a.abriu, true);
  assert.equal(e.abriu, true);
  assert.ok(a.valor > 0);
  assert.ok(e.valor > 0);
});

test('zona intermediária: escalonado abre uma fatia onde o atual fica de fora', () => {
  // spread 0,1% e consistência 100% dão payback de 16h: gatilho de 1,0x em
  // 16h, gatilho de 1,5x em 24h. 20h cai exatamente entre os dois.
  const c = { duracaoHoras: 20, spreadMedio: 0.001, consistencia: 1 };
  const a = simularAtual(c, P);
  const e = simularEscalonado(c, P);
  assert.equal(a.abriu, false, 'o portão atual não chega a abrir nesta janela');
  assert.equal(e.abriu, true, 'o escalonado já pegou a fatia pequena');
});

test('escalonado nunca abre mais tarde que o atual', () => {
  const casos = [
    { duracaoHoras: 10, spreadMedio: 0.002, consistencia: 0.8 },
    { duracaoHoras: 100, spreadMedio: 0.0005, consistencia: 0.5 },
    { duracaoHoras: 5, spreadMedio: 0.01, consistencia: 1 },
  ];
  for (const c of casos) {
    const a = simularAtual(c, P);
    const e = simularEscalonado(c, P);
    if (a.abriu) {
      assert.ok(e.abriu, 'se o atual abriu, o escalonado (mais cedo) também deveria');
      assert.ok((e.tHoraDaAbertura ?? Infinity) <= (a.tHoraDaAbertura ?? Infinity));
    }
  }
});

test('consistência zero nunca dispara gatilho nenhum', () => {
  const c = { duracaoHoras: 1000, spreadMedio: 0.01, consistencia: 0 };
  assert.equal(simularAtual(c, P).abriu, false);
  assert.equal(simularEscalonado(c, P).abriu, false);
});

test('compararEstrategias agrega sobre uma lista de ciclos', () => {
  const ciclos = [
    { duracaoHoras: 0.5, spreadMedio: 0.0002, consistencia: 1 },   // nenhum abre
    { duracaoHoras: 20, spreadMedio: 0.001, consistencia: 1 },     // só escalonado (gatilhos em 16h/24h)
    { duracaoHoras: 400, spreadMedio: 0.001, consistencia: 1 },    // os dois
  ];
  const cmp = compararEstrategias(ciclos, P);
  assert.equal(cmp.ciclos, 3);
  assert.equal(cmp.atual.abriu, 1);
  assert.equal(cmp.escalonado.abriu, 2);
});
