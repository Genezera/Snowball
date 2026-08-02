/**
 * Alocador adaptativo de estrategias.
 *
 * O problema que ele resolve: as 5 estrategias nao sao intercambiaveis.
 * `momentum-breakout` e `body-breakout` precisam que o mercado ANDE.
 * `zscore-dip` e `vwma-dip` precisam que ele VOLTE. Rodar todas o tempo todo
 * significa que metade esta sempre no ambiente errado.
 *
 * Como funciona:
 *
 *  1. Treino: roda cada estrategia sozinha sobre o historico e guarda, para
 *     cada trade, as features de REGIME no momento da entrada e o R obtido.
 *  2. Um modelo por estrategia aprende P(este trade da lucro | regime atual).
 *  3. Inferencia: quando varias estrategias sinalizam na mesma barra, cada uma
 *     e pontuada pelo SEU modelo com o regime daquele instante. O alocador
 *     escolhe a de maior R esperado, e so entra se passar de um limiar.
 *
 * A escolha de projeto que importa: o modelo preve o R esperado usando o
 * payoff historico DA PROPRIA estrategia (avgWin/avgLoss medidos em treino),
 * nao um payoff generico. Uma estrategia com 30% de acerto e alvo 3x pode ser
 * melhor que outra com 60% e alvo 1x, e o alocador precisa enxergar isso.
 *
 * O que ele NAO faz: prever direcao. Direcao continua sendo decisao da
 * estrategia. O alocador so decide QUAL estrategia merece o capital agora.
 */
import type { Bar, Series, Strategy, Trade } from '../core/types.ts';
import type { BacktestConfig } from '../core/types.ts';
import { runBacktest } from '../backtest/engine.ts';
import { buildRegimeContext, type RegimeContext } from './regime.ts';
import { GBDT, auc, type GBDTParams } from './gbdt.ts';

export interface StrategyModel {
  name: string;
  model: GBDT;
  /** payoff historico medido no treino, em unidades de R do equity */
  avgWin: number;
  avgLoss: number;
  baseRate: number;
  trainTrades: number;
  /** undefined quando nao houve amostra suficiente para medir */
  trainAuc?: number;
  /** se false, o alocador ignora a previsao do modelo e usa a taxa-base */
  modelTrusted: boolean;
  /** expectancy da estrategia sozinha no treino, em multiplos de R */
  expR: number;
}

export interface AllocatorConfig {
  /** R esperado minimo para valer a pena entrar. Abaixo disso, fica de fora. */
  minExpectedR: number;
  /**
   * Expectancy minima que a estrategia precisa ter tido SOZINHA na janela de
   * treino para sequer entrar no pool.
   *
   * Isto e a licao mais cara deste modulo. Na primeira versao o pool aceitava
   * qualquer estrategia e o alocador escolheu `ma-cross` em 753 de 944 trades,
   * terminando em -39% enquanto a melhor isolada fazia +9,6%. A causa: pedir a
   * um modelo que "cronometre" uma estrategia sem edge nenhum e pedir o
   * impossivel, e regras de ESTADO (que sinalizam quase toda barra) lotam o
   * conjunto de candidatos e sufocam as estrategias seletivas.
   *
   * A regra e simples: o alocador escolhe entre ferramentas que funcionam. Ele
   * nao conserta ferramenta quebrada.
   */
  minTrainExpectancy: number;
  /**
   * AUC minima do modelo da estrategia, medida em holdout do proprio treino.
   * Abaixo disso o modelo nao distingue trade bom de ruim e nao deve ter voto.
   */
  minModelAuc: number;
  gbdt?: Partial<GBDTParams>;
}

export const DEFAULT_ALLOCATOR: AllocatorConfig = {
  minExpectedR: 0.0005,
  minTrainExpectancy: 0.02,
  minModelAuc: 0.52,
  gbdt: { nTrees: 100, maxDepth: 3, learningRate: 0.05, minSamplesLeaf: 30, lambda: 8 },
};

/** Mapa de epoch ms -> indice da barra, para localizar o regime de cada trade. */
function timeIndex(bars: Bar[]): Map<number, number> {
  const m = new Map<number, number>();
  for (let i = 0; i < bars.length; i++) m.set(bars[i].t, i);
  return m;
}

/**
 * Coleta o dataset de treino: roda cada estrategia isolada e casa cada trade
 * com o regime vigente na barra de entrada.
 *
 * Os circuit breakers sao desligados aqui de proposito -- precisamos de TODOS
 * os sinais historicos para treinar, nao so os que aconteceram antes de a conta
 * ser desligada. Eles voltam na simulacao de validacao.
 */
export function collectTrainingData(
  series: Series,
  strategies: Strategy[],
  cfg: BacktestConfig,
  ctx: RegimeContext,
): Map<string, { X: number[][]; y: number[]; r: number[]; trades: Trade[] }> {
  const idx = timeIndex(series.bars);
  const collectCfg: BacktestConfig = {
    ...cfg,
    risk: { ...cfg.risk, maxDrawdownStop: 1, dailyLossLimit: 1 },
  };

  const out = new Map<string, { X: number[][]; y: number[]; r: number[]; trades: Trade[] }>();
  for (const s of strategies) {
    const res = runBacktest(series, s, collectCfg);
    const X: number[][] = [];
    const y: number[] = [];
    const r: number[] = [];
    const trades: Trade[] = [];
    for (const t of res.trades) {
      const i = idx.get(t.entryTime);
      if (i == null || !ctx.rows[i]) continue;
      // O lado entra como feature: o regime que favorece long nao e
      // necessariamente o que favorece short.
      X.push([...ctx.rows[i], t.side === 'long' ? 1 : 0]);
      y.push(t.pnl > 0 ? 1 : 0);
      r.push(t.rEquity);
      trades.push(t);
    }
    out.set(s.name, { X, y, r, trades });
  }
  return out;
}

