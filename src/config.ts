/**
 * Presets de custo e risco.
 *
 * Os numeros de custo NAO sao chutes otimistas. Taxa taker padrao de Binance
 * spot e 0.1% por lado; futures USDT-M e 0.05% por lado. Slippage de 2 bps em
 * par liquido de 5min e conservador mas realista para ordem a mercado pequena.
 *
 * Se voce mudar estes numeros para baixo "para o backtest ficar melhor", voce
 * nao melhorou a estrategia, voce so parou de medir.
 */
import type { BacktestConfig, CostModel, RiskConfig } from './core/types.ts';

export const COSTS: Record<string, CostModel> = {
  /** Binance spot, sem desconto de BNB. O cenario mais caro e mais honesto. */
  'binance-spot': { takerFee: 0.001, slippage: 0.0002, fundingPer8h: 0 },
  /** Binance spot com BNB (-25%). */
  'binance-spot-bnb': { takerFee: 0.00075, slippage: 0.0002, fundingPer8h: 0 },
  /** Binance USDT-M futures. Funding medio historico ~0.01% por 8h em alta. */
  'binance-futures': { takerFee: 0.0005, slippage: 0.0002, fundingPer8h: 0.0001 },
  /**
   * Binance futures com ordem LIMITE (maker). 0.02%/lado e sem slippage, porque
   * voce define o preco. E 3.5x mais barato que taker, e nestas estrategias a
   * diferenca entre taker e maker e literalmente a diferenca entre perder e
   * ganhar.
   *
   * O custo escondido: ordem limite nem sempre executa. Voce so e preenchido
   * quando o preco volta ate voce, o que significa que perde justamente os
   * rompimentos que dispararam sem olhar para tras -- que sao os trades bons.
   * Isso se chama selecao adversa e NAO aparece neste modelo de custo. Por isso
   * este preset e um TETO otimista, nao uma previsao.
   */
  'binance-futures-maker': { takerFee: 0.0002, slippage: 0.00005, fundingPer8h: 0.0001 },
  /** Maker com desconto BNB. */
  'binance-futures-maker-bnb': { takerFee: 0.00015, slippage: 0.00005, fundingPer8h: 0.0001 },
  /** Bybit perpetuos. */
  'bybit-futures': { takerFee: 0.00055, slippage: 0.0002, fundingPer8h: 0.0001 },
  /**
   * Acao americana em corretora de varejo. A comissao e literalmente ZERO
   * (Robinhood, Schwab, Fidelity), o que remove o pedagio que matou o scalping
   * de 5 minutos em cripto. Sobram spread e slippage.
   *
   * O que NAO esta neste modelo e precisa ser lembrado: o gap overnight. Com
   * mediana de 0,45% (F) a 2,50% (SOXL) e maximos acima de 20%, um stop de
   * 1,5% e atravessado com frequencia. O motor sai na abertura nesses casos,
   * entao o custo aparece no resultado -- mas nao neste preset.
   */
  'acao-varejo': { takerFee: 0, slippage: 0.0005, fundingPer8h: 0 },
  /** Acao com spread mais largo (menos liquida) ou execucao pior. */
  'acao-conservador': { takerFee: 0.0001, slippage: 0.0015, fundingPer8h: 0 },
  /**
   * Acao em corretora de varejo dos EUA. Comissao ZERO -- e o motivo pelo qual
   * esta trilha existe. O pedagio que condenou o scalping em cripto nao existe
   * aqui; sobram spread e slippage.
   *
   * 0,10%/lado e conservador para acao de grande capitalizacao no intraday.
   */
  'acao-varejo': { takerFee: 0, slippage: 0.001, fundingPer8h: 0 },
  /** Acao com spread pior: small cap, ou horario de baixa liquidez. */
  'acao-stress': { takerFee: 0.0001, slippage: 0.002, fundingPer8h: 0 },
  /** Cenario adverso: use para stress test antes de colocar dinheiro. */
  stress: { takerFee: 0.001, slippage: 0.0008, fundingPer8h: 0.0003 },
  /** Cenario de fantasia. Existe so para demonstrar o quanto os custos importam. */
  'zero-cost': { takerFee: 0, slippage: 0, fundingPer8h: 0 },
};

/**
 * Perfil "bola de neve": comeca com o minimo que a exchange aceita e sobe
 * sozinho porque o tamanho e sempre uma fracao do equity atual.
 *
 * riskPerTrade 0.5% e a escolha central. Com 0.5% por trade, uma sequencia de
 * 20 perdas seguidas custa ~10% da conta, nao a conta inteira. Backtests dessas
 * estrategias mostram sequencias de 12-18 perdas como coisa normal.
 */
export const RISK_PROFILES: Record<string, RiskConfig> = {
  /** Para validar em conta real com valor que voce aceita perder inteiro. */
  seed: {
    riskPerTrade: 0.005,
    maxLeverage: 3,
    dailyLossLimit: 0.03,
    maxDrawdownStop: 0.15,
    minNotional: 5,
    maxConcurrent: 1,
  },
  /** Depois que a estrategia sobreviveu a walk-forward E a 3 meses de paper. */
  grow: {
    riskPerTrade: 0.0075,
    maxLeverage: 5,
    dailyLossLimit: 0.04,
    maxDrawdownStop: 0.2,
    minNotional: 5,
    maxConcurrent: 1,
  },
  /** Ultra conservador: para quando o objetivo e so nao morrer enquanto aprende. */
  turtle: {
    riskPerTrade: 0.0025,
    maxLeverage: 2,
    dailyLossLimit: 0.02,
    maxDrawdownStop: 0.1,
    minNotional: 5,
    maxConcurrent: 1,
  },
};

export function makeConfig(opts: {
  initialEquity?: number;
  costPreset?: string;
  riskProfile?: string;
  maxBarsInTrade?: number;
  pessimisticIntrabar?: boolean;
  riskPerTrade?: number;
} = {}): BacktestConfig {
  const cost = COSTS[opts.costPreset ?? 'binance-futures'];
  if (!cost) throw new Error(`preset de custo desconhecido: ${opts.costPreset}. Opcoes: ${Object.keys(COSTS).join(', ')}`);
  const base = RISK_PROFILES[opts.riskProfile ?? 'seed'];
  if (!base) throw new Error(`perfil de risco desconhecido: ${opts.riskProfile}. Opcoes: ${Object.keys(RISK_PROFILES).join(', ')}`);
  const risk = { ...base };
  if (opts.riskPerTrade != null) risk.riskPerTrade = opts.riskPerTrade;
  return {
    initialEquity: opts.initialEquity ?? 100,
    cost,
    risk,
    // 48 barras de 5min = 4 horas. Um scalp que nao resolveu em 4h nao e mais
    // um scalp, e uma posicao presa pagando funding.
    maxBarsInTrade: opts.maxBarsInTrade ?? 48,
    pessimisticIntrabar: opts.pessimisticIntrabar ?? true,
  };
}
