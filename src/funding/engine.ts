/**
 * MOTOR DELTA-NEUTRO — o sistema que gera renda semanal.
 *
 * Estrutura com US$ 100:
 *   US$ 75 comprando o ativo no spot
 *   US$ 25 de margem sustentando US$ 75 vendidos no perpétuo (3x)
 *   Exposição líquida a preço: ZERO
 *   Notional que coleta funding: US$ 75
 *
 * Por que 3x na perna vendida e não mais: a liquidação viria a ~33% de alta.
 * Como o spot sobe junto, o ganho lá cobre a chamada de margem. Acima de 5x a
 * folga fica pequena demais para movimentos de um dia em altcoin.
 *
 * Por que 3x e não menos: cada ponto de alavancagem aumenta proporcionalmente
 * o notional que coleta funding. A 1x seriam US$ 50; a 3x são US$ 75.
 */

export interface Posicao {
  symbol: string;
  /** valor investido no spot */
  spot: number;
  /** margem alocada para a perna vendida */
  margem: number;
  /** notional vendido no perpétuo — igual ao spot para ficar neutro */
  notionalShort: number;
  precoEntrada: number;
  abertaEm: number;
  fundingAcumulado: number;
  pagamentos: number;
}

export interface ConfigMotor {
  /** alavancagem da perna vendida */
  alavancagemShort: number;
  /** taxa taker no spot */
  taxaSpot: number;
  /** taxa taker no perpétuo */
  taxaPerp: number;
  /** distância de alta que dispara chamada de margem antes da liquidação */
  margemDeSeguranca: number;
  /** funding médio abaixo do qual a posição é desmontada */
  fundingMinimoParaManter: number;
  /** dias mínimos antes de considerar troca — impede girar e queimar taxa */
  diasMinimos: number;
}

export const CONFIG_PADRAO: ConfigMotor = {
  alavancagemShort: 3,
  taxaSpot: 0.001,
  taxaPerp: 0.0005,
  margemDeSeguranca: 0.25,
  fundingMinimoParaManter: 0.00002,
  diasMinimos: 5,
};

/**
 * Divide o capital entre spot e margem, mantendo neutralidade.
 *
 * capital = spot + margem, e margem = spot / alavancagem
 * logo: spot = capital × alavancagem / (alavancagem + 1)
 */
export function dimensionar(capital: number, cfg: ConfigMotor = CONFIG_PADRAO): {
  spot: number; margem: number; notional: number; custoEntrada: number;
} {
  const spot = (capital * cfg.alavancagemShort) / (cfg.alavancagemShort + 1);
  const margem = capital - spot;
  const custoEntrada = spot * cfg.taxaSpot + spot * cfg.taxaPerp;
  return { spot, margem, notional: spot, custoEntrada };
}

export function abrir(
  symbol: string, capital: number, preco: number, cfg: ConfigMotor = CONFIG_PADRAO,
): { posicao: Posicao; custo: number } {
  const d = dimensionar(capital, cfg);
  return {
    posicao: {
      symbol, spot: d.spot, margem: d.margem, notionalShort: d.notional,
      precoEntrada: preco, abertaEm: Date.now(), fundingAcumulado: 0, pagamentos: 0,
    },
    custo: d.custoEntrada,
  };
}

/** Recebe (ou paga) um ciclo de funding. Acontece 3 vezes por dia. */
export function aplicarFunding(p: Posicao, taxa: number): Posicao {
  const ganho = p.notionalShort * taxa;
  return { ...p, fundingAcumulado: p.fundingAcumulado + ganho, pagamentos: p.pagamentos + 1 };
}

/**
 * Verifica a saúde da posição.
 *
 * O ponto que importa: numa alta forte, a perna vendida perde e consome margem.
 * Mas o spot sobe na mesma proporção — o patrimônio total não muda. O risco é
 * de CHAMADA DE MARGEM, não de perda: pode ser preciso mover valor do spot
 * para a margem antes que a exchange liquide.
 */
