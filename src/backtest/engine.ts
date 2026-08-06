/**
 * Motor de backtest barra-a-barra.
 *
 * Regras que existem especificamente para nao mentir para nos mesmos:
 *
 * 1. Sinal na barra i executa na ABERTURA da barra i+1. A estrategia nunca
 *    negocia dentro da barra que ela mesma usou para decidir.
 * 2. Taxa taker nos dois lados + slippage no preco nos dois lados. Em scalp de
 *    5min com alvo de 3%, ignorar isso muda o resultado de lucro para prejuizo.
 * 3. Quando a mesma barra toca stop E alvo, assumimos o STOP. Sem dados de tick
 *    nao da para saber a ordem, e o erro otimista aqui e o unico erro que
 *    quebra conta de verdade.
 * 4. Uma posicao por vez. Nada de empilhar 8 entradas correlacionadas e chamar
 *    de diversificacao.
 * 5. Circuit breakers de perda diaria e drawdown maximo param o backtest do
 *    mesmo jeito que parariam a conta real.
 */
import type {
  Bar,
  BacktestConfig,
  BacktestResult,
  ExitReason,
  Series,
  Strategy,
  Trade,
} from '../core/types.ts';
import { tfMs } from '../data/store.ts';

interface OpenPosition {
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
  features?: Record<string, number>;
  /** stop movel, se a estrategia pediu */
  trailPct?: number;
  trailArmPct?: number;
  trailArmed: boolean;
  /** melhor preco alcancado a favor do trade, para a catraca do stop */
  bestPrice: number;
}

function dayKey(t: number): number {
  return Math.floor(t / 86_400_000);
}

/**
 * Calcula o tamanho da posicao. Risco fixo fracionario: o tamanho e escolhido
 * para que TOCAR O STOP custe exatamente `riskPerTrade` do equity atual.
 * E dai que vem a bola de neve: o notional cresce com o equity sozinho, sem
 * nenhuma decisao discricionaria, e encolhe automaticamente numa sequencia ruim.
 */
export function sizePosition(
  equity: number,
  stopPct: number,
  cost: { takerFee: number; slippage: number },
  risk: { riskPerTrade: number; maxLeverage: number; minNotional: number },
): { notional: number; reason?: string } {
  // A perda no stop nao e so stopPct: tem fee de entrada, fee de saida e
  // slippage nos dois lados. Ignorar isso faz o risco real ser maior que o alvo.
  const roundTripCost = 2 * cost.takerFee + 2 * cost.slippage;
  const lossPerUnit = stopPct + roundTripCost;
  if (lossPerUnit <= 0) return { notional: 0, reason: 'stop invalido' };

  let notional = (equity * risk.riskPerTrade) / lossPerUnit;
  const cap = equity * risk.maxLeverage;
  if (notional > cap) notional = cap;

  if (notional < risk.minNotional) {
    return { notional: 0, reason: `notional ${notional.toFixed(2)} abaixo do minimo ${risk.minNotional}` };
  }
  return { notional };
}

