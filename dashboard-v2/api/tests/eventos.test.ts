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

test('achado real (Quality Gate de Interface): sequenceNumber+eventId duplicado upstream (reinício do orquestrador) nunca gera eventId repetido NEM apaga o evento economicamente diferente', () => {
  const root = tmpRoot();
  // reproduz exatamente o caso real: mesmo eventId/sequenceNumber:1, dois
  // cycleId diferentes (contador do Lab não sobreviveu a um restart) — os
  // dois são economicamente DISTINTOS (cycleId diferente), então os dois
  // precisam sobreviver, só não podem ter o mesmo eventId.
  escreverDiarioChallenger(root, 'challenger-teste', [
    { eventId: 'challenger-teste-1', sequenceNumber: 1, cycleId: 'orch-A', ts: 1000, evento: 'bloqueado' },
    { eventId: 'challenger-teste-1', sequenceNumber: 1, cycleId: 'orch-B', ts: 2000, evento: 'bloqueado' },
    { eventId: 'challenger-teste-2', sequenceNumber: 2, cycleId: 'orch-B', ts: 3000, evento: 'bloqueado' },
  ]);
  const r = buscarEventosIncremental(root, [{ fonte: 'challenger-teste', ehChampion: false }], null, 100);
  const ids = r.eventos.map((e) => e.eventId);
  assert.equal(new Set(ids).size, ids.length, 'nenhum eventId deveria se repetir mesmo com duplicata upstream');
  assert.equal(r.eventos.length, 3, 'os TRÊS eventos sobrevivem — nenhum é apagado, mesmo o que colidiu de eventId');
  const colidido = r.eventos.find((e) => e.cycleId === 'orch-B' && e.sequenceNumber === 1);
  assert.ok(colidido, 'o evento colidido (orch-B, seq 1) precisa continuar presente na resposta');
  assert.equal(colidido.eventIdOriginal, 'challenger-teste-1', 'o eventId original da fonte fica preservado pra auditoria');
  assert.notEqual(colidido.eventId, 'challenger-teste-1', 'o eventId público precisa ter sido reescrito pra algo único');
  const naoColidido = r.eventos.find((e) => e.cycleId === 'orch-A');
  assert.equal(naoColidido.eventIdOriginal, null, 'evento sem colisão não deveria ter eventIdOriginal preenchido');
  fs.rmSync(root, { recursive: true, force: true });
});

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

// ── Fechamento do Quality Gate — cursor sobrevive a reset de sequenceNumber ──

