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

test('EPISÓDIOS: mesma combinação que some e reaparece após gap vira NOVO episódio', () => {
  const root = tmpRoot();
  const base = Date.now() - 3 * 3600_000; // começa 3h atrás
  // episódio 1: 3 obs próximas
  escreverCiclo(root, base, [candidata()]);
  escreverCiclo(root, base + 60_000, [candidata()]);
  escreverCiclo(root, base + 120_000, [candidata()]);
  // gap de 40 min (> 30 min) → encerra episódio 1
  // episódio 2 (atual): 2 obs recentes
  escreverCiclo(root, Date.now() - 60_000, [candidata({ score: 9.9 })]);
  escreverCiclo(root, Date.now() - 10_000, [candidata({ score: 9.9 })]);
  const r = montarOportunidades(root);
  assert.equal(r.items.length, 1, 'ainda é UMA opportunityKey (mesma combinação de mercado)');
  const o = r.items[0];
  assert.equal(o.observationCount, 5, 'observationCount = todas as observações da chave na janela');
  assert.equal(o.persistenceCycles, 2, 'persistenceCycles = só as do episódio ATUAL (2 recentes)');
  assert.equal(o.firstSeenAt, base, 'firstSeenAt = primeira observação de todas');
  assert.ok(o.episodeStartedAt > base + 120_000, 'episodeStartedAt = início do episódio novo, depois do gap');
  assert.equal(o.active, true, 'episódio atual está ativo (última obs recente)');
  assert.equal(o.episodeEndedAt, null, 'ativo → sem fim');
  assert.equal(o.opportunityKey, o.identity);
  assert.ok(o.episodeId.includes('#'), 'episodeId identifica a aparição');
  fs.rmSync(root, { recursive: true, force: true });
});

test('EPISÓDIOS: sem observação recente → episódio inativo com episodeEndedAt', () => {
  const root = tmpRoot();
  const base = Date.now() - 5 * 3600_000; // tudo velho (5h atrás)
  escreverCiclo(root, base, [candidata()]);
  escreverCiclo(root, base + 60_000, [candidata()]);
  const r = montarOportunidades(root);
  const o = r.items[0];
  assert.equal(o.active, false, 'última obs velha → episódio encerrado');
  assert.equal(o.episodeEndedAt, o.lastSeenAt, 'episodeEndedAt = última observação');
  fs.rmSync(root, { recursive: true, force: true });
});

// meia-noite UTC de HOJE — a única fronteira de arquivo diário entre o
// arquivo de "ontem" e o de "hoje" que o serviço lê. Sempre no passado (<=now).
function meiaNoiteHojeUTC(): number {
  return new Date(new Date().toISOString().slice(0, 10) + 'T00:00:00.000Z').getTime();
}

test('EPISÓDIOS cruzando MEIA-NOITE (troca de arquivo diário): gap < 30min mantém UM episódio, costurando os dois arquivos', () => {
  const root = tmpRoot();
  const meiaNoite = meiaNoiteHojeUTC();
  // A cai no arquivo de ONTEM (23:45), B no de HOJE (00:05) — gap 20min < 30min
  const a = meiaNoite - 15 * 60_000;
  const b = meiaNoite + 5 * 60_000;
  escreverCiclo(root, a, [candidata()]);
  escreverCiclo(root, b, [candidata({ score: 4.0 })]);
  const r = montarOportunidades(root);
  assert.equal(r.items.length, 1, 'mesma chave, mesma aparição — não vira duas por causa da troca de arquivo');
  const o = r.items[0];
  assert.equal(o.observationCount, 2, 'as duas observações contam, mesmo em arquivos diários diferentes');
  assert.equal(o.persistenceCycles, 2, 'gap < 30min → um único episódio contínuo atravessando a meia-noite');
  assert.equal(o.firstSeenAt, a, 'firstSeenAt = obs de ontem');
  assert.equal(o.episodeStartedAt, a, 'episódio começou ANTES da meia-noite e continua o mesmo depois');
  assert.equal(o.lastSeenAt, b, 'lastSeenAt = obs de hoje');
  assert.equal(r.coverage.arquivosProcessados.length, 2, 'os DOIS arquivos diários foram atravessados');
  fs.rmSync(root, { recursive: true, force: true });
});

test('EPISÓDIOS cruzando meia-noite: gap > 30min → episódio novo depois da meia-noite, chave preservada', () => {
  const root = tmpRoot();
  const meiaNoite = meiaNoiteHojeUTC();
  const a = meiaNoite - 40 * 60_000; // ontem 23:20
  const b = meiaNoite + 5 * 60_000;  // hoje 00:05 — gap 45min > 30min
  escreverCiclo(root, a, [candidata()]);
  escreverCiclo(root, b, [candidata({ score: 4.0 })]);
  const r = montarOportunidades(root);
  assert.equal(r.items.length, 1, 'ainda UMA opportunityKey');
  const o = r.items[0];
  assert.equal(o.observationCount, 2, 'ambas as observações da chave contam');
  assert.equal(o.persistenceCycles, 1, 'gap > 30min → episódio atual tem só a observação de hoje');
  assert.equal(o.episodeStartedAt, b, 'novo episódio começa depois da meia-noite');
  assert.equal(o.firstSeenAt, a, 'firstSeenAt da chave preservado (obs de ontem)');
  assert.equal(r.coverage.arquivosProcessados.length, 2, 'os dois arquivos diários foram lidos');
  fs.rmSync(root, { recursive: true, force: true });
});

test('episodeId ESTÁVEL após "restart da API" mesmo cruzando arquivo diário — 100% derivado do dado persistido', () => {
  const root = tmpRoot();
  const meiaNoite = meiaNoiteHojeUTC();
  escreverCiclo(root, meiaNoite - 15 * 60_000, [candidata()]);
  escreverCiclo(root, meiaNoite + 5 * 60_000, [candidata()]);
  const id1 = montarOportunidades(root).items[0].episodeId;
  const id2 = montarOportunidades(root).items[0].episodeId; // nova invocação = restart
  assert.equal(id1, id2, 'episodeId = `${key}#${episodeStartedAt}` é derivado só do arquivo, idêntico após restart');
  fs.rmSync(root, { recursive: true, force: true });
});

test('coverage/retenção: expõe arquivos, registros lidos e primeiro/último timestamp', () => {
  const root = tmpRoot();
  const base = Date.now();
  escreverCiclo(root, base, [candidata()]);
  const r = montarOportunidades(root);
  assert.ok(r.coverage.arquivosProcessados.length >= 1, 'lista os arquivos lidos');
  assert.equal(r.coverage.registrosLidos, 1);
  assert.equal(r.coverage.primeiroTs, base);
  assert.equal(r.coverage.ultimoTs, base);
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
