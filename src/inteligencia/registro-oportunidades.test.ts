/**
 * Testes de registro-oportunidades.ts — a garantia que mais importa aqui é
 * "nunca lança", porque isso roda dentro do ciclo do champion.
 * Rodar: node --test src/inteligencia/registro-oportunidades.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { registrarCiclo, lerCiclos, novoCycleId } from './registro-oportunidades.ts';

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'snowball-oport-'));
}

test('registra e relê um ciclo completo, ida e volta', () => {
  const dir = tmpDir();
  const ts = Date.parse('2026-08-08T12:00:00Z');
  const ok = registrarCiclo(dir, {
    cycleId: novoCycleId(ts, 'persistencia'), ts, modo: 'persistencia',
    candidatas: [{
      symbol: 'FOO/USDT:USDT', exchangeShort: 'bybit', exchangeLong: 'okx',
      spread: 0.001, consistencia: 0.9, duracaoHoras: 5, valorEsperado: 0.2,
      valorPorHora: 0.04, folga: 1.6, custo: 0.05, escorregamento: 0.0002,
      escorregamentoMedido: true, capitalNecessario: 50, saldoDisponivel: 70,
      score: 0.04, aprovada: true,
    }],
    escolhida: 'FOO/USDT:USDT', aprovadasNaoEscolhidas: [],
  });
  assert.equal(ok, true);
  const lidos = lerCiclos(dir, '2026-08-08');
  assert.equal(lidos.length, 1);
  assert.equal(lidos[0].candidatas[0].symbol, 'FOO/USDT:USDT');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('dois ciclos no mesmo dia se acumulam (append-only)', () => {
  const dir = tmpDir();
  const ts1 = Date.parse('2026-08-08T12:00:00Z');
  const ts2 = Date.parse('2026-08-08T12:05:00Z');
  registrarCiclo(dir, { cycleId: novoCycleId(ts1, 'persistencia'), ts: ts1, modo: 'persistencia', candidatas: [], aprovadasNaoEscolhidas: [] });
  registrarCiclo(dir, { cycleId: novoCycleId(ts2, 'persistencia'), ts: ts2, modo: 'persistencia', candidatas: [], aprovadasNaoEscolhidas: [] });
  assert.equal(lerCiclos(dir, '2026-08-08').length, 2);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('nunca lança mesmo com diretório base inválido (caminho com caractere nulo)', () => {
  assert.doesNotThrow(() => {
    const ok = registrarCiclo('\0invalido', { cycleId: 'x', ts: Date.now(), modo: 'persistencia', candidatas: [], aprovadasNaoEscolhidas: [] });
    assert.equal(ok, false);
  });
});

test('lerCiclos nunca lança para dia sem arquivo', () => {
  const dir = tmpDir();
  assert.doesNotThrow(() => {
    const lidos = lerCiclos(dir, '1999-01-01');
    assert.deepEqual(lidos, []);
  });
  fs.rmSync(dir, { recursive: true, force: true });
});

test('linha JSON corrompida no meio do arquivo não derruba a leitura das outras', () => {
  const dir = tmpDir();
  const sub = path.join(dir, 'inteligencia', 'oportunidades');
  fs.mkdirSync(sub, { recursive: true });
  fs.writeFileSync(path.join(sub, '2026-08-08.jsonl'),
    '{"cycleId":"a","ts":1,"modo":"persistencia","candidatas":[],"aprovadasNaoEscolhidas":[]}\n' +
    'isto não é json\n' +
    '{"cycleId":"b","ts":2,"modo":"persistencia","candidatas":[],"aprovadasNaoEscolhidas":[]}\n');
  const lidos = lerCiclos(dir, '2026-08-08');
  assert.equal(lidos.length, 2);
  fs.rmSync(dir, { recursive: true, force: true });
});
