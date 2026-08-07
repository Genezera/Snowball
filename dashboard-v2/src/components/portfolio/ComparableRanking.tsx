import type { LinhaMultiStrategy } from '../../schemas/multiStrategy';

/**
 * Correção obrigatória: nunca eleger "melhor"/"pior" motor misturando
 * janelas diferentes. Só `comparavelNaJanela === true` participa do
 * ranking — as outras aparecem, mas numa seção separada, com o motivo
 * (a `nota` que o backend já anexa a cada linha), nunca excluídas em
 * silêncio.
 */
export interface RankingComparavel {
  melhor: LinhaMultiStrategy | null;
  pior: LinhaMultiStrategy | null;
  comparaveis: LinhaMultiStrategy[];
  naoComparaveis: LinhaMultiStrategy[];
}

export function calcularRankingComparavel(linhas: LinhaMultiStrategy[]): RankingComparavel {
  const comparaveis = linhas.filter((l) => l.comparavelNaJanela && l.disponivel);
  const naoComparaveis = linhas.filter((l) => !l.comparavelNaJanela || !l.disponivel);
  if (!comparaveis.length) return { melhor: null, pior: null, comparaveis, naoComparaveis };
  const ordenado = [...comparaveis].sort((a, b) => b.pnlDesdeOInicio - a.pnlDesdeOInicio);
  return { melhor: ordenado[0], pior: ordenado[ordenado.length - 1], comparaveis, naoComparaveis };
}
