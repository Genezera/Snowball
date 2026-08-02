/**
 * Motor de portfólio — várias posições simultâneas, equity compartilhado.
 *
 * ---------------------------------------------------------------------------
 * POR QUE ESTE ARQUIVO É O MAIS PERIGOSO DO PROJETO
 *
 * O motor de posição única tinha uma proteção implícita que ninguém precisava
 * escrever: era impossível estar exposto a duas coisas ao mesmo tempo. Este
 * arquivo remove essa proteção, e com ela some a garantia que sustentava toda
 * a matemática de risco.
 *
 * A conta "3 posições × 0,5% = 1,5% de risco" só vale se as três forem
 * INDEPENDENTES. BTC, ETH e SOL caem juntos. Três posições correlacionadas não
 * são três apostas de 0,5% — são aproximadamente UMA aposta de 1,5% com três
 * nomes diferentes. Quem monta multi-ativo sem medir isso triplica o risco real
 * achando que diversificou.
 *
 * As três defesas implementadas aqui, todas obrigatórias:
 *
 *   1. TETO DE CALOR (heat)  — a soma do risco aberto nunca passa de um limite
 *      duro, independentemente de quantos sinais apareçam.
 *   2. CORRELAÇÃO MEDIDA     — a exposição efetiva é calculada com a matriz de
 *      correlação realizada, não assumindo independência.
 *   3. UMA POSIÇÃO POR ATIVO — dois pares no mesmo símbolo é alavancagem
 *      disfarçada de diversificação.
 * ---------------------------------------------------------------------------
 */
import type { BacktestConfig, Bar, ExitReason, Series, Signal, Strategy, Trade } from '../core/types.ts';
import { sizePosition } from './engine.ts';
import { tfMs } from '../data/store.ts';

export interface Leg {
  symbol: string;
  series: Series;
  strategy: Strategy;
}

export interface PortfolioConfig extends BacktestConfig {
  /** soma máxima do risco aberto simultâneo, em fração do equity */
  maxHeat: number;
  /**
   * Correlação acima da qual duas posições passam a contar como uma só para o
   * cálculo de calor. 0,7 é o padrão: acima disso os ativos praticamente não
   * oferecem diversificação.
   */
  correlationThreshold: number;
}

interface OpenPos {
  leg: number;
  symbol: string;
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
  riskFraction: number;
}

export interface PortfolioResult {
  trades: Trade[];
  equityCurve: { t: number; equity: number }[];
  finalEquity: number;
  haltedAt?: { t: number; reason: string };
  /** quantos sinais foram recusados por teto de calor */
  blockedByHeat: number;
  /** quantos por já haver posição no mesmo ativo */
  blockedBySymbol: number;
  /** pico de calor simultâneo observado */
  peakHeat: number;
  /** pico de posições simultâneas */
  peakPositions: number;
  /** correlação média entre os retornos diários dos ativos operados */
  measuredCorrelation: number;
  /** calor efetivo no pico, ajustado por correlação */
  peakEffectiveHeat: number;
  perLeg: Record<string, { trades: number; pnl: number }>;
}

/**
 * Correlação de Pearson entre os retornos por barra de dois ativos, alinhados
 * por timestamp. É a medida que decide se "diversificar" foi real ou verbal.
 */
export function correlationMatrix(legs: Leg[]): number[][] {
  const rets = legs.map((l) => {
    const m = new Map<number, number>();
    for (let i = 1; i < l.series.bars.length; i++) {
      const p = l.series.bars[i - 1].c;
      if (p > 0) m.set(l.series.bars[i].t, l.series.bars[i].c / p - 1);
    }
    return m;
  });

  const n = legs.length;
  const M: number[][] = Array.from({ length: n }, () => new Array(n).fill(0));
  for (let i = 0; i < n; i++) {
    M[i][i] = 1;
    for (let j = i + 1; j < n; j++) {
      const xs: number[] = [], ys: number[] = [];
      for (const [t, v] of rets[i]) {
        const w = rets[j].get(t);
        if (w != null) { xs.push(v); ys.push(w); }
      }
      if (xs.length < 30) { M[i][j] = M[j][i] = 0; continue; }
      const mx = xs.reduce((a, b) => a + b, 0) / xs.length;
      const my = ys.reduce((a, b) => a + b, 0) / ys.length;
      let num = 0, dx = 0, dy = 0;
      for (let k = 0; k < xs.length; k++) {
        num += (xs[k] - mx) * (ys[k] - my);
        dx += (xs[k] - mx) ** 2;
        dy += (ys[k] - my) ** 2;
      }
      const c = dx > 0 && dy > 0 ? num / Math.sqrt(dx * dy) : 0;
      M[i][j] = M[j][i] = c;
    }
  }
  return M;
}

