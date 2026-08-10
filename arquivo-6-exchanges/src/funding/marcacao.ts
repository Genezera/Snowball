/**
 * MARCAÇÃO A MERCADO — read-only, nunca decide nada.
 *
 * Responde a uma pergunta que o motor nunca respondeu: quanto vale, agora, o
 * que está aberto? O motor só sabe `capital` (realizado, atualizado em
 * eventos discretos — funding, custo, socorro) e `margemShort`/`margemLong`
 * por posição (contabilidade incremental de preço, ver spread-live.ts). Nem
 * um nem outro é "quanto eu teria se fechasse agora".
 *
 * Dois números, propositalmente diferentes:
 *
 *   equityMark        — usa MARK PRICE (referência da exchange, o que o
 *                        book mostraria fechado, sem cruzar o spread)
 *   equityLiquidacao   — usa o lado EXECUTÁVEL do book (bid pra vender a
 *                        perna comprada, ask pra comprar a perna vendida) e
 *                        desconta o custo de fechar as duas pernas AGORA
 *
 * equityLiquidacao é sempre <= equityMark (cruzar o spread e pagar taxa
 * custa). A diferença entre os dois é o preço de sair imediatamente.
 *
 * NENHUM valor daqui entra em `estado.json` nem em qualquer decisão do
 * motor — grava em `spread/marcacao.json`, arquivo próprio, sem overlap com
 * o estado que o motor lê para decidir. Ver spread-live.ts para onde isto é
 * chamado (sempre depois da decisão do ciclo já ter sido tomada).
 */

export interface TickerPerna {
  bid: number;
  ask: number;
  /** referência da exchange — nem sempre exposta; cai para (bid+ask)/2 quando ausente */
  mark?: number;
}

export interface EntradaMarcacaoPerna {
  /** 'venda' = perna short (vendida), 'compra' = perna long (comprada) */
  lado: 'venda' | 'compra';
  precoEntrada: number;
  notional: number;
  ticker: TickerPerna;
}

export interface SaidaMarcacaoPerna {
  precoEntrada: number;
  markPrice: number;
  precoExecutavel: number;
  notional: number;
  pnlNaoRealizadoMark: number;
  pnlNaoRealizadoExecutavel: number;
}

/**
 * Uma perna vendida lucra quando o preço CAI; uma comprada lucra quando SOBE.
 * `precoExecutavel` é o lado do book que fechar essa perna cruzaria: quem
 * está vendido fecha COMPRANDO (paga o ask); quem está comprado fecha
 * VENDENDO (recebe o bid). Isso é sempre pior para quem fecha que o mark —
 * por isso equityLiquidacao <= equityMark, sempre.
 */
export function marcarPerna(e: EntradaMarcacaoPerna): SaidaMarcacaoPerna {
  const mark = e.ticker.mark ?? (e.ticker.bid + e.ticker.ask) / 2;
  const precoExecutavel = e.lado === 'venda' ? e.ticker.ask : e.ticker.bid;
  const sinal = e.lado === 'venda' ? -1 : 1;
  const pnlMark = sinal * e.notional * (mark / e.precoEntrada - 1);
  const pnlExecutavel = sinal * e.notional * (precoExecutavel / e.precoEntrada - 1);
  return {
    precoEntrada: e.precoEntrada, markPrice: mark, precoExecutavel: precoExecutavel,
    notional: e.notional, pnlNaoRealizadoMark: pnlMark, pnlNaoRealizadoExecutavel: pnlExecutavel,
  };
}

export interface EntradaMarcacaoPosicao {
  symbol: string;
  notionalPorPerna: number;
  precoEntradaShort: number;
  precoEntradaLong: number;
  tickerShort: TickerPerna;
  tickerLong: TickerPerna;
  fundingAcumulado: number;
  taxasPagas: number;
  /** taxa efetiva já usada para custear esta posição — reaproveitada para o custo de fechamento */
  taxaEfetiva: number;
}

