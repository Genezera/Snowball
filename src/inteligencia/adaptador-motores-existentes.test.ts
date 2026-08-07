/**
 * Testes de adaptador-motores-existentes.ts — só LEITURA, nunca deveria
 * lançar mesmo com arquivo ausente/corrompido, e nunca deveria inventar
 * pnlNaoRealizado que o motor original não grava.
 *
 * Rodar: node --test src/inteligencia/adaptador-motores-existentes.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { lerMomentumAdaptado, lerParesAdaptado } from './adaptador-motores-existentes.ts';

function tmpDir() { return fs.mkdtempSync(path.join(os.tmpdir(), 'snowball-adapt-')); }

test('sem estado.json nenhum: disponivel=false, nunca lança, nunca inventa capital', () => {
  const dir = tmpDir();
  const r1 = lerMomentumAdaptado(dir);
  const r2 = lerParesAdaptado(dir);
  assert.equal(r1.disponivel, false);
  assert.equal(r2.disponivel, false);
  assert.equal(r1.capitalVirtual, 0);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('estado.json corrompido: cai pra disponivel=false em vez de lançar', () => {
  const dir = tmpDir();
  fs.mkdirSync(path.join(dir, 'momentum'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'momentum', 'estado.json'), 'isto não é json{{{');
  assert.doesNotThrow(() => {
    const r = lerMomentumAdaptado(dir);
    assert.equal(r.disponivel, false);
  });
  fs.rmSync(dir, { recursive: true, force: true });
});

test('estado.json válido: adapta capital/PnL/drawdown corretamente, e nunca finge ter marcação a mercado', () => {
  const dir = tmpDir();
  fs.mkdirSync(path.join(dir, 'momentum'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'momentum', 'estado.json'), JSON.stringify({
    iniciadoEm: 1000, capital: 190, capitalInicial: 200, pico: 205,
    posicoes: [{ symbol: 'BTC/USDT:USDT' }], fechados: 10, vitorias: 4,
    custosTotal: 3.5, halted: false, ultimoCicloTs: Date.now(),
  }));
  const r = lerMomentumAdaptado(dir);
  assert.equal(r.disponivel, true);
  assert.equal(r.pnlRealizado, -10);
  assert.equal(r.trades, 10);
  assert.equal(r.taxaVitoria, 0.4);
  assert.ok(r.drawdownMaxPct > 0, 'pico 205 vs capital 190 deveria mostrar drawdown');
  assert.equal(r.pnlNaoRealizadoDisponivel, false, 'nenhum dos dois motores grava marcação separada — nunca fingir que tem');
  assert.equal(r.posicoesAbertas, 1);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('estado real do projeto (se existir) nunca lança ao ser lido pelo adaptador', () => {
  assert.doesNotThrow(() => { lerMomentumAdaptado('.'); lerParesAdaptado('.'); });
});