export function saude(p: Posicao, precoAtual: number, cfg: ConfigMotor = CONFIG_PADRAO): {
  variacao: number;
  perdaNoShort: number;
  ganhoNoSpot: number;
  patrimonio: number;
  margemRestante: number;
  precisaRebalancear: boolean;
  emPerigo: boolean;
} {
  const variacao = precoAtual / p.precoEntrada - 1;
  const perdaNoShort = p.notionalShort * variacao;
  const ganhoNoSpot = p.spot * variacao;
  const margemRestante = p.margem - perdaNoShort;
  const patrimonio = p.spot + ganhoNoSpot + margemRestante + p.fundingAcumulado;
  const fracaoMargem = margemRestante / p.margem;

  return {
    variacao, perdaNoShort, ganhoNoSpot, patrimonio, margemRestante,
    // rebalancear quando a margem cai abaixo da folga de segurança
    precisaRebalancear: fracaoMargem < cfg.margemDeSeguranca * 2,
    emPerigo: fracaoMargem < cfg.margemDeSeguranca,
  };
}

/**
 * Move valor do spot para a margem quando a alta consome a perna vendida.
 *
 * É a operação que mantém o sistema vivo numa alta forte. O patrimônio não
 * muda — só a distribuição interna. Sem isso, a exchange liquidaria a perna
 * vendida e a posição deixaria de ser neutra no pior momento possível.
 */
export function rebalancearMargem(p: Posicao, precoAtual: number, cfg: ConfigMotor = CONFIG_PADRAO): {
  posicao: Posicao; transferido: number; custo: number;
} {
  const s = saude(p, precoAtual, cfg);
  const margemAlvo = p.notionalShort / cfg.alavancagemShort;
  const falta = margemAlvo - s.margemRestante;
  if (falta <= 0) return { posicao: p, transferido: 0, custo: 0 };

  // vende parte do spot para repor a margem
  const vender = Math.min(falta, p.spot * (1 + s.variacao) * 0.5);
  const custo = vender * cfg.taxaSpot;
  return {
    posicao: {
      ...p,
      spot: p.spot - vender / (1 + s.variacao),
      margem: p.margem + vender - custo,
      // o notional vendido encolhe junto para manter a neutralidade
      notionalShort: p.notionalShort - vender / (1 + s.variacao),
    },
    transferido: vender, custo,
  };
}

export function fechar(p: Posicao, precoAtual: number, cfg: ConfigMotor = CONFIG_PADRAO): {
  patrimonio: number; custo: number; lucro: number;
} {
  const s = saude(p, precoAtual, cfg);
  const custo = p.spot * (1 + s.variacao) * cfg.taxaSpot + p.notionalShort * cfg.taxaPerp;
  const patrimonio = s.patrimonio - custo;
  return { patrimonio, custo, lucro: p.fundingAcumulado - custo };
}

/**
 * Decide se vale trocar de ativo.
 *
 * Trocar custa entrada e saída. Com capital pequeno, girar atrás do funding
 * mais alto queima mais em taxa do que ganha em rendimento. A troca só
 * acontece quando o ganho projetado supera o custo com folga.
 */
export function valeTrocar(
  atual: { funding: number; diasAberta: number },
  candidato: { funding: number },
  notional: number,
  cfg: ConfigMotor = CONFIG_PADRAO,
): { trocar: boolean; motivo: string } {
  if (atual.diasAberta < cfg.diasMinimos) {
    return { trocar: false, motivo: `só ${atual.diasAberta.toFixed(1)} dias abertos (mín ${cfg.diasMinimos})` };
  }
  if (atual.funding < cfg.fundingMinimoParaManter) {
    return { trocar: true, motivo: `funding atual ${(atual.funding * 100).toFixed(4)}% abaixo do mínimo` };
  }
  const custoTroca = notional * (cfg.taxaSpot + cfg.taxaPerp) * 2;
  const ganhoExtraPorDia = (candidato.funding - atual.funding) * notional * 3;
  if (ganhoExtraPorDia <= 0) return { trocar: false, motivo: 'candidato não é melhor' };
  const diasParaPagar = custoTroca / ganhoExtraPorDia;
  return diasParaPagar < 10
    ? { trocar: true, motivo: `troca se paga em ${diasParaPagar.toFixed(1)} dias` }
    : { trocar: false, motivo: `troca levaria ${diasParaPagar.toFixed(0)} dias para se pagar` };
}