export interface SaidaMarcacaoPosicao {
  symbol: string;
  precoEntradaShort: number; precoEntradaLong: number;
  markPriceShort: number; markPriceLong: number;
  precoExecutavelShort: number; precoExecutavelLong: number;
  notionalShort: number; notionalLong: number;
  pnlNaoRealizadoShort: number; pnlNaoRealizadoLong: number;
  pnlNaoRealizadoTotal: number;
  pnlNaoRealizadoExecutavelTotal: number;
  fundingAcumulado: number;
  taxasPagas: number;
  custoEstimadoFechamento: number;
}

/** A posição inteira: as duas pernas somadas, mais o custo de fechar as duas agora. */
export function marcarPosicao(e: EntradaMarcacaoPosicao): SaidaMarcacaoPosicao {
  const short = marcarPerna({ lado: 'venda', precoEntrada: e.precoEntradaShort, notional: e.notionalPorPerna, ticker: e.tickerShort });
  const long = marcarPerna({ lado: 'compra', precoEntrada: e.precoEntradaLong, notional: e.notionalPorPerna, ticker: e.tickerLong });
  const custoEstimadoFechamento = e.notionalPorPerna * e.taxaEfetiva * 2;
  return {
    symbol: e.symbol,
    precoEntradaShort: e.precoEntradaShort, precoEntradaLong: e.precoEntradaLong,
    markPriceShort: short.markPrice, markPriceLong: long.markPrice,
    precoExecutavelShort: short.precoExecutavel, precoExecutavelLong: long.precoExecutavel,
    notionalShort: e.notionalPorPerna, notionalLong: e.notionalPorPerna,
    pnlNaoRealizadoShort: short.pnlNaoRealizadoMark, pnlNaoRealizadoLong: long.pnlNaoRealizadoMark,
    pnlNaoRealizadoTotal: short.pnlNaoRealizadoMark + long.pnlNaoRealizadoMark,
    pnlNaoRealizadoExecutavelTotal: short.pnlNaoRealizadoExecutavel + long.pnlNaoRealizadoExecutavel,
    fundingAcumulado: e.fundingAcumulado, taxasPagas: e.taxasPagas,
    custoEstimadoFechamento,
  };
}

export interface ResumoMarcacao {
  capitalRealizado: number;
  pnlNaoRealizadoMark: number;
  pnlNaoRealizadoExecutavel: number;
  custoEstimadoFechamentoTotal: number;
  /** capitalRealizado + pnlNaoRealizadoMark — o que o mark price diz que vale */
  equityMark: number;
  /**
   * capitalRealizado + pnlNaoRealizadoExecutavel − custoEstimadoFechamentoTotal
   * — o que sobraria fechando tudo AGORA, cruzando o book e pagando taxa.
   * Sempre <= equityMark.
   */
  equityLiquidacao: number;
  posicoes: SaidaMarcacaoPosicao[];
  geradoEm: number;
}

export function resumirMarcacao(capitalRealizado: number, posicoes: SaidaMarcacaoPosicao[], geradoEm = Date.now()): ResumoMarcacao {
  const pnlMark = posicoes.reduce((s, p) => s + p.pnlNaoRealizadoTotal, 0);
  const pnlExec = posicoes.reduce((s, p) => s + p.pnlNaoRealizadoExecutavelTotal, 0);
  const custoFechamento = posicoes.reduce((s, p) => s + p.custoEstimadoFechamento, 0);
  return {
    capitalRealizado,
    pnlNaoRealizadoMark: pnlMark,
    pnlNaoRealizadoExecutavel: pnlExec,
    custoEstimadoFechamentoTotal: custoFechamento,
    equityMark: capitalRealizado + pnlMark,
    equityLiquidacao: capitalRealizado + pnlExec - custoFechamento,
    posicoes, geradoEm,
  };
}
