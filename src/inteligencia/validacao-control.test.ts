/**
 * Testes de validacao-control.ts, com diários sintéticos (sem depender do
 * champion real estar rodando).
 * Rodar: node --test src/inteligencia/validacao-control.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { validarControl } from './validacao-control.ts';

function tmpDir() { return fs.mkdtempSync(path.join(os.tmpdir(), 'snowball-val-')); }
function escrever(dir: string, relPath: string, linhas: object[]) {
  const p = path.join(dir, relPath);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, linhas.map((l) => JSON.stringify(l)).join('\n') + '\n');
}

test('sem nenhum evento em nenhum dos dois lados: 0 comparáveis, status em andamento', () => {
  const dir = tmpDir();
  const r = validarControl(dir, Date.now() - 3_600_000);
  assert.equal(r.decisoesComparaveis, 0);
  assert.equal(r.status, 'validacao_em_andamento');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('decisões idênticas (mesmo símbolo, mesmo tipo, timestamps próximos) contam como iguais', () => {
  const dir = tmpDir();
  const ts = Date.now();
  escrever(dir, 'spread/diario.jsonl', [{ ts, evento: 'abre', symbol: 'FOO', notional: 100, custo: 0.1 }]);
  escrever(dir, 'inteligencia/challengers/challenger-control/diario.jsonl', [{ ts: ts + 5000, evento: 'abre', symbol: 'FOO', notional: 100, custo: 0.1 }]);
  const r = validarControl(dir, ts - 60_000);
  assert.equal(r.decisoesComparaveis, 1);
  assert.equal(r.decisoesIguais, 1);
  assert.equal(r.fidelidadeDecisoes, 1);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('champion abre, control não faz nada nesse instante: diverge, conta como não-comparável ao control', () => {
  const dir = tmpDir();
  const ts = Date.now();
  escrever(dir, 'spread/diario.jsonl', [{ ts, evento: 'abre', symbol: 'FOO', notional: 100 }]);
  escrever(dir, 'inteligencia/challengers/challenger-control/diario.jsonl', []);
  const r = validarControl(dir, ts - 60_000);
  assert.equal(r.decisoesComparaveis, 1);
  assert.equal(r.decisoesIguais, 0);
  assert.ok(r.comparacoes[0].divergencia);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('status só vira "validado" quando TODAS as 5 condições batem, não com fidelidade parcial', () => {
  const dir = tmpDir();
  const ts = Date.now();
  // só abertura, nunca fechamento nem funding — não deveria validar mesmo com decisões iguais
  escrever(dir, 'spread/diario.jsonl', [{ ts, evento: 'abre', symbol: 'FOO', notional: 100, custo: 0.1 }]);
  escrever(dir, 'inteligencia/challengers/challenger-control/diario.jsonl', [{ ts: ts + 1000, evento: 'abre', symbol: 'FOO', notional: 100, custo: 0.1 }]);
  const r = validarControl(dir, ts - 60_000);
  assert.equal(r.fidelidadeDecisoes, 1, 'fidelidade das decisões observadas é 100%');
  assert.equal(r.status, 'validacao_em_andamento', 'mas sem fechamento nem funding, não pode validar ainda');
  assert.equal(r.condicoes.posicaoAbertaEFechada, false);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('leitura (heartbeat) do champion nunca conta como decisão comparável', () => {
  const dir = tmpDir();
  const ts = Date.now();
  escrever(dir, 'spread/diario.jsonl', [{ ts, evento: 'leitura', capital: 600 }]);
  const r = validarControl(dir, ts - 60_000);
  assert.equal(r.decisoesComparaveis, 0);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('custo fora da tolerância de 15% marca condição de custo como falsa', () => {
  const dir = tmpDir();
  const ts = Date.now();
  escrever(dir, 'spread/diario.jsonl', [
    { ts, evento: 'abre', symbol: 'FOO', notional: 100, custo: 1.0 },
    { ts: ts + 8 * 3_600_000, evento: 'fecha', symbol: 'FOO', custo: 1.0 },
    { ts: ts + 4 * 3_600_000, evento: 'funding', symbol: 'FOO', ganho: 0.5 },
  ]);
  escrever(dir, 'inteligencia/challengers/challenger-control/diario.jsonl', [
    { ts: ts + 1000, evento: 'abre', symbol: 'FOO', notional: 100, custo: 2.0 }, // 100% de diferença
    { ts: ts + 8 * 3_600_000 + 1000, evento: 'fecha', symbol: 'FOO', custo: 1.0 },
    { ts: ts + 4 * 3_600_000 + 1000, evento: 'funding', symbol: 'FOO', ganho: 0.5 },
  ]);
  const r = validarControl(dir, ts - 60_000, 24 * 3_600_000);
  assert.equal(r.condicoes.custoDentroDaTolerancia, false);
  fs.rmSync(dir, { recursive: true, force: true });
});
