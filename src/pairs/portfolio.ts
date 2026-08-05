/**
 * SELEÇÃO DE PORTFÓLIO SEM PERNA REPETIDA — a lacuna de correlação que ficou
 * pendente no bootstrap original.
 *
 * `varrerPares`/`rodarPares` escolhia o top-N por meia-vida sem olhar se dois
 * pares compartilhavam um ativo. Isso é real: HOT aparecia em FIL|HOT,
 * KSM|HOT, 1INCH|HOT, ZEN|HOT ao mesmo tempo — um choque em HOT afeta os
 * quatro pares juntos, e o bootstrap (que reamostra trades como sorteios
 * independentes) não enxerga isso. O risco de portfólio medido era menor
 * que o real.
 *
 * A correção: seleção GULOSA por meia-vida, mas pulando qualquer par cujo
 * ativo A ou B já apareça em um par já escolhido. O resultado é um portfólio
 * onde cada ativo aparece no máximo uma vez — os choques ficam isolados por
 * construção, não por sorte.
 */
import type { ParCandidato } from './cointegracao.ts';

/**
 * Filtra candidatos (já ordenados por meia-vida crescente, o formato que
 * `varrerPares` devolve) mantendo só os que não repetem perna com um já
 * aceito. Greedy: o primeiro candidato de cada ativo "ganha" o ativo.
 */
export function selecionarSemSobreposicao(candidatosOrdenados: ParCandidato[], maxPares: number): ParCandidato[] {
  const usados = new Set<string>();
  const selecionados: ParCandidato[] = [];
  for (const c of candidatosOrdenados) {
    if (selecionados.length >= maxPares) break;
    if (usados.has(c.a) || usados.has(c.b)) continue;
    usados.add(c.a); usados.add(c.b);
    selecionados.push(c);
  }
  return selecionados;
}