test('CRÍTICO: reset de sequenceNumber após "reinício do orquestrador" nunca perde os eventos novos nem repete os antigos', () => {
  const root = tmpRoot();
  const fontes = [{ fonte: 'challenger-teste', ehChampion: false }];

  // 1. escreve eventos com sequenceNumber 898, 899, 900
  escreverDiarioChallenger(root, 'challenger-teste', [
    { eventId: 'c-898', sequenceNumber: 898, cycleId: 'orch-A', ts: 1000, evento: 'funding' },
    { eventId: 'c-899', sequenceNumber: 899, cycleId: 'orch-A', ts: 1001, evento: 'funding' },
    { eventId: 'c-900', sequenceNumber: 900, cycleId: 'orch-A', ts: 1002, evento: 'funding' },
  ]);
  // 2. lê e persiste o cursor
  const r1 = buscarEventosIncremental(root, fontes, null, 100);
  assert.equal(r1.eventos.length, 3, 'os 3 eventos iniciais deveriam ser entregues');
  const cursorPersistido = r1.nextCursor;

  // 3. simula reinício do orquestrador (sequenceNumber reinicia do 1) — o
  // MESMO arquivo continua sendo usado (append real, sem truncar/recriar),
  // como acontece de verdade: o processo reinicia, o arquivo não.
  // 4. acrescenta novos eventos com sequenceNumber 1, 2, 3
  escreverDiarioChallenger(root, 'challenger-teste', [
    { eventId: 'c-898', sequenceNumber: 898, cycleId: 'orch-A', ts: 1000, evento: 'funding' },
    { eventId: 'c-899', sequenceNumber: 899, cycleId: 'orch-A', ts: 1001, evento: 'funding' },
    { eventId: 'c-900', sequenceNumber: 900, cycleId: 'orch-A', ts: 1002, evento: 'funding' },
    { eventId: 'c-r1', sequenceNumber: 1, cycleId: 'orch-B', ts: 2000, evento: 'funding' },
    { eventId: 'c-r2', sequenceNumber: 2, cycleId: 'orch-B', ts: 2001, evento: 'funding' },
    { eventId: 'c-r3', sequenceNumber: 3, cycleId: 'orch-B', ts: 2002, evento: 'funding' },
  ]);
  // 6. lê novamente usando o cursor anterior
  const r2 = buscarEventosIncremental(root, fontes, cursorPersistido, 100);

  // 7. confirma que os 3 eventos novos são entregues
  const idsNovos = r2.eventos.map((e) => e.eventId);
  assert.deepEqual(idsNovos, ['c-r1', 'c-r2', 'c-r3'], 'os 3 eventos pós-restart (sequenceNumber 1,2,3) precisam ser entregues — a causa raiz do bug era exatamente esses serem descartados por 1<=900');
  // 8. confirma que nenhum antigo é repetido
  assert.ok(!idsNovos.includes('c-898') && !idsNovos.includes('c-899') && !idsNovos.includes('c-900'), 'os eventos antigos (898-900) não podem reaparecer');
  // 9. confirma IDs únicos
  assert.equal(new Set(idsNovos).size, idsNovos.length);

  // 10. reinicia a API (nova chamada, mesmo cursor persistido — equivalente
  // a reprocessar a mesma leitura após reiniciar o processo da API) e repete
  const r3 = buscarEventosIncremental(root, fontes, cursorPersistido, 100);
  assert.deepEqual(r3.eventos.map((e) => e.eventId), ['c-r1', 'c-r2', 'c-r3'], 'reler com o mesmo cursor após "reiniciar a API" é determinístico — mesmo resultado');

  // critério final: cursor continua válido pra próxima leitura incremental
  const r4 = buscarEventosIncremental(root, fontes, r2.nextCursor, 100);
  assert.equal(r4.eventos.length, 0, 'cursor avançado corretamente — nada novo, nada repetido');
  fs.rmSync(root, { recursive: true, force: true });
});

test('duplicata: mesmo eventId + mesmo cycleId (retransmissão idêntica) é tratada como colisão e mantida com ID sintético, nunca some', () => {
  const root = tmpRoot();
  escreverDiarioChallenger(root, 'challenger-teste', [
    { eventId: 'c-1', sequenceNumber: 1, cycleId: 'orch-A', ts: 1000, evento: 'abre' },
    { eventId: 'c-1', sequenceNumber: 1, cycleId: 'orch-A', ts: 1000, evento: 'abre' },
  ]);
  const r = buscarEventosIncremental(root, [{ fonte: 'challenger-teste', ehChampion: false }], null, 100);
  assert.equal(r.eventos.length, 2, 'mesmo sendo uma retransmissão idêntica, a linha existe no diário e é preservada — a API só lê, não decide o que é ruído econômico');
  assert.notEqual(r.eventos[0].eventId, r.eventos[1].eventId);
  fs.rmSync(root, { recursive: true, force: true });
});

test('duplicata: mesmo eventId + cycleId diferente (evento economicamente distinto) preserva os dois, com eventIdOriginal auditável', () => {
  const root = tmpRoot();
  escreverDiarioChallenger(root, 'challenger-teste', [
    { eventId: 'c-1', sequenceNumber: 1, cycleId: 'orch-A', ts: 1000, evento: 'abre' },
    { eventId: 'c-1', sequenceNumber: 1, cycleId: 'orch-B', ts: 2000, evento: 'fecha' },
  ]);
  const r = buscarEventosIncremental(root, [{ fonte: 'challenger-teste', ehChampion: false }], null, 100);
  assert.equal(r.eventos.length, 2);
  assert.equal(r.eventos[1].eventIdOriginal, 'c-1');
  fs.rmSync(root, { recursive: true, force: true });
});

