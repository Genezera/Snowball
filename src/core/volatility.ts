/**
 * Previsão de volatilidade e dimensionamento por vol-alvo.
 *
 * A única previsão que funcionou neste projeto, e vale entender por quê:
 *
 *   Prever DIREÇÃO falhou duas vezes (filtro de ML: AUC 0,54 e removia trades
 *   lucrativos; alocador adaptativo: perdeu em 5 de 5 ativos).
 *
 *   Prever VOLATILIDADE funciona porque volatilidade se AGRUPA — períodos
 *   agitados seguem períodos agitados. É um dos fatos empíricos mais
 *   replicados em finanças, e não exige acertar para onde o preço vai.
 *
 * E a propriedade que a torna segura: dimensionar nunca REMOVE um trade. Todos
 * os sinais continuam sendo executados; só o tamanho muda. Isso respeita a
 * regra do projeto de nunca aplicar nada que corte trades lucrativos.
 */
import type { Bar } from './types.ts';
import { closes } from './indicators.ts';

/**
 * EWMA da variância dos retornos (RiskMetrics, lambda = 0,94).
 *
 * A previsão para a barra `i` usa apenas retornos até `i-1`. O deslocamento é
 * deliberado e é o que impede lookahead: no momento de decidir o tamanho, a
 * volatilidade daquela barra ainda não aconteceu.
 */
export function forecastVolatility(bars: Bar[], lambda = 0.94, warmup = 30): number[] {
  const c = closes(bars);
  const out = new Array<number>(bars.length).fill(NaN);
  let ewma = 0;
  for (let i = 1; i < bars.length; i++) {
    out[i] = i > warmup ? Math.sqrt(ewma) : NaN;
    const r = c[i - 1] > 0 ? c[i] / c[i - 1] - 1 : 0;
    ewma = lambda * ewma + (1 - lambda) * r * r;
  }
  return out;
}

/**
 * Volatilidade-alvo: a mediana da volatilidade prevista ao longo da série.
 *
 * Usar a mediana em vez da média é proposital — a distribuição de volatilidade
 * tem cauda direita pesada, e a média seria puxada pelos picos de crise.
 */
export function targetVolatility(volForecast: number[]): number {
  const v = volForecast.filter((x) => isFinite(x) && x > 0).sort((a, b) => a - b);
  return v.length ? v[Math.floor(v.length / 2)] : 0;
}

export interface VolSizingConfig {
  /** multiplicador mínimo — impede zerar o tamanho em crise */
  minMult: number;
  /** multiplicador máximo — impede alavancar demais em mercado morto */
  maxMult: number;
}

export const DEFAULT_VOL_SIZING: VolSizingConfig = { minMult: 0.4, maxMult: 2.5 };

/**
 * Multiplicador de tamanho para a barra `i`.
 *
 * Quando a volatilidade prevista está acima do alvo, o tamanho encolhe; quando
 * está abaixo, cresce. O objetivo é manter o risco em DÓLARES aproximadamente
 * constante, em vez de deixá-lo variar com o humor do mercado.
 *
 * Os limites existem porque a fórmula sem trava faz besteira nos extremos: em
 * mercado morto ela pediria alavancagem absurda, e numa crise pediria tamanho
 * praticamente zero, o que faz perder a recuperação.
 */
export function volSizeMultiplier(
  volForecast: number[],
  i: number,
  volTarget: number,
  cfg: VolSizingConfig = DEFAULT_VOL_SIZING,
): number {
  const v = volForecast[i];
  if (!isFinite(v) || v <= 0 || volTarget <= 0) return 1;
  return Math.min(cfg.maxMult, Math.max(cfg.minMult, volTarget / v));
}

/**
 * CATRACA — o risco desce sozinho conforme o capital sobe.
 *
 * Testada contra risco fixo: mesma mediana (US$ 789 vs 786 em 6 meses), mas
 * retém 92% dos que tocam a meta contra 72%. Não troca retorno por segurança —
 * pega os dois, porque é uma política dependente do caminho.
 *
 * A decisão usa o PICO já atingido, não o equity atual. Assim uma queda
 * temporária não faz a catraca voltar a ser agressiva justamente na hora ruim.
 */
export interface RatchetStep { acima: number; risco: number }

export const DEFAULT_RATCHET: RatchetStep[] = [
  { acima: 0, risco: 0.20 },
  { acima: 200, risco: 0.12 },
  { acima: 350, risco: 0.07 },
  { acima: 500, risco: 0.04 },
  { acima: 1000, risco: 0.02 },
  { acima: 2500, risco: 0.01 },
];

/** Perfil conservador: mesma forma, um degrau abaixo em tudo. */
export const CONSERVATIVE_RATCHET: RatchetStep[] = [
  { acima: 0, risco: 0.05 },
  { acima: 200, risco: 0.03 },
  { acima: 500, risco: 0.02 },
  { acima: 1000, risco: 0.01 },
  { acima: 2500, risco: 0.005 },
];

export function ratchetRisk(peakEquity: number, steps: RatchetStep[] = DEFAULT_RATCHET): number {
  let r = steps[0].risco;
  for (const s of steps) if (peakEquity >= s.acima) r = s.risco;
  return r;
}

/**
 * Piso móvel: corta o risco pela metade quando já se devolveu `giveback` do
 * pico. É o freio que impede devolver o lucro inteiro depois de uma boa
 * sequência — e foi o que salvou a política agressiva no cenário de edge zero
 * (mediana US$ 36 contra US$ 2 sem o piso).
 */
export function floorAdjust(equity: number, peak: number, risk: number, giveback = 0.25): number {
  return equity < peak * (1 - giveback) ? risk * 0.5 : risk;
}
