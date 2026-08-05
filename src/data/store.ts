/**
 * Download e cache de OHLCV via ccxt.
 *
 * Guarda em JSON simples em data/. Nao e o formato mais eficiente, mas e
 * inspecionavel e nao adiciona dependencia binaria. Para 5min, 1 ano de dados
 * sao ~105k barras por simbolo, o que cabe folgado na memoria.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ccxt from 'ccxt';
import type { Bar, Series } from '../core/types.ts';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(HERE, '..', '..');
export const DATA_DIR = path.join(ROOT, 'data');

const TF_MS: Record<string, number> = {
  '1m': 60_000,
  '3m': 180_000,
  '5m': 300_000,
  '15m': 900_000,
  '30m': 1_800_000,
  '1h': 3_600_000,
  '4h': 14_400_000,
  '1d': 86_400_000,
};

export function tfMs(timeframe: string): number {
  const ms = TF_MS[timeframe];
  if (!ms) throw new Error(`timeframe nao suportado: ${timeframe}`);
  return ms;
}

function cachePath(exchange: string, symbol: string, timeframe: string): string {
  const safe = symbol.replace(/[/:]/g, '_');
  return path.join(DATA_DIR, `${exchange}__${safe}__${timeframe}.json`);
}

export function loadSeries(exchange: string, symbol: string, timeframe: string): Series {
  const p = cachePath(exchange, symbol, timeframe);
  if (!fs.existsSync(p)) {
    throw new Error(`sem dados em cache para ${symbol} ${timeframe}. Rode: npm run download -- --symbol "${symbol}" --timeframe ${timeframe}`);
  }
  const raw = JSON.parse(fs.readFileSync(p, 'utf8')) as { bars: number[][] };
  const bars: Bar[] = raw.bars.map((r) => ({ t: r[0], o: r[1], h: r[2], l: r[3], c: r[4], v: r[5] }));
  return { symbol, timeframe, bars };
}

export function hasSeries(exchange: string, symbol: string, timeframe: string): boolean {
  return fs.existsSync(cachePath(exchange, symbol, timeframe));
}

/**
 * Baixa OHLCV paginando para tras a partir de agora ate cobrir `days`.
 * Faz merge com o que ja existe em cache e deduplica por timestamp.
 */
export async function downloadSeries(opts: {
  exchange: string;
  symbol: string;
  timeframe: string;
  days: number;
  onProgress?: (fetched: number, total: number) => void;
}): Promise<Series> {
  const { exchange, symbol, timeframe, days } = opts;
  const ExClass = (ccxt as any)[exchange];
  if (!ExClass) throw new Error(`exchange desconhecida: ${exchange}`);
  const ex = new ExClass({ enableRateLimit: true });
  await ex.loadMarkets();
  if (!ex.markets[symbol]) {
    throw new Error(`simbolo ${symbol} nao existe em ${exchange}`);
  }

  const step = tfMs(timeframe);
  const wanted = Math.ceil((days * 86_400_000) / step);
  const since0 = Date.now() - days * 86_400_000;

  const byTime = new Map<number, number[]>();
  // Aproveita o que ja existe para nao rebaixar tudo.
  const p = cachePath(exchange, symbol, timeframe);
  if (fs.existsSync(p)) {
    const prev = JSON.parse(fs.readFileSync(p, 'utf8')) as { bars: number[][] };
    for (const b of prev.bars) if (b[0] >= since0) byTime.set(b[0], b);
  }

  let since = since0;
  const limit = 1000;
  while (since < Date.now()) {
    const batch: number[][] = await ex.fetchOHLCV(symbol, timeframe, since, limit);
    if (!batch.length) break;
    for (const b of batch) byTime.set(b[0], b);
    const last = batch[batch.length - 1][0];
    // Se a exchange devolveu menos que o pedido e nao avancou, chegamos ao fim.
    if (last <= since) break;
    since = last + step;
    opts.onProgress?.(byTime.size, wanted);
    if (batch.length < limit) break;
  }

  const bars = [...byTime.values()].sort((a, b) => a[0] - b[0]);
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(p, JSON.stringify({ exchange, symbol, timeframe, bars }));
  return {
    symbol,
    timeframe,
    bars: bars.map((r) => ({ t: r[0], o: r[1], h: r[2], l: r[3], c: r[4], v: r[5] })),
  };
}

/** Corta a serie para um intervalo [from, to) em epoch ms. */
export function slice(series: Series, from?: number, to?: number): Series {
  const bars = series.bars.filter((b) => (from == null || b.t >= from) && (to == null || b.t < to));
  return { ...series, bars };
}

/**
 * Verifica integridade: barras faltando, duplicadas, fora de ordem, ou com
 * OHLC inconsistente. Dados sujos produzem backtests bonitos e falsos.
 */
export function auditSeries(series: Series): {
  bars: number;
  gaps: number;
  worstGapBars: number;
  badOhlc: number;
  from: string;
  to: string;
  coverage: number;
} {
  const step = tfMs(series.timeframe);
  const b = series.bars;
  let gaps = 0;
  let worstGapBars = 0;
  let badOhlc = 0;
  for (let i = 1; i < b.length; i++) {
    const d = (b[i].t - b[i - 1].t) / step;
    if (d > 1) {
      gaps++;
      worstGapBars = Math.max(worstGapBars, d - 1);
    }
  }
  for (const x of b) {
    if (!(x.h >= Math.max(x.o, x.c) && x.l <= Math.min(x.o, x.c) && x.l > 0)) badOhlc++;
  }
  const expected = b.length ? Math.round((b[b.length - 1].t - b[0].t) / step) + 1 : 0;
  return {
    bars: b.length,
    gaps,
    worstGapBars,
    badOhlc,
    from: b.length ? new Date(b[0].t).toISOString() : '-',
    to: b.length ? new Date(b[b.length - 1].t).toISOString() : '-',
    coverage: expected ? b.length / expected : 0,
  };
}
