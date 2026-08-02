/**
 * O AUDITOR — o papel que faltava na equipe.
 *
 * Pergunta que ele responde: **o que está acontecendo de verdade bate com o
 * que o backtest prometeu?**
 *
 * Sem ele o sistema é cego. Um par aprovado continua operando até quebrar o
 * circuit breaker de drawdown, que é tarde demais e caro demais. O Auditor
 * existe para puxar o freio *antes* disso, com base em evidência estatística e
 * não em susto.
 *
 * A dificuldade real: distinguir "a estratégia parou de funcionar" de "a
 * estratégia está numa sequência ruim normal". Toda estratégia com 37% de
 * acerto passa por sequências de 10 perdas — isso é esperado, não é defeito.
 * Desligar na primeira sequência ruim é tão destrutivo quanto nunca desligar.
 *
 * A defesa contra os dois erros é comparar o realizado com a DISTRIBUIÇÃO
 * simulada do próprio backtest, não com a média. Se o resultado está dentro do
 * que o Monte Carlo previa como possível, é sequência ruim. Se está fora, é
 * outra coisa.
 */
import type { Trade } from '../core/types.ts';
import { monteCarlo } from '../validate/montecarlo.ts';

export type AuditStatus = 'SAUDAVEL' | 'OBSERVACAO' | 'REBAIXAR' | 'EVIDENCIA_INSUFICIENTE';

export interface Expectation {
  /** vem do walk-forward out-of-sample do par */
  expectancyR: number;
  /** desvio padrão do retorno por trade, em fração do equity */
  sdR: number;
  /** drawdown no percentil 95 das simulações */
  p95Drawdown: number;
  /** retorno no percentil 5 das simulações, no horizonte medido */
  p5Return: number;
  /** regimes em que o par foi aprovado, com a fração de trades em cada */
  approvedRegimes: Record<string, number>;
  /** quantos trades o backtest OOS produziu (peso da evidência original) */
  baselineTrades: number;
}

export interface Observation {
  trades: Trade[];
  /** regime vigente agora, do módulo de regime */
  currentRegime?: string;
  /** rótulo do regime em cada trade observado, se disponível */
  regimePerTrade?: string[];
}

export interface AuditFinding {
  check: string;
  passed: boolean;
  detail: string;
  /** quão grave: 0 = informativo, 1 = observação, 2 = rebaixar */
  severity: 0 | 1 | 2;
}

export interface AuditReport {
  status: AuditStatus;
  trades: number;
  realizedExpectancyR: number;
  realizedReturn: number;
  realizedMaxDrawdown: number;
  /** z-score do realizado contra o esperado. Negativo = pior que o previsto. */
  zScore: number;
  findings: AuditFinding[];
  recommendation: string;
}

/** Constrói a expectativa a partir dos trades do walk-forward OOS. */
export function buildExpectation(
  oosTrades: Trade[],
  ddStop: number,
  regimePerTrade?: string[],
): Expectation {
  const rs = oosTrades.map((t) => t.rEquity);
  const mean = rs.reduce((a, b) => a + b, 0) / (rs.length || 1);
  const sd = Math.sqrt(rs.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(1, rs.length - 1));
  const mc = monteCarlo(oosTrades, { sims: 5000, ddStop });

  const approvedRegimes: Record<string, number> = {};
  if (regimePerTrade?.length) {
    for (const r of regimePerTrade) approvedRegimes[r] = (approvedRegimes[r] ?? 0) + 1;
    for (const k of Object.keys(approvedRegimes)) approvedRegimes[k] /= regimePerTrade.length;
  }

  // expectancy em multiplos de R, para ser comparavel entre pares
  const wins = rs.filter((r) => r > 0);
  const losses = rs.filter((r) => r <= 0);
  const avgWin = wins.length ? wins.reduce((a, b) => a + b, 0) / wins.length : 0;
  const avgLoss = losses.length ? Math.abs(losses.reduce((a, b) => a + b, 0) / losses.length) : 1;
  const wr = wins.length / (rs.length || 1);

  return {
    expectancyR: avgLoss > 0 ? (wr * avgWin - (1 - wr) * avgLoss) / avgLoss : 0,
    sdR: sd,
    p95Drawdown: mc.p95MaxDd,
    p5Return: mc.p5Return,
    approvedRegimes,
    baselineTrades: oosTrades.length,
  };
}

