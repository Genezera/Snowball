/**
 * Testes de janela-comum.ts — a garantia central: o snapshot inicial nunca
 * se move depois de criado, e todo consumidor vê valorNoInicio/valorNoFim/
 * deltaNaJanela, nunca o total histórico bruto.
 *
 * Rodar: node --test src/inteligencia/janela-comum.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  carregarOuCriarJanelaComum, salvarJanelaComum, calcularDeltasChallengers,
  calcularDeltasChampion, calcularDeltasHeartbeat, classificarPosicoesAbertas,
} from './janela-comum.ts';
import { novoEstado, type ConfigChallenger } from './virtual-portfolio.ts';

function tmpDir() { return fs.mkdtempSync(path.join(os.tmpdir(), 'snowball-janela-')); }

const CFG: ConfigChallenger = {
  challengerId: 'challenger-teste', strategyVersion: 'v1', configVersion: 'v1',
  exchanges: ['a', 'b'], capitalPorExchange: 100, alavancagem: 5, reserva: 0.3, margemPayback: 1.5, maxPosicoes: 3,
};

test('primeira chamada cria a janela com o estado ATUAL como início — nunca zero fabricado', () => {
  const dir = tmpDir();
  const e = novoEstado(CFG);
  e.bloqueiosPorPayback = 17194; // simula o total histórico "sujo" já acumulado antes da janela existir
  const janela = carregarOuCriarJanelaComum(dir, [e], null, null);
  assert.equal(janela.snapshotInicial.challengers['challenger-teste'].bloqueiosPorPayback, 17194, 'o snapshot inicial deveria capturar o total JÁ acumulado como base, não zero');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('chamadas seguintes NUNCA recriam a janela — commonWindowStart fica fixo mesmo com reinício simulado', () => {
  const dir = tmpDir();
  const e = novoEstado(CFG);
  const janela1 = carregarOuCriarJanelaComum(dir, [e], null, null);
  const inicioOriginal = janela1.commonWindowStart;

  // simula reinício: chama de novo com estado mudado
  e.bloqueiosPorPayback = 500;
  const janela2 = carregarOuCriarJanelaComum(dir, [e], null, null);
  assert.equal(janela2.commonWindowStart, inicioOriginal, 'commonWindowStart nunca deveria mudar depois de criado');
  assert.equal(janela2.snapshotInicial.challengers['challenger-teste'].bloqueiosPorPayback, 0, 'o snapshot inicial continua sendo o valor de QUANDO A JANELA COMEÇOU, não o atual');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('deltaNaJanela nunca inclui o histórico anterior à janela — só o que aconteceu DEPOIS', () => {
  const dir = tmpDir();
  const e = novoEstado(CFG);
  e.bloqueiosPorPayback = 17194; // "sujo" — já existia antes da janela
  const janela = carregarOuCriarJanelaComum(dir, [e], null, null);

  e.bloqueiosPorPayback = 17194 + 12; // 12 bloqueios NOVOS, dentro da janela
  const deltas = calcularDeltasChallengers(janela, [e]);
  assert.equal(deltas[0].bloqueiosPorPayback.valorNoInicio, 17194);
  assert.equal(deltas[0].bloqueiosPorPayback.valorNoFim, 17206);
  assert.equal(deltas[0].bloqueiosPorPayback.deltaNaJanela, 12, 'delta deveria ser só os 12 novos, nunca os 17194 antigos');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('challenger que não existia quando a janela começou: delta = próprio total, mas marcado honestamente sem snapshot inicial', () => {
  const dir = tmpDir();
  const janela = carregarOuCriarJanelaComum(dir, [], null, null); // janela criada sem nenhum challenger
  const eNovo = novoEstado({ ...CFG, challengerId: 'challenger-criado-depois' });
  eNovo.trades = 3;
  const deltas = calcularDeltasChallengers(janela, [eNovo]);
  assert.equal(deltas[0].tinhaSnapshotInicial, false);
  assert.equal(deltas[0].trades.deltaNaJanela, 3, 'sem snapshot, o delta é o próprio valor atual — documentado, não escondido');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('champion e heartbeat: delta calculado corretamente, null quando não havia snapshot', () => {
  const dir = tmpDir();
  const championInicial = { capital: 600, fundingTotal: 10, custosTotal: 5, pagamentos: 18, equityMark: 599, equityLiquidacao: 598 };
  const hbInicial = { reinicios: 3, ciclosComErro: 0 };
  const janela = carregarOuCriarJanelaComum(dir, [], championInicial, hbInicial);

  const championAtual = { capital: 606, fundingTotal: 16, custosTotal: 8, pagamentos: 24, equityMark: 605, equityLiquidacao: 603 };
  const hbAtual = { reinicios: 5, ciclosComErro: 1 };
  const dChampion = calcularDeltasChampion(janela, championAtual);
  const dHb = calcularDeltasHeartbeat(janela, hbAtual);

  assert.equal(dChampion?.capital.deltaNaJanela, 6);
  assert.equal(dChampion?.fundingTotal.deltaNaJanela, 6);
  assert.equal(dChampion?.pnlEconomicoNaJanela, 5, 'pnlEconomicoNaJanela deveria ser equityLiquidacaoFinal(603) - equityLiquidacaoInicial(598)');
  assert.equal(dHb?.reinicios.deltaNaJanela, 2);
  assert.equal(dHb?.ciclosComErro.deltaNaJanela, 1);
  assert.equal(calcularDeltasChampion(janela, null), null);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('persistência: salvarJanelaComum sobrevive a recarregar do disco sem perder o snapshot inicial', () => {
  const dir = tmpDir();
  const e = novoEstado(CFG);
  e.trades = 1;
  const janela = carregarOuCriarJanelaComum(dir, [e], null, null);
  salvarJanelaComum(dir, janela);
  const recarregada = carregarOuCriarJanelaComum(dir, [e], null, null);
  assert.equal(recarregada.commonWindowStart, janela.commonWindowStart);
  assert.equal(recarregada.snapshotInicial.challengers['challenger-teste'].trades, 1);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('pnlEconomicoNaJanela é null quando marcação não estava disponível em algum dos extremos — nunca fabrica um número', () => {
  const dir = tmpDir();
  const championInicial = { capital: 600, fundingTotal: 10, custosTotal: 5, pagamentos: 18, equityMark: null, equityLiquidacao: null };
  const janela = carregarOuCriarJanelaComum(dir, [], championInicial, null);
  const championAtual = { capital: 606, fundingTotal: 16, custosTotal: 8, pagamentos: 24, equityMark: 605, equityLiquidacao: 603 };
  const d = calcularDeltasChampion(janela, championAtual);
  assert.equal(d?.pnlEconomicoNaJanela, null, 'sem marcação no início, não dá pra calcular o delta econômico honestamente');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('classificarPosicoesAbertas: posição aberta antes do início da janela nunca vira "abertaDentroDaJanela"', () => {
  const commonWindowStart = 1_000_000;
  const posicoes = [
    { symbol: 'HERDADA', abertaEm: 500_000, notionalPorPerna: 100 },
    { symbol: 'NOVA', abertaEm: 1_500_000, notionalPorPerna: 50 },
  ];
  const classificadas = classificarPosicoesAbertas(posicoes, commonWindowStart);
  assert.equal(classificadas[0].classificacao, 'abertaAntesDaJanela');
  assert.equal(classificadas[1].classificacao, 'abertaDentroDaJanela');
});

test('JSON corrompido: recria a janela do zero em vez de lançar', () => {
  const dir = tmpDir();
  const p = path.join(dir, 'inteligencia', 'dashboard', 'janela-comum.json');
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, 'isto não é json{{{');
  assert.doesNotThrow(() => {
    const janela = carregarOuCriarJanelaComum(dir, [], null, null);
    assert.ok(janela.commonWindowStart > 0);
  });
  fs.rmSync(dir, { recursive: true, force: true });
});