/** Treina um modelo por estrategia. Estrategias com poucos trades ficam de fora. */
export function trainAllocator(
  data: Map<string, { X: number[][]; y: number[]; r: number[]; trades: Trade[] }>,
  featureNames: string[],
  acfg: AllocatorConfig = DEFAULT_ALLOCATOR,
  minTrades = 120,
): Map<string, StrategyModel> {
  const models = new Map<string, StrategyModel>();
  const names = [...featureNames, 'isLong'];

  for (const [name, d] of data) {
    if (d.X.length < minTrades) continue;
    const pos = d.y.reduce((a, b) => a + b, 0);
    const rate = pos / d.y.length;
    if (rate < 0.05 || rate > 0.95) continue;

    const wins = d.r.filter((x) => x > 0);
    const losses = d.r.filter((x) => x <= 0);
    if (!wins.length || !losses.length) continue;

    const avgWin = wins.reduce((a, b) => a + b, 0) / wins.length;
    const avgLoss = Math.abs(losses.reduce((a, b) => a + b, 0) / losses.length);

    // PORTAO 1 -- a estrategia precisa funcionar sozinha no treino.
    // Expectancy em multiplos de R, comparavel entre estrategias com stops
    // diferentes. Sem este portao o alocador tenta cronometrar lixo.
    const expR = avgLoss > 0 ? (rate * avgWin - (1 - rate) * avgLoss) / avgLoss : 0;
    if (expR < acfg.minTrainExpectancy) continue;

    // PORTAO 2 -- a AUC decide se o MODELO tem voto, nao se a estrategia entra
    // no pool. As duas perguntas sao diferentes e acopla-las produzia um bug
    // perverso: estrategias com poucos trades escapavam do teste de AUC e
    // passavam por nao serem examinadas, enquanto estrategias boas com amostra
    // grande eram testadas e reprovavam. No DOT isso rejeitava a
    // `momentum-breakout` (+0,198R) e aprovava a `body-breakout` (+0,041R).
    //
    // Semantica correta:
    //   pertencer ao pool  -> depende da expectancy (portao 1)
    //   o modelo ter voto  -> depende da AUC medida (portao 2)
    // Quando nao ha amostra para medir AUC, `modelTrusted` fica false e o
    // alocador usa a taxa-base da estrategia em vez da previsao do modelo.
    const cut = Math.floor(d.X.length * 0.75);
    let trainAuc: number | undefined;
    if (cut >= 60 && d.X.length - cut >= 25) {
      const probe = new GBDT(acfg.gbdt).fit(d.X.slice(0, cut), d.y.slice(0, cut), names);
      trainAuc = auc(d.y.slice(cut), probe.predictAll(d.X.slice(cut)));
    }
    const modelTrusted = trainAuc != null && trainAuc >= acfg.minModelAuc;

    const model = new GBDT(acfg.gbdt).fit(d.X, d.y, names);
    models.set(name, {
      name, model, avgWin, avgLoss, baseRate: rate,
      trainTrades: d.X.length, trainAuc, modelTrusted, expR,
    });
  }
  return models;
}

/**
 * R esperado de um sinal, em unidades de equity.
 * p * ganho_medio - (1-p) * perda_media, usando o payoff DAQUELA estrategia.
 */
export function expectedR(m: StrategyModel, regimeRow: number[], isLong: boolean): number {
  const p = m.model.predictProba([...regimeRow, isLong ? 1 : 0]);
  return p * m.avgWin - (1 - p) * m.avgLoss;
}

export interface AllocationDecision {
  chosen: string | null;
  scores: { strategy: string; expectedR: number; pWin: number }[];
  regime: string;
}

/**
 * A decisao, dado o conjunto de sinais disponiveis nesta barra.
 * Retorna null quando nenhum sinal supera o limiar -- ficar de fora e uma
 * decisao valida e frequentemente a melhor.
 */
export function allocate(
  models: Map<string, StrategyModel>,
  candidates: { strategy: string; isLong: boolean }[],
  regimeRow: number[],
  acfg: AllocatorConfig = DEFAULT_ALLOCATOR,
): AllocationDecision {
  const scores: { strategy: string; expectedR: number; pWin: number }[] = [];
  for (const c of candidates) {
    const m = models.get(c.strategy);
    if (!m) continue;
    // Modelo sem AUC validada nao opina: usa-se a taxa-base historica da
    // estrategia. Assim ela continua elegivel (passou no portao de expectancy)
    // sem que uma previsao nao verificada decida por ela.
    const p = m.modelTrusted ? m.model.predictProba([...regimeRow, c.isLong ? 1 : 0]) : m.baseRate;
    scores.push({
      strategy: c.strategy,
      pWin: p,
      expectedR: p * m.avgWin - (1 - p) * m.avgLoss,
    });
  }
  scores.sort((a, b) => b.expectedR - a.expectedR);
  const best = scores[0];
  return {
    chosen: best && best.expectedR >= acfg.minExpectedR ? best.strategy : null,
    scores,
    regime: '',
  };
}

/** Diagnostico: quanto cada modelo realmente sabe, medido fora da amostra. */
export function scoreModels(
  models: Map<string, StrategyModel>,
  holdout: Map<string, { X: number[][]; y: number[] }>,
): { strategy: string; auc: number; n: number }[] {
  const out: { strategy: string; auc: number; n: number }[] = [];
  for (const [name, m] of models) {
    const h = holdout.get(name);
    if (!h || h.X.length < 30) continue;
    out.push({ strategy: name, auc: auc(h.y, m.model.predictAll(h.X)), n: h.X.length });
  }
  return out.sort((a, b) => b.auc - a.auc);
}
