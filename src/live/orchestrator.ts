/**
 * ORQUESTRADOR DE PAPER TRADING — vários pares, um capital só.
 *
 * O que muda em relação a rodar quatro executores soltos: aqui o equity é
 * COMPARTILHADO. Quatro processos independentes com US$ 100 cada não simulam
 * uma conta de US$ 100 com quatro pares — simulam quatro contas de US$ 100. A
 * diferença aparece exatamente onde importa: no teto de posições simultâneas,
 * no calor ajustado por correlação, e no circuit breaker da carteira.
 *
 * Registra tudo em um diário append-only. Em 90 dias esse arquivo é a única
 * evidência que importa, e é o que o Auditor vai ler para dizer se o backtest
 * sabia alguma coisa sobre a realidade.
 */
import fs from 'node:fs';
import path from 'node:path';
import ccxt from 'ccxt';
import type { Bar, CostModel, RiskConfig, Side, Strategy } from '../core/types.ts';
import { sizePosition } from '../backtest/engine.ts';
import { tfMs, ROOT } from '../data/store.ts';
import {
  forecastVolatility, targetVolatility, volSizeMultiplier,
  ratchetRisk, floorAdjust, type RatchetStep,
} from '../core/volatility.ts';
import { effectiveHeat } from '../backtest/portfolio.ts';

export interface PaperLeg {
  symbol: string;
  strategy: Strategy;
}

export interface OrchestratorOptions {
  exchange: string;
  timeframe: string;
  legs: PaperLeg[];
  cost: CostModel;
  risk: RiskConfig;
  startEquity: number;
  maxBarsInTrade: number;
  maxConcurrent: number;
  maxHeat: number;
  ratchet?: RatchetStep[] | null;
  useFloor?: boolean;
  volTargeting?: boolean;
  warmupBars?: number;
  stateFile?: string;
  journalFile?: string;
}

interface PaperPosition {
  legIndex: number;
  symbol: string;
  strategy: string;
  side: Side;
  entryTime: number;
  entryPrice: number;
  entryBarT: number;
  stopPrice: number;
  takePrice: number;
  qty: number;
  notional: number;
  riskUsed: number;
  equityAtEntry: number;
}

export interface PaperState {
  startedAt: number;
  equity: number;
  peakEquity: number;
  dayKey: number;
  dayStartEquity: number;
  halted: boolean;
  haltReason?: string;
  positions: PaperPosition[];
  closedTrades: number;
  wins: number;
  lastBarByLeg: Record<string, number>;
}

export class PaperOrchestrator {
  private ex: any;
  private o: OrchestratorOptions;
  private state: PaperState;
  private bars: Bar[][] = [];
  private stateFile: string;
  private journalFile: string;
  private corr: number[][] = [];

  constructor(o: OrchestratorOptions) {
    this.o = o;
    const dir = path.join(ROOT, 'paper');
    fs.mkdirSync(dir, { recursive: true });
    this.stateFile = o.stateFile ?? path.join(dir, `state-${o.timeframe}.json`);
    this.journalFile = o.journalFile ?? path.join(dir, `journal-${o.timeframe}.jsonl`);
    this.state = this.load();
  }

  private load(): PaperState {
    if (fs.existsSync(this.stateFile)) {
      const s = JSON.parse(fs.readFileSync(this.stateFile, 'utf8')) as PaperState;
      this.say(`estado recuperado: equity US$ ${s.equity.toFixed(2)}, ${s.positions.length} posições abertas, ${s.closedTrades} trades fechados`);
      return s;
    }
    return {
      startedAt: Date.now(),
      equity: this.o.startEquity,
      peakEquity: this.o.startEquity,
      dayKey: Math.floor(Date.now() / 86_400_000),
      dayStartEquity: this.o.startEquity,
      halted: false,
      positions: [],
      closedTrades: 0,
      wins: 0,
      lastBarByLeg: {},
    };
  }

  private save() {
    fs.writeFileSync(this.stateFile, JSON.stringify(this.state, null, 2));
  }

  /** Diário append-only. É a evidência que o Auditor lê depois. */
  private journal(event: string, data: Record<string, unknown>) {
    fs.appendFileSync(this.journalFile, JSON.stringify({ ts: Date.now(), event, ...data }) + '\n');
  }

