/**
 * RECONCILIAÇÃO DO PnL — item 6 do "fechamento das cinco páginas centrais".
 *
 * Identidade contábil esperada do estado do champion:
 *
 *     capital − capitalInicial  ==  fundingTotal − custosTotal
 *
 * ou seja, todo o PnL realizado tem que ser explicado por funding recebido
 * menos custos pagos. A diferença entre os dois lados é o resíduo de
 * reconciliação.
 *
 * Tolerância (as duas se aplicam, vence a MAIOR — um piso proporcional
 * pra PnLs grandes, um piso absoluto pra PnLs pequenos):
 *   - absoluta:   US$ 0.05  (ruído de arredondamento centavo-a-centavo)
 *   - percentual: 0.5% de |capital − capitalInicial|
 *
 * Três resultados honestos:
 *   - dentro da tolerância         → 'reconciliado'
 *   - fora da tolerância           → 'divergente'
 *   - algum campo ausente/inválido → 'nao_instrumentado' (nunca "reconciliado
 *     por omissão": sem os quatro números não há o que reconciliar)
 */
export const TOLERANCIA_ABSOLUTA = 0.05;   // US$
export const TOLERANCIA_PERCENTUAL = 0.005; // 0.5% (fração)

export type StatusReconciliacao = 'reconciliado' | 'divergente' | 'nao_instrumentado';

export interface EntradaReconciliacao {
  fundingTotal?: number | null;
  custosTotal?: number | null;
  capital?: number | null;
  capitalInicial?: number | null;
}

export interface ResultadoReconciliacao {
  status: StatusReconciliacao;
  fundMenosCustos: number | null;
  capMenosInicial: number | null;
  dif: number | null;
  tolAbs: number;
  tolPct: number;
  /** tolerância efetiva aplicada = max(tolAbs, tolPct·|capMenosInicial|) */
  tolEfetiva: number | null;
  reconciliado: boolean;
  campoAusente: string | null;
}

function ausente(v: unknown): boolean {
  return v === null || v === undefined || typeof v !== 'number' || !Number.isFinite(v);
}

export function reconciliarPnl(e: EntradaReconciliacao): ResultadoReconciliacao {
  const faltando =
    ausente(e.fundingTotal) ? 'fundingTotal'
      : ausente(e.custosTotal) ? 'custosTotal'
        : ausente(e.capital) ? 'capital'
          : ausente(e.capitalInicial) ? 'capitalInicial'
            : null;

  if (faltando) {
    return {
      status: 'nao_instrumentado',
      fundMenosCustos: null, capMenosInicial: null, dif: null,
      tolAbs: TOLERANCIA_ABSOLUTA, tolPct: TOLERANCIA_PERCENTUAL, tolEfetiva: null,
      reconciliado: false, campoAusente: faltando,
    };
  }

  const fundMenosCustos = (e.fundingTotal as number) - (e.custosTotal as number);
  const capMenosInicial = (e.capital as number) - (e.capitalInicial as number);
  const dif = capMenosInicial - fundMenosCustos;
  const tolEfetiva = Math.max(TOLERANCIA_ABSOLUTA, TOLERANCIA_PERCENTUAL * Math.abs(capMenosInicial));
  const reconciliado = Math.abs(dif) <= tolEfetiva;

  return {
    status: reconciliado ? 'reconciliado' : 'divergente',
    fundMenosCustos, capMenosInicial, dif,
    tolAbs: TOLERANCIA_ABSOLUTA, tolPct: TOLERANCIA_PERCENTUAL, tolEfetiva,
    reconciliado, campoAusente: null,
  };
}
