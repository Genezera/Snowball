/**
 * Peneira para o leaderboard do trader.dev.
 *
 * O problema: a base tem 32 mil estrategias e 87 mil backtests, mas os filtros
 * da API nao conseguem separar sinal de artefato. Duas razoes:
 *
 *  1. O backtester deles EXIGE commission=0 e percent_of_equity=100 (esta
 *     escrito na spec da ferramenta get_pine_codegen_rules). Entao todo
 *     resultado e um numero sem custo, com composicao total.
 *  2. A JANELA de avaliacao nao e filtravel. O topo do ranking por Sharpe sao
 *     backtests de 10 dias com Sharpe 17 -- que e ruido anualizado, nao edge.
 *
 * Esta peneira puxa varias paginas e filtra do lado do cliente pelo que
 * realmente importa: janela longa, numero de trades decente, e metricas dentro
 * do que e fisicamente plausivel. Sharpe acima de 4 nao e uma estrategia boa,
 * e um erro de medicao.
 *
 * Uso: node tools/td-screen.mjs [timeframe]
 */
const KEY = process.env.TRADERDEV_API_KEY ?? '';
const BASE = 'https://mcp.trader.dev';
const headers = KEY ? { Authorization: `Bearer ${KEY}`, 'X-API-Key': KEY } : {};

async function connect() {
  const ac = new AbortController();
  const res = await fetch(`${BASE}/sse`, { headers: { ...headers, Accept: 'text/event-stream' }, signal: ac.signal });
  const pending = new Map();
  let ready, messagesPath;
  const p = new Promise((r) => (ready = r));
  (async () => {
    const rd = res.body.getReader();
    const dec = new TextDecoder();
    let buf = '';
    try {
      for (;;) {
        const { done, value } = await rd.read();
        if (done) break;
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
    const wait = new Promise((res2, rej) => { pending.set(myId, res2); setTimeout(() => { if (pending.has(myId)) { pending.delete(myId); rej(new Error('timeout')); } }, 90000); });
    await fetch(`${BASE}${messagesPath}`, { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: myId, method, params }) });
    return wait;
  };
  await rpc('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'snowball', version: '0.1.0' } });
  await fetch(`${BASE}${messagesPath}`, { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized', params: {} }) });
  return { rpc, close: () => ac.abort() };
}

const TF = process.argv[2];
const c = await connect();

const seen = new Map();
// Varre por varios eixos de ordenacao: cada um expoe uma parte diferente da base.
for (const sort of ['sharpe', 'drawdown', 'sortino', 'trades', 'winrate', 'recent', 'profit']) {
  for (const offset of [0, 50, 100]) {
    try {
      const args = { sort, limit: 50, offset, minTrades: 80 };
      if (TF) args.timeframe = TF;
      const r = await c.rpc('tools/call', { name: 'search_strategies', arguments: args });
      const txt = r.result?.content?.[0]?.text;
      if (!txt) continue;
      for (const s of (JSON.parse(txt).results ?? [])) if (s.result) seen.set(s.id, s);
    } catch { /* segue */ }
  }
}
c.close();

const rows = [...seen.values()].map((s) => {
  const r = s.result;
  const days = (r.toTs - r.fromTs) / 86_400_000;
  return {
    name: s.name, symbol: s.symbol, tf: s.timeframe,
    days: Math.round(days), trades: r.totalTrades,
    pf: r.profitFactor, sharpe: r.sharpeRatio, dd: r.maxDrawdownPct,
    win: r.winRatePct, netPct: r.netProfitPct,
    tradesPerDay: r.totalTrades / Math.max(1, days),
    url: r.viewUrl,
  };
});

console.log(`${rows.length} backtests unicos coletados${TF ? ` (timeframe ${TF})` : ''}\n`);

// --- diagnostico da qualidade da base ---
const absurd = rows.filter((r) => r.sharpe > 4 || r.pf > 3 || r.netPct > 10000);
const short = rows.filter((r) => r.days < 180);
console.log(`Sharpe>4 ou PF>3 ou retorno>10000%  : ${absurd.length}  (fisicamente implausivel)`);
console.log(`janela menor que 180 dias           : ${short.length}  (curta demais para concluir)`);

// --- a peneira ---
const keep = rows.filter((r) =>
  r.days >= 365 &&          // pelo menos 1 ano de janela
  r.trades >= 100 &&        // amostra minima
  r.pf >= 1.1 && r.pf <= 3 && // acima disso e artefato, nao estrategia
  r.sharpe > 0.5 && r.sharpe <= 4 &&
  r.dd <= 35,
).sort((a, b) => b.sharpe - a.sharpe);

console.log(`\nSOBREVIVEM A PENEIRA: ${keep.length}\n`);
if (!keep.length) {
  console.log('Nenhum. Lembre que TODOS estes numeros sao com commission=0 por');
  console.log('imposicao do backtester deles -- entao mesmo os sobreviventes teriam');
  console.log('de ser revalidados aqui com custo real antes de significarem algo.');
} else {
  console.log('nome'.padEnd(46) + 'sym'.padEnd(11) + 'tf'.padEnd(5) + 'dias'.padEnd(6) + 'trades'.padEnd(8) + 'PF'.padEnd(7) + 'Sharpe'.padEnd(8) + 'DD%');
  for (const r of keep.slice(0, 30)) {
    console.log(
      r.name.slice(0, 44).padEnd(46) + String(r.symbol).padEnd(11) + String(r.tf).padEnd(5) +
      String(r.days).padEnd(6) + String(r.trades).padEnd(8) +
      r.pf.toFixed(2).padEnd(7) + r.sharpe.toFixed(2).padEnd(8) + r.dd.toFixed(1),
    );
  }
}
process.exit(0);
