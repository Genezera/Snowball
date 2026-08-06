/**
 * Executor ao vivo. Tres modos, em ordem obrigatoria de progressao:
 *
 *   paper   -> nenhuma ordem sai daqui. Le precos reais, simula preenchimento
 *              com o MESMO modelo de custo do backtest. E o modo padrao.
 *   testnet -> envia ordens para a testnet da exchange, com dinheiro de mentira.
 *   live    -> dinheiro real. Exige chave de API real E a flag --i-understand.
 *
 * Voce nao deve pular etapas. O modo paper existe para descobrir a diferenca
 * entre o backtest e a realidade (latencia, preenchimento, barra incompleta)
 * antes que essa diferenca custe dinheiro.
 *
 * Salvaguardas que rodam em todos os modos:
 *  - so age em barras FECHADAS. Uma barra de 5min em formacao muda de forma e
 *    dispara sinais que desaparecem. Este e o bug numero um de bot de scalping.
 *  - limite de perda diaria e drawdown maximo, iguais aos do backtest.
 *  - estado persistido em disco: reiniciar o processo nao ressuscita uma
 *    posicao fantasma nem esquece uma real.
 */
import fs from 'node:fs';
import path from 'node:path';
import ccxt from 'ccxt';
import type { Bar, CostModel, RiskConfig, Side, Strategy } from '../core/types.ts';
import { sizePosition } from '../backtest/engine.ts';
import { tfMs, ROOT } from '../data/store.ts';
import { GBDT } from '../ml/gbdt.ts';
import {
  forecastVolatility, targetVolatility, volSizeMultiplier,
  ratchetRisk, floorAdjust, type RatchetStep,
} from '../core/volatility.ts';

export type Mode = 'paper' | 'testnet' | 'live';

export interface LiveState {
  mode: Mode;
  equity: number;
  peakEquity: number;
  dayKey: number;
  dayStartEquity: number;
  halted: boolean;
  haltReason?: string;
  position: null | {
    side: Side;
    entryPrice: number;
    qty: number;
    notional: number;
    stopPrice: number;
    takePrice: number;
    openedAt: number;
    openedBarT: number;
  };
  closedTrades: number;
  wins: number;
  lastBarT: number;
}

export interface LiveOptions {
  exchange: string;
  symbol: string;
  timeframe: string;
  mode: Mode;
  strategy: Strategy;
  cost: CostModel;
  risk: RiskConfig;
  startEquity: number;
  maxBarsInTrade: number;
  /**
   * Catraca: o risco desce sozinho conforme o PICO de capital sobe. Testada
   * contra risco fixo — mesma mediana, mas retém 92% dos que atingem a meta
   * contra 72%. Passe null para usar o risco fixo de `risk.riskPerTrade`.
   */
  ratchet?: RatchetStep[] | null;
  /**
   * Piso móvel: corta o risco pela metade quando o equity já devolveu 25% do
   * pico. É o que faz a política agressiva sobreviver ao cenário de edge zero.
   */
  useFloor?: boolean;
  /**
   * Dimensionamento por volatilidade prevista. Nunca remove um trade — só muda
   * o tamanho. Foi a única previsão que funcionou no projeto.
   */
  volTargeting?: boolean;
  /** filtro de ML opcional: so entra se p >= threshold */
  mlModel?: GBDT;
  mlThreshold?: number;
  /** quantas barras historicas carregar no boot para aquecer indicadores */
  warmupBars?: number;
  stateFile?: string;
  log?: (msg: string) => void;
}

export class LiveExecutor {
  private ex: any;
  private state: LiveState;
  private stateFile: string;
  private bars: Bar[] = [];
  private log: (m: string) => void;

  private o: LiveOptions;

  constructor(o: LiveOptions) {
    this.o = o;
    this.log = o.log ?? ((m) => console.log(`[${new Date().toISOString()}] ${m}`));
    this.stateFile =
      o.stateFile ?? path.join(ROOT, 'state', `${o.mode}__${o.symbol.replace('/', '_')}__${o.timeframe}.json`);
    this.state = this.loadState();
  }

