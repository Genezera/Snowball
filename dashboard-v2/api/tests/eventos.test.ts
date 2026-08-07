/**
 * Testes do transporte incremental — critérios da Parte 11:
 * zero evento perdido, zero duplicado, ID estável, ordenação determinística,
 * cursor resistente a rotação (Parte 6).
 *
 * Rodar: node --experimental-strip-types --test dashboard-v2/api/tests/eventos.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { buscarEventosIncremental, decodificarCursor, codificarCursor } from '../services/eventos.ts';

function tmpRoot(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'snowball-v2api-'));
  fs.mkdirSync(path.join(dir, 'spread'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'inteligencia', 'challengers', 'challenger-teste'), { recursive: true });
  return dir;
}
function escreverDiarioChallenger(root: string, id: string, linhas: any[]) {
  const p = path.join(root, 'inteligencia', 'challengers', id, 'diario.jsonl');
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, linhas.map((l) => JSON.stringify(l)).join('\n') + '\n');
}
function escreverDiarioChampion(root: string, linhas: any[]) {
  fs.writeFileSync(path.join(root, 'spread', 'diario.jsonl'), linhas.map((l) => JSON.stringify(l)).join('\n') + '\n');
}

test('evento único: aparece uma vez, com eventId estável', () => {
  const root = tmpRoot();
  escreverDiarioChallenger(root, 'challenger-teste', [{ eventId: 'challenger-teste-1', sequenceNumber: 1, ts: 1000, evento: 'abre' }]);
  const r = buscarEventosIncremental(root, [{ fonte: 'challenger-teste', ehChampion: false }], null, 100);
  assert.equal(r.eventos.length, 1);
  assert.equal(r.eventos[0].eventId, 'challenger-teste-1');
  fs.rmSync(root, { recursive: true, force: true });
});

test('eventos com o mesmo timestamp: os dois aparecem, nunca colapsam num só', () => {
  const root = tmpRoot();
  escreverDiarioChampion(root, [
    { ts: 5000, evento: 'bloqueado', motivo: 'A' },
    { ts: 5000, evento: 'bloqueado', motivo: 'B' },
  ]);
  const r = buscarEventosIncremental(root, [{ fonte: 'champion', ehChampion: true }], null, 100);
  assert.equal(r.eventos.length, 2);
  assert.notEqual(r.eventos[0].eventId, r.eventos[1].eventId, 'IDs precisam ser diferentes mesmo com timestamp igual');
  fs.rmSync(root, { recursive: true, force: true });
});

test('eventos legados sem sequenceNumber: eventId por geração+byteOffset, marcado idLegado=true', () => {
  const root = tmpRoot();
  escreverDiarioChampion(root, [{ ts: 1000, evento: 'abre', symbol: 'BTC' }]);
  const r = buscarEventosIncremental(root, [{ fonte: 'champion', ehChampion: true }], null, 100);
  assert.equal(r.eventos[0].idLegado, true);
  assert.equal(r.eventos[0].eventId, 'champion:g0:b0', 'geração 0, byte offset 0 (primeira linha do arquivo)');
  fs.rmSync(root, { recursive: true, force: true });
});

test('cursor incremental: segunda chamada só traz o que é NOVO, nunca repete o que já foi entregue', () => {
  const root = tmpRoot();
  escreverDiarioChallenger(root, 'challenger-teste', [
    { eventId: 'c-1', sequenceNumber: 1, ts: 1000, evento: 'abre' },
    { eventId: 'c-2', sequenceNumber: 2, ts: 2000, evento: 'funding' },
  ]);
  const r1 = buscarEventosIncremental(root, [{ fonte: 'challenger-teste', ehChampion: false }], null, 100);
  assert.equal(r1.eventos.length, 2);

  escreverDiarioChallenger(root, 'challenger-teste', [
    { eventId: 'c-1', sequenceNumber: 1, ts: 1000, evento: 'abre' },
    { eventId: 'c-2', sequenceNumber: 2, ts: 2000, evento: 'funding' },
    { eventId: 'c-3', sequenceNumber: 3, ts: 3000, evento: 'fecha' },
  ]);
  const r2 = buscarEventosIncremental(root, [{ fonte: 'challenger-teste', ehChampion: false }], r1.nextCursor, 100);
  assert.equal(r2.eventos.length, 1, 'só o evento 3 é novo — 1 e 2 não deveriam reaparecer');
  assert.equal(r2.eventos[0].eventId, 'c-3');
  fs.rmSync(root, { recursive: true, force: true });
});

test('cursor sobrevive a "reinício" — decodificar de novo o mesmo cursor devolve a mesma posição', () => {
  const cursor = codificarCursor({
    'challenger-x': { fileIdentity: 'abc:def', generation: 0, position: 42, lastEventId: 'x-42' },
    champion: { fileIdentity: 'ghi:jkl', generation: 1, position: 100, lastEventId: 'champion-100' },
  });
  const decodificado = decodificarCursor(cursor);
  assert.equal(decodificado['challenger-x'].position, 42);
  assert.equal(decodificado.champion.generation, 1);
});

test('cursor corrompido/inválido nunca lança — cai pra estado vazio', () => {
  assert.doesNotThrow(() => {
    const estado = decodificarCursor('isto não é base64 válido de um json{{{');
    assert.deepEqual(estado, {});
  });
});

test('cursor de formato ANTIGO (número puro, pré-rotação) não lança — tratado como fonte nunca vista', () => {
  const cursorAntigo = Buffer.from(JSON.stringify({ 'challenger-teste': 5 }), 'utf8').toString('base64');
  assert.doesNotThrow(() => {
    const estado = decodificarCursor(cursorAntigo);
    assert.deepEqual(estado, {}, 'formato antigo é incompatível — cai pra vazio em vez de tentar interpretar um número como CursorFonte');
  });
});

test('limite corta a entrega, mas hasMore avisa e o cursor NÃO pula os eventos cortados', () => {
  const root = tmpRoot();
  escreverDiarioChallenger(root, 'challenger-teste', [
    { eventId: 'c-1', sequenceNumber: 1, ts: 1000, evento: 'abre' },
    { eventId: 'c-2', sequenceNumber: 2, ts: 2000, evento: 'funding' },
    { eventId: 'c-3', sequenceNumber: 3, ts: 3000, evento: 'fecha' },
  ]);
  const r1 = buscarEventosIncremental(root, [{ fonte: 'challenger-teste', ehChampion: false }], null, 1);
  assert.equal(r1.eventos.length, 1);
  assert.equal(r1.hasMore, true);
  const r2 = buscarEventosIncremental(root, [{ fonte: 'challenger-teste', ehChampion: false }], r1.nextCursor, 100);
  assert.equal(r2.eventos.length, 2, 'os 2 eventos que ficaram de fora do limite anterior deveriam vir agora, nenhum perdido');
  fs.rmSync(root, { recursive: true, force: true });
});

test('múltiplas fontes: merge cronológico correto entre challenger e champion', () => {
  const root = tmpRoot();
  escreverDiarioChampion(root, [{ ts: 1000, evento: 'funding', symbol: 'A' }]);
  escreverDiarioChallenger(root, 'challenger-teste', [{ eventId: 'c-1', sequenceNumber: 1, ts: 2000, evento: 'abre' }]);
  const r = buscarEventosIncremental(root, [{ fonte: 'champion', ehChampion: true }, { fonte: 'challenger-teste', ehChampion: false }], null, 100);
  assert.equal(r.eventos.length, 2);
  assert.ok(r.eventos[0].timestamp < r.eventos[1].timestamp, 'ordem cronológica deveria ser respeitada entre fontes diferentes');
  fs.rmSync(root, { recursive: true, force: true });
});

test('10.000 eventos sintéticos: nenhum perdido, nenhum duplicado, tempo razoável', () => {
  const root = tmpRoot();
  const linhas = Array.from({ length: 10_000 }, (_, i) => ({ eventId: `c-${i + 1}`, sequenceNumber: i + 1, ts: 1000 + i, evento: 'leitura' }));
  escreverDiarioChallenger(root, 'challenger-teste', linhas);

  const t0 = Date.now();
  let cursor: string | null = null;
  let total = 0;
  const idsVistos = new Set<string>();
  let paginas = 0;
  while (true) {
    const r = buscarEventosIncremental(root, [{ fonte: 'challenger-teste', ehChampion: false }], cursor, 500);
    for (const ev of r.eventos) {
      assert.ok(!idsVistos.has(ev.eventId), 'nenhum eventId deveria se repetir entre páginas');
      idsVistos.add(ev.eventId);
    }
    total += r.eventos.length;
    cursor = r.nextCursor;
    paginas++;
    if (!r.hasMore) break;
    if (paginas > 50) throw new Error('paginação não convergiu — possível loop infinito');
  }
  const duracaoMs = Date.now() - t0;
  assert.equal(total, 10_000, 'todos os 10.000 eventos deveriam ter sido entregues, sem perda');
  assert.equal(idsVistos.size, 10_000, 'nenhum duplicado');
  assert.ok(duracaoMs < 5000, `10k eventos em ${paginas} páginas levou ${duracaoMs}ms — deveria ser bem mais rápido que isso`);
  fs.rmSync(root, { recursive: true, force: true });
});

test('fairness: uma fonte com backlog enorme não starva as outras numa única página', () => {
  const root = tmpRoot();
  escreverDiarioChampion(root, Array.from({ length: 1000 }, (_, i) => ({ ts: i, evento: 'bloqueado' })));
  escreverDiarioChallenger(root, 'challenger-teste', [{ eventId: 'c-1', sequenceNumber: 1, ts: 2000, evento: 'abre' }]);
  const r = buscarEventosIncremental(root, [{ fonte: 'champion', ehChampion: true }, { fonte: 'challenger-teste', ehChampion: false }], null, 100);
  const temChallenger = r.eventos.some((e) => e.challengerId === 'challenger-teste');
  assert.ok(temChallenger, 'o único evento do challenger deveria aparecer na primeira página, mesmo com o champion tendo 1000 eventos mais antigos');
  fs.rmSync(root, { recursive: true, force: true });
});

test('fonte sem nenhum evento novo: não quebra, cursor dessa fonte fica igual', () => {
  const root = tmpRoot();
  const r = buscarEventosIncremental(root, [{ fonte: 'challenger-inexistente', ehChampion: false }], null, 100);
  assert.equal(r.eventos.length, 0);
  assert.equal(r.hasMore, false);
});

// ── Parte 6 — cursor resistente a rotação ──────────────────────────────────

test('rotação: arquivo TRUNCADO (cursor maior que o tamanho atual) reinicia do byte 0, nunca lança', () => {
  const root = tmpRoot();
  escreverDiarioChampion(root, Array.from({ length: 20 }, (_, i) => ({ ts: 1000 + i, evento: 'bloqueado' })));
  const r1 = buscarEventosIncremental(root, [{ fonte: 'champion', ehChampion: true }], null, 100);
  assert.equal(r1.eventos.length, 20);

  // arquivo truncado e recriado com SÓ 2 linhas (simula rotação de log)
  escreverDiarioChampion(root, [{ ts: 5000, evento: 'abre' }, { ts: 5001, evento: 'fecha' }]);
  const r2 = buscarEventosIncremental(root, [{ fonte: 'champion', ehChampion: true }], r1.nextCursor, 100);
  assert.equal(r2.rotacoesDetectadas.length, 1, 'deveria ter detectado uma rotação');
  assert.equal(r2.rotacoesDetectadas[0].fonte, 'champion');
  assert.equal(r2.rotacoesDetectadas[0].oldGeneration, 0);
  assert.equal(r2.rotacoesDetectadas[0].newGeneration, 1);
  assert.equal(r2.eventos.length, 2, 'as 2 linhas do arquivo novo deveriam ser entregues, sem tentar continuar do byte antigo');
  fs.rmSync(root, { recursive: true, force: true });
});

test('rotação: mesma linha reaproveitada não é tratada como o mesmo evento após rotação (geração muda o eventId legado)', () => {
  const root = tmpRoot();
  escreverDiarioChampion(root, [{ ts: 1000, evento: 'abre' }]);
  const r1 = buscarEventosIncremental(root, [{ fonte: 'champion', ehChampion: true }], null, 100);
  const idAntes = r1.eventos[0].eventId;

  // arquivo recriado do zero com CONTEÚDO DIFERENTE na mesma posição (byte 0) — identidade muda (hash de cabeçalho)
  escreverDiarioChampion(root, [{ ts: 9999, evento: 'fecha' }]);
  const r2 = buscarEventosIncremental(root, [{ fonte: 'champion', ehChampion: true }], r1.nextCursor, 100);
  const idDepois = r2.eventos[0]?.eventId;
  assert.notEqual(idAntes, idDepois, 'o evento da geração nova no mesmo byte 0 precisa ter um eventId diferente do da geração antiga');
  fs.rmSync(root, { recursive: true, force: true });
});

test('cursor maior que o arquivo atual (sem termos lido antes) nunca lança', () => {
  const root = tmpRoot();
  escreverDiarioChampion(root, [{ ts: 1000, evento: 'abre' }]);
  const cursorFabricado = codificarCursor({ champion: { fileIdentity: 'inexistente:0', generation: 0, position: 999999, lastEventId: null } });
  assert.doesNotThrow(() => {
    const r = buscarEventosIncremental(root, [{ fonte: 'champion', ehChampion: true }], cursorFabricado, 100);
    assert.equal(r.rotacoesDetectadas.length, 1, 'fileIdentity divergente já deveria ter disparado a detecção de rotação');
  });
  fs.rmSync(root, { recursive: true, force: true });
});

// ── Parte 10 — testes adicionais de transporte ─────────────────────────────

test('dois clientes simultâneos: cursores independentes, cada um avança no seu próprio ritmo sem interferir no outro', () => {
  const root = tmpRoot();
  escreverDiarioChallenger(root, 'challenger-teste', [
    { eventId: 'c-1', sequenceNumber: 1, ts: 1000, evento: 'abre' },
    { eventId: 'c-2', sequenceNumber: 2, ts: 2000, evento: 'funding' },
  ]);
  const fontes = [{ fonte: 'challenger-teste', ehChampion: false }];
  // cliente A lê tudo de uma vez
  const clienteA1 = buscarEventosIncremental(root, fontes, null, 100);
  assert.equal(clienteA1.eventos.length, 2);
  // cliente B lê com limite 1 (paginado)
  const clienteB1 = buscarEventosIncremental(root, fontes, null, 1);
  assert.equal(clienteB1.eventos.length, 1);

  // novo evento chega
  escreverDiarioChallenger(root, 'challenger-teste', [
    { eventId: 'c-1', sequenceNumber: 1, ts: 1000, evento: 'abre' },
    { eventId: 'c-2', sequenceNumber: 2, ts: 2000, evento: 'funding' },
    { eventId: 'c-3', sequenceNumber: 3, ts: 3000, evento: 'fecha' },
  ]);
  const clienteA2 = buscarEventosIncremental(root, fontes, clienteA1.nextCursor, 100);
  assert.equal(clienteA2.eventos.length, 1, 'cliente A só vê o evento novo, seu cursor já tinha os 2 primeiros');
  assert.equal(clienteA2.eventos[0].eventId, 'c-3');

  const clienteB2 = buscarEventosIncremental(root, fontes, clienteB1.nextCursor, 100);
  assert.equal(clienteB2.eventos.length, 2, 'cliente B, que só tinha visto 1, agora vê os 2 que faltavam — independente do progresso do cliente A');
  fs.rmSync(root, { recursive: true, force: true });
});

test('linha parcial/corrompida no meio do arquivo: pulada, nunca derruba a leitura das linhas boas ao redor', () => {
  const root = tmpRoot();
  const p = path.join(root, 'spread', 'diario.jsonl');
  const linhas = [
    JSON.stringify({ ts: 1000, evento: 'abre' }),
    '{"ts": 2000, "evento": "bloqueado", corrompido sem fechar chaves',
    JSON.stringify({ ts: 3000, evento: 'fecha' }),
  ];
  fs.writeFileSync(p, linhas.join('\n') + '\n');
  const r = buscarEventosIncremental(root, [{ fonte: 'champion', ehChampion: true }], null, 100);
  assert.equal(r.eventos.length, 2, 'as 2 linhas válidas aparecem, a corrompida no meio é pulada sem quebrar as outras');
  assert.equal(r.eventos[0].evento, 'abre');
  assert.equal(r.eventos[1].evento, 'fecha');
  fs.rmSync(root, { recursive: true, force: true });
});

test('linha parcial no FINAL do arquivo (escrita truncada a meio de um append): pulada, não derruba as anteriores', () => {
  const root = tmpRoot();
  const p = path.join(root, 'spread', 'diario.jsonl');
  fs.writeFileSync(p, JSON.stringify({ ts: 1000, evento: 'abre' }) + '\n' + '{"ts": 2000, "evento": "fu');
  const r = buscarEventosIncremental(root, [{ fonte: 'champion', ehChampion: true }], null, 100);
  assert.equal(r.eventos.length, 1, 'só a linha completa aparece — a linha final truncada (motor gravando no meio do append) nunca quebra a leitura');
  fs.rmSync(root, { recursive: true, force: true });
});

test('freeze longo simulado: cursor acumula muitas páginas sem perder nada quando o cliente finalmente "retoma" (busca em lote depois de ficar muito tempo sem pedir)', () => {
  const root = tmpRoot();
  const linhas = Array.from({ length: 2000 }, (_, i) => ({ eventId: `c-${i + 1}`, sequenceNumber: i + 1, ts: 1000 + i, evento: 'leitura' }));
  escreverDiarioChallenger(root, 'challenger-teste', linhas);
  const fontes = [{ fonte: 'challenger-teste', ehChampion: false }];
  // cliente nunca chamou (equivalente a ficar congelado por muito tempo) —
  // ao "retomar", busca tudo em páginas sucessivas até esvaziar, sem perder nada
  let cursor: string | null = null;
  let total = 0;
  const vistos = new Set<string>();
  for (let pagina = 0; pagina < 20; pagina++) {
    const r = buscarEventosIncremental(root, fontes, cursor, 200);
    for (const ev of r.eventos) { assert.ok(!vistos.has(ev.eventId)); vistos.add(ev.eventId); }
    total += r.eventos.length;
    cursor = r.nextCursor;
    if (!r.hasMore) break;
  }
  assert.equal(total, 2000, 'freeze longo nunca perde eventos — o backlog inteiro é recuperável em páginas sucessivas');
  fs.rmSync(root, { recursive: true, force: true });
});