  private say(msg: string) {
    console.log(`[${new Date().toISOString().slice(0, 19)}] ${msg}`);
  }

  async init() {
    const Ex = (ccxt as any)[this.o.exchange];
    this.ex = new Ex({ enableRateLimit: true });
    await this.ex.loadMarkets();

    const need = this.o.warmupBars ?? Math.max(600, ...this.o.legs.map((l) => l.strategy.warmup + 200));
    for (const leg of this.o.legs) {
      const raw: number[][] = await this.ex.fetchOHLCV(leg.symbol, this.o.timeframe, undefined, need);
      this.bars.push(raw.map((r) => ({ t: r[0], o: r[1], h: r[2], l: r[3], c: r[4], v: r[5] })));
      this.say(`${leg.symbol} ${leg.strategy.name.split('(')[0]}: ${raw.length} barras`);
    }
    this.computeCorrelation();
    this.journal('init', {
      equity: this.state.equity,
      legs: this.o.legs.map((l) => ({ symbol: l.symbol, strategy: l.strategy.name })),
      correlation: this.corr,
    });
  }

  /** Correlação entre os retornos por barra das pernas, alinhados por timestamp. */
  private computeCorrelation() {
    const n = this.o.legs.length;
    const rets = this.bars.map((bs) => {
      const m = new Map<number, number>();
      for (let i = 1; i < bs.length; i++) if (bs[i - 1].c > 0) m.set(bs[i].t, bs[i].c / bs[i - 1].c - 1);
      return m;
    });
    this.corr = Array.from({ length: n }, () => new Array(n).fill(0));
    for (let i = 0; i < n; i++) {
      this.corr[i][i] = 1;
      for (let j = i + 1; j < n; j++) {
        const xs: number[] = [], ys: number[] = [];
        for (const [t, v] of rets[i]) { const w = rets[j].get(t); if (w != null) { xs.push(v); ys.push(w); } }
        if (xs.length < 30) continue;
        const mx = xs.reduce((a, b) => a + b, 0) / xs.length;
        const my = ys.reduce((a, b) => a + b, 0) / ys.length;
        let num = 0, dx = 0, dy = 0;
        for (let k = 0; k < xs.length; k++) { num += (xs[k] - mx) * (ys[k] - my); dx += (xs[k] - mx) ** 2; dy += (ys[k] - my) ** 2; }
        this.corr[i][j] = this.corr[j][i] = dx > 0 && dy > 0 ? num / Math.sqrt(dx * dy) : 0;
      }
    }
  }

  async tick() {
    if (this.state.halted) return;
    const step = tfMs(this.o.timeframe);
    const now = Date.now();

    const d = Math.floor(now / 86_400_000);
    if (d !== this.state.dayKey) {
      this.state.dayKey = d;
      this.state.dayStartEquity = this.state.equity;
      this.journal('novo-dia', { equity: this.state.equity });
    }

    for (let li = 0; li < this.o.legs.length; li++) {
      const leg = this.o.legs[li];
      let raw: number[][];
      try {
        raw = await this.ex.fetchOHLCV(leg.symbol, this.o.timeframe, undefined, 5);
      } catch (e) {
        this.say(`erro ao buscar ${leg.symbol}: ${(e as Error).message}`);
        continue;
      }

      for (const r of raw) {
        const bar: Bar = { t: r[0], o: r[1], h: r[2], l: r[3], c: r[4], v: r[5] };
        // Só barras FECHADAS. Barra em formação muda de forma e dispara sinal
        // que depois desaparece — é o bug número um de bot de trading.
        if (bar.t + step > now) continue;
        const last = this.state.lastBarByLeg[leg.symbol] ?? 0;
        if (bar.t <= last) continue;

        const k = this.bars[li].findIndex((b) => b.t === bar.t);
        if (k >= 0) this.bars[li][k] = bar; else this.bars[li].push(bar);
        this.state.lastBarByLeg[leg.symbol] = bar.t;
        await this.onClosedBar(li, bar);
      }
    }
    this.save();
  }

