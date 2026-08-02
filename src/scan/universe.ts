/**
 * Scanner de universo -- o "Analista de Mercado" da equipe.
 *
 * Responde: dentro de TODO o mercado, quais ativos merecem capital agora?
 *
 * Por que isto e mais defensavel que o filtro de ML por trade que falhou:
 * este projeto mediu, repetidamente, que o retorno esta nas decisoes
 * estruturais de baixa frequencia (timeframe, estrategia, mercado) e o ruido
 * esta nas de alta frequencia (tomar ou nao este sinal). Escolher o mercado e
 * uma decisao estrutural.
 *
 * E resolve um vies real: o video escolheu F, COIN, ALTR, DOT e TRX sem
 * criterio declarado -- acoes e cripto misturadas, uma delas hoje deslistada.
 * Isso e escolha a dedo. Varrer o universo com regra fixa remove o cherry-pick.
 *
 * ---------------------------------------------------------------------------
 * O PERIGO CENTRAL, dito antes de qualquer resultado
 *
 * Testar 679 ativos x 5 estrategias = 3.395 testes. O melhor deles vai parecer
 * excelente por puro acaso. Um scanner ingenuo e uma maquina industrial de
 * gerar falso positivo.
 *
 * Tres defesas, nesta ordem de importancia:
 *
 *  1. FILTRAR ANTES DE TESTAR. Os portoes 1-3 abaixo nao rodam backtest nenhum.
 *     Eles cortam o universo por liquidez, qualidade de dado e viabilidade
 *     economica. 679 -> ~30. Cada ativo eliminado antes do backtest e um teste
 *     que nunca aconteceu, e portanto uma correcao que nao precisa ser feita.
 *  2. EXIGIR CONSISTENCIA TRANSVERSAL. Um ativo isolado que passa e suspeito.
 *     Uma estrategia que funciona numa familia de ativos parecidos e sinal.
 *  3. CONTABILIZAR OS TESTES. O numero de testes efetivos e registrado e
 *     entregue junto do resultado, para o Sharpe deflacionado usar.
 * ---------------------------------------------------------------------------
 */
import ccxt from 'ccxt';
import type { Bar, CostModel, Series } from '../core/types.ts';
import { closes } from '../core/indicators.ts';
import { efficiencyRatio } from '../ml/regime.ts';
import { auditSeries } from '../data/store.ts';

export interface UniverseCandidate {
  symbol: string;
  quoteVolume24h: number;
  /** classificacao grosseira: cripto majors, alts, ou acao tokenizada */
  kind: 'major' | 'alt' | 'equity-token';
}

/** Ativos que sao acoes/ETFs tokenizados negociados como perpetuo. */
const EQUITY_TOKEN_HINT = /^(SNDK|SOXL|MU|SKHY|SKHYNIX|KORU|NVDA|TSLA|AAPL|MSFT|META|AMZN|GOOGL|COIN|MSTR|HOOD|PLTR|AMD|INTC|IBIT|SPY|QQQ|TQQQ|GLD)/;
const MAJORS = new Set(['BTC', 'ETH', 'SOL', 'BNB', 'XRP', 'DOGE', 'ADA', 'AVAX', 'LINK', 'DOT', 'TRX', 'LTC']);

/**
 * PORTAO 1 -- Liquidez. Nenhum backtest aqui, so uma chamada de tickers.
 *
 * E o filtro mais importante e o mais barato. Backtest em par ilíquido produz
 * numeros lindos e execucao impossivel: e exatamente a origem do
 * "+172.575.181.377%" em PAXGUSDT no leaderboard do trader.dev.
 */
