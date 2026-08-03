/**
 * TESOURARIA: o dinheiro tratado como ele existe de fato.
 *
 * O motor tratava capital como um número único, e "alocar uma posição" como
 * dividir esse número. Isso escondia a realidade: **o dinheiro está em contas
 * separadas, em exchanges separadas, e não se move entre elas sem saque
 * on-chain.**
 *
 * Duas coisas quebravam por causa disso:
 *
 * 1. O TETO POR EXCHANGE ERA INSATISFAZÍVEL. Cem por cento das oportunidades
 *    medidas usam apenas binance e bybit. Com duas exchanges, a concentração
 *    mínima possível é 50% — sempre. Um teto de 40% bloqueava a primeira
 *    abertura, e isso nunca apareceu no log só porque o portão de valor
 *    esperado roda antes e barrava tudo primeiro.
 *
 * 2. A TRANSFERÊNCIA DE MARGEM ERA FICÇÃO. Saque entre exchanges tem mínimo de
 *    US$ 10, leva minutos, e está sujeito a trava de 24h, whitelist e limite de
 *    KYC. A US$ 100 de capital a transferência necessária ficava abaixo do
 *    mínimo e simplesmente não podia ser feita.
 *
 * ── o modelo novo ─────────────────────────────────────────────────────────
 *
 * Cada exchange tem um saldo próprio. Uma posição consome margem dos saldos das
 * duas exchanges que ela usa. O que sobra em cada uma é **reserva local**, e é
 * com ela que se socorre uma perna apertada — transferência interna de spot
 * para futuros: instantânea, sem taxa, sem mínimo, sem trava.
 *
 * **Nenhum dinheiro cruza entre exchanges. Nunca.**
 *
 * ── quanto deixar de reserva ──────────────────────────────────────────────
 *
 * Medido em 20 mil simulações de 90 dias, com US$ 100 em cada exchange:
 *
 *   reserva   liquidado   mediana
 *   0%        0,00%       US$ 203,39   ← sem socorro, fecha demais
 *   15%       0,01%       US$ 213,07
 *   25%       0,04%       US$ 214,59   ← ótimo
 *   35%       0,01%       US$ 214,11
 *   50%       0,00%       US$ 211,79
 *   65%       0,01%       US$ 208,51   ← capital demais parado
 *
 * A curva é plana entre 15% e 35%, então 30% é a escolha: perto do ótimo e do
 * lado seguro dele.
 */

/** fração do saldo de cada exchange que fica livre, como reserva de socorro */
export const RESERVA_PADRAO = 0.30;

export interface Saldos {
  /** dinheiro total em cada exchange: margem comprometida mais reserva livre */
  [exchange: string]: number;
}

export interface UsoExchange {
  saldo: number;
  margemUsada: number;
  livre: number;
  fracaoLivre: number;
}

/**
 * Quanto de cada exchange está comprometido e quanto está livre.
 *
 * `margens` é a soma das margens de todas as pernas naquela exchange.
 */
export function usoPorExchange(saldos: Saldos, margens: Record<string, number>): Record<string, UsoExchange> {
  const out: Record<string, UsoExchange> = {};
  for (const [ex, saldo] of Object.entries(saldos)) {
    const usada = margens[ex] ?? 0;
    const livre = Math.max(0, saldo - usada);
    out[ex] = { saldo, margemUsada: usada, livre, fracaoLivre: saldo > 0 ? livre / saldo : 0 };
  }
  return out;
}

export interface Dimensionamento {
  possivel: boolean;
  margemPorPerna: number;
  notionalPorPerna: number;
  reservaPorPerna: number;
  motivo: string;
}

/**
 * Quanto montar de uma posição, dado o que há livre nas duas exchanges.
 *
 * A margem é limitada pela exchange com MENOS saldo livre — as duas pernas têm
 * de ter o mesmo notional, senão a estrutura deixa de ser neutra em preço.
 *
 * `reserva` é a fração do saldo de cada exchange que fica de fora, para socorro.
 * Note que ela é calculada sobre o SALDO, não sobre o livre: o objetivo é que
 * sempre exista aquele colchão na conta, independentemente de quantas posições
 * já estejam montadas.
 */