export function runBacktest(series: Series, strategy: Strategy, cfg: BacktestConfig): BacktestResult {
  const bars = series.bars;
  const step = tfMs(series.timeframe);
  const trades: Trade[] = [];
  const equityCurve: { t: number; equity: number }[] = [];

  let equity = cfg.initialEquity;
  let peak = equity;
  let pos: OpenPosition | null = null;
  let pending: ReturnType<Strategy['onBar']> = null;

  let curDay = bars.length ? dayKey(bars[0].t) : 0;
  let dayStartEquity = equity;
  let dayBlocked = false;
  let halted: BacktestResult['haltedAt'];

  const fee = cfg.cost.takerFee;
  const slip = cfg.cost.slippage;

  for (let i = 0; i < bars.length && !halted; i++) {
    const bar = bars[i];

    // --- fronteira de dia: reseta o limite de perda diaria ---
    const d = dayKey(bar.t);
    if (d !== curDay) {
      curDay = d;
      dayStartEquity = equity;
      dayBlocked = false;
    }

    // --- 1. executa a entrada pendente na ABERTURA desta barra ---
    if (pending && !pos && !dayBlocked) {
      const sig = pending;
      const sized = sizePosition(equity, sig.stopPct, cfg.cost, cfg.risk);
      if (sized.notional > 0) {
        // slippage sempre contra nos: compra mais caro, vende mais barato
        const entryPrice = sig.side === 'long' ? bar.o * (1 + slip) : bar.o * (1 - slip);
        const qty = sized.notional / entryPrice;
        pos = {
          side: sig.side,
          entryTime: bar.t,
          entryPrice,
          entryIndex: i,
          stopPrice:
            sig.side === 'long' ? entryPrice * (1 - sig.stopPct) : entryPrice * (1 + sig.stopPct),
          // short com takePct >= 1 (ex.: ts-momentum de alvo largo, 5.0) dava
          // preço-alvo NEGATIVO — matematicamente inalcançável, achado rodando
          // o modo agressivo ao vivo (35 de 40 posições nunca poderiam sair
          // por alvo). O teto de 0,95 preserva "alvo bem largo, quase nunca
          // bate" sem virar impossível — o preço só pode cair até 5% do
          // valor de entrada, nunca menos.
          takePrice:
            sig.side === 'long' ? entryPrice * (1 + sig.takePct) : entryPrice * (1 - Math.min(sig.takePct, 0.95)),
          qty,
          notional: sized.notional,
          entryFee: sized.notional * fee,
          equityAtEntry: equity,
          features: sig.features,
          trailPct: sig.trailPct,
          trailArmPct: sig.trailArmPct,
          trailArmed: false,
          bestPrice: entryPrice,
        };
      }
    }
    pending = null;

    // --- 2. gerencia a posicao aberta contra o range DESTA barra ---
    if (pos) {
      const barsHeld = i - pos.entryIndex;
      let exitPrice: number | null = null;
      let reason: ExitReason | null = null;

      // --- stop movel (catraca) ---
      // A ordem importa: o stop e atualizado com o extremo DESTA barra ANTES
      // de checar se foi tocado. Fazer o contrario deixaria o stop antigo
      // capturar o movimento e depois "descobrir" que ja tinha subido, o que
      // e uma forma sutil de olhar para o futuro.
      //
      // O stop so sobe (long) ou desce (short). Nunca volta atras -- e por
      // isso que se chama catraca.
      if (pos.trailPct && i > pos.entryIndex) {
        const extremo = pos.side === 'long' ? bar.h : bar.l;
        pos.bestPrice = pos.side === 'long'
          ? Math.max(pos.bestPrice, extremo)
          : Math.min(pos.bestPrice, extremo);

        const avanco = pos.side === 'long'
          ? pos.bestPrice / pos.entryPrice - 1
          : 1 - pos.bestPrice / pos.entryPrice;

        if (!pos.trailArmed && avanco >= (pos.trailArmPct ?? 0)) pos.trailArmed = true;

        if (pos.trailArmed) {
          const novo = pos.side === 'long'
            ? pos.bestPrice * (1 - pos.trailPct)
            : pos.bestPrice * (1 + pos.trailPct);
          pos.stopPrice = pos.side === 'long'
            ? Math.max(pos.stopPrice, novo)
            : Math.min(pos.stopPrice, novo);
        }
      }

      const hitStop = pos.side === 'long' ? bar.l <= pos.stopPrice : bar.h >= pos.stopPrice;
      const hitTake = pos.side === 'long' ? bar.h >= pos.takePrice : bar.l <= pos.takePrice;

      if (barsHeld > 0 || i > pos.entryIndex) {
        if (hitStop && hitTake) {
          // ambiguidade intrabar: sem ticks, escolhemos o lado pessimista
          exitPrice = cfg.pessimisticIntrabar ? pos.stopPrice : pos.takePrice;
          reason = cfg.pessimisticIntrabar ? 'stop' : 'take';
        } else if (hitStop) {
          // gap: se a barra ABRIU alem do stop, saimos na abertura, pior preco
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
        const exitNotional = fill * pos.qty;
        const exitFee = exitNotional * fee;

        const hoursHeld = (barsHeld * step) / 3_600_000;
        const funding = cfg.cost.fundingPer8h
          ? pos.notional * cfg.cost.fundingPer8h * (hoursHeld / 8)
          : 0;

        const gross =
          pos.side === 'long'
            ? (fill - pos.entryPrice) * pos.qty
            : (pos.entryPrice - fill) * pos.qty;
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
          features: pos.features,
        });
        pos = null;

        // --- circuit breakers, avaliados apos cada trade fechado ---
        if (equity <= 0) {
          halted = { t: bar.t, reason: 'conta zerada' };
        } else if ((peak - equity) / peak >= cfg.risk.maxDrawdownStop) {
          halted = {
            t: bar.t,
            reason: `drawdown maximo atingido (${((peak - equity) / peak * 100).toFixed(1)}%)`,
          };
        } else if ((dayStartEquity - equity) / dayStartEquity >= cfg.risk.dailyLossLimit) {
          dayBlocked = true;
        }
      }
    }

    // --- 3. estrategia decide, para executar na PROXIMA barra ---
    if (!pos && !pending && !dayBlocked && !halted && i >= strategy.warmup && i < bars.length - 1) {
      pending = strategy.onBar(bars, i);
    }

    equityCurve.push({ t: bar.t, equity });
  }

  return { trades, equityCurve, finalEquity: equity, haltedAt: halted };
}