  private async onClosedBar(li: number, bar: Bar) {
    const leg = this.o.legs[li];
    const bars = this.bars[li];
    const i = bars.length - 1;
    const step = tfMs(this.o.timeframe);

    // ── 1. gerencia posição aberta desta perna ───────────────────────────
    const pi = this.state.positions.findIndex((p) => p.symbol === leg.symbol);
    if (pi >= 0) {
      const pos = this.state.positions[pi];
      const barsHeld = Math.round((bar.t - pos.entryBarT) / step);
      const hitStop = pos.side === 'long' ? bar.l <= pos.stopPrice : bar.h >= pos.stopPrice;
      const hitTake = pos.side === 'long' ? bar.h >= pos.takePrice : bar.l <= pos.takePrice;

      let exitPrice: number | null = null;
      let reason = '';
      // Pessimista: se tocou os dois na mesma barra, assume o stop.
      if (hitStop) { exitPrice = pos.stopPrice; reason = 'stop'; }
      else if (hitTake) { exitPrice = pos.takePrice; reason = 'take'; }
      else if (barsHeld >= this.o.maxBarsInTrade) { exitPrice = bar.c; reason = 'timeout'; }

      if (exitPrice != null) this.closePosition(pi, exitPrice, reason, barsHeld);
    }

    if (this.state.halted) return;

    // ── 2. circuit breakers da CARTEIRA ─────────────────────────────────
    const dd = (this.state.peakEquity - this.state.equity) / this.state.peakEquity;
    if (dd >= this.o.risk.maxDrawdownStop) {
      this.state.halted = true;
      this.state.haltReason = `drawdown de carteira ${(dd * 100).toFixed(1)}%`;
      this.say(`### DESLIGADO: ${this.state.haltReason}`);
      this.journal('halt', { reason: this.state.haltReason, equity: this.state.equity });
      return;
    }
    const dayLoss = (this.state.dayStartEquity - this.state.equity) / this.state.dayStartEquity;
    if (dayLoss >= this.o.risk.dailyLossLimit) return;

    // ── 3. sinal ────────────────────────────────────────────────────────
    if (this.state.positions.some((p) => p.symbol === leg.symbol)) return;
    if (i < leg.strategy.warmup) return;
    const sig = leg.strategy.onBar(bars, i);
    if (!sig) return;

    // teto de posições e de calor ajustado por correlação
    if (this.state.positions.length >= this.o.maxConcurrent) {
      this.journal('bloqueado', { symbol: leg.symbol, motivo: 'teto de posições' });
      return;
    }
    const risksNow = this.state.positions.map((p) => p.riskUsed);
    const idxNow = this.state.positions.map((p) => p.legIndex);

    let risk = this.o.ratchet ? ratchetRisk(this.state.peakEquity, this.o.ratchet) : this.o.risk.riskPerTrade;
    if (this.o.useFloor) risk = floorAdjust(this.state.equity, this.state.peakEquity, risk);

    let volMult = 1;
    if (this.o.volTargeting) {
      const vf = forecastVolatility(bars);
      volMult = volSizeMultiplier(vf, i, targetVolatility(vf));
    }
    const effRisk = risk * volMult;

    const heat = effectiveHeat([...risksNow, effRisk], [...idxNow, li], this.corr);
    if (heat > this.o.maxHeat) {
      this.journal('bloqueado', { symbol: leg.symbol, motivo: 'teto de calor', heat, maxHeat: this.o.maxHeat });
      this.say(`${leg.symbol}: sinal ${sig.side} barrado — calor ${(heat * 100).toFixed(2)}% > ${(this.o.maxHeat * 100).toFixed(2)}%`);
      return;
    }

    const sized = sizePosition(this.state.equity, sig.stopPct, this.o.cost, { ...this.o.risk, riskPerTrade: effRisk });
    if (sized.notional <= 0) {
      this.journal('bloqueado', { symbol: leg.symbol, motivo: sized.reason });
      return;
    }

    // Entrada ao preço de referência da barra seguinte (paper: usa o fecho +
    // slippage, que é a aproximação conservadora sem enviar ordem).
    const ref = bar.c;
    const entryPrice = sig.side === 'long' ? ref * (1 + this.o.cost.slippage) : ref * (1 - this.o.cost.slippage);

    this.state.positions.push({
      legIndex: li, symbol: leg.symbol, strategy: leg.strategy.name, side: sig.side,
      entryTime: Date.now(), entryPrice, entryBarT: bar.t,
      stopPrice: sig.side === 'long' ? entryPrice * (1 - sig.stopPct) : entryPrice * (1 + sig.stopPct),
      // teto de 0,95 no lado short: takePct >= 1 gerava preço-alvo negativo
      // (inalcançável) — ver mesma correção em backtest/engine.ts
      takePrice: sig.side === 'long' ? entryPrice * (1 + sig.takePct) : entryPrice * (1 - Math.min(sig.takePct, 0.95)),
      qty: sized.notional / entryPrice, notional: sized.notional,
      riskUsed: effRisk, equityAtEntry: this.state.equity,
    });
    this.state.equity -= sized.notional * this.o.cost.takerFee;

    this.say(
      `ABRE ${leg.symbol.replace('/USDT:USDT', '')} ${sig.side} @ ${entryPrice.toFixed(4)} · ` +
      `risco ${(risk * 100).toFixed(2)}%×vol ${volMult.toFixed(2)} = ${(effRisk * 100).toFixed(2)}% · ` +
      `notional US$ ${sized.notional.toFixed(2)} · calor ${(heat * 100).toFixed(2)}%`,
    );
    this.journal('abre', {
      symbol: leg.symbol, strategy: leg.strategy.name, side: sig.side, entryPrice,
      notional: sized.notional, risk, volMult, effRisk, heat, equity: this.state.equity,
      // registra o preço esperado para medir seleção adversa depois
      refPrice: ref, barClose: bar.c,
    });
  }

