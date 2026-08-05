/**
 * Testes da seleção de portfólio sem sobreposição de perna.
 *
 * Rodar: node --test src/pairs/portfolio.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { selecionarSemSobreposicao } from './portfolio.ts';
import type { ParCandidato } from './cointegracao.ts';

function par(a: string, b: string, meiaVida: number): ParCandidato {
  return { a, b, hedgeRatio: 1, intercepto: 0, correlacao: 0.9, meiaVidaBarras: meiaVida, desvioResiduo: 0.01 };
}

test('sem sobreposição nenhuma, aceita todos até o limite', () => {
  const cand = [par('A', 'B', 1), par('C', 'D', 2), par('E', 'F', 3)];
  const sel = selecionarSemSobreposicao(cand, 10);
  assert.equal(sel.length, 3);
});

test('rejeita par cujo ativo já foi usado, mesmo em ordem de meia-vida', () => {
  const cand = [par('A', 'B', 1), par('A', 'C', 2), par('B', 'D', 3), par('E', 'F', 4)];
  const sel = selecionarSemSobreposicao(cand, 10);
  // A|B ganha (menor meia-vida). A|C e B|D são rejeitados (repetem A ou B). E|F entra.
  assert.deepEqual(sel.map((c) => `${c.a}|${c.b}`), ['A|B', 'E|F']);
});

test('respeita o limite máximo de pares', () => {
  const cand = [par('A', 'B', 1), par('C', 'D', 2), par('E', 'F', 3), par('G', 'H', 4)];
  const sel = selecionarSemSobreposicao(cand, 2);
  assert.equal(sel.length, 2);
});

test('nenhum ativo aparece em mais de um par selecionado', () => {
  const cand = [
    par('HOT', 'FIL', 1), par('HOT', 'KSM', 2), par('HOT', '1INCH', 3), par('HOT', 'ZEN', 4),
    par('AXS', 'RVN', 5), par('COTI', 'ONE', 6),
  ];
  const sel = selecionarSemSobreposicao(cand, 10);
  const ativos = sel.flatMap((c) => [c.a, c.b]);
  assert.equal(new Set(ativos).size, ativos.length, 'nenhum ativo repetido');
  assert.ok(sel.some((c) => c.a === 'HOT' || c.b === 'HOT'), 'HOT aparece em exatamente um par');
});

test('lista vazia devolve seleção vazia', () => {
  assert.deepEqual(selecionarSemSobreposicao([], 10), []);
});

test('maxPares zero devolve vazio mesmo com candidatos', () => {
  assert.deepEqual(selecionarSemSobreposicao([par('A', 'B', 1)], 0), []);
});
