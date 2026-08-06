/**
 * Paper trading da trilha de ações.
 *
 * Roda em paralelo ao paper de cripto, com capital próprio, para que aos 90
 * dias existam DUAS respostas independentes em vez de uma.
 *
 * Escopo deliberadamente pequeno — dois pares, e por razões diferentes:
 *
 *   MU/body-breakout    — positivo no walk-forward (+0,153R) E com parâmetros
 *                         padrão (+0,073R). Evidência de dois tipos
 *                         independentes. É o candidato genuíno.
 *   COIN/momentum       — passou no portão (+0,122R) mas perde com parâmetros
 *                         padrão (−0,012R). Todo o resultado vem da otimização
 *                         por fold. Entra marcado como evidência de segunda
 *                         classe, para que aos 90 dias dê para separar os casos.
 *
 * Os outros cinco ativos reprovaram e ficam de fora. Rodar 7 pares onde 5 não
 * passaram seria repetir o erro de confundir "o método encontra algo" com
 * "existe algo".
 */
import fs from 'node:fs';
import path from 'node:path';
import { downloadStock } from '../data/stocks.ts';
import { buildStrategy } from '../strategies/index.ts';
import { sizePosition } from '../backtest/engine.ts';
import { estadoMercado, minutosAteFechar } from '../live/market-hours.ts';
import { forecastVolatility, targetVolatility, volSizeMultiplier, ratchetRisk, floorAdjust, DEFAULT_RATCHET } from '../core/volatility.ts';
import { makeConfig } from '../config.ts';
import { ROOT } from '../data/store.ts';
import { parseArgs, num, str, bool } from './args.ts';
import type { Bar, Side } from '../core/types.ts';

const a = parseArgs();
const timeframe = str(a.timeframe, '1h');
const equityInicial = num(a.equity, 100);

/** Qualidade da evidência por par — registrada no diário para o Auditor separar. */
const PARES = [
  { symbol: 'MU', strategy: 'body-breakout', evidencia: 'dupla' },
  { symbol: 'COIN', strategy: 'momentum-breakout', evidencia: 'apenas-walk-forward' },
];

const cfg = makeConfig({
  initialEquity: equityInicial,
  costPreset: 'acao-varejo',
  riskProfile: 'seed',
  maxBarsInTrade: num(a.maxBars, 14),
});

const dir = path.join(ROOT, 'paper');
fs.mkdirSync(dir, { recursive: true });
const stateFile = path.join(dir, 'state-equity.json');
const journalFile = path.join(dir, 'journal-equity.jsonl');

interface Pos {
  idx: number; symbol: string; strategy: string; side: Side;
  entryTime: number; entryPrice: number; entryBarT: number;
  stopPrice: number; takePrice: number; qty: number; notional: number;
  riskUsed: number; equityAtEntry: number;
}
interface Estado {
  startedAt: number; equity: number; peakEquity: number;
  positions: Pos[]; closedTrades: number; wins: number;
  lastBar: Record<string, number>; halted: boolean; haltReason?: string;
}

const estado: Estado = fs.existsSync(stateFile)
  ? JSON.parse(fs.readFileSync(stateFile, 'utf8'))
  : {
      startedAt: Date.now(), equity: equityInicial, peakEquity: equityInicial,
      positions: [], closedTrades: 0, wins: 0, lastBar: {}, halted: false,
    };

const bars: Bar[][] = [];
const estrategias = PARES.map((p) => buildStrategy(p.strategy, {}));

const diario = (event: string, data: Record<string, unknown>) =>
  fs.appendFileSync(journalFile, JSON.stringify({ ts: Date.now(), event, ...data }) + '\n');
const log = (m: string) => console.log(`[${new Date().toISOString().slice(0, 19)}] ${m}`);

console.log(`\n${'='.repeat(76)}`);
console.log(`PAPER AÇÕES  ·  US$ ${equityInicial}  ·  ${timeframe}  ·  ${PARES.length} pares`);
console.log(`${'='.repeat(76)}\n`);

