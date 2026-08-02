/** Tipos centrais. Uma "serie" e sempre ordenada por tempo crescente, sem buracos duplicados. */

export interface Bar {
  /** epoch ms do ABRIR da barra */
  t: number;
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
}

export interface Series {
  symbol: string;
  timeframe: string;
  bars: Bar[];
}

export type Side = 'long' | 'short';

/**
 * Sinal emitido por uma estrategia NA BARRA i, com a intencao de executar
 * na ABERTURA da barra i+1. Isso e o que impede lookahead: a estrategia so
 * enxerga bars[0..i] e nunca negocia dentro da propria barra que a gerou.
 */
export interface Signal {
  side: Side;
  /** stop loss como fracao do preco de entrada, ex 0.015 = 1.5% */
  stopPct: number;
  /** take profit como fracao do preco de entrada, ex 0.03 = 3% */
  takePct: number;
  /**
   * Stop movel, como fracao do preco. Quando definido, o stop acompanha o
   * preco na direcao favoravel e NUNCA volta atras (catraca).
   *
   * Existe porque uma familia inteira de estrategias — as que deixam o vencedor
   * correr — nao podia ser avaliada sem isto. A porta do `trend-rider` deu PF
   * 1,14 contra 1,98 do original justamente por faltar o trailing de 2,5xATR.
   */
  trailPct?: number;
  /**
   * O trailing so e ARMADO depois que o trade avanca este tanto a favor.
   * Sem isso o stop movel sufoca o trade no ruido logo apos a entrada.
   */
  trailArmPct?: number;
  /** Features opcionais gravadas junto ao trade, usadas depois pelo ML. */
  features?: Record<string, number>;
}

export interface Strategy {
  name: string;
  /** Quantas barras de aquecimento a estrategia precisa antes de poder emitir sinal. */
  warmup: number;
  /**
   * Recebe a serie inteira e o indice atual. DEVE ler apenas bars[j] com j <= i.
   * Retorna null quando nao ha sinal.
   */
  onBar(bars: Bar[], i: number): Signal | null;
}

export type ExitReason = 'stop' | 'take' | 'timeout' | 'end-of-data';

export interface Trade {
  symbol: string;
  side: Side;
  entryTime: number;
  entryPrice: number;
  exitTime: number;
  exitPrice: number;
  exitReason: ExitReason;
  barsHeld: number;
  /** notional em moeda de cotacao no momento da entrada */
  notional: number;
  /** custo total pago (fees + slippage), em moeda de cotacao */
  cost: number;
  /** PnL liquido em moeda de cotacao */
  pnl: number;
  /** retorno liquido sobre o EQUITY no momento da entrada */
  rEquity: number;
  /** retorno bruto do preco, com sinal ajustado ao lado */
  rPrice: number;
  equityAfter: number;
  features?: Record<string, number>;
}

export interface CostModel {
  /** taxa taker por lado, ex 0.0005 = 5 bps */
  takerFee: number;
  /** slippage estimado por lado, em fracao do preco */
  slippage: number;
  /** funding por 8h em perpetuos; 0 para spot */
  fundingPer8h: number;
}

export interface RiskConfig {
  /** fracao do equity arriscada por trade (a distancia ate o stop) */
  riskPerTrade: number;
  /** alavancagem maxima permitida sobre o notional */
  maxLeverage: number;
  /** perda maxima em um dia antes de parar de operar (fracao do equity do inicio do dia) */
  dailyLossLimit: number;
  /** drawdown maximo desde o pico antes de desligar de vez */
  maxDrawdownStop: number;
  /** notional minimo aceito pela exchange, em moeda de cotacao */
  minNotional: number;
  /** numero maximo de posicoes simultaneas */
  maxConcurrent: number;
}

export interface BacktestConfig {
  initialEquity: number;
  cost: CostModel;
  risk: RiskConfig;
  /** numero maximo de barras que uma posicao pode ficar aberta antes do timeout */
  maxBarsInTrade: number;
  /** se true, quando high e low tocam TP e SL na mesma barra assume o STOP (pessimista) */
  pessimisticIntrabar: boolean;
}

export interface BacktestResult {
  trades: Trade[];
  equityCurve: { t: number; equity: number }[];
  finalEquity: number;
  /** motivo pelo qual o backtest parou antes do fim dos dados, se aplicavel */
  haltedAt?: { t: number; reason: string };
}
