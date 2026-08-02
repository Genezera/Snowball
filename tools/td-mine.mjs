/**
 * Mineração da base do trader.dev para alimentar a fila do Batedor.
 *
 * Varre muitos eixos de busca, puxa o Pine de cada candidato plausível,
 * extrai a assinatura de regras e escreve research/queue.json.
 *
 * O objetivo NÃO é achar a estratégia mais lucrativa — é achar MECANISMOS que
 * o projeto ainda não tem. O pool inteiro hoje depende de `body-breakout`, e o
 * que reduz essa concentração é diversidade estrutural, não mais um breakout
 * com números bonitos.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const KEY = process.env.TRADERDEV_API_KEY ?? '';
const BASE = 'https://mcp.trader.dev';
const headers = KEY ? { Authorization: `Bearer ${KEY}`, 'X-API-Key': KEY } : {};
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

async function connect() {
  const ac = new AbortController();
  const res = await fetch(`${BASE}/sse`, { headers: { ...headers, Accept: 'text/event-stream' }, signal: ac.signal });
  const pending = new Map();
  let ready, messagesPath;
  const p = new Promise((r) => (ready = r));
  (async () => {
    const rd = res.body.getReader(); const dec = new TextDecoder(); let buf = '';
    try {
      for (;;) {
        const { done, value } = await rd.read(); if (done) break;
        buf += dec.decode(value, { stream: true });
        let i;
        while ((i = buf.indexOf('\n\n')) >= 0) {
          const raw = buf.slice(0, i); buf = buf.slice(i + 2);
          const e = {};
          for (const l of raw.split('\n')) { const c = l.indexOf(':'); if (c > 0) e[l.slice(0, c).trim()] = l.slice(c + 1).trim(); }
          if (e.event === 'endpoint') { messagesPath = e.data; ready(); }
          else if (e.data) { try { const m = JSON.parse(e.data); if (m.id != null && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } } catch {} }
        }
      }
    } catch {}
  })();
  await p;
  let id = 1;
  const rpc = async (method, params) => {
    const myId = id++;
    const wait = new Promise((res2, rej) => { pending.set(myId, res2); setTimeout(() => { if (pending.has(myId)) { pending.delete(myId); rej(new Error('timeout')); } }, 60000); });
    await fetch(`${BASE}${messagesPath}`, { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: myId, method, params }) });
    return wait;
  };
  await rpc('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'snowball-scout', version: '1' } });
  await fetch(`${BASE}${messagesPath}`, { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized', params: {} }) });
  const call = async (name, args) => {
    const r = await rpc('tools/call', { name, arguments: args });
    const t = r.result?.content?.[0]?.text;
    return t ? JSON.parse(t) : null;
  };
  return { call, close: () => ac.abort() };
}

function ruleSignature(src) {
  const inds = [...new Set([...src.matchAll(/ta\.([a-z_]+)\s*\(/g)].map((m) => m[1]))].sort();
  const exits = [];
  if (/trail_points|trail_offset|trail_price/.test(src)) exits.push('trailing');
  if (/qty_percent/.test(src)) exits.push('parcial');
  if (/\bstop\s*=/.test(src)) exits.push('stop-abs');
  if (/\blimit\s*=/.test(src)) exits.push('tp-abs');
  if (/\bloss\s*=/.test(src)) exits.push('stop-ticks');
  if (/strategy\.close/.test(src)) exits.push('flatten');
  const atr = /ta\.atr/.test(src) && /(stop|limit)\s*=/.test(src);
  return { signature: `${inds.join('+')}|${exits.sort().join(',')}|${atr ? 'atr-risk' : 'fixed-risk'}`, indicators: inds };
}

function plausible(r) {
  const reasons = [];
  const days = r.fromTs && r.toTs ? (r.toTs - r.fromTs) / 86400000 : 0;
  if (days < 365) reasons.push(`janela ${days.toFixed(0)}d`);
  if ((r.totalTrades ?? 0) < 80) reasons.push(`${r.totalTrades ?? 0} trades`);
  if ((r.profitFactor ?? 0) > 3) reasons.push(`PF ${r.profitFactor?.toFixed(2)}`);
  if ((r.sharpeRatio ?? 0) > 4) reasons.push(`Sharpe ${r.sharpeRatio?.toFixed(2)}`);
  if ((r.maxDrawdownPct ?? 100) > 40) reasons.push(`DD ${r.maxDrawdownPct?.toFixed(0)}%`);
  return { ok: reasons.length === 0, reasons, days };
}

// ── mineração ────────────────────────────────────────────────────────────────
const c = await connect();
const seen = new Map();

const sorts = ['sharpe', 'sortino', 'drawdown', 'trades', 'winrate', 'profit', 'recent'];
const tfs = [undefined, '1h', '2h', '4h', '6h', '1d'];

console.log('varrendo a base…\n');
for (const sort of sorts) {
  for (const timeframe of tfs) {
    for (const offset of [0, 50]) {
      try {
        const args = { sort, limit: 50, offset, minTrades: 80 };
        if (timeframe) args.timeframe = timeframe;
        const r = await c.call('search_strategies', args);
        for (const s of r?.results ?? []) if (s.result) seen.set(s.id, s);
      } catch {}
    }
  }
  process.stdout.write(`  ${sort}: ${seen.size} únicos acumulados\n`);
}

console.log(`\n${seen.size} estratégias únicas coletadas`);

const rows = [...seen.values()];
const passed = rows.filter((s) => plausible(s.result).ok);
console.log(`${passed.length} passaram no filtro de plausibilidade (janela ≥1a, ≥80 trades, PF≤3, Sharpe≤4, DD≤40%)\n`);

// ── puxa o Pine dos plausíveis e extrai assinatura ──────────────────────────
console.log('puxando código-fonte dos plausíveis…');
const candidates = [];
let fetched = 0;
for (const s of passed.slice(0, 90)) {
  try {
    const full = await c.call('get_strategy', { id: s.id });
    if (!full?.pineSource) continue;
    const { signature, indicators } = ruleSignature(full.pineSource);
    candidates.push({
      id: s.id, source: 'trader.dev', name: s.name, symbol: s.symbol, timeframe: s.timeframe,
      reported: {
        netProfitPct: s.result.netProfitPct, profitFactor: s.result.profitFactor,
        sharpeRatio: s.result.sharpeRatio, maxDrawdownPct: s.result.maxDrawdownPct,
        totalTrades: s.result.totalTrades, barsEvaluated: s.result.barsEvaluated,
        fromTs: s.result.fromTs, toTs: s.result.toTs,
      },
      signature, indicators, url: s.result.viewUrl,
      discoveredAt: 0, status: 'novo',
      pineLength: full.pineSource.length,
    });
    fetched++;
    if (fetched % 20 === 0) process.stdout.write(`  ${fetched}…\n`);
  } catch {}
}
c.close();

// ── deduplica por assinatura ────────────────────────────────────────────────
const bySig = new Map();
for (const cd of candidates) {
  const prev = bySig.get(cd.signature);
  // mantém o de janela mais longa em cada assinatura
  const days = (x) => (x.reported.toTs - x.reported.fromTs) / 86400000;
  if (!prev || days(cd) > days(prev)) bySig.set(cd.signature, cd);
}
const unique = [...bySig.values()];

fs.mkdirSync(path.join(ROOT, 'research'), { recursive: true });
fs.writeFileSync(path.join(ROOT, 'research', 'queue.json'), JSON.stringify(unique, null, 2));

console.log(`\n${candidates.length} com código lido → ${unique.length} assinaturas ESTRUTURALMENTE distintas\n`);

// ── o que já existe no projeto ──────────────────────────────────────────────
const KNOWN = new Set(['sma','ema','vwma','atr','stdev','rsi','supertrend','dmi','rma']);
const KNOWN_EXITS = new Set(['stop-abs','tp-abs']);

const scored = unique.map((cd) => {
  const novos = cd.indicators.filter((i) => !KNOWN.has(i));
  const exits = cd.signature.split('|')[1].split(',').filter(Boolean);
  const novosExits = exits.filter((e) => !KNOWN_EXITS.has(e));
  const d = (cd.reported.toTs - cd.reported.fromTs) / 86400000;
  const cagr = (Math.pow(1 + cd.reported.netProfitPct / 100, 365 / d) - 1) * 100;
  const calmar = cd.reported.maxDrawdownPct ? cagr / cd.reported.maxDrawdownPct : 0;
  return { cd, novos, novosExits, calmar, anos: d / 365, cagr };
}).sort((a, b) => (b.novos.length * 10 + b.novosExits.length * 8 + Math.min(3, b.calmar)) - (a.novos.length * 10 + a.novosExits.length * 8 + Math.min(3, a.calmar)));

console.log('PRIORIZADOS POR NOVIDADE ESTRUTURAL (não por lucro)\n');
console.log('estrategia'.padEnd(40) + 'sym'.padEnd(10) + 'tf'.padEnd(5) + 'anos'.padEnd(6) + 'CAGR'.padEnd(8) + 'DD'.padEnd(7) + 'Calmar'.padEnd(8) + 'indicadores inéditos');
for (const x of scored.slice(0, 22)) {
  console.log(
    x.cd.name.slice(0, 38).padEnd(40) + String(x.cd.symbol).slice(0, 8).padEnd(10) + String(x.cd.timeframe).padEnd(5) +
    x.anos.toFixed(1).padEnd(6) + (x.cagr.toFixed(0) + '%').padEnd(8) +
    (x.cd.reported.maxDrawdownPct.toFixed(0) + '%').padEnd(7) + x.calmar.toFixed(2).padEnd(8) +
    (x.novos.join(',') || '—') + (x.novosExits.length ? `  [saída: ${x.novosExits.join(',')}]` : ''),
  );
}

const allNew = new Set();
for (const x of scored) for (const i of x.novos) allNew.add(i);
console.log(`\nIndicadores que o projeto NÃO tem: ${[...allNew].sort().join(', ')}`);
console.log(`Fila salva em research/queue.json (${unique.length} candidatos)`);
process.exit(0);
