import { describe, it, expect } from 'vitest';
import { calcularRankingComparavel } from '../components/portfolio/ComparableRanking';
import type { LinhaMultiStrategy } from '../schemas/multiStrategy';

function linha(over: Partial<LinhaMultiStrategy>): LinhaMultiStrategy {
  return {
    strategyId: 'x', familia: 'funding-challenger', disponivel: true,
    capitalVirtual: 200, pnlDesdeOInicio: 0, pnlPct: 0, drawdownMaxPct: 0,
    iniciadoEm: null, diasRodando: null, dentroDaJanelaComumDesdeOInicio: true,
    comparavelNaJanela: true, nota: '',
    ...over,
  };
}

describe('calcularRankingComparavel', () => {
  it('nunca elege o champion (janela diferente) como melhor motor, mesmo com PnL absoluto maior', () => {
    const champion = linha({ strategyId: 'funding-arbitrage-champion', pnlDesdeOInicio: 999, comparavelNaJanela: false });
    const challenger = linha({ strategyId: 'challenger-control', pnlDesdeOInicio: 1, comparavelNaJanela: true });
    const r = calcularRankingComparavel([champion, challenger]);
    expect(r.melhor?.strategyId).toBe('challenger-control');
    expect(r.naoComparaveis.map((l) => l.strategyId)).toContain('funding-arbitrage-champion');
  });

  it('linhas não comparáveis nunca somem — aparecem em naoComparaveis, nunca excluídas', () => {
    const linhas = [
      linha({ strategyId: 'a', comparavelNaJanela: true }),
      linha({ strategyId: 'b', comparavelNaJanela: false }),
      linha({ strategyId: 'c', comparavelNaJanela: false }),
    ];
    const r = calcularRankingComparavel(linhas);
    expect(r.comparaveis).toHaveLength(1);
    expect(r.naoComparaveis).toHaveLength(2);
    expect(r.comparaveis.length + r.naoComparaveis.length).toBe(linhas.length);
  });

  it('sem nenhuma linha comparável: melhor e pior são null, nunca um valor fabricado', () => {
    const linhas = [linha({ comparavelNaJanela: false }), linha({ comparavelNaJanela: false })];
    const r = calcularRankingComparavel(linhas);
    expect(r.melhor).toBeNull();
    expect(r.pior).toBeNull();
  });

  it('indisponível (disponivel:false) também não participa do ranking, mesmo se comparavelNaJanela for true', () => {
    const linhas = [linha({ strategyId: 'indisponivel', comparavelNaJanela: true, disponivel: false, pnlDesdeOInicio: 999 })];
    const r = calcularRankingComparavel(linhas);
    expect(r.melhor).toBeNull();
    expect(r.naoComparaveis).toHaveLength(1);
  });

  it('melhor e pior são a mesma linha quando só há uma comparável', () => {
    const linhas = [linha({ strategyId: 'unica' })];
    const r = calcularRankingComparavel(linhas);
    expect(r.melhor?.strategyId).toBe('unica');
    expect(r.pior?.strategyId).toBe('unica');
  });
});
