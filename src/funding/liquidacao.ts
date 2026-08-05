/**
 * CAPTURA DE LIQUIDAÇÃO — o erro de desenho que manteve o motor parado.
 *
 * ── o erro ────────────────────────────────────────────────────────────────
 *
 * O portão de valor esperado (valor.ts) calcula:
 *
 *   payback_horas = custo / (notional × spread × pagamentos_por_hora)
 *
 * Isso trata funding como se PINGASSE CONTINUAMENTE, a 3/24 de pagamento por
 * hora. Sob essa conta, um par precisa VIVER `payback × 1,5` horas antes de
 * valer a pena — tipicamente 28h a 1200h nos candidatos reais. Como a vida
 * mediana de um spread é de 20 minutos, o portão barra tudo. Zero de 341
 * ciclos reais passariam (`npm run viabilidade`).
 *
 * Mas funding NÃO é contínuo. É pago em horários FIXOS (00:00, 08:00, 16:00
 * UTC na maioria das exchanges). Quem estiver posicionado NO INSTANTE da
 * liquidação recebe o período inteiro — tendo aberto cinco minutos ou cinco
 * horas antes. Fechar um minuto antes não recebe nada.
 *
 * Então a pergunta certa não é "esse spread vive 28 horas?", é:
 *
 *   "o spread sobrevive até a próxima liquidação, e o que ela paga cobre
 *    o custo de entrar e sair?"
 *
 * A primeira parte é uma janela CONHECIDA e CURTA (no máximo o intervalo de
 * funding, tipicamente ≤ 8h e muitas vezes minutos). A segunda é uma
 * comparação direta entre dois números, sem estimador de sobrevivência.
 *
 * ── o que isso muda, medido ───────────────────────────────────────────────
 *
 * Nas observações reais coletadas DEPOIS da correção de intervalo de funding
 * (dado limpo, 04/08/2026), agrupadas por ativo × janela de liquidação:
 *
 *   HOME   pico 1,340% por 8h    ERA   pico 1,103%    DEXE   pico 0,707%
 *
 * contra um custo de ida e volta de 0,330%. Três oportunidades em um dia em
 * que o motor não abriu nada — porque cada uma teria precisado provar horas
 * de vida que elas não tinham, para receber um pagamento que já estava a
 * minutos de distância.
 *
 * ── o que isto NÃO resolve ────────────────────────────────────────────────
 *
 * Nada aqui promete lucro. O que muda é a pergunta do portão. Continuam de pé,
 * e precisam de medição própria antes de qualquer capital:
 *
 *   · ESCORREGAMENTO. Os pares de funding extremo são finos. A medição de
 *     0,03% foi feita em pares líquidos; aqui pode ser muito pior, e o custo
 *     entra QUATRO vezes. `livro.ts` já mede isso por par — usar sempre.
 *
 *   · ALINHAMENTO DE LIQUIDAÇÃO. Numa operação entre exchanges, as duas pernas
 *     precisam liquidar dentro da janela em que a posição está montada. Se uma
 *     liquida de hora em hora e a outra de 8 em 8, não existe "a" liquidação
 *     — existem duas agendas, e capturar o spread líquido exige as duas.
 *     `alinhamento()` abaixo é o que decide se o par é elegível.
 *
 *   · POR QUE O FUNDING ESTÁ EXTREMO. Taxa alta é compensação por pressão
 *     direcional forte — squeeze, listagem nova, liquidez rasa. O par pode
 *     andar violentamente dentro da janela. A estrutura delta-neutra protege
 *     do preço, não da liquidação de uma perna.
 */

/** Horários padrão de liquidação em UTC, na maioria das exchanges. */
export const HORAS_PADRAO_UTC = [0, 8, 16];

/**
 * Quando é a próxima liquidação, em ms desde agora.
 *
 * Assume liquidação em múltiplos do intervalo, ancorada em 00:00 UTC — que é a
 * convenção de binance, bybit, okx, gate e bitget. Pura de propósito: recebe o
 * "agora" em vez de chamar Date.now(), para poder ser testada em qualquer
 * instante.
 */
