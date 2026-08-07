/**
 * Testes de controle.ts — a garantia central é que SÓ challengers aprovados
 * (CHALLENGERS_APROVADOS) podem ser controlados, e toda ação grava evento de
 * auditoria, sem exceção.
 *
 * Rodar: node --test src/inteligencia/controle.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  pausarChallenger, retomarChallenger, adicionarObservacao, marcarStatusExperimento,
  duplicarComoNovaVersao, lerAuditoria,
} from './controle.ts';
import { carregarEstado } from './virtual-portfolio.ts';
import { CHALLENGER_CONTROL } from './challengers.ts';

function dirTemp(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'snowball-controle-'));
}

test('pausarChallenger recusa ID fora da lista aprovada, sem gravar nada', () => {
  const dir = dirTemp();
  const r = pausarChallenger(dir, 'challenger-inventado-na-hora', 'teste', 'motivo qualquer');
  assert.equal(r.ok, false);
  assert.ok(r.erro?.includes('não está na lista'));
  assert.equal(lerAuditoria(dir).length, 0, 'tentativa recusada não deveria gerar evento de auditoria');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('pausarChallenger exige motivo — recusa string vazia', () => {
  const dir = dirTemp();
  const r = pausarChallenger(dir, CHALLENGER_CONTROL.challengerId, 'teste', '   ');
  assert.equal(r.ok, false);
  assert.ok(r.erro?.includes('motivo'));
  fs.rmSync(dir, { recursive: true, force: true });
});

test('pausar e retomar um challenger aprovado: estado muda, auditoria registra os dois eventos', () => {
  const dir = dirTemp();
  const r1 = pausarChallenger(dir, CHALLENGER_CONTROL.challengerId, 'renan', 'testando o controle');
  assert.equal(r1.ok, true);
  const e1 = carregarEstado(dir, CHALLENGER_CONTROL);
  assert.ok(e1.pausado);
  assert.equal(e1.experimentoStatus, 'pausado');

  // pausar de novo deveria recusar (já pausado)
  const r2 = pausarChallenger(dir, CHALLENGER_CONTROL.challengerId, 'renan', 'de novo');
  assert.equal(r2.ok, false);

  const r3 = retomarChallenger(dir, CHALLENGER_CONTROL.challengerId, 'renan', 'fim do teste');
  assert.equal(r3.ok, true);
  const e2 = carregarEstado(dir, CHALLENGER_CONTROL);
  assert.equal(e2.pausado, undefined);
  assert.equal(e2.experimentoStatus, 'rodando');

  const auditoria = lerAuditoria(dir);
  assert.equal(auditoria.length, 2, 'a tentativa de pausar 2x recusada não grava evento — só pausar+retomar mudaram estado de verdade');
  assert.equal(auditoria[0].acao, 'retomar', 'lerAuditoria devolve mais recente primeiro');
  assert.equal(auditoria[1].acao, 'pausar');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('adicionarObservacao anexa ao array sem apagar histórico anterior, nunca lida pela lógica de decisão', () => {
  const dir = dirTemp();
  adicionarObservacao(dir, CHALLENGER_CONTROL.challengerId, 'renan', 'primeira observação');
  adicionarObservacao(dir, CHALLENGER_CONTROL.challengerId, 'renan', 'segunda observação');
  const e = carregarEstado(dir, CHALLENGER_CONTROL);
  assert.equal(e.observacoes?.length, 2);
  assert.equal(e.observacoes?.[0].texto, 'primeira observação');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('marcarStatusExperimento recusa status fora do vocabulário válido', () => {
  const dir = dirTemp();
  const r = marcarStatusExperimento(dir, CHALLENGER_CONTROL.challengerId, 'renan', 'promovido-pra-live', 'tentativa inválida');
  assert.equal(r.ok, false);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('marcarStatusExperimento aceita um dos 6 estados válidos e grava configuracaoAnterior/Nova na auditoria', () => {
  const dir = dirTemp();
  marcarStatusExperimento(dir, CHALLENGER_CONTROL.challengerId, 'renan', 'concluido', 'evidência suficiente após 60 dias');
  const e = carregarEstado(dir, CHALLENGER_CONTROL);
  assert.equal(e.experimentoStatus, 'concluido');
  const aud = lerAuditoria(dir);
  assert.equal(aud[0].configuracaoNova, 'concluido');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('duplicarComoNovaVersao nunca cria challenger novo — sempre recusa, mas registra a tentativa', () => {
  const dir = dirTemp();
  const r = duplicarComoNovaVersao(dir, CHALLENGER_CONTROL.challengerId, 'renan');
  assert.equal(r.ok, false);
  assert.ok(r.erro?.includes('revisão de código'));
  const aud = lerAuditoria(dir);
  assert.equal(aud.length, 1);
  assert.equal(aud[0].acao, 'duplicar-negado');
  fs.rmSync(dir, { recursive: true, force: true });
});
