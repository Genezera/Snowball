/**
 * Universo de cripto usado para validar `ts-momentum` (time-series momentum,
 * Moskowitz/Ooi/Pedersen). 57 perpétuos binanceusdm, 1d, baixados em 08/2026.
 *
 * Dividido em DESCOBERTA (onde a grade de parâmetros foi ajustada) e HOLDOUT
 * (nunca visto durante o ajuste — testado com os parâmetros fixos escolhidos
 * na descoberta, sem reajuste). Essa separação é o que faltou na tentativa
 * anterior com `body-breakout` em ações, e é o que torna este resultado
 * verificável em vez de mais um falso positivo.
 */

export const DESCOBERTA = [
  'BTC/USDT:USDT', 'ETH/USDT:USDT', 'BCH/USDT:USDT', 'XRP/USDT:USDT', 'LTC/USDT:USDT',
  'TRX/USDT:USDT', 'ETC/USDT:USDT', 'LINK/USDT:USDT', 'XLM/USDT:USDT', 'ADA/USDT:USDT',
  'XMR/USDT:USDT', 'DASH/USDT:USDT', 'ZEC/USDT:USDT', 'XTZ/USDT:USDT', 'BNB/USDT:USDT',
  'ATOM/USDT:USDT', 'VET/USDT:USDT', 'NEO/USDT:USDT', 'QTUM/USDT:USDT', 'THETA/USDT:USDT',
  'ALGO/USDT:USDT', 'ZIL/USDT:USDT', 'COMP/USDT:USDT', 'DOGE/USDT:USDT', 'DOT/USDT:USDT',
  'YFI/USDT:USDT', 'CRV/USDT:USDT', 'SUSHI/USDT:USDT', 'SOL/USDT:USDT', 'AVAX/USDT:USDT',
];

export const HOLDOUT = [
  'EGLD/USDT:USDT', 'ICX/USDT:USDT', 'STORJ/USDT:USDT', 'UNI/USDT:USDT', 'ENJ/USDT:USDT',
  'KSM/USDT:USDT', 'NEAR/USDT:USDT', 'AAVE/USDT:USDT', 'FIL/USDT:USDT', 'RSR/USDT:USDT',
  'AXS/USDT:USDT', 'ZEN/USDT:USDT', 'GRT/USDT:USDT', '1INCH/USDT:USDT', 'CHZ/USDT:USDT',
  'SAND/USDT:USDT', 'ANKR/USDT:USDT', 'RVN/USDT:USDT', 'MANA/USDT:USDT', 'HBAR/USDT:USDT',
  'ONE/USDT:USDT', 'HOT/USDT:USDT', 'GALA/USDT:USDT', 'CELO/USDT:USDT', 'AR/USDT:USDT',
  'LPT/USDT:USDT', 'ROSE/USDT:USDT',
];

export const UNIVERSO_MOMENTUM = [...DESCOBERTA, ...HOLDOUT];

/**
 * Parâmetros fixos do `ts-momentum`, escolhidos pela região mais comum entre
 * os vencedores do walk-forward na DESCOBERTA — não são o "melhor" individual
 * de nenhum ativo (isso seria reintroduzir o sobreajuste), são o centro da
 * nuvem de escolhas.
 *
 * Com este conjunto fixo (SEM reajuste por ativo — a versão honesta, não a
 * ajustada por fold do walk-forward): 18 de 30 positivos (60%) na descoberta,
 * 20 de 27 (74%) no holdout. Combinado, 38 de 57 (67%), p=0,008 sob H0 de
 * moeda justa. O holdout não caiu em relação à descoberta — é o oposto do
 * padrão de falso positivo visto em `body-breakout` (docs/O-QUE-FALHOU.md,
 * item 6), onde a taxa desabou de 100% para 15% fora da amostra ajustada.
 *
 * Reproduzir: `npm run momentum`.
 */
export const PARAMS_VALIDADOS = { lookback: 30, minRet: 0.05, stopPct: 0.12, takePct: 0.40 };
export const MAX_BARS_VALIDADO = 20;
