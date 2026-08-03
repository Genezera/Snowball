/**
 * IMPOSTO DE RENDA — aproximação para o simulador, não parecer jurídico.
 *
 * Regra usada, pessoa física, cripto no Brasil (IN RFB 1.888/2019):
 *
 *   · ISENÇÃO: alienações (vendas) do mês somando até R$ 35.000 não pagam
 *     imposto, qualquer que seja o lucro.
 *   · ACIMA da isenção: 15% sobre o GANHO do mês (faixa até R$ 5 milhões;
 *     este projeto nunca chega perto disso, então as faixas maiores não
 *     estão implementadas).
 *
 * O que este módulo NÃO resolve, porque a lei não é clara para o caso e um
 * número falso é pior que a lacuna:
 *
 *   · Se o funding recebido em perpétuo é "ganho de capital" (alienação) ou
 *     rendimento tributado por outra regra (ex.: juros). Tratamos como parte
 *     do ganho de capital do mês — é a leitura mais comum entre corretoras,
 *     não uma opinião jurídica.
 *   · Compensação de prejuízo entre meses, que a lei permite. Este simulador
 *     tributa mês a mês, isoladamente.
 *
 * Consulte um contador antes de qualquer declaração real. Ver
 * docs/BACKLOG.md item B8 e docs/ROADMAP.md.
 */

export const ISENCAO_MENSAL_BRL = 35_000;
export const ALIQUOTA = 0.15;

/**
 * Câmbio aproximado, só para o simulador ter uma ordem de grandeza. Não é
 * cotação ao vivo — o motor não opera em BRL, só lê funding em cripto/USDT.
 */
export const USD_BRL_APROXIMADO = 5.30;

export interface ResultadoMesImposto {
  volumeVendasBRL: number;
  ganhoBRL: number;
  isento: boolean;
  impostoDevidoBRL: number;
  liquidoBRL: number;
}

/**
 * @param volumeVendasUsd soma do notional das duas pernas em toda posição
 *   FECHADA no mês (montar e desmontar, cada perna conta como alienação).
 * @param ganhoUsd funding recebido menos custos pagos no mês, em dólares.
 */
export function calcularImpostoMes(
  volumeVendasUsd: number,
  ganhoUsd: number,
  fx: number = USD_BRL_APROXIMADO,
): ResultadoMesImposto {
  const volumeVendasBRL = volumeVendasUsd * fx;
  const ganhoBRL = ganhoUsd * fx;
  const isento = volumeVendasBRL <= ISENCAO_MENSAL_BRL;
  const impostoDevidoBRL = (isento || ganhoBRL <= 0) ? 0 : ganhoBRL * ALIQUOTA;
  return {
    volumeVendasBRL, ganhoBRL, isento, impostoDevidoBRL,
    liquidoBRL: ganhoBRL - impostoDevidoBRL,
  };
}