for (let i = 0; i < PARES.length; i++) {
  const s = await downloadStock({ symbol: PARES[i].symbol, timeframe });
  bars.push(s.bars);
  log(`${PARES[i].symbol} ${PARES[i].strategy}: ${s.bars.length} barras · evidência ${PARES[i].evidencia}`);
}
if (!fs.existsSync(journalFile)) {
  diario('init', { equity: estado.equity, pares: PARES, custo: 'acao-varejo' });
}

console.log(
  `\ncatraca          ${DEFAULT_RATCHET.map((s) => `>${s.acima}:${(s.risco * 100).toFixed(0)}%`).join(' ')}\n` +
  `piso móvel       ativo\n` +
  `vol-targeting    ativo\n` +
  `máx por trade    ${cfg.maxBarsInTrade} barras (~2 pregões)\n` +
  `desliga em       ${(cfg.risk.maxDrawdownStop * 100).toFixed(0)}% de drawdown\n` +
  `\nNENHUMA ORDEM SERÁ ENVIADA.\nDiário: paper/journal-equity.jsonl\n`,
);

function fechar(pi: number, preco: number, motivo: string, barsHeld: number) {
  const p = estado.positions[pi];
  const fill = p.side === 'long' ? preco * (1 - cfg.cost.slippage) : preco * (1 + cfg.cost.slippage);
  const bruto = p.side === 'long' ? (fill - p.entryPrice) * p.qty : (p.entryPrice - fill) * p.qty;
  const pnl = bruto - fill * p.qty * cfg.cost.takerFee;

  estado.equity += pnl;
  if (estado.equity > estado.peakEquity) estado.peakEquity = estado.equity;
  estado.closedTrades++;
  if (pnl > 0) estado.wins++;
  estado.positions.splice(pi, 1);

  log(`FECHA ${p.symbol} (${motivo}) @ ${fill.toFixed(2)} · PnL US$ ${pnl.toFixed(4)} · equity US$ ${estado.equity.toFixed(2)}`);
  diario('fecha', {
    symbol: p.symbol, strategy: p.strategy, side: p.side, reason: motivo, barsHeld,
    entryPrice: p.entryPrice, exitPrice: fill, pnl, rEquity: pnl / p.equityAtEntry,
    equity: estado.equity, evidencia: PARES[p.idx].evidencia,
  });
}