  private loadState(): LiveState {
    if (fs.existsSync(this.stateFile)) {
      const s = JSON.parse(fs.readFileSync(this.stateFile, 'utf8')) as LiveState;
      this.log(`estado recuperado: equity ${s.equity.toFixed(2)}, posicao ${s.position ? s.position.side : 'nenhuma'}`);
      return s;
    }
    return {
      mode: this.o.mode,
      equity: this.o.startEquity,
      peakEquity: this.o.startEquity,
      dayKey: Math.floor(Date.now() / 86_400_000),
      dayStartEquity: this.o.startEquity,
      halted: false,
      position: null,
      closedTrades: 0,
      wins: 0,
      lastBarT: 0,
    };
  }

  private saveState() {
    fs.mkdirSync(path.dirname(this.stateFile), { recursive: true });
    fs.writeFileSync(this.stateFile, JSON.stringify(this.state, null, 2));
  }

  async init() {
    const Ex = (ccxt as any)[this.o.exchange];
    if (!Ex) throw new Error(`exchange desconhecida: ${this.o.exchange}`);

    const cfg: any = { enableRateLimit: true };
    if (this.o.mode !== 'paper') {
      const prefix = this.o.mode === 'testnet' ? 'TESTNET_' : 'LIVE_';
      cfg.apiKey = process.env[`${prefix}API_KEY`];
      cfg.secret = process.env[`${prefix}API_SECRET`];
      if (!cfg.apiKey || !cfg.secret) {
        throw new Error(
          `modo ${this.o.mode} exige as variaveis de ambiente ${prefix}API_KEY e ${prefix}API_SECRET. ` +
            `Nunca coloque chaves no codigo nem em arquivo versionado.`,
        );
      }
    }
    this.ex = new Ex(cfg);
    if (this.o.mode === 'testnet') this.ex.setSandboxMode(true);
    await this.ex.loadMarkets();

    // Aquecimento: precisamos de historico suficiente para os indicadores.
    const need = this.o.warmupBars ?? Math.max(500, this.o.strategy.warmup + 100);
    const raw: number[][] = await this.ex.fetchOHLCV(this.o.symbol, this.o.timeframe, undefined, need);
    this.bars = raw.map((r) => ({ t: r[0], o: r[1], h: r[2], l: r[3], c: r[4], v: r[5] }));
    this.log(`aquecido com ${this.bars.length} barras de ${this.o.symbol} ${this.o.timeframe} (modo ${this.o.mode})`);
  }

  /** Um ciclo. Chame a cada fechamento de barra. */
  async tick(): Promise<void> {
    if (this.state.halted) return;

    const raw: number[][] = await this.ex.fetchOHLCV(this.o.symbol, this.o.timeframe, undefined, 5);
    const step = tfMs(this.o.timeframe);
    const now = Date.now();

    for (const r of raw) {
      const bar: Bar = { t: r[0], o: r[1], h: r[2], l: r[3], c: r[4], v: r[5] };
      // REGRA CRITICA: so processa barras ja fechadas. Uma barra cujo intervalo
      // ainda nao terminou vai mudar, e agir nela e olhar para o futuro que
      // ainda nao existe.
      if (bar.t + step > now) continue;
      if (bar.t <= this.state.lastBarT) continue;

      const idx = this.bars.findIndex((b) => b.t === bar.t);
      if (idx >= 0) this.bars[idx] = bar;
      else this.bars.push(bar);
      this.state.lastBarT = bar.t;
      await this.onClosedBar();
    }
    this.saveState();
  }

