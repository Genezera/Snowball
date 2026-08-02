/**
 * Mecânica de liquidação — a restrição da realidade que faltava.
 *
 * Até agora todo cálculo de risco deste projeto assumiu que o stop sempre
 * executa. Isso é verdade em risco baixo. Em risco alto é falso, e a diferença
 * é a conta inteira.
 *
 * Para arriscar `R` do capital com um stop a `S` de distância, a posição
 * precisa de alavancagem `L = R / S`. Com R = 50% e S = 1,5%, são 33x. A
 * exchange liquida quando a perda consome a margem de manutenção — o que
 * acontece a aproximadamente `1/L` de movimento contrário.
 *
 * Com 33x, a liquidação vem em ~3%. O stop em 1,5% ainda dispara antes.
 * Com 66x, a liquidação vem em ~1,5% — exatamente onde está o stop. Aí é
 * sorteio entre os dois, e a liquidação é sempre pior: fecha a mercado, com
 * slippage, e cobra taxa de liquidação.
 *
 * Sem modelar isto, uma simulação de risco alto mente para melhor.
 */

/** Escalonamento de margem de manutenção da Binance USDT-M, faixas iniciais. */
export interface TierMargem {
  /** notional máximo desta faixa, em USDT */
  ateNotional: number;
  /** alavancagem máxima permitida */
  alavancagemMax: number;
  /** taxa de margem de manutenção */
  mmr: number;
}

/**
 * Faixas para BTC/ETH. Alts costumam ter tetos bem menores — 20x a 75x — e
 * faixas que apertam mais rápido. Estes valores são conservadores para
 * posições pequenas (abaixo de US$ 50 mil).
 */
export const TIERS_MAJOR: TierMargem[] = [
  { ateNotional: 50_000, alavancagemMax: 125, mmr: 0.004 },
  { ateNotional: 500_000, alavancagemMax: 100, mmr: 0.005 },
  { ateNotional: 1_000_000, alavancagemMax: 50, mmr: 0.01 },
];

/** Alts líquidos: teto muito menor. É o caso de XRP, DOT, DOGE. */
export const TIERS_ALT: TierMargem[] = [
  { ateNotional: 10_000, alavancagemMax: 50, mmr: 0.01 },
  { ateNotional: 50_000, alavancagemMax: 25, mmr: 0.02 },
];

export function tierPara(notional: number, tiers: TierMargem[]): TierMargem {
  return tiers.find((t) => notional <= t.ateNotional) ?? tiers[tiers.length - 1];
}

export interface AnaliseLiquidacao {
  alavancagemNecessaria: number;
  alavancagemPermitida: number;
  /** true quando a exchange simplesmente não deixa montar a posição */
  impossivel: boolean;
  /** movimento contrário, em fração, que dispara a liquidação */
  distanciaLiquidacao: number;
  /** true quando a liquidação vem ANTES do stop */
  liquidaAntesDoStop: boolean;
  /** risco máximo por trade que a alavancagem permitida sustenta */
  riscoMaximoViavel: number;
}

/**
 * Analisa se um risco desejado é fisicamente montável, e se o stop protege.
 *
 * A margem de manutenção é o que sobra: você é liquidado quando a perda
 * consome (1/L - mmr) do notional, não 1/L. Ignorar o mmr subestima o perigo.
 */
export function analisarLiquidacao(
  riscoPorTrade: number,
  stopPct: number,
  tiers: TierMargem[] = TIERS_MAJOR,
  notionalEstimado = 1000,
): AnaliseLiquidacao {
  const tier = tierPara(notionalEstimado, tiers);
  const necessaria = riscoPorTrade / stopPct;
  const permitida = tier.alavancagemMax;
  const efetiva = Math.min(necessaria, permitida);

  // distância até a liquidação: 1/L menos a margem de manutenção
  const distLiq = Math.max(0.0001, 1 / efetiva - tier.mmr);

  return {
    alavancagemNecessaria: necessaria,
    alavancagemPermitida: permitida,
    impossivel: necessaria > permitida,
    distanciaLiquidacao: distLiq,
    liquidaAntesDoStop: distLiq <= stopPct,
    riscoMaximoViavel: permitida * stopPct,
  };
}

/**
 * Custo de uma liquidação, em fração do notional.
 *
 * Liquidação não é um stop mais caro — é uma coisa diferente. A posição é
 * fechada a mercado pelo motor da exchange, com slippage que você não escolhe,
 * e ainda incide taxa de liquidação. Em cascatas de liquidação o slippage é
 * muito pior que o normal, porque todo mundo é fechado ao mesmo tempo.
 */
export const CUSTO_LIQUIDACAO = {
  /** taxa cobrada pela exchange sobre o notional */
  taxa: 0.005,
  /** slippage adicional na execução forçada */
  slippage: 0.003,
};

/**
 * Resultado de um trade com liquidação modelada.
 *
 * Quando a liquidação vem antes do stop, o trade não perde `stopPct` — perde
 * a margem inteira mais os custos de liquidação. É por isso que risco alto não
 * escala linearmente: a partir de certo ponto, cada perda é total.
 */
export function aplicarTrade(
  equity: number,
  retornoR: number,
  riscoPorTrade: number,
  stopPct: number,
  analise: AnaliseLiquidacao,
): { novoEquity: number; liquidado: boolean } {
  // Quando a exchange não permite a alavancagem, o risco real é o máximo viável
  const riscoEfetivo = analise.impossivel ? analise.riscoMaximoViavel : riscoPorTrade;

  if (!analise.liquidaAntesDoStop) {
    return { novoEquity: equity + Math.max(-equity, retornoR * equity * riscoEfetivo), liquidado: false };
  }

  // A liquidação vem antes do stop: qualquer perda que alcance a distância de
  // liquidação vira perda total da margem, mais taxas.
  const movimentoContrario = retornoR < 0 ? Math.abs(retornoR) * stopPct : 0;
  if (movimentoContrario >= analise.distanciaLiquidacao) {
    const perda = equity * (1 + CUSTO_LIQUIDACAO.taxa + CUSTO_LIQUIDACAO.slippage);
    return { novoEquity: Math.max(0, equity - perda), liquidado: true };
  }
  return { novoEquity: equity + Math.max(-equity, retornoR * equity * riscoEfetivo), liquidado: false };
}
