/**
 * Metricas. Alem das usuais, calcula as que efetivamente decidem se uma
 * estrategia pode receber dinheiro: Sharpe deflacionado (corrige o Sharpe pelo
 * numero de tentativas), risco de ruina e o custo total pago em taxas.
 */
import type { BacktestResult, Trade } from '../core/types.ts';

export interface Metrics {
  trades: number;
  winRate: number;
  profitFactor: number;
  expectancyR: number;
  totalReturn: number;
  cagr: number;
  maxDrawdown: number;
  maxDrawdownDurationDays: number;
  sharpe: number;
  sortino: number;
  calmar: number;
  avgWin: number;
  avgLoss: number;
  longestLossStreak: number;
  totalFeesPaid: number;
  feesAsPctOfGross: number;
  grossProfit: number;
  netProfit: number;
  finalEquity: number;
  halted?: string;
  exitBreakdown: Record<string, number>;
}

function stdev(x: number[]): number {
  if (x.length < 2) return 0;
  const m = x.reduce((a, b) => a + b, 0) / x.length;
  return Math.sqrt(x.reduce((a, b) => a + (b - m) ** 2, 0) / (x.length - 1));
}

function maxDrawdown(curve: { t: number; equity: number }[]): { dd: number; durDays: number } {
  let peak = -Infinity;
  let peakT = curve[0]?.t ?? 0;
  let dd = 0;
  let dur = 0;
  for (const p of curve) {
    if (p.equity > peak) {
      peak = p.equity;
      peakT = p.t;
    }
    const d = peak > 0 ? (peak - p.equity) / peak : 0;
    if (d > dd) dd = d;
    dur = Math.max(dur, p.t - peakT);
  }
  return { dd, durDays: dur / 86_400_000 };
}

export function computeMetrics(res: BacktestResult, initialEquity: number): Metrics {
  const t = res.trades;
  const wins = t.filter((x) => x.pnl > 0);
  const losses = t.filter((x) => x.pnl <= 0);
  const grossWin = wins.reduce((a, b) => a + b.pnl, 0);
  const grossLoss = Math.abs(losses.reduce((a, b) => a + b.pnl, 0));
  const fees = t.reduce((a, b) => a + b.cost, 0);
  const grossProfit = t.reduce((a, b) => a + b.pnl + b.cost, 0);

  const curve = res.equityCurve;
  const { dd, durDays } = maxDrawdown(curve);
  const days = curve.length ? (curve[curve.length - 1].t - curve[0].t) / 86_400_000 : 0;
  const years = days / 365.25;

  // Sharpe sobre retornos POR TRADE, anualizado pela frequencia real de trades.
  const rets = t.map((x) => x.rEquity);
  const meanR = rets.length ? rets.reduce((a, b) => a + b, 0) / rets.length : 0;
  const sd = stdev(rets);
  const tradesPerYear = years > 0 ? t.length / years : 0;
  const sharpe = sd > 0 ? (meanR / sd) * Math.sqrt(tradesPerYear) : 0;

  const downside = rets.filter((r) => r < 0);
  const dsd = stdev(downside);
  const sortino = dsd > 0 ? (meanR / dsd) * Math.sqrt(tradesPerYear) : 0;

  const totalReturn = initialEquity > 0 ? res.finalEquity / initialEquity - 1 : 0;
  const cagr = years > 0 && res.finalEquity > 0 ? (res.finalEquity / initialEquity) ** (1 / years) - 1 : 0;

  let streak = 0;
  let longest = 0;
  for (const x of t) {
    if (x.pnl <= 0) {
      streak++;
      longest = Math.max(longest, streak);
    } else streak = 0;
  }

  const exitBreakdown: Record<string, number> = {};
  for (const x of t) exitBreakdown[x.exitReason] = (exitBreakdown[x.exitReason] ?? 0) + 1;

  // Expectancy em multiplos de R (quanto se ganha por unidade de risco tomada).
  const avgWinR = wins.length ? wins.reduce((a, b) => a + b.rEquity, 0) / wins.length : 0;
  const avgLossR = losses.length ? Math.abs(losses.reduce((a, b) => a + b.rEquity, 0) / losses.length) : 0;
  const winRate = t.length ? wins.length / t.length : 0;
  const expectancyR = avgLossR > 0 ? (winRate * avgWinR - (1 - winRate) * avgLossR) / avgLossR : 0;

  return {
    trades: t.length,
    winRate,
    profitFactor: grossLoss > 0 ? grossWin / grossLoss : grossWin > 0 ? Infinity : 0,
    expectancyR,
    totalReturn,
    cagr,
    maxDrawdown: dd,
    maxDrawdownDurationDays: durDays,
    sharpe,
    sortino,
    calmar: dd > 0 ? cagr / dd : 0,
    avgWin: wins.length ? grossWin / wins.length : 0,
    avgLoss: losses.length ? -grossLoss / losses.length : 0,
    longestLossStreak: longest,
    totalFeesPaid: fees,
    feesAsPctOfGross: grossProfit !== 0 ? fees / Math.abs(grossProfit) : 0,
    grossProfit,
    netProfit: res.finalEquity - initialEquity,
    finalEquity: res.finalEquity,
    halted: res.haltedAt?.reason,
    exitBreakdown,
  };
}