export async function screenLiquidity(opts: {
  exchange?: string;
  minQuoteVolume24h?: number;
  max?: number;
}): Promise<{ candidates: UniverseCandidate[]; totalActive: number }> {
  const exId = opts.exchange ?? 'binanceusdm';
  const minVol = opts.minQuoteVolume24h ?? 50e6;
  const ex = new (ccxt as any)[exId]({ enableRateLimit: true });
  await ex.loadMarkets();

  const perps = Object.values(ex.markets).filter(
    (m: any) => m.swap && m.quote === 'USDT' && m.active,
  ) as any[];
  const tickers = await ex.fetchTickers();

  const candidates: UniverseCandidate[] = [];
  for (const m of perps) {
    const v = tickers[m.symbol]?.quoteVolume ?? 0;
    if (v < minVol) continue;
    const base = m.base as string;
    candidates.push({
      symbol: m.symbol,
      quoteVolume24h: v,
      kind: EQUITY_TOKEN_HINT.test(base) ? 'equity-token' : MAJORS.has(base) ? 'major' : 'alt',
    });
  }
  candidates.sort((a, b) => b.quoteVolume24h - a.quoteVolume24h);
  return {
    candidates: opts.max ? candidates.slice(0, opts.max) : candidates,
    totalActive: perps.length,
  };
}

export interface TradeabilityReport {
  symbol: string;
  bars: number;
  coverage: number;
  /** mediana do |retorno| em `horizon` barras, em fracao do preco */
  medianMove: number;
  /** medianMove dividido pelo custo de ida e volta. Abaixo de ~8 nao ha o que ganhar. */
  costToMove: number;
  /** Efficiency Ratio mediano: acima de ~0.3 o ativo tende a andar em linha reta */
  medianER: number;
  /** fracao das barras em regime de tendencia (ER > 0.35) */
  trendingFraction: number;
  /** volatilidade anualizada, so para contexto */
  annualVol: number;
  passed: boolean;
  reasons: string[];
}

/**
 * PORTAO 2 e 3 -- Qualidade de dado e viabilidade economica.
 *
 * `costToMove` e a metrica central deste arquivo e resume a descoberta inteira
 * do projeto. O custo e um pedagio quase fixo por trade; o que muda entre
 * ativo e timeframe e o tamanho do movimento capturavel. Se o movimento tipico
 * no horizonte do trade nao for um multiplo confortavel do pedagio, nao existe
 * estrategia possivel ali -- e isso da para saber ANTES de rodar backtest.
 *
 * Foi exatamente isso que condenou o scalping de 5 minutos: custo ~0,14% ida e
 * volta contra movimento tipico de 0,3% em 12 barras -> costToMove ~2.
 */
