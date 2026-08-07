/**
 * Testes do coletor de oportunidades — a propriedade central é que a fonte
 * é PERSISTENTE (arquivo do motor), então os dados sobrevivem a qualquer
 * restart do frontend/API: o serviço só lê e agrega. Rodar:
 * node --experimental-strip-types --test dashboard-v2/api/tests/oportunidades.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { montarOportunidades } from '../services/oportunidades.ts';

function tmpRoot(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'snowball-opps-'));
  fs.mkdirSync(path.join(dir, 'inteligencia', 'oportunidades'), { recursive: true });
  return dir;
}
function escreverCiclo(root: string, ts: number, candidatas: any[], modo = 'persistencia') {
  const dia = new Date(ts).toISOString().slice(0, 10);
  const arq = path.join(root, 'inteligencia', 'oportunidades', `${dia}.jsonl`);
  fs.appendFileSync(arq, JSON.stringify({ cycleId: `${modo}-${ts}`, ts, modo, candidatas }) + '\n');
}
function candidata(over: any = {}) {
  return {
    symbol: 'ACE/USDT:USDT', exchangeShort: 'binanceusdm', exchangeLong: 'bybit',
    spread: 0.05, consistencia: 0.9, duracaoHoras: 2, valorEsperado: 0.5, valorPorHora: 0.25,
    folga: 0.3, custo: 0.2, escorregamento: 0.001, escorregamentoMedido: true,
    capitalNecessario: 50, saldoDisponivel: 60, score: 2.5, aprovada: true, ...over,
  };
}

test('agrega candidatas por identidade — dedup, não cria item novo por ciclo', () => {
  const root = tmpRoot();
  const base = Date.now();
  escreverCiclo(root, base, [candidata({ score: 1.0 })]);
  escreverCiclo(root, base + 60_000, [candidata({ score: 2.0 })]);
  escreverCiclo(root, base + 120_000, [candidata({ score: 3.0 })]);
  const r = montarOportunidades(root);
  assert.equal(r.items.length, 1, 'a mesma identidade em 3 ciclos vira UMA oportunidade, não três');
  const o = r.items[0];
  assert.equal(o.observationCount, 3, 'observationCount cresce a cada ciclo');
  assert.equal(o.persistenceCycles, 3);
  assert.equal(o.firstSeenAt, base, 'firstSeenAt preservado (primeiro ciclo)');
  assert.equal(o.lastSeenAt, base + 120_000, 'lastSeenAt avança (último ciclo)');
  assert.equal(o.qualityScore, 3.0, 'snapshot mais recente ganha (score do último ciclo)');
  fs.rmSync(root, { recursive: true, force: true });
});

test('campos não medidos vêm marcados tracked:false, nunca zero', () => {
  const root = tmpRoot();
  escreverCiclo(root, Date.now(), [candidata()]);
  const o = montarOportunidades(root).items[0];
  assert.equal(o.apr.tracked, false); assert.equal(o.apr.valor, null);
  assert.equal(o.liquidity.tracked, false); assert.equal(o.liquidity.valor, null);
  assert.equal(o.settlementAt.tracked, false); assert.equal(o.settlementAt.valor, null);
  assert.equal(o.fundingCombined.tracked, false);
  fs.rmSync(root, { recursive: true, force: true });
});

test('eligible/blocked e blockReasons vêm de aprovada/motivoRejeicao', () => {
  const root = tmpRoot();
  const base = Date.now();
  escreverCiclo(root, base, [
    candidata({ symbol: 'A/USDT:USDT', aprovada: true }),
    candidata({ symbol: 'B/USDT:USDT', aprovada: false, motivoRejeicao: 'payback_insuficiente' }),
  ]);
  const r = montarOportunidades(root);
  assert.equal(r.summary.eligible, 1);
  assert.equal(r.summary.blocked, 1);
  const b = r.items.find((x) => x.symbol === 'B/USDT:USDT')!;
  assert.equal(b.eligible, false);
  assert.deepEqual(b.blockReasons, ['payback_insuficiente']);
  fs.rmSync(root, { recursive: true, force: true });
});

test('CONTINUIDADE: reler o mesmo arquivo (simula restart da API) dá o mesmo resultado — dados não zeram', () => {
  const root = tmpRoot();
  const base = Date.now();
  escreverCiclo(root, base, [candidata()]);
  escreverCiclo(root, base + 60_000, [candidata()]);
  const r1 = montarOportunidades(root);
  // "restart da API/frontend" == nova invocação, sem estado em memória; o
  // arquivo persistente é a única fonte.
  const r2 = montarOportunidades(root);
  assert.equal(r2.items.length, r1.items.length);
  assert.equal(r2.items[0].firstSeenAt, r1.items[0].firstSeenAt, 'firstSeenAt preservado entre "restarts"');
  assert.equal(r2.items[0].observationCount, 2, 'observationCount não zera');
  fs.rmSync(root, { recursive: true, force: true });
});

test('arquivo inexistente / ciclo corrompido nunca lança — estado empty honesto', () => {
  const root = tmpRoot();
  assert.doesNotThrow(() => {
    const r = montarOportunidades(root);
    assert.equal(r.items.length, 0);
    assert.equal(r.collectorStatus.estado, 'empty');
  });
  // linha corrompida no meio não derruba as boas
  const base = Date.now();
  const dia = new Date(base).toISOString().slice(0, 10);
  fs.writeFileSync(path.join(root, 'inteligencia', 'oportunidades', `${dia}.jsonl`),
    JSON.stringify({ cycleId: 'x', ts: base, modo: 'persistencia', candidatas: [candidata()] }) + '\n{corrompido\n');
  const r = montarOportunidades(root);
  assert.equal(r.items.length, 1, 'a linha corrompida é pulada, a boa aparece');
  fs.rmSync(root, { recursive: true, force: true });
});