test('duplicata: mesmo sequenceNumber + cycleId diferente, eventId distinto — não é tratado como colisão de eventId, os dois passam direto', () => {
  const root = tmpRoot();
  escreverDiarioChallenger(root, 'challenger-teste', [
    { eventId: 'c-1', sequenceNumber: 1, cycleId: 'orch-A', ts: 1000, evento: 'abre' },
    { eventId: 'c-2', sequenceNumber: 1, cycleId: 'orch-B', ts: 2000, evento: 'abre' },
  ]);
  const r = buscarEventosIncremental(root, [{ fonte: 'challenger-teste', ehChampion: false }], null, 100);
  assert.equal(r.eventos.length, 2);
  assert.equal(r.eventos[0].eventIdOriginal, null);
  assert.equal(r.eventos[1].eventIdOriginal, null);
  fs.rmSync(root, { recursive: true, force: true });
});

test('duplicata: mesmo timestamp, eventos diferentes — nunca colapsam (cobertura já existente, reafirmada aqui)', () => {
  const root = tmpRoot();
  escreverDiarioChallenger(root, 'challenger-teste', [
    { eventId: 'c-1', sequenceNumber: 1, cycleId: 'orch-A', ts: 5000, evento: 'abre' },
    { eventId: 'c-2', sequenceNumber: 2, cycleId: 'orch-A', ts: 5000, evento: 'funding' },
  ]);
  const r = buscarEventosIncremental(root, [{ fonte: 'challenger-teste', ehChampion: false }], null, 100);
  assert.equal(r.eventos.length, 2);
  fs.rmSync(root, { recursive: true, force: true });
});

test('duplicata: restart da API (mesmo cursor relido do zero, processo novo) é determinístico e não duplica nem perde', () => {
  const root = tmpRoot();
  escreverDiarioChallenger(root, 'challenger-teste', [
    { eventId: 'c-1', sequenceNumber: 1, cycleId: 'orch-A', ts: 1000, evento: 'abre' },
    { eventId: 'c-2', sequenceNumber: 2, cycleId: 'orch-A', ts: 2000, evento: 'funding' },
  ]);
  const r1 = buscarEventosIncremental(root, [{ fonte: 'challenger-teste', ehChampion: false }], null, 100);
  // "restart da API" == nenhum estado em memória sobrevive; só o cursor
  // (opaco, serializado no cliente) e o arquivo no disco persistem — a
  // próxima chamada é uma invocação de função nova, sem estado compartilhado.
  const r2 = buscarEventosIncremental(root, [{ fonte: 'challenger-teste', ehChampion: false }], r1.nextCursor, 100);
  assert.equal(r2.eventos.length, 0, 'nada novo, cursor sobrevive ao restart do processo da API porque é 100% derivado do cursor recebido + disco');
  fs.rmSync(root, { recursive: true, force: true });
});

test('duplicata: restart do orquestrador — sequenceNumber reseta, mas byteOffset nunca coincide entre a linha antiga e a nova, cursor não perde nem repete', () => {
  const root = tmpRoot();
  const fontes = [{ fonte: 'challenger-teste', ehChampion: false }];
  escreverDiarioChallenger(root, 'challenger-teste', [{ eventId: 'c-500', sequenceNumber: 500, cycleId: 'orch-A', ts: 1000, evento: 'funding' }]);
  const r1 = buscarEventosIncremental(root, fontes, null, 100);
  escreverDiarioChallenger(root, 'challenger-teste', [
    { eventId: 'c-500', sequenceNumber: 500, cycleId: 'orch-A', ts: 1000, evento: 'funding' },
    { eventId: 'c-1-novo', sequenceNumber: 1, cycleId: 'orch-B', ts: 2000, evento: 'funding' },
  ]);
  const r2 = buscarEventosIncremental(root, fontes, r1.nextCursor, 100);
  assert.equal(r2.eventos.length, 1);
  assert.equal(r2.eventos[0].eventId, 'c-1-novo');
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