function maxDrawdown(trades: Trade[]): number {
  let eq = 1, peak = 1, dd = 0;
  for (const t of trades) {
    eq *= 1 + t.rEquity;
    if (eq > peak) peak = eq;
    dd = Math.max(dd, (peak - eq) / peak);
  }
  return dd;
}

/**
 * Auditoria. Cinco checagens, cada uma com um erro específico que ela previne.
 */
export function audit(
  expected: Expectation,
  observed: Observation,
  opts: { minTrades?: number; watchZ?: number; downgradeZ?: number } = {},
): AuditReport {
  const minTrades = opts.minTrades ?? 25;
  const watchZ = opts.watchZ ?? -1.5;
  const downgradeZ = opts.downgradeZ ?? -2.5;

  const t = observed.trades;
  const n = t.length;
  const rs = t.map((x) => x.rEquity);
  const realizedReturn = rs.reduce((acc, r) => acc * (1 + r), 1) - 1;
  const realizedDd = maxDrawdown(t);

  const wins = rs.filter((r) => r > 0);
  const losses = rs.filter((r) => r <= 0);
  const avgWin = wins.length ? wins.reduce((a, b) => a + b, 0) / wins.length : 0;
  const avgLoss = losses.length ? Math.abs(losses.reduce((a, b) => a + b, 0) / losses.length) : 1;
  const wr = n ? wins.length / n : 0;
  const realizedExpR = avgLoss > 0 ? (wr * avgWin - (1 - wr) * avgLoss) / avgLoss : 0;

  const findings: AuditFinding[] = [];

  // --- 0. Evidência mínima. Julgar cedo demais é o erro mais comum. ---
  if (n < minTrades) {
    return {
      status: 'EVIDENCIA_INSUFICIENTE',
      trades: n,
      realizedExpectancyR: realizedExpR,
      realizedReturn,
      realizedMaxDrawdown: realizedDd,
      zScore: 0,
      findings: [{
        check: 'evidencia-minima',
        passed: false,
        severity: 0,
        detail: `${n} trades observados, mínimo ${minTrades}. Uma sequência ruim de 10 perdas é normal numa estratégia de 37% de acerto — julgar agora é ruído.`,
      }],
      recommendation: `Continuar operando e reavaliar em ${minTrades - n} trades.`,
    };
  }

  // --- 1. O realizado está dentro do que a simulação previa? ---
  // Erro do teste do meio da média: uma média realizada abaixo da esperada é
  // esperada metade das vezes. O que importa é quantos desvios abaixo.
  const meanExpected = expected.expectancyR * (expected.sdR > 0 ? 1 : 1);
  const seMean = expected.sdR / Math.sqrt(n);
  const meanRealized = rs.reduce((a, b) => a + b, 0) / n;
  const meanExpectedAbs = (expected.expectancyR * avgLoss) || 0;
  const z = seMean > 0 ? (meanRealized - meanExpectedAbs) / seMean : 0;

  findings.push({
    check: 'expectancy-vs-esperado',
    passed: z > watchZ,
    severity: z <= downgradeZ ? 2 : z <= watchZ ? 1 : 0,
    detail:
      `expectancy realizada ${realizedExpR.toFixed(3)}R contra ${expected.expectancyR.toFixed(3)}R esperada ` +
      `(z = ${z.toFixed(2)}; abaixo de ${downgradeZ} rebaixa, abaixo de ${watchZ} observa)`,
  });

  // --- 2. Drawdown além do p95 simulado ---
  findings.push({
    check: 'drawdown-vs-p95',
    passed: realizedDd <= expected.p95Drawdown,
    severity: realizedDd > expected.p95Drawdown * 1.25 ? 2 : realizedDd > expected.p95Drawdown ? 1 : 0,
    detail:
      `drawdown realizado ${(realizedDd * 100).toFixed(1)}% contra p95 simulado de ` +
      `${(expected.p95Drawdown * 100).toFixed(1)}%`,
  });

  // --- 3. Retorno abaixo do cenário pessimista ---
  // Se estamos abaixo do p5, ou tivemos muito azar ou o modelo está errado.
  // Nos dois casos a resposta prudente é a mesma.
  const belowP5 = realizedReturn < expected.p5Return;
  findings.push({
    check: 'retorno-vs-p5',
    passed: !belowP5,
    severity: belowP5 ? 2 : 0,
    detail:
      `retorno realizado ${(realizedReturn * 100).toFixed(1)}% contra cenário p5 de ` +
      `${(expected.p5Return * 100).toFixed(1)}%` +
      (belowP5 ? ' — abaixo do que 95% das simulações previam' : ''),
  });

  // --- 4. Mudança de regime ---
  // A estratégia foi aprovada operando certos regimes. Se o mercado mudou para
  // um regime em que ela quase não foi testada, o backtest não fala sobre isto.
  if (observed.currentRegime && Object.keys(expected.approvedRegimes).length) {
    const share = expected.approvedRegimes[observed.currentRegime] ?? 0;
    findings.push({
      check: 'regime-atual',
      passed: share >= 0.1,
      severity: share < 0.05 ? 1 : 0,
      detail:
        `regime atual "${observed.currentRegime}" representou ${(share * 100).toFixed(0)}% dos trades na aprovação` +
        (share < 0.05 ? ' — o par praticamente não foi testado neste ambiente' : ''),
    });
  }

  // --- 5. Sequência de perdas fora do previsto ---
  let streak = 0, worst = 0;
  for (const r of rs) { if (r <= 0) { streak++; worst = Math.max(worst, streak); } else streak = 0; }
  // Sequência esperada de perdas em n trades com taxa de acerto wr.
  const pLoss = 1 - wr;
  const expectedStreak = pLoss > 0 && pLoss < 1 ? Math.log(n) / -Math.log(pLoss) : 0;
  findings.push({
    check: 'sequencia-de-perdas',
    passed: worst <= expectedStreak * 1.8,
    severity: worst > expectedStreak * 2.2 ? 1 : 0,
    detail: `maior sequência de perdas ${worst}, esperada ~${expectedStreak.toFixed(0)} para ${n} trades a ${(wr * 100).toFixed(0)}% de acerto`,
  });

  const maxSeverity = Math.max(...findings.map((f) => f.severity));
  const status: AuditStatus = maxSeverity === 2 ? 'REBAIXAR' : maxSeverity === 1 ? 'OBSERVACAO' : 'SAUDAVEL';

  const failed = findings.filter((f) => f.severity > 0);
  const recommendation =
    status === 'REBAIXAR'
      ? `REBAIXAR e disparar nova varredura. Motivo: ${failed.filter((f) => f.severity === 2).map((f) => f.check).join(', ')}.`
      : status === 'OBSERVACAO'
        ? `Manter operando com atenção. Sinais fracos em: ${failed.map((f) => f.check).join(', ')}. Reavaliar em 25 trades.`
        : 'Manter. O realizado está dentro do previsto.';

  return {
    status,
    trades: n,
    realizedExpectancyR: realizedExpR,
    realizedReturn,
    realizedMaxDrawdown: realizedDd,
    zScore: z,
    findings,
    recommendation,
  };
}

/**
 * Auditoria em janela móvel — replica o Auditor rodando ao longo do histórico,
 * para responder "quando ele teria puxado o freio?".
 *
 * Serve para validar o próprio Auditor antes de confiar nele: um auditor que
 * rebaixa cedo demais destrói estratégias boas; um que rebaixa tarde demais
 * não serve para nada.
 */
export function replayAudit(
  expected: Expectation,
  trades: Trade[],
  window = 40,
  step = 10,
): { atTrade: number; date: string; status: AuditStatus; z: number; return: number }[] {
  const out: { atTrade: number; date: string; status: AuditStatus; z: number; return: number }[] = [];
  for (let end = window; end <= trades.length; end += step) {
    const slice = trades.slice(end - window, end);
    const r = audit(expected, { trades: slice }, { minTrades: Math.min(25, window) });
    out.push({
      atTrade: end,
      date: new Date(trades[end - 1].exitTime).toISOString().slice(0, 10),
      status: r.status,
      z: r.zScore,
      return: r.realizedReturn,
    });
  }
  return out;
}