export function msAteProximaLiquidacao(agora: number, intervaloHoras: number): number {
  const intervaloMs = Math.max(1, intervaloHoras) * 3_600_000;
  const desdeMeiaNoite = agora % 86_400_000;
  const decorridoNoCiclo = desdeMeiaNoite % intervaloMs;
  return intervaloMs - decorridoNoCiclo;
}

/**
 * Quanto UMA liquidação paga, a partir do funding já normalizado para 8h.
 *
 * A normalização de 8h existe para comparar pares de intervalos diferentes.
 * Mas na hora de receber, o que cai na conta é o valor do PERÍODO REAL: um
 * par que liquida de 4 em 4 horas paga metade do valor normalizado a cada
 * liquidação — e paga duas vezes mais vezes.
 *
 * Confundir os dois é o erro que faz um par de 1h parecer oito vezes melhor
 * do que é numa captura de liquidação única.
 */
export function fundingPorLiquidacao(funding8h: number, intervaloHoras: number): number {
  return funding8h * (Math.max(1, intervaloHoras) / 8);
}

/**
 * As duas pernas liquidam dentro da mesma janela de posse?
 *
 * Numa operação entre exchanges o lucro é a DIFERENÇA entre dois fundings, e
 * ela só se realiza se as duas pernas liquidarem enquanto a posição está
 * montada. Com intervalos iguais e âncora comum (00:00 UTC), as liquidações
 * coincidem. Com intervalos diferentes, a perna mais lenta manda: é preciso
 * segurar até ela liquidar, e nesse meio tempo a perna rápida liquida várias
 * vezes — o que muda a conta e não está modelado aqui.
 *
 * Enquanto não estiver modelado, só o caso alinhado é elegível. Recusar o que
 * não sabemos calcular é mais barato que calcular errado.
 */
export function alinhamento(intervaloShort: number, intervaloLong: number): {
  alinhado: boolean; motivo: string;
} {
  if (intervaloShort === intervaloLong) {
    return { alinhado: true, motivo: `as duas liquidam a cada ${intervaloShort}h, na mesma âncora` };
  }
  return {
    alinhado: false,
    motivo: `intervalos diferentes (${intervaloShort}h × ${intervaloLong}h) — captura numa janela só não está modelada`,
  };
}

export interface EntradaCaptura {
  /** spread médio já normalizado para 8h, em fração */
  spread8h: number;
  /** intervalo de liquidação, em horas — precisa ser o REAL, não o assumido */
  intervaloHoras: number;
  /** taxa por perna e por lado, JÁ com escorregamento medido (ver livro.ts) */
  taxaEfetiva: number;
  /** quantas vezes o pagamento precisa cobrir o custo para valer abrir */
  margem: number;
}

export interface Captura {
  /** o que uma liquidação paga, em fração do notional */
  pagamentoPorLiquidacao: number;
  /** entrar e sair: 2 pernas × 2 lados */
  custoIdaEVolta: number;
  /** quantas vezes o pagamento cobre o custo */
  cobertura: number;
  /** sobra líquida de uma captura, em fração do notional */
  liquidoPorLiquidacao: number;
  vale: boolean;
}

/**
 * Vale abrir para capturar UMA liquidação?
 *
 * Note o que NÃO aparece aqui: estimador de vida, consistência, duração já
 * vivida. Nada disso entra, porque a posição não precisa sobreviver a horas de
 * mercado — precisa sobreviver até um instante conhecido. O que sobra é uma
 * comparação entre o que a liquidação paga e o que custa entrar e sair.
 *
 * Como todo o resto do projeto, é independente do notional: ele multiplica os
 * dois lados e se cancela.
 */
export function avaliarCaptura(e: EntradaCaptura): Captura {
  const pagamentoPorLiquidacao = fundingPorLiquidacao(e.spread8h, e.intervaloHoras);
  const custoIdaEVolta = e.taxaEfetiva * 4;
  const cobertura = custoIdaEVolta > 0 ? pagamentoPorLiquidacao / custoIdaEVolta : 0;
  return {
    pagamentoPorLiquidacao,
    custoIdaEVolta,
    cobertura,
    liquidoPorLiquidacao: pagamentoPorLiquidacao - custoIdaEVolta,
    vale: cobertura >= e.margem,
  };
}