export function assessTradeability(
  series: Series,
  cost: CostModel,
  opts: { horizon?: number; minCostToMove?: number; minBars?: number } = {},
): TradeabilityReport {
  const horizon = opts.horizon ?? 12;
  const minCostToMove = opts.minCostToMove ?? 8;
  const minBars = opts.minBars ?? 2000;

  const audit = auditSeries(series);
  const c = closes(series.bars);
  const reasons: string[] = [];

  const moves: number[] = [];
  for (let i = horizon; i < c.length; i++) {
    if (c[i - horizon] > 0) moves.push(Math.abs(c[i] / c[i - horizon] - 1));
  }
  moves.sort((a, b) => a - b);
  const medianMove = moves.length ? moves[Math.floor(moves.length / 2)] : 0;

  const roundTrip = 2 * cost.takerFee + 2 * cost.slippage;
  const costToMove = roundTrip > 0 ? medianMove / roundTrip : Infinity;

  const er = efficiencyRatio(series.bars, 20).filter((v) => isFinite(v));
  er.sort((a, b) => a - b);
  const medianER = er.length ? er[Math.floor(er.length / 2)] : 0;
  const trendingFraction = er.length ? er.filter((v) => v > 0.35).length / er.length : 0;

  // volatilidade anualizada, a partir de retornos por barra
  const rets: number[] = [];
  for (let i = 1; i < c.length; i++) if (c[i - 1] > 0) rets.push(c[i] / c[i - 1] - 1);
  const mean = rets.reduce((a, b) => a + b, 0) / (rets.length || 1);
  const sd = Math.sqrt(rets.reduce((a, b) => a + (b - mean) ** 2, 0) / (rets.length || 1));
  const barsPerYear = (365 * 86_400_000) / (series.bars.length > 1 ? series.bars[1].t - series.bars[0].t : 1);
  const annualVol = sd * Math.sqrt(barsPerYear);

  if (audit.bars < minBars) reasons.push(`historico curto (${audit.bars} < ${minBars} barras)`);
  if (audit.coverage < 0.97) reasons.push(`cobertura ${(audit.coverage * 100).toFixed(1)}% < 97%`);
  if (audit.badOhlc > 0) reasons.push(`${audit.badOhlc} barras com OHLC invalido`);
  if (costToMove < minCostToMove)
    reasons.push(`custo-para-movimento ${costToMove.toFixed(1)}x < ${minCostToMove}x (o pedagio come o movimento)`);
  if (annualVol < 0.15) reasons.push(`volatilidade anual ${(annualVol * 100).toFixed(0)}% baixa demais para pagar o custo`);
  if (annualVol > 3.0) reasons.push(`volatilidade anual ${(annualVol * 100).toFixed(0)}% alta demais: stops de % fixo viram loteria`);

  return {
    symbol: series.symbol,
    bars: audit.bars,
    coverage: audit.coverage,
    medianMove,
    costToMove,
    medianER,
    trendingFraction,
    annualVol,
    passed: reasons.length === 0,
    reasons,
  };
}

/**
 * Contabilidade de teste multiplo. O scanner PRECISA reportar quantos testes
 * efetivamente aconteceu, senao o Sharpe deflacionado mente.
 */
export interface TestBudget {
  assetsConsidered: number;
  assetsAfterLiquidity: number;
  assetsAfterTradeability: number;
  strategiesPerAsset: number;
  /** o numero que o Sharpe deflacionado deve usar */
  effectiveTests: number;
}

export function testBudget(
  totalActive: number,
  afterLiquidity: number,
  afterTradeability: number,
  strategiesPerAsset: number,
): TestBudget {
  return {
    assetsConsidered: totalActive,
    assetsAfterLiquidity: afterLiquidity,
    assetsAfterTradeability: afterTradeability,
    strategiesPerAsset,
    // So contam os testes que realmente rodaram backtest. Ativos cortados pelos
    // portoes baratos nunca viraram tentativa.
    effectiveTests: afterTradeability * strategiesPerAsset,
  };
}

/**
 * Consistencia transversal -- a defesa mais forte contra falso positivo.
 *
 * Um ativo isolado que passa e suspeito; uma estrategia que funciona numa
 * familia inteira de ativos parecidos e sinal. Foi assim que `body-breakout`
 * se destacou: expectancy positiva em 5 de 5 ativos em 4h.
 */
export function crossSectionalConsistency(
  results: { symbol: string; strategy: string; expectancyR: number }[],
): { strategy: string; assets: number; positive: number; fraction: number; medianExpectancy: number }[] {
  const by = new Map<string, { expectancyR: number }[]>();
  for (const r of results) {
    if (!by.has(r.strategy)) by.set(r.strategy, []);
    by.get(r.strategy)!.push({ expectancyR: r.expectancyR });
  }
  const out = [...by].map(([strategy, rows]) => {
    const es = rows.map((r) => r.expectancyR).sort((a, b) => a - b);
    return {
      strategy,
      assets: rows.length,
      positive: rows.filter((r) => r.expectancyR > 0).length,
      fraction: rows.filter((r) => r.expectancyR > 0).length / rows.length,
      medianExpectancy: es[Math.floor(es.length / 2)] ?? 0,
    };
  });
  return out.sort((a, b) => b.fraction - a.fraction || b.medianExpectancy - a.medianExpectancy);
}
