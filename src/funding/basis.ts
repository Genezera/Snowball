/**
 * BASIS TRADE — comprar à vista, vender o perpétuo na MESMA exchange.
 *
 * Diferença central pro spread entre exchanges (spread.ts/universo.ts): ali
 * o lucro é a DIFERENÇA entre dois fundings, corroída por taxa dos dois
 * lados. Aqui é o funding INTEIRO de uma perna só — o payback cai muito
 * mais rápido pro mesmo ativo, porque não se está apostando numa diferença
 * fina entre dois números parecidos.
 *
 * O preço disso, medido, não estimado:
 *
 *   · CAPITAL: a perna à vista precisa do notional inteiro em caixa; a perna
 *     do perpétuo só da margem. Capital necessário = notional × (1 + 1/alav).
 *     Contra spread entre exchanges, onde as duas pernas são margem:
 *     capital = notional × (2/alav). A 5x, isso é 1,2× contra 0,4× —
 *     basis pede 3x mais capital pro mesmo notional.
 *
 *   · CUSTÓDIA CONCENTRADA. As duas pernas ficam na MESMA exchange — quebra
 *     a diluição de risco de custódia que o projeto inteiro foi construído
 *     em cima (metade do capital em cada uma de duas exchanges). Isto não
 *     está mitigado aqui — é um risco novo que precisa de decisão
 *     explícita antes de qualquer capital de verdade (mesmo paper) entrar.
 *
 *   · SEM DADO DE PERSISTÊNCIA AINDA. O projeto mede há dias quanto tempo
 *     um SPREAD ENTRE EXCHANGES sobrevive (vigilancia.ts, coletor). Não
 *     existe o equivalente pra funding de UMA exchange só — os números
 *     aqui dizem "quanto tempo precisaria viver", não "quanto tempo
 *     costuma viver". As duas coisas são diferentes, e só a segunda decide
 *     se vale a pena de verdade.
 */

const PAGAMENTOS_POR_HORA = 3 / 24;

export interface EntradaBasis {
  /** funding por período de 8h, já normalizado — mesma convenção do resto do projeto */
  funding8h: number;
  /** taxa taker da perna do perpétuo, fração */
  taxaPerp: number;
  /** taxa taker da perna à vista, fração — geralmente maior que a de perp */
  taxaSpot: number;
}

export interface ValorBasis {
  paybackHoras: number;
  taxaMedia: number;
}

/**
 * Payback é INDEPENDENTE do notional — mesma propriedade que decide tudo no
 * resto do projeto ("o notional se cancela"). Só depende de taxa e funding.
 */
export function avaliarBasis(e: EntradaBasis): ValorBasis {
  const taxaMedia = (e.taxaPerp + e.taxaSpot) / 2;
  const custoFracao = taxaMedia * 4; // 2 pernas (spot, perp) × (entrada + saída)
  const paybackHoras = e.funding8h > 0
    ? custoFracao / (e.funding8h * PAGAMENTOS_POR_HORA)
    : Infinity;
  return { paybackHoras, taxaMedia };
}

/**
 * Capital necessário pra sustentar um notional N nesta estrutura: a perna à
 * vista pede N inteiro, a perna do perpétuo só a margem (N/alavancagem).
 */
export function capitalNecessario(notional: number, alavancagem: number): number {
  return notional * (1 + 1 / alavancagem);
}

/** O inverso: quanto notional um capital C sustenta, dada a alavancagem. */
export function notionalSustentavel(capital: number, alavancagem: number): number {
  return capital / (1 + 1 / alavancagem);
}

export interface ParFunding {
  symbol: string;
  exchange: string;
  funding: number;
  intervaloHoras: number;
  volume24h: number;
}

export interface CandidatoBasis {
  symbol: string;
  exchange: string;
  funding8h: number;
  aprFunding: number;
  volume24h: number;
}

/**
 * Candidatos a basis trade: funding positivo (só assim vender o perpétuo
 * RECEBE, não paga) e volume acima do piso. Não cruza exchange nenhuma —
 * cada listagem é candidata por conta própria.
 */
export function candidatosBasis(pares: ParFunding[], volumeMinimo: number): CandidatoBasis[] {
  return pares
    .filter((p) => p.funding > 0 && p.volume24h >= volumeMinimo)
    .map((p) => {
      const funding8h = p.funding * (8 / (p.intervaloHoras || 8));
      return {
        symbol: p.symbol, exchange: p.exchange, funding8h,
        aprFunding: funding8h * 3 * 365, volume24h: p.volume24h,
      };
    })
    .sort((a, b) => b.aprFunding - a.aprFunding);
}
