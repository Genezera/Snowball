/**
 * Quanto capital minimo faz sentido, e quanto tempo leva a bola de neve.
 *
 * Este arquivo existe porque "comeco com o minimo possivel" tem uma resposta
 * matematica concreta, e ela nao e "o minimo que a exchange deixa depositar".
 *
 * A restricao real: o tamanho da posicao e `risco * equity / distancia ao stop`.
 * Com equity pequeno demais, esse numero fica abaixo do notional minimo da
 * exchange. Ai voce tem duas opcoes ruins: nao operar, ou operar com risco
 * maior do que planejou. A segunda e como as contas pequenas morrem.
 */
import { sizePosition } from '../backtest/engine.ts';
import type { CostModel, RiskConfig } from '../core/types.ts';

export interface CapitalAnalysis {
  minViableEquity: number;
  riskPerTradeAtMin: number;
  notionalAtMin: number;
  leverageAtMin: number;
  warning?: string;
}

/**
 * Menor equity para o qual o tamanho calculado pelo risco alvo ainda atinge o
 * notional minimo da exchange, sem estourar a alavancagem.
 */
export function minViableCapital(
  stopPct: number,
  cost: CostModel,
  risk: RiskConfig,
): CapitalAnalysis {
  const roundTrip = 2 * cost.takerFee + 2 * cost.slippage;
  const lossPerUnit = stopPct + roundTrip;
  // notional = equity * risk / lossPerUnit >= minNotional
  const minEquity = (risk.minNotional * lossPerUnit) / risk.riskPerTrade;
  const notional = (minEquity * risk.riskPerTrade) / lossPerUnit;
  const lev = notional / minEquity;

  let warning: string | undefined;
  if (lev > risk.maxLeverage) {
    warning = `o tamanho exigido usa ${lev.toFixed(1)}x, acima do limite de ${risk.maxLeverage}x. Aumente o stop ou o capital.`;
  }
  return {
    minViableEquity: minEquity,
    riskPerTradeAtMin: minEquity * risk.riskPerTrade,
    notionalAtMin: notional,
    leverageAtMin: lev,
    warning,
  };
}

/**
 * Simula a bola de neve. Com risco fracionario o crescimento e geometrico, mas
 * duas coisas o freiam e nenhum video menciona: (1) trades que nao cabem no
 * notional minimo sao PERDIDOS quando o equity esta baixo, e (2) o drawdown
 * reduz o tamanho, o que atrasa a recuperacao.
 */
export function simulateSnowball(opts: {
  startEquity: number;
  expectancyR: number;
  /** desvio padrao do retorno por trade, em R */
  volR: number;
  tradesPerMonth: number;
  months: number;
  stopPct: number;
  cost: CostModel;
  risk: RiskConfig;
  sims?: number;
  /** quanto voce saca por mes, em fracao do equity */
  monthlyWithdrawal?: number;
}): {
  medianFinal: number;
  p5Final: number;
  p95Final: number;
  pRuin: number;
  pSkippedTrades: number;
  monthlyMedian: number[];
} {
  const sims = opts.sims ?? 3000;
  const totalTrades = Math.round(opts.tradesPerMonth * opts.months);
  let seed = 20260731;
  const rnd = () => {
    seed ^= seed << 13; seed >>>= 0;
    seed ^= seed >> 17;
    seed ^= seed << 5; seed >>>= 0;
    return seed / 4294967296;
  };
  // Box-Muller para retornos normais em unidades de R
  const gauss = () => {
    const u = Math.max(1e-9, rnd());
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rnd());
  };

  const finals: number[] = [];
  const monthly: number[][] = Array.from({ length: opts.months + 1 }, () => []);
  let ruins = 0;
  let skipped = 0;
  let attempted = 0;

  for (let s = 0; s < sims; s++) {
    let eq = opts.startEquity;
    let peak = eq;
    let ruined = false;
    monthly[0].push(eq);

    for (let m = 1; m <= opts.months && !ruined; m++) {
      for (let k = 0; k < opts.tradesPerMonth; k++) {
        attempted++;
        const sized = sizePosition(eq, opts.stopPct, opts.cost, opts.risk);
        if (sized.notional <= 0) {
          skipped++;
          continue; // conta pequena demais: o trade simplesmente nao acontece
        }
        const rMultiple = opts.expectancyR + opts.volR * gauss();
        eq += rMultiple * (eq * opts.risk.riskPerTrade);
        if (eq > peak) peak = eq;
        if (eq <= 0 || (peak - eq) / peak >= opts.risk.maxDrawdownStop) {
          ruined = true;
          break;
        }
      }
      if (opts.monthlyWithdrawal) eq *= 1 - opts.monthlyWithdrawal;
      monthly[m].push(eq);
    }
    if (ruined) ruins++;
    finals.push(eq);
  }

  finals.sort((a, b) => a - b);
  const q = (arr: number[], p: number) => {
    const sorted = [...arr].sort((x, y) => x - y);
    return sorted[Math.floor((sorted.length - 1) * p)] ?? 0;
  };

  return {
    medianFinal: q(finals, 0.5),
    p5Final: q(finals, 0.05),
    p95Final: q(finals, 0.95),
    pRuin: ruins / sims,
    pSkippedTrades: attempted ? skipped / attempted : 0,
    monthlyMedian: monthly.map((m) => q(m, 0.5)),
  };
}