  private async onClosedBar() {
    const bars = this.bars;
    const i = bars.length - 1;
    const bar = bars[i];

    // fronteira de dia
    const dk = Math.floor(bar.t / 86_400_000);
    if (dk !== this.state.dayKey) {
      this.state.dayKey = dk;
      this.state.dayStartEquity = this.state.equity;
    }

    // 1. gerencia posicao aberta
    const pos = this.state.position;
    if (pos) {
      const hitStop = pos.side === 'long' ? bar.l <= pos.stopPrice : bar.h >= pos.stopPrice;
      const hitTake = pos.side === 'long' ? bar.h >= pos.takePrice : bar.l <= pos.takePrice;
      const barsHeld = Math.round((bar.t - pos.openedBarT) / tfMs(this.o.timeframe));
      let exitPrice: number | null = null;
      let reason = '';
      if (hitStop) { exitPrice = pos.stopPrice; reason = 'stop'; }
      else if (hitTake) { exitPrice = pos.takePrice; reason = 'take'; }
      else if (barsHeld >= this.o.maxBarsInTrade) { exitPrice = bar.c; reason = 'timeout'; }
      if (exitPrice != null) await this.closePosition(exitPrice, reason);
    }

    // 2. checa circuit breakers antes de considerar nova entrada
    const ddFromPeak = (this.state.peakEquity - this.state.equity) / this.state.peakEquity;
    if (ddFromPeak >= this.o.risk.maxDrawdownStop) {
      this.state.halted = true;
      this.state.haltReason = `drawdown ${(ddFromPeak * 100).toFixed(1)}% atingiu o limite`;
      this.log(`### DESLIGADO: ${this.state.haltReason}`);
      return;
    }
    const dayLoss = (this.state.dayStartEquity - this.state.equity) / this.state.dayStartEquity;
    if (dayLoss >= this.o.risk.dailyLossLimit) {
      this.log(`perda diaria ${(dayLoss * 100).toFixed(1)}% atingiu o limite. Sem novas entradas hoje.`);
      return;
    }

    // 3. sinal
    if (this.state.position || i < this.o.strategy.warmup) return;
    const sig = this.o.strategy.onBar(bars, i);
    if (!sig) return;

    // 4. filtro de ML
    if (this.o.mlModel && this.o.mlThreshold != null) {
      const names = this.o.mlModel.featureNames;
      const row = names.map((n) =>
        n === 'isLong' ? (sig.side === 'long' ? 1 : 0) : (sig.features?.[n] ?? 0),
      );
      const p = this.o.mlModel.predictProba(row);
      if (p < this.o.mlThreshold) {
        this.log(`sinal ${sig.side} descartado pelo ML (p=${p.toFixed(3)} < ${this.o.mlThreshold})`);
        return;
      }
      this.log(`sinal ${sig.side} aprovado pelo ML (p=${p.toFixed(3)})`);
    }

    // ── risco dinâmico: catraca + piso móvel ────────────────────────────────
    // A catraca decide pelo PICO já atingido, não pelo equity atual, para que
    // uma queda temporária não devolva a conta ao modo agressivo justamente na
    // hora ruim.
    let riskPerTrade = this.o.ratchet
      ? ratchetRisk(this.state.peakEquity, this.o.ratchet)
      : this.o.risk.riskPerTrade;
    if (this.o.useFloor) {
      riskPerTrade = floorAdjust(this.state.equity, this.state.peakEquity, riskPerTrade);
    }

    // ── dimensionamento por volatilidade prevista ───────────────────────────
    // Não remove trade nenhum: só encolhe o tamanho quando a volatilidade
    // prevista está acima do normal e aumenta quando está abaixo.
    let volMult = 1;
    if (this.o.volTargeting) {
      const vf = forecastVolatility(bars);
      const vt = targetVolatility(vf);
      volMult = volSizeMultiplier(vf, i, vt);
    }

    const effRisk = riskPerTrade * volMult;
    const sized = sizePosition(this.state.equity, sig.stopPct, this.o.cost, {
      ...this.o.risk,
      riskPerTrade: effRisk,
    });
    if (sized.notional <= 0) {
      this.log(`sinal ignorado: ${sized.reason}`);
      return;
    }
    this.log(
      `dimensionamento: risco base ${(riskPerTrade * 100).toFixed(2)}% ` +
        `(pico US$ ${this.state.peakEquity.toFixed(2)})` +
        (this.o.volTargeting ? ` × vol ${volMult.toFixed(2)}x` : '') +
        ` = ${(effRisk * 100).toFixed(2)}% → notional US$ ${sized.notional.toFixed(2)}`,
    );
    // Entrada no proximo preco disponivel, replicando "abertura da proxima barra".
    const ticker = await this.ex.fetchTicker(this.o.symbol);
    const ref = ticker.last ?? bar.c;
    await this.openPosition(sig.side, ref, sized.notional, sig.stopPct, sig.takePct, bar.t);
  }

