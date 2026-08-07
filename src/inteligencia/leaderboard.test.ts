/**
 * Testes de leaderboard.ts — o foco central desta versão é PROVAR que não há
 * dupla contagem de custo (Parte 4), porque foi exatamente esse bug que a
 * v1 deste arquivo tinha: penalizava slippage no "ajuste de realismo" que já
 * estava dentro do PnL realizado.
 *
 * Rodar: node --test src/inteligencia/leaderboard.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  montarLeaderboard, linhaDe, reconciliar, calcularPenalidades, pnlAjustadoNoCenario, CENARIOS,
} from './leaderboard.ts';
import { novoEstado, cicloChallenger, type ConfigChallenger, type EstadoVirtual } from './virtual-portfolio.ts';
import type { OportunidadeSpread } from '../funding/spread.ts';

const CFG: ConfigChallenger = {
  challengerId: 'x', strategyVersion: 'v1', configVersion: 'v1',
  exchanges: ['a', 'b'], capitalPorExchange: 100, alavancagem: 5, reserva: 0.3,
  margemPayback: 1.5, maxPosicoes: 3,
};

const precoFixo = async () => 100;
function oportunidade(over: Partial<OportunidadeSpread> = {}): OportunidadeSpread {
  return {
    symbol: 'FOO/USDT:USDT', exchangeShort: 'a', exchangeLong: 'b',
    fundingShort: 0.01, fundingLong: 0, spread: 0.05, spreadInstantaneo: 0.05,
    consistencia: 0.95, duracaoHoras: 30, aprSpread: 0.05 * 3 * 365,
    pontuacao: 1, volumeMinimo: 20_000_000,
    ...over,
  } as OportunidadeSpread;
}

function estadoSintetico(id: string, fundingBruto: number, custoTotal: number, trades = 5): EstadoVirtual {
  const e = novoEstado({ ...CFG, challengerId: id });
  e.fundingBruto = fundingBruto;
  e.custos.taxasEntrada = custoTotal; // tudo num bucket só, suficiente pra estes testes
  e.custosTotais = custoTotal;
  e.trades = trades;
  e.pnlRealizado = fundingBruto - custoTotal;
  return e;
}

// ── Parte 4: reconciliação exata, sem dupla contagem ────────────────────────

test('reconciliar: pnlPaperBase = fundingBruto − soma exata dos 8 componentes, nunca reconstruído por fora', () => {
  const e = novoEstado(CFG);
  e.fundingBruto = 10;
  e.custos = {
    taxasEntrada: 1, taxasSaida: 1, slippageEntradaModelado: 0.5, slippageSaidaModelado: 0.5,
    custoEscalonamento: 0.3, custoApara: 0.1, custoReinvestimento: 0.05, custoEmergencial: 0,
  };
  const r = reconciliar(e);
  const somaEsperada = 1 + 1 + 0.5 + 0.5 + 0.3 + 0.1 + 0.05 + 0;
  assert.ok(Math.abs(r.pnlPaperBase - (10 - somaEsperada)) < 1e-9);
});

test('cenário BASE não re-penaliza o slippage já contado em custos — a prova direta contra o bug da v1', () => {
  const e = novoEstado(CFG);
  e.fundingBruto = 10;
  e.custos = { taxasEntrada: 1, taxasSaida: 1, slippageEntradaModelado: 2, slippageSaidaModelado: 2, custoEscalonamento: 0, custoApara: 0, custoReinvestimento: 0, custoEmergencial: 0 };
  e.custosTotais = 6;
  const { pnlPaperBase, pnlPaperAjustado, penalidades } = pnlAjustadoNoCenario(e, 'base');
  assert.ok(Math.abs(pnlPaperBase - 4) < 1e-9); // 10 - 6
  // cenário base não tem posições abertas (notionalAtual=0) e não tem trades
  // com custo de execução parcial — logo a única penalidade possível
  // (atraso entre pernas) também é zero aqui porque não há posição aberta
  assert.equal(penalidades.penalidadeSlippageStress, 0, 'stress extra só existe no cenário stress, nunca no base');
  assert.ok(Math.abs(pnlPaperAjustado - pnlPaperBase) < 1e-9, 'sem posição aberta, base não deveria penalizar nada além do já contado');
});

test('cenário STRESS penaliza slippage ADICIONAL, não duplica o já modelado', () => {
  const e = novoEstado(CFG);
  e.custos.slippageEntradaModelado = 1; e.custos.slippageSaidaModelado = 1; // total já modelado: 2
  const pen = calcularPenalidades(e, CENARIOS.stress);
  // stress usa slippageStressExtra=1.0 → 100% do já modelado, ou seja +2, não +4 nem re-contar os 2 originais
  assert.ok(Math.abs(pen.penalidadeSlippageStress - 2) < 1e-9);
});

test('quatro cenários existem e IDEAL nunca penaliza nada', () => {
  const e = novoEstado(CFG);
  e.fundingBruto = 5; e.custos.taxasEntrada = 1; e.custosTotais = 1;
  const { pnlPaperAjustado, pnlPaperBase } = pnlAjustadoNoCenario(e, 'ideal');
  assert.equal(pnlPaperAjustado, pnlPaperBase);
});

test('conservador e stress penalizam mais que base, em ordem crescente, quando há posição aberta', async () => {
  const e = novoEstado(CFG);
  await cicloChallenger(CFG, e, [oportunidade()], precoFixo);
  assert.ok(e.posicoesVirtuais.length >= 1, 'precisa de posição aberta pra testar penalidade de exposição');
  const ideal = pnlAjustadoNoCenario(e, 'ideal').pnlPaperAjustado;
  const base = pnlAjustadoNoCenario(e, 'base').pnlPaperAjustado;
  const conservador = pnlAjustadoNoCenario(e, 'conservador').pnlPaperAjustado;
  const stress = pnlAjustadoNoCenario(e, 'stress').pnlPaperAjustado;
  assert.ok(ideal >= base, `ideal (${ideal}) deveria ser >= base (${base})`);
  assert.ok(base >= conservador, `base (${base}) deveria ser >= conservador (${conservador})`);
  assert.ok(conservador >= stress, `conservador (${conservador}) deveria ser >= stress (${stress})`);
});

// ── leaderboard geral ────────────────────────────────────────────────────────

test('linhaDe: pnlIncremental usa o cenário base, comparado contra o champion na mesma unidade (%)', () => {
  const e = estadoSintetico('a', 10, 2);
  const linha = linhaDe(e, 2);
  assert.ok(Math.abs(linha.pnlIncremental - (linha.retornoPct - 2)) < 1e-9);
});

test('montarLeaderboard: ranking de maior PnL ordena corretamente', () => {
  const e1 = estadoSintetico('baixo', 2, 1);
  const e2 = estadoSintetico('alto', 20, 1);
  const lb = montarLeaderboard([e1, e2], 0);
  assert.equal(lb.rankings.maiorPnl[0], 'alto');
});

test('montarLeaderboard: candidato a eliminação aparece marcado, não some do leaderboard', () => {
  const e = estadoSintetico('elim', 1, 50, 20);
  e.iniciadoEm = Date.now() - 10 * 86_400_000;
  const lb = montarLeaderboard([e], 5);
  assert.equal(lb.linhas.length, 1);
  assert.equal(lb.linhas[0].eliminado, false);
  assert.ok(lb.linhas[0].recomendadoEliminar);
});

test('montarLeaderboard: challenger JÁ eliminado (campo gravado) aparece como eliminado de verdade', () => {
  const e = estadoSintetico('elim2', 1, 50, 20);
  e.eliminado = { ts: Date.now(), motivo: 'teste manual' };
  const lb = montarLeaderboard([e], 5);
  assert.equal(lb.linhas[0].eliminado, true);
  assert.equal(lb.linhas[0].motivoEliminacao, 'teste manual');
});

test('feeToGross é Infinity quando não há funding, não NaN', () => {
  const e = novoEstado(CFG);
  e.custosTotais = 1; e.fundingBruto = 0;
  const linha = linhaDe(e, 0);
  assert.equal(linha.feeToGross, Infinity);
});

test('cada linha do leaderboard expõe os 4 cenários, todos numéricos finitos ou zero', () => {
  const e = estadoSintetico('c', 5, 1);
  const linha = linhaDe(e, 0);
  for (const nome of ['ideal', 'base', 'conservador', 'stress'] as const) {
    assert.ok(Number.isFinite(linha.cenarios[nome]), `cenário ${nome} deveria ser um número finito`);
  }
});

// ── Parte 1 / Parte 8 / Parte 17 desta etapa: família, alto risco, rankings expandidos ──

test('linhaDe: familia e hipotese vêm do estado (puramente informativo), nunca influenciam pnl', () => {
  const e = estadoSintetico('exp', 5, 1);
  e.familia = 'exploration';
  e.hipotese = 'teste de hipótese';
  const linha = linhaDe(e, 0);
  assert.equal(linha.familia, 'exploration');
  assert.equal(linha.hipotese, 'teste de hipótese');
});

test('linhaDe: altoRiscoAlavancagem é true só quando a config do challenger usa alavancagem > 5x (a do champion)', () => {
  const e = estadoSintetico('lev', 5, 1);
  const cfgAltoRisco: ConfigChallenger = { ...CFG, alavancagem: 7 };
  const cfgNormal: ConfigChallenger = { ...CFG, alavancagem: 5 };
  assert.equal(linhaDe(e, 0, cfgAltoRisco).altoRiscoAlavancagem, true);
  assert.equal(linhaDe(e, 0, cfgNormal).altoRiscoAlavancagem, false);
  assert.equal(linhaDe(e, 0).altoRiscoAlavancagem, false, 'sem config, nunca marca como alto risco por engano');
});

test('montarLeaderboard: rankings expandidos (crescimento/frequência/eficiência/risco-ajustado) existem e ordenam', () => {
  const e1 = estadoSintetico('baixo', 2, 1, 2);
  const e2 = estadoSintetico('alto', 20, 1, 8);
  const lb = montarLeaderboard([e1, e2], 0);
  assert.equal(lb.rankings.maiorCrescimento[0], 'alto');
  assert.equal(lb.rankings.maiorFrequencia[0], 'alto', 'mais trades+settlements deveria vir primeiro');
  assert.equal(lb.rankings.maisEficiente.length, 2);
  assert.equal(lb.rankings.melhorAjustadoPorRisco.length, 2);
});

test('linhaDe: pausado e experimentoStatus vêm do estado — Experimentos e Leaderboard do dashboard usam o mesmo dado', () => {
  const e = estadoSintetico('pz', 5, 1);
  e.pausado = { ts: Date.now(), motivo: 'pausado pra teste', usuario: 'x' };
  e.experimentoStatus = 'pausado';
  e.configDesde = 12345;
  const linha = linhaDe(e, 0);
  assert.equal(linha.pausado, true);
  assert.equal(linha.motivoPausa, 'pausado pra teste');
  assert.equal(linha.experimentoStatus, 'pausado');
  assert.equal(linha.configDesde, 12345);
});

test('montarLeaderboard: passar configs propaga familia/altoRisco pra cada linha pelo challengerId certo', () => {
  const e1 = estadoSintetico('a', 5, 1);
  e1.familia = 'control';
  const e2 = estadoSintetico('b', 5, 1);
  e2.familia = 'exploration';
  const cfgA: ConfigChallenger = { ...CFG, challengerId: 'a', alavancagem: 5 };
  const cfgB: ConfigChallenger = { ...CFG, challengerId: 'b', alavancagem: 8 };
  const lb = montarLeaderboard([e1, e2], 0, [cfgA, cfgB]);
  const linhaA = lb.linhas.find((l) => l.challengerId === 'a')!;
  const linhaB = lb.linhas.find((l) => l.challengerId === 'b')!;
  assert.equal(linhaA.altoRiscoAlavancagem, false);
  assert.equal(linhaB.altoRiscoAlavancagem, true);
});
