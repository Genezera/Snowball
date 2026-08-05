/**
 * Dados intradiários de ações via Yahoo Finance.
 *
 * Existe porque o ccxt só cobre cripto, e três dos cinco ativos do vídeo são
 * ações (F, COIN, ALTR).
 *
 * Duas limitações que mudam o que dá para concluir, e que precisam ficar
 * visíveis em vez de escondidas:
 *
 * 1. O Yahoo só devolve 5 minutos dos últimos ~60 dias. Isso dá ~4.700 barras,
 *    o suficiente para uma checagem direcional e NÃO o suficiente para um
 *    walk-forward de 6 folds. Para janela longa em ação intradiária é preciso
 *    fonte paga (Polygon, Alpha Vantage premium, Databento).
 *
 * 2. Ação tem gap de abertura. O mercado fecha às 16h e reabre às 9h30 num
 *    preço diferente, sem que nada tenha sido negociado no meio. O motor de
 *    backtest já trata isso (sai na abertura quando a barra abre além do stop),
 *    mas o efeito é real: um stop de 1,5% em ação é rompido por gap com muito
 *    mais frequência do que em cripto, que negocia 24/7.
 *
 * `ALTR` está deslistada (Altair foi adquirida pela Siemens), então a quinta
 * estratégia do vídeo não é mais verificável no ativo original.
 */
import fs from 'node:fs';
import path from 'node:path';
import type { Bar, Series } from '../core/types.ts';
import { DATA_DIR } from './store.ts';

const YF = 'https://query1.finance.yahoo.com/v8/finance/chart';

/** Intervalos aceitos pelo Yahoo e o alcance máximo de cada um. */
const MAX_RANGE: Record<string, string> = {
  '1m': '7d',
  '5m': '60d',
  '15m': '60d',
  '30m': '60d',
  // 1h devolve ~1.064 dias na prática (o Yahoo entrega mais que os 730
  // nominais). É o suficiente para walk-forward com 5-6 folds, e foi isso que
  // destravou a trilha de ações.
  '1h': '730d',
  '1d': '10y',
};

/**
 * Universo de ações relevante para este projeto.
 *
 * F e COIN vieram do vídeo. MU, SOXL, NVDA e SNDK entraram porque a varredura
 * de custo-para-movimento mostrou que são os ativos economicamente mais
 * atraentes que existem — SOXL marcou 199x contra 38x do BTC.
 *
 * MU e SOXL têm uma propriedade que nenhum outro tem: existem no Yahoo com 3
 * anos de histórico E como perpétuo tokenizado na Binance. Dá para validar num
 * lugar e operar no outro, com o mesmo modelo de custo de cripto.
 */
export const EQUITY_UNIVERSE = ['F', 'COIN', 'MU', 'SOXL', 'NVDA', 'SNDK', 'TSLA', 'AMD'];

/** Os que também existem como perpétuo tokenizado na Binance. */
export const TOKENIZED = new Set(['MU', 'SOXL', 'SNDK']);

export async function downloadStock(opts: {
  symbol: string;
  timeframe: string;
  range?: string;
}): Promise<Series> {
  const { symbol, timeframe } = opts;
  const range = opts.range ?? MAX_RANGE[timeframe];
  if (!range) throw new Error(`timeframe ${timeframe} nao suportado pelo Yahoo`);

  const url = `${YF}/${encodeURIComponent(symbol)}?interval=${timeframe}&range=${range}`;
  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
  if (!res.ok) throw new Error(`Yahoo HTTP ${res.status} para ${symbol}`);
  const json: any = await res.json();

  const err = json?.chart?.error;
  if (err) throw new Error(`${symbol}: ${err.description ?? err.code}`);
  const r = json?.chart?.result?.[0];
  if (!r?.timestamp?.length) throw new Error(`${symbol}: resposta sem barras`);

  const q = r.indicators.quote[0];
  const bars: Bar[] = [];
  for (let i = 0; i < r.timestamp.length; i++) {
    const o = q.open[i], h = q.high[i], l = q.low[i], c = q.close[i], v = q.volume[i];
    // O Yahoo devolve null em barras sem negócio. Descartar em vez de
    // interpolar: barra inventada vira trade inventado.
    if (o == null || h == null || l == null || c == null) continue;
    bars.push({ t: r.timestamp[i] * 1000, o, h, l, c, v: v ?? 0 });
  }
  if (!bars.length) throw new Error(`${symbol}: todas as barras vieram nulas`);

  const p = path.join(DATA_DIR, `yahoo__${symbol}__${timeframe}.json`);
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(
    p,
    JSON.stringify({
      exchange: 'yahoo',
      symbol,
      timeframe,
      exchangeName: r.meta?.fullExchangeName,
      bars: bars.map((b) => [b.t, b.o, b.h, b.l, b.c, b.v]),
    }),
  );

  return { symbol, timeframe, bars };
}

/**
 * Conta os gaps de sessão. Numa série de ação intradiária a maior parte dos
 * "gaps" é só o mercado fechado à noite, o que é normal e não é defeito de
 * dado. Este relatório separa uma coisa da outra.
 */
export function sessionReport(series: Series): {
  bars: number;
  sessions: number;
  barsPerSession: number;
  overnightGaps: number;
  medianOvernightGapPct: number;
  maxOvernightGapPct: number;
} {
  const b = series.bars;
  const dayOf = (t: number) => new Date(t).toISOString().slice(0, 10);
  const days = new Set(b.map((x) => dayOf(x.t)));
  const gaps: number[] = [];
  for (let i = 1; i < b.length; i++) {
    if (dayOf(b[i].t) !== dayOf(b[i - 1].t)) {
      gaps.push(Math.abs(b[i].o / b[i - 1].c - 1));
    }
  }
  gaps.sort((x, y) => x - y);
  return {
    bars: b.length,
    sessions: days.size,
    barsPerSession: Math.round(b.length / days.size),
    overnightGaps: gaps.length,
    medianOvernightGapPct: gaps.length ? gaps[Math.floor(gaps.length / 2)] : 0,
    maxOvernightGapPct: gaps.length ? gaps[gaps.length - 1] : 0,
  };
}
