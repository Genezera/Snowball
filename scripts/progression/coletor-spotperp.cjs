#!/usr/bin/env node
'use strict';
/**
 * COLETOR SPOT-PERP — produtor de dados para o motor spot-perp (cash-and-carry no perp).
 *
 * Spot-perp = comprar SPOT + shortar PERP na MESMA exchange → captura o funding ABSOLUTO
 * daquela exchange (quando positivo, o short perp recebe). Delta-neutro. Diferente do
 * cross-exchange (que captura só o DIFERENCIAL entre 2 exchanges), aqui captura o absoluto —
 * então acessa oportunidades que o cross-exchange perde (funding alto e IGUAL nas duas).
 *
 * Este script só COLETA e classifica (dados reais via ccxt), não opera nada. Escreve um feed
 * que o forward-lab (motor snowball-2ex) vai ler. Requisito real: o símbolo precisa ter perp
 * (funding) E spot na MESMA exchange — muitos small-caps de funding alto NÃO têm spot.
 *
 * Economia HONESTA: funding absoluto − taxa spot (0,10%/lado, cara) − taxa perp maker − basis.
 * Só escreve oportunidade com EV/dia positivo depois de TODOS os custos.
 */
const ccxt = require('ccxt');
const fs = require('node:fs');
const path = require('node:path');

const args = process.argv.slice(2);
const opt = (n, d) => (args.includes(n) ? args[args.indexOf(n) + 1] : d);
const ONCE = args.includes('--once');
const INTERVALO_S = Number(opt('--intervalo', 300));
const EXCHS = String(opt('--exchanges', 'bybit,bitget')).split(',').map((s) => s.trim());
const OUT = path.join(__dirname, '..', '..', 'vigilancia', 'arquivo-spotperp.jsonl');
const CACHE = path.join(__dirname, '..', '..', 'vigilancia', 'spot-mercados-cache.json');

// custos REAIS (frações). spot é caro; perp maker é barato. basis = gap spot-perp na entrada.
const SPOT_TAKER = 0.001;      // 0,10%/lado (preset binance-spot real)
const PERP_MAKER = 0.0002;     // 0,02%/lado (ordem limite)
const SLIP = 0.0002;           // slippage do spot (mercado)
const BASIS = 0.0005;          // gap spot-perp conservador na entrada
// round-trip: spot entra+sai (2×taker+2×slip) + perp entra+sai (2×maker) + basis (1×)
const CUSTO_RT = 2 * SPOT_TAKER + 2 * SLIP + 2 * PERP_MAKER + BASIS;  // ≈ 0,00284
const MIN_VOL = 500000;        // liquidez mínima do perp (24h) pra valer

async function mercadosSpot(ex) {
  await ex.loadMarkets();
  const set = new Set();
  for (const m of Object.values(ex.markets)) {
    if (m.spot && m.active && m.quote === 'USDT') set.add(m.base + '/USDT');
  }
  return set;
}

async function umCiclo() {
  const ts = Date.now();
  const oportunidades = [];
  const resumo = {};
  for (const id of EXCHS) {
    try {
      const ex = new ccxt[id]({ enableRateLimit: true });
      const spot = await mercadosSpot(ex);
      const taxas = await ex.fetchFundingRates();
      let tickers = {};
      try { tickers = await Promise.race([ex.fetchTickers(undefined, { type: 'swap' }).catch(() => ({})), new Promise((r) => setTimeout(() => r({}), 8000))]); } catch {}
      let vistos = 0, comSpot = 0, positivas = 0;
      for (const [sym, fr] of Object.entries(taxas)) {
        if (!sym.endsWith('/USDT:USDT') || fr?.fundingRate == null) continue;
        vistos++;
        const base = sym.replace('/USDT:USDT', '');
        if (!spot.has(base + '/USDT')) continue;   // precisa ter SPOT na mesma exchange
        comSpot++;
        const funding = fr.fundingRate;            // por intervalo
        if (funding <= 0) continue;                // spot-perp simples só capta funding POSITIVO
        positivas++;
        const iv = fr.interval ? Number(String(fr.interval).replace(/\D/g, '')) || 8 : 8;
        const t = tickers[sym] || {};
        const vol = Number(t.quoteVolume ?? (t.baseVolume && t.last ? t.baseVolume * t.last : 0)) || 0;
        if (vol < MIN_VOL) continue;
        const fundingDia = funding * (24 / iv);    // funding capturado por dia (fração)
        // EV/dia sobre US$100 de notional, líquido do custo de entrada amortizado num payback alvo
        const custoEntrada = CUSTO_RT;             // fração do notional, uma vez
        const evDiaBruto = fundingDia;             // fração/dia
        oportunidades.push({ ts, exchange: id, sym: base, funding, iv, fundingDia, custoEntrada, evDiaBruto, vol: Math.round(vol) });
      }
      resumo[id] = { perpsUSDT: vistos, comSpot, fundingPositivo: positivas };
    } catch (e) { resumo[id] = { erro: String(e.message).slice(0, 60) }; }
  }
  // ranquear por EV/dia bruto e quão rápido o custo de entrada se paga (payback em dias)
  oportunidades.forEach((o) => { o.paybackDias = o.fundingDia > 0 ? o.custoEntrada / o.fundingDia : Infinity; });
  oportunidades.sort((a, b) => b.evDiaBruto - a.evDiaBruto);
  // grava o feed (append) — o motor lê depois
  if (oportunidades.length) fs.appendFileSync(OUT, oportunidades.map((o) => JSON.stringify(o)).join('\n') + '\n');
  return { ts, resumo, oportunidades };
}

(async () => {
  const r = await umCiclo();
  console.log('[spotperp] resumo:', JSON.stringify(r.resumo));
  console.log('[spotperp] oportunidades (spot+perp na mesma ex, funding>0, líquidas):', r.oportunidades.length);
  r.oportunidades.slice(0, 12).forEach((o) => console.log(
    `  ${o.exchange} ${o.sym.padEnd(10)} funding ${(o.funding * 100).toFixed(4)}%/${o.iv}h | dia ${(o.fundingDia * 100).toFixed(3)}% | payback ${o.paybackDias.toFixed(1)}d | vol ${(o.vol / 1e6).toFixed(1)}M`));
  if (!ONCE) setInterval(() => umCiclo().catch(() => {}), INTERVALO_S * 1000);
})();
