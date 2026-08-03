/**
 * CUSTOS REAIS, medidos das exchanges em 03/08/2026.
 *
 * O motor usava 0,05% de taxa uniforme e 0,05% do valor para transferência.
 * Nenhum dos dois estava certo, e o segundo escondia uma restrição física que
 * inviabilizava metade do desenho de segurança.
 */

/**
 * Taxa taker por exchange, lida de `market.taker` via ccxt.
 *
 * A bitget é 20% mais cara que as outras. Numa estrutura onde o payback é
 * `taxa × 4 / spread`, isso é 20% a mais de tempo até empatar — não é
 * arredondamento.
 */
export const TAKER: Record<string, number> = {
  binanceusdm: 0.0005,
  binance: 0.0005,
  okx: 0.0005,
  gate: 0.0005,
  bybit: 0.00055,   // não expõe via ccxt sem chave; valor de tabela pública
  bitget: 0.0006,
};

export const TAKER_PADRAO = 0.0006;

/** Taxa de uma operação de duas pernas: cada exchange cobra a sua. */
export function taxaDaOperacao(exShort: string, exLong: string): number {
  return ((TAKER[exShort] ?? TAKER_PADRAO) + (TAKER[exLong] ?? TAKER_PADRAO)) / 2;
}

/**
 * Saque mínimo de USDT, em dólares.
 *
 * **Esta é a restrição que quebrou o desenho.** Não é um custo — é um piso.
 * Abaixo dele a transferência não acontece, por mais que o motor mande.
 *
 * Medido na bitget: mínimo de US$ 10 em todas as 12 redes. As outras exchanges
 * não expõem o dado sem chave de API, então uso 10 como padrão conservador.
 */
export const SAQUE_MINIMO = 10;

/**
 * Taxa fixa de saque, na rede mais barata disponível.
 *
 * Medido na bitget: US$ 0,001 na Plasma, US$ 0,03 na Aptos, US$ 0,15 na BEP20.
 * É pequeno em valor absoluto, mas é FIXO — sobre uma transferência de US$ 10,
 * US$ 0,15 é 1,5%, não 0,05%.
 */
export const TAXA_SAQUE = 0.15;

export interface CustoTransferencia {
  possivel: boolean;
  custo: number;
  fracao: number;
  motivo: string;
}

export function custoTransferencia(valor: number): CustoTransferencia {
  if (valor < SAQUE_MINIMO) {
    return {
      possivel: false, custo: 0, fracao: 0,
      motivo: `US$ ${valor.toFixed(2)} abaixo do saque mínimo de US$ ${SAQUE_MINIMO}`,
    };
  }
  return {
    possivel: true, custo: TAXA_SAQUE, fracao: TAXA_SAQUE / valor,
    motivo: `US$ ${TAXA_SAQUE.toFixed(2)} fixos (${(TAXA_SAQUE / valor * 100).toFixed(2)}% do valor)`,
  };
}

/**
 * Quantas posições simultâneas o capital sustenta **sem perder a capacidade de
 * transferir margem**.
 *
 * ── por que este limite existe ────────────────────────────────────────────
 *
 * Diluir em três posições reduz a concentração por exchange de 50% para 33%.
 * Parece puro ganho. Não é: diluir também divide a margem por perna, e no
 * momento do alerta a transferência necessária fica **abaixo do saque mínimo**.
 *
 * A transferência simplesmente não pode ser feita. Medido:
 *
 *   posições  margem/perna  transferência no alerta  possível?
 *   1         US$ 50,00     US$ 17,50                sim
 *   2         US$ 25,00     US$  8,75                NÃO
 *   3         US$ 16,67     US$  5,83                NÃO
 *
 * E sem transferência, a única defesa é fechar — o que o teste de ruína mediu
 * em 90 dias:
 *
 *   só fechamento   0,01% de ruína   mediana US$  89,88   42,5 fechamentos
 *   completa        0,03% de ruína   mediana US$ 111,67    0,2 fechamentos
 *
 * As duas são seguras. Mas a primeira **perde dinheiro**: sem poder reequilibrar,
 * a posição é fechada 42 vezes em 90 dias e o atrito devora o capital.
 *
 * Ou seja, a US$ 100 a escolha real não é "diluir ou não". É:
 *
 *   1 posição   concentração 50%, mediana US$ 111,67
 *   3 posições  concentração 33%, mediana US$  89,88
 *
 * Concentração é risco de cauda; o atrito é certeza. Escolhe-se a certeza.
 *
 * ── a fórmula ────────────────────────────────────────────────────────────
 *
 * No alerta, a margem apertada vale `notional × (alerta + mmr)`, e a
 * transferência é a metade da diferença entre as pernas:
 *
 *   transferência = margem_inicial × (1 − (alerta + mmr) × alavancagem)
 *
 * Exigindo `transferência ≥ SAQUE_MINIMO` e sabendo que
 * `margem_inicial = capital / (2 × posições)`, sai o limite abaixo.
 */
export function posicoesSustentaveis(
  capital: number, alavancagem: number,
  alerta = 0.12, mmr = 0.01, teto = 3,
): { posicoes: number; capitalPorPosicao: number; motivo: string } {
  const fator = 1 - (alerta + mmr) * alavancagem;

  // A alavancagem é alta demais para que a posição nasça fora do alerta. Nesse
  // caso não há transferência possível em nenhum tamanho, e a conta abaixo
  // devolveria um número negativo sem sentido.
  if (fator <= 0) {
    return {
      posicoes: 1, capitalPorPosicao: capital,
      motivo: `alavancagem ${alavancagem}x nasce dentro do alerta — sem margem para reequilibrar`,
    };
  }

  const maxPorSaque = Math.floor((capital * fator) / (SAQUE_MINIMO * 2));
  const posicoes = Math.max(1, Math.min(teto, maxPorSaque));
  const capitalParaTeto = (SAQUE_MINIMO * 2 * teto) / fator;

  return {
    posicoes,
    capitalPorPosicao: capital / posicoes,
    motivo: posicoes < teto
      ? `${posicoes} de ${teto} — transferir margem exige US$ ${capitalParaTeto.toFixed(0)} para ${teto} posições`
      : `${teto} posições, com transferência de margem viável em todas`,
  };
}