/**
 * Sharpe deflacionado (Bailey & Lopez de Prado). Se voce testou 500 combinacoes
 * de parametros, o melhor Sharpe que voce achou esta inflado por sorte pura.
 * Isto corrige por isso. Abaixo de ~0.95 de probabilidade, o "edge" e ruido.
 */
export function deflatedSharpe(
  observedSharpe: number,
  nTrials: number,
  nObs: number,
  skew = 0,
  kurt = 3,
): number {
  if (nObs < 2 || nTrials < 1) return 0;
  const EULER = 0.5772156649;
  // Sharpe esperado do MELHOR de nTrials tentativas sem nenhum edge real.
  const z = (p: number) => {
    // aproximacao inversa da normal (Acklam simplificada)
    const a = [-3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2, 1.383577518672690e2, -3.066479806614716e1, 2.506628277459239];
    const b = [-5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2, 6.680131188771972e1, -1.328068155288572e1];
    const c = [-7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
    const d = [7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996, 3.754408661907416];
    const pl = 0.02425;
    let q: number, r: number;
    if (p < pl) {
      q = Math.sqrt(-2 * Math.log(p));
      return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
    }
    if (p > 1 - pl) return -z(1 - p);
    q = p - 0.5;
    r = q * q;
    return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
  };
  const maxZ = (1 - EULER) * z(1 - 1 / nTrials) + EULER * z(1 - 1 / (nTrials * Math.E));
  const sr0 = maxZ / Math.sqrt(nObs - 1);

  const denom = Math.sqrt(1 - skew * observedSharpe + ((kurt - 1) / 4) * observedSharpe ** 2);
  if (!isFinite(denom) || denom <= 0) return 0;
  const stat = ((observedSharpe - sr0) * Math.sqrt(nObs - 1)) / denom;
  // CDF normal
  const cdf = 0.5 * (1 + erf(stat / Math.SQRT2));
  return cdf;
}

function erf(x: number): number {
  const s = x < 0 ? -1 : 1;
  x = Math.abs(x);
  const a1 = 0.254829592, a2 = -0.284496736, a3 = 1.421413741, a4 = -1.453152027, a5 = 1.061405429, p = 0.3275911;
  const tt = 1 / (1 + p * x);
  const y = 1 - ((((a5 * tt + a4) * tt + a3) * tt + a2) * tt + a1) * tt * Math.exp(-x * x);
  return s * y;
}

/**
 * Risco de ruina por simulacao: qual a chance de perder `ruinPct` do capital
 * antes de dobrar, dada a distribuicao empirica de trades observada.
 */
export function riskOfRuin(trades: Trade[], ruinPct = 0.5, sims = 5000, horizon = 500): number {
  if (!trades.length) return 1;
  const rs = trades.map((t) => t.rEquity);
  let ruined = 0;
  // LCG deterministico: o mesmo backtest sempre da o mesmo numero.
  let seed = 12345;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  for (let s = 0; s < sims; s++) {
    let eq = 1;
    for (let i = 0; i < horizon; i++) {
      eq *= 1 + rs[Math.floor(rnd() * rs.length)];
      if (eq <= 1 - ruinPct) {
        ruined++;
        break;
      }
    }
  }
  return ruined / sims;
}

export function formatMetrics(m: Metrics, label = ''): string {
  const pct = (x: number) => `${(x * 100).toFixed(2)}%`;
  const L: string[] = [];
  if (label) L.push(`=== ${label} ===`);
  L.push(`Trades            ${m.trades}`);
  L.push(`Win rate          ${pct(m.winRate)}`);
  L.push(`Profit factor     ${m.profitFactor === Infinity ? 'inf' : m.profitFactor.toFixed(3)}`);
  L.push(`Expectancy        ${m.expectancyR.toFixed(3)} R`);
  L.push(`Retorno total     ${pct(m.totalReturn)}`);
  L.push(`CAGR              ${pct(m.cagr)}`);
  L.push(`Max drawdown      ${pct(m.maxDrawdown)}  (${m.maxDrawdownDurationDays.toFixed(0)} dias sob agua)`);
  L.push(`Sharpe            ${m.sharpe.toFixed(2)}`);
  L.push(`Sortino           ${m.sortino.toFixed(2)}`);
  L.push(`Calmar            ${m.calmar.toFixed(2)}`);
  L.push(`Maior seq. perdas ${m.longestLossStreak}`);
  L.push(`Lucro bruto       ${m.grossProfit.toFixed(2)}`);
  L.push(`Taxas pagas       ${m.totalFeesPaid.toFixed(2)}  (${pct(m.feesAsPctOfGross)} do bruto)`);
  L.push(`Lucro liquido     ${m.netProfit.toFixed(2)}`);
  L.push(`Equity final      ${m.finalEquity.toFixed(2)}`);
  L.push(`Saidas            ${JSON.stringify(m.exitBreakdown)}`);
  if (m.halted) L.push(`PARADO: ${m.halted}`);
  return L.join('\n');
}
