/**
 * Testes de dashboard-aggregator.ts — o foco é provar que as funções PURAS
 * (`construir*`) produzem os números certos a partir de estado sintético, e
 * que `executarAgregacao` grava os 6 arquivos sem exigir que o champion
 * esteja rodando (arquivo ausente = fallback honesto, nunca exceção).
 *
 * Rodar: node --test src/inteligencia/dashboard-aggregator.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  construirResumo, construirFrequencia, construirCustos, construirRiscos, construirTelemetria,
  executarAgregacao,
} from './dashboard-aggregator.ts';
import { montarLeaderboard } from './leaderboard.ts';
import { novoEstado, type ConfigChallenger, type EstadoVirtual } from './virtual-portfolio.ts';
import { novoHeartbeat, registrarLatencia } from './supervisao.ts';

const CFG_CONTROL: ConfigChallenger = {
  challengerId: 'challenger-control', strategyVersion: 'v1', configVersion: 'v1',
  exchanges: ['a', 'b'], capitalPorExchange: 100, alavancagem: 5, reserva: 0.3, margemPayback: 1.5, maxPosicoes: 3,
  familia: 'control',
};
const CFG_PAYBACK_120: ConfigChallenger = {
  challengerId: 'challenger-payback-120', strategyVersion: 'v1', configVersion: 'v1',
  exchanges: ['a', 'b'], capitalPorExchange: 100, alavancagem: 5, reserva: 0.3, margemPayback: 1.2, maxPosicoes: 3,
  familia: 'exploration',
};
const CFG_LEVERAGE_8: ConfigChallenger = {
  challengerId: 'challenger-leverage-8', strategyVersion: 'v1', configVersion: 'v1',
  exchanges: ['a', 'b'], capitalPorExchange: 100, alavancagem: 8, reserva: 0.3, margemPayback: 1.5, maxPosicoes: 3,
  familia: 'exploration',
};

function estadoComPnl(cfg: ConfigChallenger, pnl: number, trades = 5, custos = 1): EstadoVirtual {
  const e = novoEstado(cfg);
  e.pnlRealizado = pnl;
  e.trades = trades;
  e.custos.taxasEntrada = custos;
  e.custosTotais = custos;
  e.fundingBruto = pnl + custos;
  return e;
}

test('construirResumo: champion vem de estado.json + marcacao.json, nunca de arquivo do Lab', () => {
  const estados = [estadoComPnl(CFG_CONTROL, 5), estadoComPnl(CFG_PAYBACK_120, 8)];
  const leaderboard = montarLeaderboard(estados, 0, [CFG_CONTROL, CFG_PAYBACK_120]);
  const championEstado = { capital: 610, capitalInicial: 600, fundingTotal: 12, custosTotal: 2 };
  const marcacao = { capitalRealizado: 610, pnlNaoRealizadoMark: -1.5, pnlNaoRealizadoExecutavel: -2, equityMark: 608.5, equityLiquidacao: 606, custoEstimadoFechamentoTotal: 2, posicoes: [], geradoEm: Date.now() };
  const resumo = construirResumo(estados, leaderboard, championEstado, marcacao);
  assert.equal(resumo.champion.pnlRealizado, 10);
  assert.equal(resumo.champion.pnlNaoRealizadoMark, -1.5);
  assert.equal(resumo.champion.equityLiquidacao, 606);
  assert.ok(resumo.champion.marcacaoDisponivel);
  assert.equal(resumo.control?.pnlBase, leaderboard.linhas.find((l) => l.challengerId === 'challenger-control')?.pnlPaperBase);
});

test('construirResumo: sem estado.json/marcacao.json do champion (Lab rodando antes do champion), nunca lança — fallback honesto', () => {
  const estados = [estadoComPnl(CFG_CONTROL, 5)];
  const leaderboard = montarLeaderboard(estados, 0, [CFG_CONTROL]);
  const resumo = construirResumo(estados, leaderboard, null, null);
  assert.equal(resumo.champion.marcacaoDisponivel, false);
  assert.equal(resumo.champion.pnlRealizado, 0);
});

test('construirResumo: melhorPnlBase nunca escolhe um challenger eliminado', () => {
  const bom = estadoComPnl(CFG_CONTROL, 100);
  const eliminadoComPnlMaior = estadoComPnl(CFG_PAYBACK_120, 500);
  eliminadoComPnlMaior.eliminado = { ts: Date.now(), motivo: 'teste' };
  const leaderboard = montarLeaderboard([bom, eliminadoComPnlMaior], 0, [CFG_CONTROL, CFG_PAYBACK_120]);
  const resumo = construirResumo([bom, eliminadoComPnlMaior], leaderboard, null, null);
  assert.equal(resumo.melhorPnlBase.challengerId, 'challenger-control', 'eliminado não deveria vencer mesmo com PnL maior');
});

test('construirResumo: conta ativos/pausados/eliminados corretamente', () => {
  const ativo = estadoComPnl(CFG_CONTROL, 1);
  const pausado = estadoComPnl(CFG_PAYBACK_120, 1);
  pausado.pausado = { ts: Date.now(), motivo: 'teste', usuario: 'x' };
  const eliminado = estadoComPnl(CFG_LEVERAGE_8, 1);
  eliminado.eliminado = { ts: Date.now(), motivo: 'teste' };
  const leaderboard = montarLeaderboard([ativo, pausado, eliminado], 0, [CFG_CONTROL, CFG_PAYBACK_120, CFG_LEVERAGE_8]);
  const resumo = construirResumo([ativo, pausado, eliminado], leaderboard, null, null);
  assert.equal(resumo.numeroAtivos, 1);
  assert.equal(resumo.numeroPausados, 1);
  assert.equal(resumo.numeroEliminados, 1);
  assert.equal(resumo.numeroChallengers, 3);
});

test('construirFrequencia: grid de payback é extraído pelo prefixo do ID e ordenado por margemPayback', () => {
  const e120 = estadoComPnl(CFG_PAYBACK_120, 3, 4);
  const eControl = estadoComPnl(CFG_CONTROL, 3, 4);
  const leaderboard = montarLeaderboard([e120, eControl], 0, [CFG_PAYBACK_120, CFG_CONTROL]);
  const hb = novoHeartbeat();
  hb.ciclosComCandidata = 10; hb.observadasAcumuladas = 40;
  const freq = construirFrequencia([e120, eControl], leaderboard, hb);
  assert.equal(freq.paybackGrid.length, 1, 'só o challenger-payback-120 deveria entrar no grid, não o control');
  assert.equal(freq.paybackGrid[0].margemPayback, 1.2);
  assert.equal(freq.global.observadasAcumuladas, 40);
});

test('construirFrequencia: motivos de rejeição não instrumentados aparecem como null, nunca como 0 fabricado', () => {
  const e = estadoComPnl(CFG_CONTROL, 1);
  const leaderboard = montarLeaderboard([e], 0, [CFG_CONTROL]);
  const freq = construirFrequencia([e], leaderboard, novoHeartbeat());
  assert.equal(freq.motivosRejeicao.liquidez, null);
  assert.equal(freq.motivosRejeicao.consistencia, null);
  assert.equal(typeof freq.motivosRejeicao.paybackInsuficiente, 'number', 'payback É instrumentado — deveria ser número, não null');
});

test('construirCustos: decompõe os 8 buckets e soma custoTradingPuro/custoGerenciamento/custoTotal sem sobreposição', () => {
  const e = novoEstado(CFG_CONTROL);
  e.custos = { taxasEntrada: 1, taxasSaida: 1, slippageEntradaModelado: 0.5, slippageSaidaModelado: 0.5, custoEscalonamento: 0.3, custoApara: 0.2, custoReinvestimento: 0.1, custoEmergencial: 0 };
  e.fundingBruto = 10;
  const linhas = construirCustos([e]);
  assert.equal(linhas[0].custoTradingPuro, 3); // 1+1+0.5+0.5
  assert.equal(linhas[0].custoGerenciamento, 0.6); // 0.3+0.2+0.1
  assert.ok(Math.abs(linhas[0].custoTotal - 3.6) < 1e-9);
});

test('construirRiscos: altoRiscoAlavancagem true só quando cfg.alavancagem > 5x, mesmo com PnL bom', () => {
  const e = estadoComPnl(CFG_LEVERAGE_8, 999);
  const linhas = construirRiscos([e], [CFG_LEVERAGE_8]);
  assert.equal(linhas[0].altoRiscoAlavancagem, true);
});

test('construirTelemetria: percentis de latência vêm da janela recente do heartbeat', () => {
  const hb = novoHeartbeat();
  for (const ms of [10, 20, 30, 40, 50]) registrarLatencia(hb, ms);
  const tel = construirTelemetria(hb);
  assert.equal(tel.latencia.max, 50);
  assert.equal(tel.latencia.p50, 30);
});

test('executarAgregacao: grava os 6 arquivos em inteligencia/dashboard/, mesmo sem nenhum arquivo do champion presente', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'snowball-agg-'));
  const estados = [estadoComPnl(CFG_CONTROL, 5), estadoComPnl(CFG_PAYBACK_120, 3)];
  assert.doesNotThrow(() => {
    executarAgregacao(dir, {
      estados, configs: [CFG_CONTROL, CFG_PAYBACK_120], heartbeat: novoHeartbeat(),
      championPnlPct: 0, validacaoControl: null,
    });
  });
  const dashDir = path.join(dir, 'inteligencia', 'dashboard');
  for (const nome of ['resumo.json', 'leaderboard.json', 'frequencia.json', 'custos.json', 'riscos.json', 'telemetria.json']) {
    assert.ok(fs.existsSync(path.join(dashDir, nome)), `${nome} deveria existir`);
    assert.doesNotThrow(() => JSON.parse(fs.readFileSync(path.join(dashDir, nome), 'utf8')), `${nome} deveria ser JSON válido`);
  }
  assert.ok(!fs.existsSync(path.join(dashDir, 'champion-vs-control.json')), 'sem validacaoControl, não deveria criar o arquivo (nunca fabricar dado ausente)');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('executarAgregacao: nenhum .tmp sobra depois da escrita (rename atômico limpo)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'snowball-agg-tmp-'));
  executarAgregacao(dir, { estados: [estadoComPnl(CFG_CONTROL, 1)], configs: [CFG_CONTROL], heartbeat: novoHeartbeat(), championPnlPct: 0, validacaoControl: null });
  const arquivos = fs.readdirSync(path.join(dir, 'inteligencia', 'dashboard'));
  assert.ok(!arquivos.some((a) => a.endsWith('.tmp')), 'nenhum arquivo .tmp deveria sobrar');
  fs.rmSync(dir, { recursive: true, force: true });
});
