/**
 * O GESTOR DE RISCO — o único módulo com poder de veto.
 *
 * A assimetria é deliberada: o custo de barrar um trade bom é pequeno, o de
 * deixar passar um que quebra a conta é terminal. Por isso nenhum outro módulo
 * pode sobrepor este.
 *
 * ---------------------------------------------------------------------------
 * A RESTRIÇÃO DOS 100 DÓLARES
 *
 * Este arquivo existe principalmente por causa dela. Com capital pequeno o
 * limite não é a estratégia — é a aritmética da exchange.
 *
 * O tamanho da posição sai de `risco × equity ÷ distância ao stop`. Com equity
 * baixo demais esse número cai abaixo do notional mínimo (US$ 5 na Binance).
 * Aí sobram duas opções, e as duas são ruins:
 *
 *   a) não operar  — a bola de neve para
 *   b) operar assim mesmo, arriscando mais do que o plano diz
 *
 * A opção (b) é o mecanismo exato pelo qual contas pequenas morrem: o operador
 * não percebe que trocou 0,5% de risco por 3%, e uma sequência normal de 10
 * perdas vira 30% da conta em vez de 5%.
 *
 * Este módulo torna isso explícito e recusa a opção (b).
 * ---------------------------------------------------------------------------
 */
import type { CostModel, RiskConfig } from '../core/types.ts';
import type { Evidence, ResearchVerdict, RiskRuling } from './messages.ts';

export interface CapitalState {
  equity: number;
  cost: CostModel;
  risk: RiskConfig;
}

/** Tamanho da posição e o equity mínimo que o par exige para ser operável. */
export function positionMath(equity: number, stopPct: number, cost: CostModel, risk: RiskConfig) {
  const roundTrip = 2 * cost.takerFee + 2 * cost.slippage;
  const lossPerUnit = stopPct + roundTrip;
  const notional = (equity * risk.riskPerTrade) / lossPerUnit;
  const minViableEquity = (risk.minNotional * lossPerUnit) / risk.riskPerTrade;
  const leverage = notional / equity;
  return { notional, minViableEquity, leverage, lossPerUnit };
}

/**
 * Quantas posições simultâneas a conta suporta.
 *
 * Três limites, e vale o menor dos três:
 *   1. notional mínimo — cada posição precisa caber
 *   2. alavancagem — a soma dos notionais não pode estourar o limite
 *   3. risco simultâneo — a soma dos riscos não pode passar do limite diário,
 *      senão um dia ruim sozinho encosta no circuit breaker
 */
export function maxConcurrent(equity: number, stopPct: number, cost: CostModel, risk: RiskConfig): {
  limit: number;
  binding: string;
  byNotional: number;
  byLeverage: number;
  byRisk: number;
} {
  const { notional } = positionMath(equity, stopPct, cost, risk);
  const byNotional = notional >= risk.minNotional ? Math.floor(equity / (risk.minNotional / (notional / equity))) : 0;
  const byLeverage = Math.floor((equity * risk.maxLeverage) / Math.max(notional, 1e-9));
  // Nunca deixar o risco simultâneo passar de 60% do limite de perda diária:
  // sobra folga para o dia continuar operável depois de uma sequência ruim.
  const byRisk = Math.floor((risk.dailyLossLimit * 0.6) / risk.riskPerTrade);

  const limit = Math.max(0, Math.min(byNotional, byLeverage, byRisk));
  const binding =
    limit === byRisk ? 'risco simultâneo vs limite diário'
      : limit === byLeverage ? 'alavancagem máxima'
        : 'notional mínimo da exchange';
  return { limit, binding, byNotional, byLeverage, byRisk };
}

/**
 * O julgamento sobre um par aprovado pelo Pesquisador.
 * Retorna veto quando o capital simplesmente não comporta.
 */
export function rule(verdict: ResearchVerdict, state: CapitalState, assumedStopPct = 0.015): RiskRuling {
  const { equity, cost, risk } = state;
  const m = positionMath(equity, assumedStopPct, cost, risk);
  const conc = maxConcurrent(equity, assumedStopPct, cost, risk);

  const evidence: Evidence[] = [
    { metric: 'notional no equity atual', value: Number(m.notional.toFixed(2)), method: `risco ${(risk.riskPerTrade * 100).toFixed(2)}% ÷ (stop ${(assumedStopPct * 100).toFixed(1)}% + custo ida-e-volta)` },
    { metric: 'equity mínimo viável', value: Number(m.minViableEquity.toFixed(2)), method: `notional mínimo US$ ${risk.minNotional} da exchange` },
    { metric: 'alavancagem por posição', value: Number(m.leverage.toFixed(2)), method: 'notional ÷ equity' },
    { metric: 'posições simultâneas', value: conc.limit, method: `limitado por: ${conc.binding}` },
  ];

  let vetoed = false;
  let vetoReason: string | undefined;

  if (m.notional < risk.minNotional) {
    vetoed = true;
    vetoReason =
      `notional calculado US$ ${m.notional.toFixed(2)} abaixo do mínimo US$ ${risk.minNotional}. ` +
      `Este par só volta a ser operável com equity acima de US$ ${m.minViableEquity.toFixed(2)}. ` +
      `Operar assim mesmo significaria arriscar mais que ${(risk.riskPerTrade * 100).toFixed(2)}% por trade.`;
  } else if (m.leverage > risk.maxLeverage) {
    vetoed = true;
    vetoReason = `alavancagem exigida ${m.leverage.toFixed(1)}x acima do limite ${risk.maxLeverage}x.`;
  } else if (verdict.p95Drawdown > risk.maxDrawdownStop) {
    vetoed = true;
    vetoReason =
      `drawdown p95 simulado ${(verdict.p95Drawdown * 100).toFixed(1)}% excede o desligamento em ` +
      `${(risk.maxDrawdownStop * 100).toFixed(0)}%. O par bateria o circuit breaker antes de entregar o resultado.`;
  }

  return {
    from: 'risco',
    symbol: verdict.symbol,
    strategy: verdict.strategy,
    vetoed,
    vetoReason,
    riskPerTrade: risk.riskPerTrade,
    notionalAtCurrentEquity: m.notional,
    maxConcurrentPositions: conc.limit,
    minViableEquity: m.minViableEquity,
    evidence,
  };
}

/**
 * Relatório de sobrevivência do capital — responde "o que US$ 100 realmente
 * suportam?" ao longo da curva de equity, incluindo o caminho para baixo.
 */
export function capitalRunway(state: CapitalState, stopPct = 0.015): {
  equity: number;
  notional: number;
  concurrent: number;
  operable: boolean;
}[] {
  const levels = [200, 150, 100, 75, 50, 35, 25, 20, 15, 12, 10];
  return levels.map((equity) => {
    const m = positionMath(equity, stopPct, state.cost, state.risk);
    const c = maxConcurrent(equity, stopPct, state.cost, state.risk);
    return {
      equity,
      notional: Number(m.notional.toFixed(2)),
      concurrent: c.limit,
      operable: m.notional >= state.risk.minNotional,
    };
  });
}