  private async openPosition(side: Side, refPrice: number, notional: number, stopPct: number, takePct: number, barT: number) {
    const entryPrice = side === 'long' ? refPrice * (1 + this.o.cost.slippage) : refPrice * (1 - this.o.cost.slippage);
    const qty = notional / entryPrice;

    if (this.o.mode !== 'paper') {
      const order = await this.ex.createOrder(this.o.symbol, 'market', side === 'long' ? 'buy' : 'sell', qty);
      this.log(`ordem enviada (${this.o.mode}): ${JSON.stringify({ id: order.id, side, qty })}`);
    }

    this.state.position = {
      side, entryPrice, qty, notional,
      stopPrice: side === 'long' ? entryPrice * (1 - stopPct) : entryPrice * (1 + stopPct),
      // teto de 0,95 no lado short: takePct >= 1 gerava preço-alvo negativo
      // (inalcançável) — ver mesma correção em backtest/engine.ts
      takePrice: side === 'long' ? entryPrice * (1 + takePct) : entryPrice * (1 - Math.min(takePct, 0.95)),
      openedAt: Date.now(),
      openedBarT: barT,
    };
    this.state.equity -= notional * this.o.cost.takerFee;
    this.log(
      `ABRIU ${side} ${this.o.symbol} @ ${entryPrice.toFixed(4)} notional $${notional.toFixed(2)} ` +
        `stop ${this.state.position.stopPrice.toFixed(4)} alvo ${this.state.position.takePrice.toFixed(4)}`,
    );
    this.saveState();
  }

  private async closePosition(refPrice: number, reason: string) {
    const pos = this.state.position!;
    const fill = pos.side === 'long' ? refPrice * (1 - this.o.cost.slippage) : refPrice * (1 + this.o.cost.slippage);

    if (this.o.mode !== 'paper') {
      const order = await this.ex.createOrder(
        this.o.symbol, 'market', pos.side === 'long' ? 'sell' : 'buy', pos.qty,
        undefined, { reduceOnly: true },
      );
      this.log(`ordem de saida enviada (${this.o.mode}): ${order.id}`);
    }

    const gross = pos.side === 'long' ? (fill - pos.entryPrice) * pos.qty : (pos.entryPrice - fill) * pos.qty;
    const exitFee = fill * pos.qty * this.o.cost.takerFee;
    const pnl = gross - exitFee;
    this.state.equity += pnl;
    this.state.peakEquity = Math.max(this.state.peakEquity, this.state.equity);
    this.state.closedTrades++;
    if (pnl > 0) this.state.wins++;
    this.state.position = null;

    this.log(
      `FECHOU (${reason}) @ ${fill.toFixed(4)}  pnl $${pnl.toFixed(4)}  equity $${this.state.equity.toFixed(2)}  ` +
        `trades ${this.state.closedTrades} win% ${((this.state.wins / this.state.closedTrades) * 100).toFixed(1)}`,
    );
    this.saveState();
  }

  getState(): LiveState {
    return { ...this.state };
  }
}
