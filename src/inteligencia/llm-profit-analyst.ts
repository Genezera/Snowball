/**
 * LLM PROFIT ANALYST — v1 determinístico, mesmo padrão já usado no plano
 * anterior (Intelligence Layer §2.1): monta as 10 respostas pedidas a partir
 * de dado estruturado, cada afirmação citando o challenger e o número exato.
 * Nenhuma chamada a modelo externo nesta versão — não há decisão de custo/
 * chave de API tomada ainda, e um relatório fabricado por template é
 * estritamente melhor que um resumo de LLM sem grounding checável. Trocar o
 * template por uma chamada real de LLM depois é aditivo: o LLM leria estes
 * mesmos fatos e só verbalizaria melhor, nunca inventaria número.
 */
import type { Leaderboard, LinhaLeaderboard } from './leaderboard.ts';

export interface RelatorioDiario {
  data: string;
  respostas: { pergunta: string; resposta: string }[];
}

function fmt(n: number, casas = 2): string { return n.toFixed(casas); }

export function gerarRelatorioDiario(lb: Leaderboard): RelatorioDiario {
  const L = lb.linhas;
  const data = new Date(lb.geradoEm).toISOString().slice(0, 10);
  if (!L.length) {
    return { data, respostas: [{ pergunta: 'estado geral', resposta: 'nenhum challenger com estado ainda — Lab recém-iniciado ou ainda sem ciclo completo.' }] };
  }
  const porId = (id: string) => L.find((l) => l.challengerId === id);
  const maiorPnl = porId(lb.rankings.maiorPnl[0]);
  const melhorMargem = porId(lb.rankings.melhorRetornoPorMargem[0]);
  const menorCusto = porId(lb.rankings.menorCusto[0]);
  const maiorDrawdown = [...L].sort((a, b) => b.drawdownMaxPct - a.drawdownMaxPct)[0];
  const incrementalPositivo = L.filter((l) => l.pnlIncremental > 0).sort((a, b) => b.pnlIncremental - a.pnlIncremental)[0];
  const piorIncremental = [...L].sort((a, b) => a.pnlIncremental - b.pnlIncremental)[0];
  const dependeDeUmTrade = L.filter((l) => l.trades > 0 && l.trades <= 2);
  const continuar = L.filter((l) => !l.eliminado && !l.recomendadoEliminar);
  const pausar = L.filter((l) => l.recomendadoEliminar && !l.eliminado);

  const respostas = [
    { pergunta: 'Qual challenger ganhou mais?', resposta: maiorPnl ? `${maiorPnl.challengerId}: PnL ajustado US$${fmt(maiorPnl.pnlPaperAjustado)} (${fmt(maiorPnl.retornoPct)}%)` : 'sem dado' },
    { pergunta: 'Qual teve melhor retorno por margem?', resposta: melhorMargem ? `${melhorMargem.challengerId}: US$${fmt(melhorMargem.retornoPorMargem, 4)} por dólar de margem comprometida` : 'sem dado' },
    { pergunta: 'Qual reduziu mais custos?', resposta: menorCusto ? `${menorCusto.challengerId}: US$${fmt(menorCusto.custosTotais)} de custo total (fee-to-gross ${isFinite(menorCusto.feeToGross) ? fmt(menorCusto.feeToGross * 100) + '%' : 'sem funding ainda'})` : 'sem dado' },
    { pergunta: 'Qual assumiu risco excessivo?', resposta: maiorDrawdown && maiorDrawdown.drawdownMaxPct > 0 ? `${maiorDrawdown.challengerId}: drawdown máximo de ${fmt(maiorDrawdown.drawdownMaxPct)}%` : 'nenhum drawdown relevante registrado ainda' },
    { pergunta: 'Qual melhoria gerou lucro incremental?', resposta: incrementalPositivo ? `${incrementalPositivo.challengerId}: +${fmt(incrementalPositivo.pnlIncremental)}pp sobre o champion (ajustado)` : 'nenhum challenger supera o champion ajustado ainda' },
    { pergunta: 'Qual combinação destruiu o resultado?', resposta: piorIncremental && piorIncremental.pnlIncremental < 0 ? `${piorIncremental.challengerId}: ${fmt(piorIncremental.pnlIncremental)}pp abaixo do champion` : 'nenhum challenger significativamente pior que o champion ainda' },
    { pergunta: 'Algum lucro dependeu de um único trade?', resposta: dependeDeUmTrade.length ? `sim — ${dependeDeUmTrade.map((l) => l.challengerId).join(', ')} têm 1-2 trades no total, qualquer PnL ali é anedota, não sinal` : 'nenhum challenger com amostra criticamente pequena (todos com 3+ trades ou zero)' },
    { pergunta: 'Qual experimento deve continuar?', resposta: continuar.length ? continuar.map((l) => l.challengerId).join(', ') : 'nenhum — revisar critérios de eliminação' },
    { pergunta: 'Qual deve ser pausado?', resposta: pausar.length ? pausar.map((l) => `${l.challengerId} (${l.motivoRecomendacao})`).join('; ') : 'nenhum challenger atingiu critério de eliminação ainda' },
    { pergunta: 'Qual novo challenger deve ser testado?', resposta: 'ver roadmap na entrega — próximos aprovados: batch-rebalancing e capital-allocation, ainda não implementados nesta sessão' },
  ];
  return { data, respostas };
}

export function formatarMarkdown(r: RelatorioDiario): string {
  const linhas = [`# Relatório diário do Paper Profit Lab — ${r.data}`, ''];
  for (const { pergunta, resposta } of r.respostas) linhas.push(`**${pergunta}**`, resposta, '');
  return linhas.join('\n');
}
