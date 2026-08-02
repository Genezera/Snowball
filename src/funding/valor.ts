/**
 * VALOR ESPERADO de uma oportunidade, em dólares.
 *
 * Substitui a heurística `spread médio × consistência²` por uma conta que
 * responde a pergunta certa: **quanto esta posição deixa de lucro líquido, se
 * eu montar agora?**
 *
 * A heurística antiga ordenava bem entre pares parecidos, mas era cega para a
 * única coisa que decidiu o resultado real: se o par vive o suficiente para
 * pagar o próprio custo de montagem. Ela deu 100% de peso a um par de 3
 * observações e escolheu MU, que morreu em 12 minutos.
 *
 * ── a conta ────────────────────────────────────────────────────────────────
 *
 *   valor = notional × spread × pagamentos(vida esperada) − notional × taxa × 4
 *
 * O notional multiplica os DOIS termos, então ele não muda o sinal — só a
 * escala. Isso tem uma consequência que vale gravar: **alavancagem e capital
 * não decidem se uma operação vale a pena.** Só taxa, spread e tempo de vida.
 *
 * ── vida esperada ──────────────────────────────────────────────────────────
 *
 * É o termo difícil, e o único estimável a partir do que a vigilância guarda.
 * Uso Lindy amortecido pela consistência: um spread que já viveu T horas com
 * consistência c tende a viver mais `T × c`. Consistência baixa significa que
 * o par pisca, e um par que pisca morre mais cedo.
 *
 * É grosseiro. É também conservador na direção certa — subestima a vida de
 * pares bons e não superestima a de pares ruins, que é o erro que custa
 * dinheiro.
 */

/** pagamentos de funding por hora: 3 por dia */
const PAGAMENTOS_POR_HORA = 3 / 24;

export interface EntradaValor {
  /** spread médio por período de 8h, em fração */
  spread: number;
  /** fração das varreduras em que o par apareceu */
  consistencia: number;
  /** há quantas horas o spread está vivo */
  duracaoHoras: number;
  /** notional por perna, em dólares */
  notional: number;
  /** taxa por perna e por lado */
  taxa: number;
}

export interface Valor {
  /** horas que a posição deve durar, na estimativa */
  vidaEsperadaHoras: number;
  /** horas necessárias só para empatar */
  paybackHoras: number;
  /** funding bruto esperado, em dólares */
  receitaEsperada: number;
  /** montagem e desmontagem, em dólares */
  custoIdaEVolta: number;
  /** o que sobra */
  valorEsperado: number;
  /** quantas vezes a vida esperada cobre o payback */
  folga: number;
}

/**
 * Vida esperada pelo estimador de Lindy amortecido.
 *
 * Um par recém-visto tem vida esperada quase nula — e isso é deliberado. A
 * alternativa (assumir uma vida média de mercado) foi o que fez o motor montar
 * MU com três observações.
 */
export function vidaEsperada(duracaoHoras: number, consistencia: number): number {
  return Math.max(0, duracaoHoras) * Math.min(1, Math.max(0, consistencia));
}

export function avaliarValor(e: EntradaValor): Valor {
  const vida = vidaEsperada(e.duracaoHoras, e.consistencia);
  const custo = e.notional * e.taxa * 4;
  const paybackHoras = e.spread > 0 ? custo / (e.notional * e.spread * PAGAMENTOS_POR_HORA) : Infinity;
  const receita = e.notional * e.spread * PAGAMENTOS_POR_HORA * vida;
  return {
    vidaEsperadaHoras: vida,
    paybackHoras,
    receitaEsperada: receita,
    custoIdaEVolta: custo,
    valorEsperado: receita - custo,
    folga: paybackHoras > 0 && isFinite(paybackHoras) ? vida / paybackHoras : 0,
  };
}

/**
 * Valor esperado por hora de capital ocupado.
 *
 * É por isto que se ordena, não pelo valor absoluto. Duas oportunidades com o
 * mesmo lucro total não são equivalentes se uma leva o dobro do tempo: a mais
 * rápida libera o capital para a próxima.
 *
 * Um par com valor esperado negativo devolve negativo aqui também, então a
 * ordenação e o portão usam a mesma grandeza — sem duas regras que possam
 * discordar.
 */
export function valorPorHora(e: EntradaValor): number {
  const v = avaliarValor(e);
  return v.vidaEsperadaHoras > 0 ? v.valorEsperado / v.vidaEsperadaHoras : -Infinity;
}
