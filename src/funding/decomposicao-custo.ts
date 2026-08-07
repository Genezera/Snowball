/**
 * DECOMPOSIÇÃO DE CUSTO — read-only, sobre eventos já gravados.
 *
 * Separa o que já está implícito no diário em duas classes, porque elas têm
 * significado econômico diferente:
 *
 *   TRADING PURO       taxa+escorregamento de abrir e fechar uma posição —
 *                       o preço de participar do mercado.
 *   GERENCIAMENTO       escalonamento, apara, reinvestimento — o preço de
 *                       MANTER a posição segura e no tamanho certo. Existe
 *                       para reduzir risco de concentração/liquidação, não
 *                       para especular.
 *
 * A distinção importa porque um fee-to-gross alto pode ter duas causas muito
 * diferentes: trading caro (o mercado não compensa o custo de entrar/sair) ou
 * gerenciamento caro (a proteção está comendo o resultado). Tratá-las como um
 * número só, como o motor fazia até aqui, esconde qual delas — se alguma —
 * vale a pena atacar.
 *
 * Puramente de LEITURA sobre `spread/diario.jsonl` — não muda nenhum evento,
 * não influencia nenhuma decisão.
 */

export interface EventoCusto {
  evento: string;
  custo?: number;
  categoria?: 'trade' | 'gerenciamento';
  modo?: 'persistencia' | 'captura';
}

export interface DecomposicaoCusto {
  taxaEntrada: number;
  taxaSaida: number;
  custoEscalonamento: number;
  custoApara: number;
  custoReinvestimento: number;
  /** eventos 'socorre' têm custo zero por desenho (reserva interna, sem taxa) — mantido separado pra auditar que continua zero */
  custoRebalanceamento: number;
  /** fechamentos rotulados como emergência/crítico, se o campo motivo indicar */
  custoEmergencial: number;
  custoTradingPuro: number;
  custoGerenciamento: number;
  custoTotal: number;
}

/**
 * Classifica um evento por categoria quando o campo `categoria` não está
 * presente (eventos antigos, gravados antes desta instrumentação existir).
 * Mantém compatibilidade com o histórico já em disco sem precisar reescrevê-lo.
 */
function categoriaDe(e: EventoCusto): 'trade' | 'gerenciamento' | 'rebalanceamento' | null {
  if (e.categoria) return e.categoria === 'trade' ? 'trade' : 'gerenciamento';
  switch (e.evento) {
    case 'abre': case 'abre-captura': case 'fecha': return 'trade';
    case 'escalona': case 'apara': case 'reinveste': return 'gerenciamento';
    case 'socorre': return 'rebalanceamento';
    default: return null;
  }
}

export function decompor(eventos: EventoCusto[]): DecomposicaoCusto {
  let taxaEntrada = 0, taxaSaida = 0, custoEscalonamento = 0, custoApara = 0;
  let custoReinvestimento = 0, custoRebalanceamento = 0, custoEmergencial = 0;

  for (const e of eventos) {
    const custo = e.custo ?? 0;
    const cat = categoriaDe(e);
    if (cat === 'trade') {
      if (e.evento === 'abre' || e.evento === 'abre-captura') taxaEntrada += custo;
      else if (e.evento === 'fecha') taxaSaida += custo;
    } else if (cat === 'gerenciamento') {
      if (e.evento === 'escalona') custoEscalonamento += custo;
      else if (e.evento === 'apara') custoApara += custo;
      else if (e.evento === 'reinveste') custoReinvestimento += custo;
    } else if (cat === 'rebalanceamento') {
      custoRebalanceamento += custo; // esperado ser 0 — ver docstring
    }
  }

  const custoTradingPuro = taxaEntrada + taxaSaida;
  const custoGerenciamento = custoEscalonamento + custoApara + custoReinvestimento + custoRebalanceamento;
  return {
    taxaEntrada, taxaSaida, custoEscalonamento, custoApara, custoReinvestimento,
    custoRebalanceamento, custoEmergencial,
    custoTradingPuro, custoGerenciamento,
    custoTotal: custoTradingPuro + custoGerenciamento + custoEmergencial,
  };
}

export interface FeeToGross {
  feeToGrossTrading: number;
  feeToGrossTotal: number;
}

/** fundingBruto no denominador — se for 0, devolve Infinity em vez de NaN, pra não silenciar o caso degenerado. */
export function feeToGross(d: DecomposicaoCusto, fundingBruto: number): FeeToGross {
  return {
    feeToGrossTrading: fundingBruto > 0 ? d.custoTradingPuro / fundingBruto : Infinity,
    feeToGrossTotal: fundingBruto > 0 ? d.custoTotal / fundingBruto : Infinity,
  };
}

/** Mesma decomposição, mas separada por strategyId — para a atribuição por estratégia (Etapa 2). */
export function decomporPorEstrategia(
  eventos: (EventoCusto & { strategyId?: string })[],
): Record<string, DecomposicaoCusto> {
  const grupos = new Map<string, EventoCusto[]>();
  for (const e of eventos) {
    const id = e.strategyId ?? (e.modo === 'captura' ? 'settlement_capture' : 'funding_standard');
    if (!grupos.has(id)) grupos.set(id, []);
    grupos.get(id)!.push(e);
  }
  const out: Record<string, DecomposicaoCusto> = {};
  for (const [id, evs] of grupos) out[id] = decompor(evs);
  return out;
}
