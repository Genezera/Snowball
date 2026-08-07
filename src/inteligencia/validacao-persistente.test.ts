/**
 * Testes de validacao-persistente.ts — a garantia central é que
 * validationStart NUNCA muda por reinício de processo, só por mudança real
 * de versão.
 *
 * Rodar: node --test src/inteligencia/validacao-persistente.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { carregarOuCriarJanelaValidacao } from './validacao-persistente.ts';

function tmpDir() { return fs.mkdtempSync(path.join(os.tmpdir(), 'snowball-valwin-')); }

test('primeira chamada cria a janela com o instante atual', () => {
  const dir = tmpDir();
  const j = carregarOuCriarJanelaValidacao(dir, 'v1', 'v1');
  assert.ok(j.validationStart > 0);
  assert.equal(j.strategyVersion, 'v1');
  assert.match(j.motivoDoReset, /primeira janela/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('reinício simulado (PID novo, mesma versão): validationStart NUNCA muda', () => {
  const dir = tmpDir();
  const j1 = carregarOuCriarJanelaValidacao(dir, 'v1', 'v1');
  // "reinicia o processo" — chama de novo, mesma versão
  const j2 = carregarOuCriarJanelaValidacao(dir, 'v1', 'v1');
  assert.equal(j2.validationStart, j1.validationStart);
  assert.equal(j2.validationWindowId, j1.validationWindowId);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('mudança de strategyVersion reinicia a janela, com motivo explícito', () => {
  const dir = tmpDir();
  const j1 = carregarOuCriarJanelaValidacao(dir, 'v1', 'v1');
  const j2 = carregarOuCriarJanelaValidacao(dir, 'v2', 'v1');
  assert.notEqual(j2.validationStart, j1.validationStart);
  assert.notEqual(j2.validationWindowId, j1.validationWindowId);
  assert.match(j2.motivoDoReset, /strategyVersion v1→v2/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('mudança de configVersion também reinicia a janela', () => {
  const dir = tmpDir();
  const j1 = carregarOuCriarJanelaValidacao(dir, 'v1', 'v1');
  const j2 = carregarOuCriarJanelaValidacao(dir, 'v1', 'v2');
  assert.notEqual(j2.validationStart, j1.validationStart);
  assert.match(j2.motivoDoReset, /configVersion v1→v2/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('JSON corrompido: recria em vez de lançar', () => {
  const dir = tmpDir();
  const p = path.join(dir, 'inteligencia', 'dashboard', 'validation-window.json');
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, 'não é json{{');
  assert.doesNotThrow(() => {
    const j = carregarOuCriarJanelaValidacao(dir, 'v1', 'v1');
    assert.ok(j.validationStart > 0);
  });
  fs.rmSync(dir, { recursive: true, force: true });
});

test('muitas chamadas seguidas com a mesma versão: fica sempre estável (simula muitos ciclos do orquestrador)', () => {
  const dir = tmpDir();
  const primeira = carregarOuCriarJanelaValidacao(dir, 'v1', 'v1');
  for (let i = 0; i < 20; i++) {
    const j = carregarOuCriarJanelaValidacao(dir, 'v1', 'v1');
    assert.equal(j.validationStart, primeira.validationStart);
  }
  fs.rmSync(dir, { recursive: true, force: true });
});
