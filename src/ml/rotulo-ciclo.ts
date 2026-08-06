/**
 * REGRA DE RÓTULO PARA UM CICLO ARQUIVADO DA VIGILÂNCIA — extraída de
 * `lerStatusML` (dashboard/server.ts) pra um único lugar, porque o pipeline
 * de treino real (`prontidao-vigilancia.ts`) precisa da MESMA regra pra
 * rotular exemplos, e duplicar a fórmula em dois arquivos é como bugs de
 * "esqueci de atualizar os dois" acontecem.
 *
 * "Positivo" aqui não é lucro realizado — é "este ciclo, do jeito que
 * terminou, teria cruzado o portão de valor esperado" (vida esperada ≥
 * 1,5× o payback exigido pela taxa). É a mesma pergunta que o motor faz ao
 * vivo, aplicada ao registro fechado.
 */
export interface CicloArquivado {
  chave: string;
  symbol: string;
  exchangeShort: string;
  exchangeLong: string;
  abertoEm: number;
  fechadoEm: number;
  observacoes: number;
  spreadMedio: number;
  consistencia: number;
}

export const TAXA_PADRAO = 0.0005;
export const NOTIONAL_PADRAO = 250;
export const PAGAMENTOS_POR_HORA_PADRAO = 3 / 24;
export const MARGEM_PADRAO = 1.5;
/** abaixo disso a amostra de observações do ciclo é rala demais pra confiar na média. */
export const DENSIDADE_MINIMA = 0.15;

export interface AvaliacaoCiclo {
  confiavel: boolean;
  positivo: boolean;
  duracaoHoras: number;
  paybackHoras: number;
  vidaEsperadaHoras: number;
}

export function avaliarCicloArquivado(
  c: CicloArquivado,
  taxa = TAXA_PADRAO, notional = NOTIONAL_PADRAO,
  pagamentosPorHora = PAGAMENTOS_POR_HORA_PADRAO, margem = MARGEM_PADRAO,
): AvaliacaoCiclo {
  const duracaoHoras = (c.fechadoEm - c.abertoEm) / 3_600_000;
  const esperadas = Math.max(1, duracaoHoras * 12);
  const confiavel = c.observacoes / esperadas >= DENSIDADE_MINIMA;

  const custo = notional * taxa * 4;
  const paybackHoras = c.spreadMedio > 0 ? custo / (notional * c.spreadMedio * pagamentosPorHora) : Infinity;
  const vidaEsperadaHoras = duracaoHoras * c.consistencia;
  const positivo = confiavel && vidaEsperadaHoras >= paybackHoras * margem;

  return { confiavel, positivo, duracaoHoras, paybackHoras, vidaEsperadaHoras };
}
