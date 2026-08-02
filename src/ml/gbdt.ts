/**
 * Gradient Boosted Decision Trees para classificacao binaria, do zero.
 *
 * Por que escrever em vez de usar biblioteca: o dataset aqui e pequeno
 * (centenas a milhares de trades) e tabular, arvores impulsionadas sao o estado
 * da arte nesse regime, e a implementacao inteira cabe em um arquivo sem
 * adicionar dependencia binaria ao projeto. Nada de rede neural: com 800
 * exemplos e 11 features, uma rede so decora.
 *
 * Objetivo: log-loss (logistica). Cada arvore ajusta o gradiente do residuo, e
 * as folhas usam o passo de Newton (g/h) em vez da media, que e o que da a
 * qualidade do XGBoost.
 */

export interface GBDTParams {
  /**
   * 'logistic' para classificação binária, 'squared' para regressão.
   *
   * O modo regressão existe para prever VOLATILIDADE, que é a única coisa que
   * este projeto conseguiu prever com sucesso. Prever direção falhou duas
   * vezes; volatilidade se agrupa e é genuinamente previsível.
   *
   * Em regressão o passo de Newton vira trivial: gradiente = (pred - y) e
   * hessiana = 1, o que torna as folhas a média dos resíduos regularizada.
   */
  objective: 'logistic' | 'squared';
  nTrees: number;
  maxDepth: number;
  learningRate: number;
  minSamplesLeaf: number;
  /** regularizacao L2 nas folhas; segura o modelo em dataset pequeno */
  lambda: number;
  /** fracao de linhas amostrada por arvore */
  subsample: number;
  /** fracao de features considerada por split */
  colsample: number;
  seed: number;
}

export const DEFAULT_GBDT: GBDTParams = {
  objective: 'logistic',
  nTrees: 120,
  maxDepth: 3,
  learningRate: 0.05,
  minSamplesLeaf: 25,
  lambda: 5,
  subsample: 0.8,
  colsample: 0.8,
  seed: 42,
};

interface Node {
  leaf?: number;
  feature?: number;
  threshold?: number;
  left?: Node;
  right?: Node;
}

function mkRng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13; s >>>= 0;
    s ^= s >> 17;
    s ^= s << 5; s >>>= 0;
    return s / 4294967296;
  };
}

const sigmoid = (x: number) => 1 / (1 + Math.exp(-Math.max(-30, Math.min(30, x))));

function buildTree(
  X: number[][],
  g: number[],
  h: number[],
  rows: number[],
  featIdx: number[],
  depth: number,
  p: GBDTParams,
  rnd: () => number,
): Node {
  const sumG = rows.reduce((a, i) => a + g[i], 0);
  const sumH = rows.reduce((a, i) => a + h[i], 0);
  const leafValue = -sumG / (sumH + p.lambda);

  if (depth >= p.maxDepth || rows.length < 2 * p.minSamplesLeaf) return { leaf: leafValue };

  const parentScore = (sumG * sumG) / (sumH + p.lambda);
  let best: { feat: number; thr: number; gain: number; left: number[]; right: number[] } | null = null;

  const cols = featIdx.filter(() => rnd() < p.colsample);
  const useCols = cols.length ? cols : featIdx;

  for (const f of useCols) {
    // Candidatos de corte por quantis, nao por todos os valores unicos:
    // mais rapido e menos propenso a decorar um valor especifico.
    const vals = rows.map((i) => X[i][f]).sort((a, b) => a - b);
    const cand = new Set<number>();
    for (let q = 1; q < 16; q++) cand.add(vals[Math.floor((vals.length * q) / 16)]);

    for (const thr of cand) {
      let gl = 0, hl = 0, nl = 0, gr = 0, hr = 0, nr = 0;
      for (const i of rows) {
        if (X[i][f] <= thr) { gl += g[i]; hl += h[i]; nl++; }
        else { gr += g[i]; hr += h[i]; nr++; }
      }
      if (nl < p.minSamplesLeaf || nr < p.minSamplesLeaf) continue;
      const gain =
        (gl * gl) / (hl + p.lambda) + (gr * gr) / (hr + p.lambda) - parentScore;
      if (!best || gain > best.gain) {
        best = {
          feat: f, thr, gain,
          left: rows.filter((i) => X[i][f] <= thr),
          right: rows.filter((i) => X[i][f] > thr),
        };
      }
    }
  }

  // Gain minimo positivo: sem isso a arvore cria splits que so existem no treino.
  if (!best || best.gain <= 1e-6) return { leaf: leafValue };

  return {
    feature: best.feat,
    threshold: best.thr,
    left: buildTree(X, g, h, best.left, featIdx, depth + 1, p, rnd),
    right: buildTree(X, g, h, best.right, featIdx, depth + 1, p, rnd),
  };
}

