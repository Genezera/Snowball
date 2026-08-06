/**
 * Motor multi-estrategia com alocador adaptativo.
 *
 * Mesmas regras anti-autoengano do motor de estrategia unica (ver engine.ts):
 * sinal na barra i executa na abertura da barra i+1, custo nos dois lados,
 * ambiguidade intrabar resolvida pelo stop, uma posicao por vez, circuit
 * breakers ativos.
 *
 * A diferenca: a cada barra TODAS as estrategias sao consultadas, e o alocador
 * decide qual (se alguma) merece o capital, com base no regime vigente.
 *
 * Uma sutileza que importa muito: o alocador so pode usar modelos treinados em
 * dados ANTERIORES a barra atual. Quem garante isso e o chamador (o
 * walk-forward em cli/adaptive.ts). Este motor nao tem como verificar, entao a
 * responsabilidade fica documentada aqui em vez de escondida.
 */
import type { BacktestConfig, BacktestResult, ExitReason, Series, Signal, Strategy, Trade } from '../core/types.ts';
import { sizePosition } from './engine.ts';
import { tfMs } from '../data/store.ts';
import { allocate, type AllocatorConfig, type StrategyModel, DEFAULT_ALLOCATOR } from '../ml/allocator.ts';
import { labelRegime, type RegimeContext } from '../ml/regime.ts';

export interface MultiResult extends BacktestResult {
  /** quantas vezes cada estrategia foi escolhida */
  usage: Record<string, number>;
  /** quantas barras tiveram sinal mas o alocador preferiu ficar de fora */
  skipped: number;
  /** distribuicao de regimes nos trades executados */
  regimeUsage: Record<string, number>;
}