async function ciclo() {
  const mkt = estadoMercado();
  if (!mkt.aberto) {
    const min = Math.round(mkt.msAteAbrir / 60000);
    console.log(`  mercado fechado (${mkt.motivo}) · reabre em ${min > 90 ? (min / 60).toFixed(1) + 'h' : min + 'min'}`);
    setTimeout(ciclo, Math.min(mkt.msAteAbrir + 60_000, 3_600_000));
    return;
  }

  for (let i = 0; i < PARES.length && !estado.halted; i++) {
    let novas: Bar[];
    try {
      novas = (await downloadStock({ symbol: PARES[i].symbol, timeframe })).bars;
    } catch (e) {
      log(`erro ao buscar ${PARES[i].symbol}: ${(e as Error).message}`);
      continue;
    }
    bars[i] = novas;
    const ult = novas[novas.length - 1];
    if (!ult || ult.t <= (estado.lastBar[PARES[i].symbol] ?? 0)) continue;
    estado.lastBar[PARES[i].symbol] = ult.t;

    const idx = novas.length - 1;
    const pi = estado.positions.findIndex((p) => p.symbol === PARES[i].symbol);

    // ── gerencia posição aberta ──────────────────────────────────────────
    if (pi >= 0) {
      const p = estado.positions[pi];
      const held = novas.filter((b) => b.t > p.entryBarT).length;
      const bateuStop = p.side === 'long' ? ult.l <= p.stopPrice : ult.h >= p.stopPrice;
      const bateuAlvo = p.side === 'long' ? ult.h >= p.takePrice : ult.l <= p.takePrice;
      // Gap: se a barra ABRIU além do stop, a saída é na abertura, pior preço.
      // É o custo específico de ação, e ignorá-lo subestimaria a cauda esquerda.
      const gapou = p.side === 'long' ? ult.o < p.stopPrice : ult.o > p.stopPrice;

      if (bateuStop) fechar(pi, gapou ? ult.o : p.stopPrice, gapou ? 'stop-com-gap' : 'stop', held);
      else if (bateuAlvo) fechar(pi, p.takePrice, 'take', held);
      else if (held >= cfg.maxBarsInTrade) fechar(pi, ult.c, 'timeout', held);
    }

    if (estado.halted) break;
    const dd = (estado.peakEquity - estado.equity) / estado.peakEquity;
    if (dd >= cfg.risk.maxDrawdownStop) {
      estado.halted = true;
      estado.haltReason = `drawdown ${(dd * 100).toFixed(1)}%`;
      log(`### DESLIGADO: ${estado.haltReason}`);
      diario('halt', { reason: estado.haltReason, equity: estado.equity });
      break;
    }

    // ── sinal ────────────────────────────────────────────────────────────
    if (estado.positions.some((p) => p.symbol === PARES[i].symbol)) continue;
    if (estado.positions.length >= 2) continue;
    if (idx < estrategias[i].warmup) continue;
    // Não abre posição perto do fechamento: entrar 20 minutos antes do sino
    // significa carregar o gap noturno inteiro sem tempo de o trade respirar.
    if (minutosAteFechar() < 60) continue;

    const sig = estrategias[i].onBar(novas, idx);
    if (!sig) continue;

    let risco = ratchetRisk(estado.peakEquity, DEFAULT_RATCHET);
    risco = floorAdjust(estado.equity, estado.peakEquity, risco);
    const vf = forecastVolatility(novas);
    const mult = volSizeMultiplier(vf, idx, targetVolatility(vf));
    const efetivo = risco * mult;

    const sized = sizePosition(estado.equity, sig.stopPct, cfg.cost, { ...cfg.risk, riskPerTrade: efetivo });
    if (sized.notional <= 0) { diario('bloqueado', { symbol: PARES[i].symbol, motivo: sized.reason }); continue; }

    const ref = ult.c;
    const entrada = sig.side === 'long' ? ref * (1 + cfg.cost.slippage) : ref * (1 - cfg.cost.slippage);
    estado.positions.push({
      idx: i, symbol: PARES[i].symbol, strategy: PARES[i].strategy, side: sig.side,
      entryTime: Date.now(), entryPrice: entrada, entryBarT: ult.t,
      stopPrice: sig.side === 'long' ? entrada * (1 - sig.stopPct) : entrada * (1 + sig.stopPct),
      // teto de 0,95 no lado short: takePct >= 1 gerava preço-alvo negativo
      // (inalcançável) — ver mesma correção em backtest/engine.ts
      takePrice: sig.side === 'long' ? entrada * (1 + sig.takePct) : entrada * (1 - Math.min(sig.takePct, 0.95)),
      qty: sized.notional / entrada, notional: sized.notional,
      riskUsed: efetivo, equityAtEntry: estado.equity,
    });
    estado.equity -= sized.notional * cfg.cost.takerFee;

    log(`ABRE ${PARES[i].symbol} ${sig.side} @ ${entrada.toFixed(2)} · risco ${(efetivo * 100).toFixed(2)}% · notional US$ ${sized.notional.toFixed(2)}`);
    diario('abre', {
      symbol: PARES[i].symbol, strategy: PARES[i].strategy, side: sig.side,
      entryPrice: entrada, refPrice: ref, notional: sized.notional,
      risco, volMult: mult, efetivo, equity: estado.equity, evidencia: PARES[i].evidencia,
    });
  }

  fs.writeFileSync(stateFile, JSON.stringify(estado, null, 2));
  const dias = (Date.now() - estado.startedAt) / 86_400_000;
  const ret = (estado.equity / equityInicial - 1) * 100;
  console.log(
    `  dia ${dias.toFixed(1)}/90 · equity US$ ${estado.equity.toFixed(2)} (${ret >= 0 ? '+' : ''}${ret.toFixed(2)}%) · ` +
    `${estado.closedTrades} trades · ${estado.positions.length} abertas`,
  );

  if (estado.halted) { console.log('\nO sistema desligou sozinho. Isto é a proteção funcionando.'); process.exit(0); }
  setTimeout(ciclo, 15 * 60_000);
}

process.on('SIGINT', () => {
  fs.writeFileSync(stateFile, JSON.stringify(estado, null, 2));
  console.log('\nEstado salvo. Reiniciar retoma de onde parou.');
  process.exit(0);
});

await ciclo();