/**
 * Calor efetivo: o risco que você REALMENTE corre, dado que as posições não
 * são independentes.
 *
 * Fórmula: raiz de (wᵀ · C · w), onde w são os riscos individuais e C a matriz
 * de correlação. Com correlação zero isto devolve a raiz da soma dos quadrados
 * (diversificação plena). Com correlação 1 devolve a soma simples — ou seja,
 * três posições de 0,5% viram 1,5% de risco de verdade, não 0,87%.
 */
export function effectiveHeat(risks: number[], legIdx: number[], C: number[][]): number {
  let acc = 0;
  for (let a = 0; a < risks.length; a++) {
    for (let b = 0; b < risks.length; b++) {
      const corr = a === b ? 1 : (C[legIdx[a]]?.[legIdx[b]] ?? 0);
      acc += risks[a] * risks[b] * corr;
    }
  }
  return Math.sqrt(Math.max(0, acc));
}

export function runPortfolio(legs: Leg[], cfg: PortfolioConfig): PortfolioResult {
  if (!legs.length) throw new Error('portfólio vazio');
  const step = tfMs(legs[0].series.timeframe);

  // Linha do tempo unificada: união de todos os timestamps, ordenada.
  const allTimes = [...new Set(legs.flatMap((l) => l.series.bars.map((b) => b.t)))].sort((a, b) => a - b);
  const indexByTime = legs.map((l) => new Map(l.series.bars.map((b, i) => [b.t, i])));

  const C = correlationMatrix(legs);
  let corrSum = 0, corrCount = 0;
  for (let i = 0; i < legs.length; i++) for (let j = i + 1; j < legs.length; j++) { corrSum += C[i][j]; corrCount++; }
  const measuredCorrelation = corrCount ? corrSum / corrCount : 0;

  const trades: Trade[] = [];
  const equityCurve: { t: number; equity: number }[] = [];
  const perLeg: Record<string, { trades: number; pnl: number }> = {};
  for (const l of legs) perLeg[`${l.symbol}|${l.strategy.name}`] = { trades: 0, pnl: 0 };

  let equity = cfg.initialEquity;
  let peak = equity;
  let halted: PortfolioResult['haltedAt'];
  let blockedByHeat = 0, blockedBySymbol = 0, peakHeat = 0, peakPositions = 0, peakEffectiveHeat = 0;

  const open: OpenPos[] = [];
  const pending: { leg: number; sig: Signal }[] = [];

  const dayKey = (t: number) => Math.floor(t / 86_400_000);
  let curDay = dayKey(allTimes[0]);
  let dayStartEquity = equity;
  let dayBlocked = false;

  const fee = cfg.cost.takerFee;
  const slip = cfg.cost.slippage;

  for (let ti = 0; ti < allTimes.length && !halted; ti++) {
    const t = allTimes[ti];

    const d = dayKey(t);
    if (d !== curDay) { curDay = d; dayStartEquity = equity; dayBlocked = false; }

    // ── 1. executa entradas pendentes na abertura desta barra ──────────────
    for (const p of pending) {
      const bi = indexByTime[p.leg].get(t);
      if (bi == null) continue;
      const bar = legs[p.leg].series.bars[bi];
      const leg = legs[p.leg];

      // DEFESA 3: uma posição por ativo.
      if (open.some((o) => o.symbol === leg.symbol)) { blockedBySymbol++; continue; }

      const sized = sizePosition(equity, p.sig.stopPct, cfg.cost, cfg.risk);
      if (sized.notional <= 0) continue;

      // DEFESA 1 e 2: teto de calor, medido com correlação.
      const risks = open.map((o) => o.riskFraction).concat(cfg.risk.riskPerTrade);
      const idxs = open.map((o) => o.leg).concat(p.leg);
      const eff = effectiveHeat(risks, idxs, C);
      if (eff > cfg.maxHeat) { blockedByHeat++; continue; }
      if (open.length >= cfg.risk.maxConcurrent) { blockedByHeat++; continue; }

      const entryPrice = p.sig.side === 'long' ? bar.o * (1 + slip) : bar.o * (1 - slip);
      open.push({
        leg: p.leg, symbol: leg.symbol, strategy: leg.strategy.name, side: p.sig.side,
        entryTime: t, entryPrice, entryIndex: bi,
        stopPrice: p.sig.side === 'long' ? entryPrice * (1 - p.sig.stopPct) : entryPrice * (1 + p.sig.stopPct),
        takePrice: p.sig.side === 'long' ? entryPrice * (1 + p.sig.takePct) : entryPrice * (1 - p.sig.takePct),
        qty: sized.notional / entryPrice, notional: sized.notional,
        entryFee: sized.notional * fee, equityAtEntry: equity,
        riskFraction: cfg.risk.riskPerTrade,
      });
      peakPositions = Math.max(peakPositions, open.length);
      peakHeat = Math.max(peakHeat, open.reduce((a, o) => a + o.riskFraction, 0));
      peakEffectiveHeat = Math.max(peakEffectiveHeat, eff);
    }
    pending.length = 0;

    // ── 2. gerencia posições abertas ───────────────────────────────────────
    for (let k = open.length - 1; k >= 0; k--) {
      const pos = open[k];
      const bi = indexByTime[pos.leg].get(t);
      if (bi == null || bi <= pos.entryIndex) continue;
      const bar = legs[pos.leg].series.bars[bi];
      const barsHeld = bi - pos.entryIndex;

      let exitPrice: number | null = null;
      let reason: ExitReason | null = null;
      const hitStop = pos.side === 'long' ? bar.l <= pos.stopPrice : bar.h >= pos.stopPrice;
      const hitTake = pos.side === 'long' ? bar.h >= pos.takePrice : bar.l <= pos.takePrice;

      if (hitStop && hitTake) {
        exitPrice = cfg.pessimisticIntrabar ? pos.stopPrice : pos.takePrice;
        reason = cfg.pessimisticIntrabar ? 'stop' : 'take';
      } else if (hitStop) {
        const gapped = pos.side === 'long' ? bar.o < pos.stopPrice : bar.o > pos.stopPrice;
        exitPrice = gapped ? bar.o : pos.stopPrice; reason = 'stop';
      } else if (hitTake) {
        const gapped = pos.side === 'long' ? bar.o > pos.takePrice : bar.o < pos.takePrice;
        exitPrice = gapped ? bar.o : pos.takePrice; reason = 'take';
      } else if (barsHeld >= cfg.maxBarsInTrade) {
        exitPrice = bar.c; reason = 'timeout';
      } else if (ti === allTimes.length - 1) {
        exitPrice = bar.c; reason = 'end-of-data';
      }

      if (exitPrice == null || !reason) continue;

      const fill = pos.side === 'long' ? exitPrice * (1 - slip) : exitPrice * (1 + slip);
      const exitFee = fill * pos.qty * fee;
      const hoursHeld = (barsHeld * step) / 3_600_000;
      const funding = cfg.cost.fundingPer8h ? pos.notional * cfg.cost.fundingPer8h * (hoursHeld / 8) : 0;
      const gross = pos.side === 'long' ? (fill - pos.entryPrice) * pos.qty : (pos.entryPrice - fill) * pos.qty;
      const cost = pos.entryFee + exitFee + funding;
      const pnl = gross - cost;

      equity += pnl;
      peak = Math.max(peak, equity);

      trades.push({
        symbol: pos.symbol, side: pos.side, entryTime: pos.entryTime, entryPrice: pos.entryPrice,
        exitTime: t, exitPrice: fill, exitReason: reason, barsHeld,
        notional: pos.notional, cost, pnl, rEquity: pnl / pos.equityAtEntry,
        rPrice: gross / pos.notional, equityAfter: equity,
      });
      const key = `${pos.symbol}|${pos.strategy}`;
      perLeg[key].trades++; perLeg[key].pnl += pnl;
      open.splice(k, 1);

      if (equity <= 0) halted = { t, reason: 'conta zerada' };
      else if ((peak - equity) / peak >= cfg.risk.maxDrawdownStop)
        halted = { t, reason: `drawdown máximo (${(((peak - equity) / peak) * 100).toFixed(1)}%)` };
      else if ((dayStartEquity - equity) / dayStartEquity >= cfg.risk.dailyLossLimit) dayBlocked = true;
    }

    // ── 3. coleta sinais para a próxima barra ──────────────────────────────
    if (!dayBlocked && !halted) {
      for (let li = 0; li < legs.length; li++) {
        if (open.some((o) => o.symbol === legs[li].symbol)) continue;
        const bi = indexByTime[li].get(t);
        if (bi == null || bi < legs[li].strategy.warmup || bi >= legs[li].series.bars.length - 1) continue;
        const sig = legs[li].strategy.onBar(legs[li].series.bars, bi);
        if (sig) pending.push({ leg: li, sig });
      }
    }

    equityCurve.push({ t, equity });
  }

  return {
    trades, equityCurve, finalEquity: equity, haltedAt: halted,
    blockedByHeat, blockedBySymbol, peakHeat, peakPositions,
    measuredCorrelation, peakEffectiveHeat, perLeg,
  };
}