export function dimensionar(
  saldos: Saldos, margens: Record<string, number>,
  exShort: string, exLong: string,
  alavancagem: number, reserva = RESERVA_PADRAO,
  minimoNotional = 5,
): Dimensionamento {
  const uso = usoPorExchange(saldos, margens);
  const a = uso[exShort], b = uso[exLong];

  if (!a || !b) {
    return {
      possivel: false, margemPorPerna: 0, notionalPorPerna: 0, reservaPorPerna: 0,
      motivo: `sem saldo declarado em ${!a ? exShort : exLong}`,
    };
  }

  // o colchão a preservar em cada exchange, em dólares
  const colchaoA = a.saldo * reserva, colchaoB = b.saldo * reserva;
  const disponivelA = a.livre - colchaoA, disponivelB = b.livre - colchaoB;
  const margem = Math.min(disponivelA, disponivelB);

  if (margem * alavancagem < minimoNotional) {
    return {
      possivel: false, margemPorPerna: 0, notionalPorPerna: 0, reservaPorPerna: 0,
      motivo: margem <= 0
        ? `sem margem livre acima da reserva de ${(reserva * 100).toFixed(0)}%`
        : `notional de US$ ${(margem * alavancagem).toFixed(2)} abaixo do mínimo de US$ ${minimoNotional}`,
    };
  }

  return {
    possivel: true,
    margemPorPerna: margem,
    notionalPorPerna: margem * alavancagem,
    reservaPorPerna: Math.min(colchaoA, colchaoB),
    motivo: `margem US$ ${margem.toFixed(2)}/perna, limitada por ${disponivelA <= disponivelB ? exShort : exLong}`,
  };
}

export interface Socorro {
  possivel: boolean;
  valor: number;
  motivo: string;
}

/**
 * Quanto dá para reforçar a perna apertada, com o que há livre NAQUELA exchange.
 *
 * A diferença para a transferência entre exchanges é toda: aqui o dinheiro já
 * está na conta certa. É um movimento interno de spot para futuros —
 * instantâneo, sem taxa, sem valor mínimo, e imune à trava de 24 horas, à
 * exigência de whitelist e ao limite diário de saque.
 *
 * Por isso o socorro pode ser pequeno e frequente, ao contrário da
 * transferência, que precisava passar de US$ 10 para existir.
 */
export function socorrer(
  saldos: Saldos, margens: Record<string, number>,
  exchange: string, faltando: number,
): Socorro {
  const uso = usoPorExchange(saldos, margens)[exchange];
  if (!uso) return { possivel: false, valor: 0, motivo: `sem saldo em ${exchange}` };
  if (uso.livre <= 0.01) {
    return { possivel: false, valor: 0, motivo: `reserva de ${exchange} esgotada` };
  }
  const valor = Math.min(uso.livre, Math.max(0, faltando));
  return {
    possivel: valor > 0.01,
    valor,
    motivo: valor >= faltando
      ? `reforço interno de US$ ${valor.toFixed(2)} em ${exchange}`
      : `reforço parcial de US$ ${valor.toFixed(2)} — reserva de ${exchange} quase no fim`,
  };
}

/**
 * Concentração: a maior fração do capital numa única exchange.
 *
 * Com apenas duas exchanges viáveis, isto fica em 50% por construção e não há o
 * que otimizar. A métrica continua sendo reportada porque é o risco real de
 * custódia — só não é mais tratada como algo que o motor possa reduzir.
 */
export function concentracao(saldos: Saldos): { exchange: string; fracao: number } {
  const total = Object.values(saldos).reduce((a, b) => a + b, 0);
  let pior = { exchange: '—', fracao: 0 };
  for (const [ex, v] of Object.entries(saldos)) {
    const f = total > 0 ? v / total : 0;
    if (f > pior.fracao) pior = { exchange: ex, fracao: f };
  }
  return pior;
}
