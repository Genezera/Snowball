/**
 * EQUILÍBRIO DE DIREÇÃO entre exchanges.
 *
 * A perna VENDIDA perde margem quando o preço sobe. Cripto é altamente
 * correlacionada — quando um alt sobe, quase todos sobem juntos. Então duas
 * posições com a perna vendida na MESMA exchange drenam essa exchange ao
 * dobro, enquanto a outra acumula margem sobrando.
 *
 * Medido com duas posições de US$ 350 de notional e movimento de +10%:
 *
 *   ambas vendidas na binance   binance perde US$ 70   bybit sobra
 *   uma vendida em cada         binance perde US$ 35   bybit perde US$ 35
 *
 * **O que liquida é a exchange pior.** Equilibrar a direção corta o dreno de
 * pico pela metade sem mudar o notional, sem mudar a renda e sem custo nenhum.
 *
 * É a única melhoria deste projeto que não tem contrapartida — todas as outras
 * trocam retorno por segurança ou vice-versa. Esta é de graça.
 *
 * ── por que não é sempre possível ─────────────────────────────────────────
 *
 * A direção não se escolhe: ela vem do mercado. Vende-se onde o funding é alto
 * e compra-se onde é baixo. Se as duas melhores oportunidades pedem venda na
 * mesma exchange, forçar o contrário significaria pagar funding em vez de
 * receber.
 *
 * Por isso o equilíbrio entra como **desempate**, não como filtro: entre
 * candidatas de valor esperado parecido, prefere a que equilibra. Nunca recusa
 * uma oportunidade boa por causa da direção.
 */

export interface ExposicaoDirecional {
  /** notional vendido em cada exchange — o que perde quando o preço sobe */
  vendido: Record<string, number>;
  /** notional comprado em cada exchange */
  comprado: Record<string, number>;
}

export function exposicaoDirecional(
  posicoes: { exchangeShort: string; exchangeLong: string; notionalPorPerna: number }[],
): ExposicaoDirecional {
  const vendido: Record<string, number> = {};
  const comprado: Record<string, number> = {};
  for (const p of posicoes) {
    vendido[p.exchangeShort] = (vendido[p.exchangeShort] ?? 0) + p.notionalPorPerna;
    comprado[p.exchangeLong] = (comprado[p.exchangeLong] ?? 0) + p.notionalPorPerna;
  }
  return { vendido, comprado };
}

/**
 * Dreno líquido esperado em cada exchange, para um movimento de alta.
 *
 * É `vendido − comprado`: a perna vendida perde e a comprada ganha, então o que
 * importa é o saldo entre as duas naquela exchange.
 */
export function drenoLiquido(e: ExposicaoDirecional): Record<string, number> {
  const exs = new Set([...Object.keys(e.vendido), ...Object.keys(e.comprado)]);
  const out: Record<string, number> = {};
  for (const ex of exs) out[ex] = (e.vendido[ex] ?? 0) - (e.comprado[ex] ?? 0);
  return out;
}

/**
 * O pior dreno da carteira: o número que decide quando alguma exchange aperta.
 *
 * Menor é melhor. Zero significa perfeitamente equilibrado — cada exchange
 * perde tanto quanto ganha num movimento correlacionado.
 */
export function piorDreno(
  posicoes: { exchangeShort: string; exchangeLong: string; notionalPorPerna: number }[],
): number {
  const d = drenoLiquido(exposicaoDirecional(posicoes));
  const vals = Object.values(d);
  return vals.length ? Math.max(...vals.map(Math.abs)) : 0;
}

/**
 * Quanto uma candidata melhora ou piora o equilíbrio, em dólares de dreno.
 *
 * Negativo é bom: significa que adicionar esta posição REDUZ o pior dreno da
 * carteira. É usado como desempate na ordenação.
 */
export function deltaEquilibrio(
  posicoes: { exchangeShort: string; exchangeLong: string; notionalPorPerna: number }[],
  candidata: { exchangeShort: string; exchangeLong: string; notionalPorPerna: number },
): number {
  return piorDreno([...posicoes, candidata]) - piorDreno(posicoes);
}

/**
 * Bônus de ordenação, em fração do valor esperado.
 *
 * ── por que 0,07 e não 0,15 ────────────────────────────────────────────────
 *
 * O bônus é bidirecional: quem equilibra ganha `+i` e quem concentra leva `−i`.
 * Então a faixa total é `2i`, não `i`. Uma candidata A só continua vencendo B se
 *
 *     A/B > (1 + i) / (1 − i)
 *
 * Com `i = 0,15` isso dá 1,353 — o bônus inverteria diferenças de valor de até
 * **35%**. Isso não é desempate, é filtro disfarçado, e um teste reprovou
 * exatamente nesse ponto.
 *
 * Com `i = 0,07` o limite cai para 1,15: inverte diferenças abaixo de 15% e
 * respeita qualquer coisa acima. É o comportamento que se quer de um critério
 * secundário.
 *
 * O sinal é invertido de propósito: `deltaEquilibrio` negativo (que reduz o
 * dreno) vira bônus positivo.
 */
export function bonusEquilibrio(
  posicoes: { exchangeShort: string; exchangeLong: string; notionalPorPerna: number }[],
  candidata: { exchangeShort: string; exchangeLong: string; notionalPorPerna: number },
  intensidade = 0.07,
): number {
  if (!posicoes.length) return 0;   // a primeira posição não tem o que equilibrar
  const delta = deltaEquilibrio(posicoes, candidata);
  // normaliza pelo notional da candidata: o delta vai de −N (equilibra
  // totalmente) a +N (concentra totalmente)
  const norm = candidata.notionalPorPerna > 0 ? delta / candidata.notionalPorPerna : 0;
  return -Math.max(-1, Math.min(1, norm)) * intensidade;
}
