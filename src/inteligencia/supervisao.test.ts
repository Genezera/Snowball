/**
 * Testes de supervisao.ts.
 * Rodar: node --test src/inteligencia/supervisao.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  travar, destravar, novoHeartbeat, carregarOuRetomar, salvarHeartbeat,
  idadeUltimoCiclo, labProvavelmenteParado, registrarLatencia, registrarErro, errosNaJanela,
} from './supervisao.ts';

function tmpDir() { return fs.mkdtempSync(path.join(os.tmpdir(), 'snowball-sup-')); }

test('travar: primeira instância consegue, devolve o próprio PID', () => {
  const dir = tmpDir();
  const r = travar(dir);
  assert.ok(r);
  assert.equal(r!.pid, process.pid);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('travar: segunda tentativa com o MESMO processo vivo (simulado com o próprio PID) falha', () => {
  const dir = tmpDir();
  travar(dir); // grava lock com process.pid, que está vivo (somos nós mesmos)
  const segunda = travar(dir);
  assert.equal(segunda, null, 'não deveria conseguir travar de novo com o lock de um processo vivo');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('travar: lock de PID morto é tratado como resíduo, não como impedimento', () => {
  const dir = tmpDir();
  const p = path.join(dir, 'inteligencia', 'lab.lock');
  fs.mkdirSync(path.dirname(p), { recursive: true });
  // PID praticamente impossível de estar vivo
  fs.writeFileSync(p, JSON.stringify({ pid: 999999, ts: Date.now() }));
  const r = travar(dir);
  assert.ok(r, 'lock de processo morto não deveria bloquear a nova instância');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('destravar remove o lock, e destravar de novo não lança', () => {
  const dir = tmpDir();
  travar(dir);
  destravar(dir);
  assert.doesNotThrow(() => destravar(dir));
  fs.rmSync(dir, { recursive: true, force: true });
});

test('carregarOuRetomar: sem heartbeat anterior, começa do zero com reinicios=0', () => {
  const dir = tmpDir();
  const hb = carregarOuRetomar(dir);
  assert.equal(hb.reinicios, 0);
  assert.equal(hb.ciclosProcessados, 0);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('carregarOuRetomar: com heartbeat anterior, preserva contadores e incrementa reinicios', () => {
  const dir = tmpDir();
  const hb1 = novoHeartbeat();
  hb1.ciclosProcessados = 42;
  hb1.reinicios = 2;
  salvarHeartbeat(dir, hb1);
  const hb2 = carregarOuRetomar(dir);
  assert.equal(hb2.ciclosProcessados, 42, 'retomada idempotente não deveria zerar contadores');
  assert.equal(hb2.reinicios, 3);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('carregarOuRetomar: heartbeat com JSON corrompido não lança — começa do zero', () => {
  const dir = tmpDir();
  const p = path.join(dir, 'inteligencia', 'heartbeat.json');
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, 'isto não é json{{{');
  assert.doesNotThrow(() => {
    const hb = carregarOuRetomar(dir);
    assert.equal(hb.ciclosProcessados, 0);
  });
  fs.rmSync(dir, { recursive: true, force: true });
});

test('idadeUltimoCiclo e labProvavelmenteParado', () => {
  const hb = novoHeartbeat();
  assert.equal(idadeUltimoCiclo(hb), Infinity, 'nunca rodou nenhum ciclo ainda');
  hb.ultimoCiclo = Date.now() - 20 * 60_000; // 20 min atrás
  assert.ok(labProvavelmenteParado(hb, 5 * 60_000), '20min de idade com ciclo esperado de 5min deveria contar como parado');
  hb.ultimoCiclo = Date.now() - 1000;
  assert.ok(!labProvavelmenteParado(hb, 5 * 60_000));
});

test('registrarLatencia mantém só a janela recente (cap de 200), sem crescer sem limite', () => {
  const hb = novoHeartbeat();
  for (let i = 0; i < 250; i++) registrarLatencia(hb, i);
  assert.equal(hb.latenciasRecentesMs.length, 200);
  assert.equal(hb.latenciasRecentesMs[0], 50, 'deveria ter descartado as 50 amostras mais antigas, não as mais novas');
  assert.equal(hb.latenciasRecentesMs[199], 249);
});

test('registrarErro e errosNaJanela: erro antigo sai da contagem de 24h, recente entra', () => {
  const hb = novoHeartbeat();
  registrarErro(hb, 'erro de teste recente');
  assert.equal(errosNaJanela(hb, 24 * 3_600_000), 1);
  hb.errosRecentes[0].ts = Date.now() - 25 * 3_600_000; // simula erro de 25h atrás
  assert.equal(errosNaJanela(hb, 24 * 3_600_000), 0, 'erro fora da janela de 24h não deveria contar');
});

test('carregarOuRetomar migra heartbeat antigo (sem os campos novos) sem lançar, preenchendo defaults', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'snowball-sup-mig-'));
  const p = path.join(dir, 'inteligencia', 'heartbeat.json');
  fs.mkdirSync(path.dirname(p), { recursive: true });
  // heartbeat "da v2" — sem ciclosComCandidata/latenciasRecentesMs/errosRecentes
  fs.writeFileSync(p, JSON.stringify({ pid: 1, startedAt: 1, ultimoCiclo: 1, ciclosProcessados: 5, ciclosComErro: 0, reinicios: 0, statusPorChallenger: {}, ultimoEstadoSalvo: 1 }));
  const hb = carregarOuRetomar(dir);
  assert.equal(hb.ciclosComCandidata, 0);
  assert.deepEqual(hb.latenciasRecentesMs, []);
  assert.deepEqual(hb.errosRecentes, []);
  fs.rmSync(dir, { recursive: true, force: true });
});
