/**
 * PARES COINTEGRADOS — mecanismo diferente de tudo o mais no projeto.
 *
 * Toda estratégia testada até aqui aposta em DIREÇÃO: um ativo sobe ou desce,
 * e o lucro vem de acertar qual. Pares cointegrados apostam em RELAÇÃO: dois
 * ativos correlacionados se afastam temporariamente um do outro, e o lucro
 * vem de apostar que a distância volta ao normal — comprando o barato,
 * vendendo o caro, sem opinião sobre pra onde o mercado vai.
 *
 * ── por que isso é genuinamente diferente ──────────────────────────────────
 *
 * Market-neutral: se os dois ativos caem juntos 20%, a posição não perde nada
 * — o que importa é a DIFERENÇA entre eles, não o nível de nenhum. Isso é uma
 * fonte de retorno estruturalmente distinta de momentum ou rompimento, e é
 * descorrelacionada delas — a razão clássica para misturar na literatura de
 * stat-arb (Gatev, Goetzmann, Rouwenhorst 2006, "Pairs Trading").
 *
 * ── o teste de cointegração, versão sem dependência estatística pesada ────
 *
 * Cointegração de verdade usa teste de Engle-Granger ou Johansen, que pedem
 * biblioteca de estatística que este projeto não tem. Uso um substituto
 * defensável: razão de hedge por regressão OLS simples no log-preço, e
 * MEIA-VIDA de reversão do resíduo via AR(1) — se o resíduo reverte rápido e
 * de forma consistente, isso é evidência de cointegração prática, mesmo sem
 * o teste formal. É mais fraco que Engle-Granger, mas honesto sobre ser mais
 * fraco, e o walk-forward por trás confere se funciona de verdade.
 */
import type { Bar } from '../core/types.ts';

export interface ParCandidato {
  a: string;
  b: string;
  /** razão de hedge: preço(a) ≈ hedgeRatio × preço(b) + intercepto, em log */
  hedgeRatio: number;
  intercepto: number;
  /** correlação dos RETORNOS diários — filtro barato antes do resto */
  correlacao: number;
  /** meia-vida de reversão do resíduo, em barras — quanto menor, mais rápido reverte */
  meiaVidaBarras: number;
  /** desvio padrão do resíduo — escala do z-score */
  desvioResiduo: number;
}

function logPrecos(bars: Bar[]): number[] {
  return bars.map((b) => Math.log(b.c));
}

/** Correlação de Pearson entre dois vetores do mesmo tamanho. */
export function correlacao(x: number[], y: number[]): number {
  const n = Math.min(x.length, y.length);
  if (n < 2) return 0;
  let sx = 0, sy = 0, sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < n; i++) {
    sx += x[i]; sy += y[i]; sxy += x[i] * y[i]; sxx += x[i] * x[i]; syy += y[i] * y[i];
  }
  const cov = sxy / n - (sx / n) * (sy / n);
  const vx = sxx / n - (sx / n) ** 2, vy = syy / n - (sy / n) ** 2;
  const denom = Math.sqrt(vx * vy);
  return denom > 0 ? cov / denom : 0;
}

/** Retornos log período-a-período. */
function retornosLog(precos: number[]): number[] {
  const r: number[] = [];
  for (let i = 1; i < precos.length; i++) r.push(precos[i] - precos[i - 1]);
  return r;
}

/** Regressão OLS simples: y = m·x + c. Devolve {m, c}. */
function olsSimples(x: number[], y: number[]): { m: number; c: number } {
  const n = Math.min(x.length, y.length);
  let sx = 0, sy = 0, sxy = 0, sxx = 0;
  for (let i = 0; i < n; i++) { sx += x[i]; sy += y[i]; sxy += x[i] * y[i]; sxx += x[i] * x[i]; }
  const denom = n * sxx - sx * sx;
  if (Math.abs(denom) < 1e-12) return { m: 1, c: 0 };
  const m = (n * sxy - sx * sy) / denom;
  const c = (sy - m * sx) / n;
  return { m, c };
}

/**
 * Meia-vida de reversão de uma série via AR(1) no nível: Δresíduo_t =
 * φ·resíduo_{t-1} + ε. Se φ < 0, o resíduo reverte; meia-vida =
 * ln(0.5)/ln(1+φ). Devolve Infinity se não reverte (φ ≥ 0).
 */
export function meiaVida(residuo: number[]): number {
  const n = residuo.length;
  if (n < 10) return Infinity;
  const nivel = residuo.slice(0, -1);
  const delta = residuo.slice(1).map((v, i) => v - residuo[i]);
  const { m: phi } = olsSimples(nivel, delta);
  // phi >= 0: não reverte. phi <= -1: 1+phi <= 0, log(1+phi) é indefinido —
  // é oscilação instável (overshoot a cada passo), não reversão suave. A
  // fórmula de meia-vida discreta só vale para phi no intervalo aberto (-1,0).
  if (!(phi < 0 && phi > -1)) return Infinity;
  const hl = Math.log(0.5) / Math.log(1 + phi);
  return isFinite(hl) ? hl : Infinity;
}

/** Desvio padrão populacional simples. */
function desvioPadrao(v: number[]): number {
  const media = v.reduce((a, b) => a + b, 0) / v.length;
  const variancia = v.reduce((a, b) => a + (b - media) ** 2, 0) / v.length;
  return Math.sqrt(variancia);
}

/**
 * Avalia um par candidato sobre uma janela de barras JÁ ALINHADAS no tempo
 * (mesmo índice = mesmo instante nos dois ativos).
 */
export function avaliarPar(nomeA: string, barsA: Bar[], nomeB: string, barsB: Bar[]): ParCandidato | null {
  const n = Math.min(barsA.length, barsB.length);
  if (n < 60) return null;
  const logA = logPrecos(barsA.slice(-n)), logB = logPrecos(barsB.slice(-n));

  const corr = correlacao(retornosLog(logA), retornosLog(logB));
  if (corr < 0.5) return null; // filtro barato: sem correlação de retorno, não vale calcular o resto

  const { m: hedgeRatio, c: intercepto } = olsSimples(logB, logA);
  const residuo = logA.map((v, i) => v - (hedgeRatio * logB[i] + intercepto));
  const hl = meiaVida(residuo);
  if (!isFinite(hl) || hl <= 0 || hl > 60) return null; // reversão lenta demais é ruído, não sinal

  return {
    a: nomeA, b: nomeB, hedgeRatio, intercepto,
    correlacao: corr, meiaVidaBarras: hl, desvioResiduo: desvioPadrao(residuo),
  };
}

/**
 * Varre todos os pares de um conjunto de séries {nome: bars}, alinhando pelo
 * timestamp comum, e devolve os candidatos que passam nos filtros, ordenados
 * pela meia-vida (mais rápido primeiro — reverte antes, gira mais vezes).
 */
export function varrerPares(series: Record<string, Bar[]>): ParCandidato[] {
  const nomes = Object.keys(series);
  const candidatos: ParCandidato[] = [];
  for (let i = 0; i < nomes.length; i++) {
    for (let j = i + 1; j < nomes.length; j++) {
      const a = nomes[i], b = nomes[j];
      const c = avaliarPar(a, series[a], b, series[b]);
      if (c) candidatos.push(c);
    }
  }
  return candidatos.sort((x, y) => x.meiaVidaBarras - y.meiaVidaBarras);
}