function predictTree(node: Node, x: number[]): number {
  while (node.leaf === undefined) {
    node = x[node.feature!] <= node.threshold! ? node.left! : node.right!;
  }
  return node.leaf;
}

export class GBDT {
  private trees: Node[] = [];
  private base = 0;
  readonly params: GBDTParams;
  featureNames: string[] = [];

  constructor(params: Partial<GBDTParams> = {}) {
    this.params = { ...DEFAULT_GBDT, ...params };
  }

  fit(X: number[][], y: number[], featureNames?: string[]): this {
    if (featureNames) this.featureNames = featureNames;
    const p = this.params;
    const rnd = mkRng(p.seed);
    const n = X.length;
    if (!n) throw new Error('dataset vazio');
    const nFeat = X[0].length;
    const featIdx = Array.from({ length: nFeat }, (_, i) => i);

    if (p.objective === 'squared') {
      // Regressão: a base é a média do alvo.
      this.base = y.reduce((a, b) => a + b, 0) / n;
    } else {
      const pos = y.reduce((a, b) => a + b, 0);
      const rate = Math.min(0.999, Math.max(0.001, pos / n));
      this.base = Math.log(rate / (1 - rate));
    }

    const F = new Array(n).fill(this.base);
    this.trees = [];

    for (let t = 0; t < p.nTrees; t++) {
      const g = new Array(n);
      const h = new Array(n);
      for (let i = 0; i < n; i++) {
        if (p.objective === 'squared') {
          g[i] = F[i] - y[i];
          h[i] = 1;
        } else {
          const pr = sigmoid(F[i]);
          g[i] = pr - y[i];
          h[i] = Math.max(1e-6, pr * (1 - pr));
        }
      }
      const rows: number[] = [];
      for (let i = 0; i < n; i++) if (rnd() < p.subsample) rows.push(i);
      if (rows.length < 2 * p.minSamplesLeaf) continue;

      const tree = buildTree(X, g, h, rows, featIdx, 0, p, rnd);
      this.trees.push(tree);
      for (let i = 0; i < n; i++) F[i] += p.learningRate * predictTree(tree, X[i]);
    }
    return this;
  }

  /** Probabilidade da classe 1. */
  predictProba(x: number[]): number {
    let f = this.base;
    for (const t of this.trees) f += this.params.learningRate * predictTree(t, x);
    return sigmoid(f);
  }

  predictAll(X: number[][]): number[] {
    return X.map((x) => this.predictProba(x));
  }

  /**
   * Saída bruta, sem passar pela sigmoide. É o que a regressão precisa —
   * aplicar sigmoide num alvo contínuo o esmagaria em [0,1].
   */
  predictRaw(X: number[][]): number[] {
    return X.map((x) => {
      let f = this.base;
      for (const t of this.trees) f += this.params.learningRate * predictTree(t, x);
      return f;
    });
  }

  /** Importancia por contagem de uso de cada feature nos splits. */
  featureImportance(): { name: string; count: number }[] {
    const counts = new Map<number, number>();
    const walk = (n: Node) => {
      if (n.leaf !== undefined) return;
      counts.set(n.feature!, (counts.get(n.feature!) ?? 0) + 1);
      walk(n.left!);
      walk(n.right!);
    };
    for (const t of this.trees) walk(t);
    return [...counts.entries()]
      .map(([i, count]) => ({ name: this.featureNames[i] ?? `f${i}`, count }))
      .sort((a, b) => b.count - a.count);
  }

  toJSON() {
    return { trees: this.trees, base: this.base, params: this.params, featureNames: this.featureNames };
  }

  static fromJSON(o: any): GBDT {
    const m = new GBDT(o.params);
    (m as any).trees = o.trees;
    (m as any).base = o.base;
    m.featureNames = o.featureNames ?? [];
    return m;
  }
}

/** Area sob a curva ROC. 0.5 = o modelo nao sabe nada. */
export function auc(yTrue: number[], scores: number[]): number {
  const pairs = scores.map((s, i) => ({ s, y: yTrue[i] })).sort((a, b) => a.s - b.s);
  const nPos = yTrue.reduce((a, b) => a + b, 0);
  const nNeg = yTrue.length - nPos;
  if (!nPos || !nNeg) return 0.5;
  let rankSum = 0;
  for (let i = 0; i < pairs.length; i++) if (pairs[i].y === 1) rankSum += i + 1;
  return (rankSum - (nPos * (nPos + 1)) / 2) / (nPos * nNeg);
}
