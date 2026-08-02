/**
 * MAKER contra TAKER: a maior alavanca de custo que sobrou, e o risco dela.
 *
 * Taxa taker é 0,05%, maker é 0,02%. Como o payback é `taxa × 4 / spread`,
 * trocar de uma para a outra corta o tempo de empate em 2,5 vezes. É a maior
 * melhoria disponível, e por larga margem.
 *
 * Só que não é de graça, e o motivo é específico desta estrutura.
 *
 * ── por que ordem limite é perigosa numa operação de duas pernas ───────────
 *
 * A posição delta-neutra só é neutra com AS DUAS pernas montadas. Ordem limite
 * não garante execução: ela espera o mercado vir. Se a perna vendida executa e
 * a comprada não, o que resta não é uma operação de funding — é uma posição
 * direcional alavancada a 5x, exatamente aquilo que a estrutura inteira existe
 * para evitar.
 *
 * A janela entre uma perna e outra é o risco. Ele não aparece na taxa.
 *
 * ── a política que resolve ─────────────────────────────────────────────────
 *
 * Ordem limite nas duas pernas ao mesmo tempo, com prazo. Se as duas executam,
 * paga-se maker nas duas. Se só uma executa dentro do prazo, cancela-se a
 * pendente e FECHA-SE A EXECUTADA A MERCADO, imediatamente.
 *
 * O custo desse desfazimento é real: taxa taker na perna executada mais o
 * escorregamento do movimento na janela. Este módulo mede se o desconto de
 * maker paga esse seguro.
 */

export const TAXA_TAKER = 0.0005;
export const TAXA_MAKER = 0.0002;

export interface CenarioExecucao {
  /** probabilidade de uma perna limite executar dentro do prazo */
  probPreenchimento: number;
  /** movimento típico do preço na janela entre as pernas, em fração */
  derivaJanela: number;
  notional: number;
}

export interface CustoExecucao {
  /** custo esperado de montar as duas pernas, em dólares */
  esperado: number;
  /** em fração do notional por perna, para comparar com o spread */
  fracaoNotional: number;
  /** probabilidade de as duas pernas executarem */
  probAmbas: number;
  /** probabilidade de precisar desfazer uma perna solta */
  probDesfazer: number;
  detalhe: string;
}

/** Montagem a mercado: cara, mas certa. */
export function custoTaker(notional: number): CustoExecucao {
  const c = notional * TAXA_TAKER * 2;
  return {
    esperado: c, fracaoNotional: c / notional,
    probAmbas: 1, probDesfazer: 0,
    detalhe: 'duas pernas a mercado, execução garantida',
  };
}

/**
 * Montagem com ordem limite nas duas pernas.
 *
 * O termo que decide é o do meio: a probabilidade de exatamente UMA perna
 * executar. É onde mora o custo escondido, e ele cresce rápido quando o
 * preenchimento é incerto — com 80% de preenchimento por perna, 32% das
 * tentativas terminam com uma perna solta para desfazer.
 */
export function custoMaker(c: CenarioExecucao): CustoExecucao {
  const p = Math.min(1, Math.max(0, c.probPreenchimento));
  const ambas = p * p;
  const umaSo = 2 * p * (1 - p);
  const nenhuma = (1 - p) * (1 - p);

  // as duas executam: maker nas duas pernas
  const custoAmbas = c.notional * TAXA_MAKER * 2;
  // uma executa: maker na que entrou + taker para sair dela + deriva sofrida
  const custoUmaSo = c.notional * TAXA_MAKER + c.notional * TAXA_TAKER + c.notional * c.derivaJanela;
  // nenhuma executa: custo zero, mas a oportunidade passou

  const esperado = ambas * custoAmbas + umaSo * custoUmaSo + nenhuma * 0;

  // O custo esperado precisa ser normalizado pela probabilidade de a operação
  // de fato acontecer. Uma tentativa que não executa nada não é barata — ela
  // simplesmente não é uma operação, e diluir o custo por ela mentiria a favor
  // do maker.
  const esperadoPorMontagemFeita = ambas > 0 ? esperado / ambas : Infinity;

  return {
    esperado: esperadoPorMontagemFeita,
    fracaoNotional: esperadoPorMontagemFeita / c.notional,
    probAmbas: ambas,
    probDesfazer: umaSo,
    detalhe:
      `${(ambas * 100).toFixed(0)}% ambas · ${(umaSo * 100).toFixed(0)}% uma perna solta · ` +
      `${(nenhuma * 100).toFixed(0)}% nenhuma`,
  };
}

/**
 * A partir de qual probabilidade de preenchimento o maker compensa.
 *
 * Abaixo disso, o seguro contra perna solta custa mais que o desconto da taxa,
 * e a resposta certa é continuar pagando taker.
 */
export function preenchimentoMinimo(derivaJanela: number, notional = 1000): number {
  const alvo = custoTaker(notional).esperado;
  let lo = 0.01, hi = 1;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    const c = custoMaker({ probPreenchimento: mid, derivaJanela, notional });
    if (c.esperado > alvo) lo = mid; else hi = mid;
  }
  return hi;
}
