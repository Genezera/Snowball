/**
 * Testes do contrato de dados — a garantia central é que o schema aceita o
 * dado REAL que o backend produz (inclusive os casos extremos que
 * `JSON.stringify` transforma, como Infinity → null) e recusa dado
 * genuinamente inválido, sem lançar exceção não tratada.
 */
import { describe, it, expect } from 'vitest';
import { LinhaLeaderboardSchema, ResumoSchema } from '../schemas/profitLab';

describe('LinhaLeaderboardSchema', () => {
  const base = {
    challengerId: 'challenger-teste', altoRiscoAlavancagem: false,
    pnlPaperBase: 1, pnlPaperAjustado: 1, retornoPct: 0.5, drawdownMaxPct: 0,
    trades: 1, settlements: 1, custosTotais: 0.1, feeToGross: 0.1,
    retornoPorMargem: 0.01, nivelEvidencia: 'amostra_insuficiente',
    eliminado: false, pausado: false, pnlIncremental: 0,
  };

  it('aceita feeToGross null — Infinity vira null na serialização JSON, não é dado corrompido', () => {
    const r = LinhaLeaderboardSchema.safeParse({ ...base, feeToGross: null });
    expect(r.success).toBe(true);
  });

  it('aceita campos extras sem falhar (passthrough — backend pode ganhar campos novos)', () => {
    const r = LinhaLeaderboardSchema.safeParse({ ...base, campoNovoDoFuturo: 'x' });
    expect(r.success).toBe(true);
  });

  it('recusa quando um campo numérico obrigatório vem como string — dado genuinamente corrompido', () => {
    const r = LinhaLeaderboardSchema.safeParse({ ...base, pnlPaperBase: 'não é número' });
    expect(r.success).toBe(false);
  });

  it('recusa challengerId ausente', () => {
    const { challengerId, ...semId } = base;
    const r = LinhaLeaderboardSchema.safeParse(semId);
    expect(r.success).toBe(false);
  });
});

describe('ResumoSchema', () => {
  it('aceita control=null (challenger-control pode não ter linha ainda no leaderboard)', () => {
    const r = ResumoSchema.safeParse({
      geradoEm: Date.now(),
      champion: {
        pnlRealizado: 1, pnlNaoRealizadoMark: 0, pnlNaoRealizadoExecutavel: 0,
        equityMark: 601, equityLiquidacao: 600, fundingBruto: 2, custosTotais: 1,
        capitalInicial: 600, capitalAtual: 601, pnlPct: 0.16, marcacaoDisponivel: true,
      },
      control: null,
      melhorPnlBase: { challengerId: null, valor: 0 },
      melhorPnlAjustado: { challengerId: null, valor: 0 },
      melhorRetornoPorMargem: { challengerId: null, valor: 0 },
      menorDrawdown: { challengerId: null, valor: 0 },
      maiorFrequencia: { challengerId: null, valor: 0 },
      menorCusto: { challengerId: null, valor: 0 },
      capitalVirtualTotal: 0, tradesTotaisPaper: 0, settlementsTotaisPaper: 0,
      numeroChallengers: 0, numeroAtivos: 0, numeroPausados: 0, numeroEliminados: 0,
    });
    expect(r.success).toBe(true);
  });
});