  private closePosition(pi: number, exitPrice: number, reason: string, barsHeld: number) {
    const pos = this.state.positions[pi];
    const fill = pos.side === 'long' ? exitPrice * (1 - this.o.cost.slippage) : exitPrice * (1 + this.o.cost.slippage);
    const gross = pos.side === 'long' ? (fill - pos.entryPrice) * pos.qty : (pos.entryPrice - fill) * pos.qty;
    const exitFee = fill * pos.qty * this.o.cost.takerFee;
    const pnl = gross - exitFee;

    this.state.equity += pnl;
    if (this.state.equity > this.state.peakEquity) this.state.peakEquity = this.state.equity;
    this.state.closedTrades++;
    if (pnl > 0) this.state.wins++;
    this.state.positions.splice(pi, 1);

    const wr = (this.state.wins / this.state.closedTrades) * 100;
    this.say(
      `FECHA ${pos.symbol.replace('/USDT:USDT', '')} (${reason}) @ ${fill.toFixed(4)} · ` +
      `PnL US$ ${pnl.toFixed(4)} · equity US$ ${this.state.equity.toFixed(2)} · ` +
      `${this.state.closedTrades} trades, ${wr.toFixed(0)}% acerto`,
    );
    this.journal('fecha', {
      symbol: pos.symbol, strategy: pos.strategy, side: pos.side, reason, barsHeld,
      entryPrice: pos.entryPrice, exitPrice: fill, pnl,
      rEquity: pnl / pos.equityAtEntry, equity: this.state.equity, peak: this.state.peakEquity,
    });
  }

  getState(): PaperState { return { ...this.state }; }

  status(): string {
    const s = this.state;
    const dias = (Date.now() - s.startedAt) / 86_400_000;
    const ret = (s.equity / this.o.startEquity - 1) * 100;
    const dd = ((s.peakEquity - s.equity) / s.peakEquity) * 100;
    return (
      `dia ${dias.toFixed(1)}/90 · equity US$ ${s.equity.toFixed(2)} (${ret >= 0 ? '+' : ''}${ret.toFixed(2)}%) · ` +
      `pico US$ ${s.peakEquity.toFixed(2)} · dd ${dd.toFixed(1)}% · ` +
      `${s.closedTrades} trades${s.closedTrades ? `, ${((s.wins / s.closedTrades) * 100).toFixed(0)}% acerto` : ''} · ` +
      `${s.positions.length} abertas${s.halted ? ` · PARADO: ${s.haltReason}` : ''}`
    );
  }
}
