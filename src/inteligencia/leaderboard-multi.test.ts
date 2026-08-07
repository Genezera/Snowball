/**
 * Testes de leaderboard-multi.ts — o foco é a janela comum: nunca deixar uma
 * linha parecer comparável quando os períodos são diferentes.
 *
 * Rodar: node --test src/inteligencia/leaderboard-multi.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { montarLeaderboardMulti } from './leaderboard-multi.ts';
import type { ResumoMotorAdaptado } from './adaptador-motores-existentes.ts';
import type { ResumoBaseline } from './baselines.ts';

function motorVazio(strategyId: string, origem: 'momentum-live.ts' | 'pares-live.ts'): ResumoMotorAdaptado {
  return {
    strategyId, origem, disponivel: false, capitalVirtual: 0, capitalInicial: 0,
    pnlRealizado: 0, pnlNaoRealizadoDisponivel: false, custosTotais: 0, drawdownMaxPct: 0,
    trades: 0, vitorias: 0, taxaVitoria: null, posicoesAbertas: 0, halted: false,
    iniciadoEm: null, ultimaAtualizacao: null, idadeMinutos: null,
  };
}

test('sem nenhuma fonte disponível: não lança, momentum/pares aparecem marcados como indisponíveis (não somem da tabela)', () => {
  const lb = montarLeaderboardMulti(null, null, [], motorVazio('momentum-ts', 'momentum-live.ts'), motorVazio('pares-cointegrados', 'pares-live.ts'));
  assert.equal(lb.linhas.length, 2);
  assert.ok(lb.linhas.every((l) => !l.disponivel));
  assert.ok(lb.janelaComum.desde <= lb.janelaComum.ate);
});

test('champion presente: linha de PnL correta, sempre marcada como não comparável na janela (histórico maior)', () => {
  const championEstado = { iniciadoEm: Date.now() - 5 * 86_400_000, capital: 605, capitalInicial: 600 };
  const lb = montarLeaderboardMulti(championEstado, null, [], motorVazio('m', 'momentum-live.ts'), motorVazio('p', 'pares-live.ts'));
  const linha = lb.linhas.find((l) => l.strategyId === 'funding-arbitrage-champion')!;
  assert.equal(linha.pnlDesdeOInicio, 5);
  assert.equal(linha.comparavelNaJanela, false, 'histórico total do champion nunca deveria ser marcado como diretamente comparável');
});

test('baselines: sempre comparáveis entre si (mesmo início, nesta etapa)', () => {
  const baseline: ResumoBaseline = {
    id: 'baseline-cash', tipo: 'cash', hipotese: 'teste', capitalInicial: 200, custoEntrada: 0,
    equityAtual: 200, pnl: 0, pnlPct: 0, drawdownMaxPct: 0, comprado: true,
  };
  const lb = montarLeaderboardMulti(null, null, [baseline], motorVazio('m', 'momentum-live.ts'), motorVazio('p', 'pares-live.ts'));
  const linha = lb.linhas.find((l) => l.strategyId === 'baseline-cash')!;
  assert.equal(linha.comparavelNaJanela, true);
});

test('a janela comum começa no motor mais recente, nunca no mais antigo', () => {
  const championEstado = { iniciadoEm: Date.now() - 10 * 86_400_000, capital: 610, capitalInicial: 600 };
  const baseline: ResumoBaseline = { id: 'baseline-cash', tipo: 'cash', hipotese: '', capitalInicial: 200, custoEntrada: 0, equityAtual: 200, pnl: 0, pnlPct: 0, drawdownMaxPct: 0, comprado: true };
  const lb = montarLeaderboardMulti(championEstado, null, [baseline], motorVazio('m', 'momentum-live.ts'), motorVazio('p', 'pares-live.ts'));
  // baseline "nasce agora" nesta etapa — a janela comum não pode ser mais velha que isso
  assert.ok(lb.janelaComum.desde >= Date.now() - 1000);
  assert.ok(lb.historicoTotalChampion.desde < lb.janelaComum.desde, 'histórico total do champion deveria ser bem mais antigo que a janela comum');
});

test('linha do leaderboard do Lab: nunca comparavelNaJanela=true contra o champion, mesmo com PnL bom', () => {
  const labLb = {
    geradoEm: Date.now(), championPnlPct: 0,
    linhas: [{
      challengerId: 'challenger-control', pnlPaperBruto: 1, pnlPaperBase: 1, pnlPaperAjustado: 1, diferencaDeRealismo: 0,
      cenarios: { ideal: 1, base: 1, conservador: 1, stress: 1 }, equity: 201, retornoPct: 0.5, drawdownMaxPct: 0,
      trades: 1, settlements: 1, custosTotais: 0.1, feeToGross: 0.1, retornoPorMargem: 0.01, concentracaoMaxima: 0.1,
      capitalOcioso: 100, bloqueiosPorSaldo: 0, nivelEvidencia: 'amostra_insuficiente' as const, eliminado: false,
      recomendadoEliminar: false, pnlIncremental: 0, pausado: false, altoRiscoAlavancagem: false,
    }],
    rankings: { maiorPnl: [], melhorRetornoPorMargem: [], menorDrawdown: [], melhorPnlSobreDrawdown: [], menorCusto: [], maisConsistente: [], maiorCrescimento: [], maiorFrequencia: [], maisEficiente: [], melhorAjustadoPorRisco: [] },
  };
  const lb = montarLeaderboardMulti(null, labLb, [], motorVazio('m', 'momentum-live.ts'), motorVazio('p', 'pares-live.ts'));
  const linha = lb.linhas.find((l) => l.strategyId === 'challenger-control')!;
  assert.equal(linha.comparavelNaJanela, false);
});