export function runMultiBacktest(opts: {
  series: Series;
  strategies: Strategy[];
  cfg: BacktestConfig;
  ctx: RegimeContext;
  models: Map<string, StrategyModel>;
  acfg?: AllocatorConfig;
  /** indice a partir do qual pode negociar (o resto e aquecimento) */
  startIndex?: number;
}): MultiResult {
  const { series, strategies, cfg, ctx, models } = opts;
  const acfg = opts.acfg ?? DEFAULT_ALLOCATOR;
  const bars = series.bars;
  const step = tfMs(series.timeframe);
  const start = opts.startIndex ?? 0;

  const trades: Trade[] = [];
  const equityCurve: { t: number; equity: number }[] = [];
  const usage: Record<string, number> = {};
  const regimeUsage: Record<string, number> = {};
  let skipped = 0;

  let equity = cfg.initialEquity;
  let peak = equity;
  let halted: BacktestResult['haltedAt'];

  let pos: {
    strategy: string;
    side: 'long' | 'short';
    entryTime: number;
    entryPrice: number;
    entryIndex: number;
    stopPrice: number;
    takePrice: number;
    qty: number;
    notional: number;
    entryFee: number;
    equityAtEntry: number;
    regime: string;
  } | null = null;

  let pending: { strategy: string; sig: Signal; regime: string } | null = null;

  const dayKey = (t: number) => Math.floor(t / 86_400_000);
  let curDay = bars.length ? dayKey(bars[0].t) : 0;
  let dayStartEquity = equity;
  let dayBlocked = false;

  const fee = cfg.cost.takerFee;
  const slip = cfg.cost.slippage;
  const maxWarmup = Math.max(...strategies.map((s) => s.warmup), 100);

  for (let i = start; i < bars.length && !halted; i++) {
    const bar = bars[i];

    const d = dayKey(bar.t);
    if (d !== curDay) {
      curDay = d;
      dayStartEquity = equity;
      dayBlocked = false;
    }

    // --- 1. executa entrada pendente na abertura desta barra ---
    if (pending && !pos && !dayBlocked) {
      const { sig, strategy, regime } = pending;
      const sized = sizePosition(equity, sig.stopPct, cfg.cost, cfg.risk);
      if (sized.notional > 0) {
        const entryPrice = sig.side === 'long' ? bar.o * (1 + slip) : bar.o * (1 - slip);
        pos = {
          strategy,
          side: sig.side,
          entryTime: bar.t,
          entryPrice,
          entryIndex: i,
          stopPrice: sig.side === 'long' ? entryPrice * (1 - sig.stopPct) : entryPrice * (1 + sig.stopPct),
          // teto de 0,95 no lado short: takePct >= 1 gerava preço-alvo negativo
          // (inalcançável) — ver mesma correção em backtest/engine.ts
          takePrice: sig.side === 'long' ? entryPrice * (1 + sig.takePct) : entryPrice * (1 - Math.min(sig.takePct, 0.95)),
          qty: sized.notional / entryPrice,
          notional: sized.notional,
          entryFee: sized.notional * fee,
          equityAtEntry: equity,
          regime,
        };
        usage[strategy] = (usage[strategy] ?? 0) + 1;
        regimeUsage[regime] = (regimeUsage[regime] ?? 0) + 1;
      }
    }
    pending = null;

    // --- 2. gerencia posicao aberta ---
    if (pos) {
      const barsHeld = i - pos.entryIndex;
      let exitPrice: number | null = null;
      let reason: ExitReason | null = null;

      const hitStop = pos.side === 'long' ? bar.l <= pos.stopPrice : bar.h >= pos.stopPrice;
      const hitTake = pos.side === 'long' ? bar.h >= pos.takePrice : bar.l <= pos.takePrice;

      if (i > pos.entryIndex) {
        if (hitStop && hitTake) {
          exitPrice = cfg.pessimisticIntrabar ? pos.stopPrice : pos.takePrice;
          reason = cfg.pessimisticIntrabar ? 'stop' : 'take';
        } else if (hitStop) {
          const gapped = pos.side === 'long' ? bar.o < pos.stopPrice : bar.o > pos.stopPrice;
          exitPrice = gapped ? bar.o : pos.stopPrice;
          reason = 'stop';
        } else if (hitTake) {
          const gapped = pos.side === 'long' ? bar.o > pos.takePrice : bar.o < pos.takePrice;
          exitPrice = gapped ? bar.o : pos.takePrice;
          reason = 'take';
        } else if (barsHeld >= cfg.maxBarsInTrade) {
          exitPrice = bar.c;
          reason = 'timeout';
        }
      }
      if (i === bars.length - 1 && exitPrice == null) {
        exitPrice = bar.c;
        reason = 'end-of-data';
      }

      if (exitPrice != null && reason) {
        const fill = pos.side === 'long' ? exitPrice * (1 - slip) : exitPrice * (1 + slip);
        const exitFee = fill * pos.qty * fee;
        const hoursHeld = (barsHeld * step) / 3_600_000;
        const funding = cfg.cost.fundingPer8h ? pos.notional * cfg.cost.fundingPer8h * (hoursHeld / 8) : 0;
        const gross = pos.side === 'long' ? (fill - pos.entryPrice) * pos.qty : (pos.entryPrice - fill) * pos.qty;
        const totalCost = pos.entryFee + exitFee + funding;
        const pnl = gross - totalCost;

        equity += pnl;
        peak = Math.max(peak, equity);

        trades.push({
          symbol: series.symbol,
          side: pos.side,
          entryTime: pos.entryTime,
          entryPrice: pos.entryPrice,
          exitTime: bar.t,
          exitPrice: fill,
          exitReason: reason,
          barsHeld,
          notional: pos.notional,
          cost: totalCost,
          pnl,
          rEquity: pnl / pos.equityAtEntry,
          rPrice: gross / pos.notional,
          equityAfter: equity,
          features: { strategyId: strategies.findIndex((s) => s.name === pos!.strategy) },
        });
        pos = null;

        if (equity <= 0) halted = { t: bar.t, reason: 'conta zerada' };
        else if ((peak - equity) / peak >= cfg.risk.maxDrawdownStop)
          halted = { t: bar.t, reason: `drawdown maximo (${(((peak - equity) / peak) * 100).toFixed(1)}%)` };
        else if ((dayStartEquity - equity) / dayStartEquity >= cfg.risk.dailyLossLimit) dayBlocked = true;
      }
    }

    // --- 3. consulta TODAS as estrategias e deixa o alocador escolher ---
    if (!pos && !pending && !dayBlocked && !halted && i >= maxWarmup && i < bars.length - 1) {
      const candidates: { strategy: string; isLong: boolean; sig: Signal }[] = [];
      for (const s of strategies) {
        if (i < s.warmup) continue;
        const sig = s.onBar(bars, i);
        if (sig) candidates.push({ strategy: s.name, isLong: sig.side === 'long', sig });
      }

      if (candidates.length) {
        const row = ctx.rows[i];
        if (row) {
          const decision = allocate(
            models,
            candidates.map((c) => ({ strategy: c.strategy, isLong: c.isLong })),
            row,
            acfg,
          );
          if (decision.chosen) {
            const pick = candidates.find((c) => c.strategy === decision.chosen)!;
            pending = { strategy: pick.strategy, sig: pick.sig, regime: labelRegime(ctx, i) };
          } else {
            skipped++;
          }
        }
      }
    }

    equityCurve.push({ t: bar.t, equity });
  }

  return { trades, equityCurve, finalEquity: equity, haltedAt: halted, usage, skipped, regimeUsage };
}
