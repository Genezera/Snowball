/**
 * FUNDING EXTREMO COMO SINAL CONTRÁRIO DE PREÇO — mecanismo nunca testado
 * neste projeto.
 *
 * Tudo que já foi construído em `src/funding/` trata funding como FONTE DE
 * RENDA: a diferença entre exchanges (spread), ou o valor absoluto pago numa
 * liquidação (captura). Aqui funding é lido como SINAL DE POSICIONAMENTO —
 * funding muito positivo significa que a maioria do mercado está comprada e
 * pagando para segurar a posição. Isso é fragilidade, não oportunidade de
 * renda: um mercado "lotado" de um lado reage desproporcionalmente a
 * qualquer notícia contrária, porque a saída em massa (fechar posições
 * compradas = vender) empurra o preço na mesma direção que os fecha, em
 * cascata. Funding extremo como sinal CONTRÁRIO de preço é hipótese clássica
 * de mercado cripto — a pergunta é se sobrevive a teste rigoroso.
 *
 * ── o desenho ────────────────────────────────────────────────────────────
 *
 * Threshold ROLANTE e CAUSAL (percentil dos últimos N dias, olhando só para
 * trás) — cada ativo tem faixa de funding própria (BTC quase nunca sai de
 * ±0,01%; um shitcoin pode oscilar ordens de grandeza mais), então um corte
 * absoluto global não faz sentido. Quando o funding do dia cruza o percentil
 * extremo da própria janela do ativo, abre na direção CONTRÁRIA e segura por
 * um prazo fixo — sem tentar adivinhar quando a posição vai reverter, só
 * aposta que o extremo de positioning se resolve dentro do prazo.
 */
import type { Bar } from '../core/types.ts';
import type { RegistroFunding } from '../data/funding-history.ts';

export interface ParametrosContrario {
  /** janela causal para o percentil, em dias */
  janelaDias: number;
  /** percentil que define "extremo" (ex 0.10 = abaixo do p10 ou acima do p90) */
  percentilExtremo: number;
  /** quantos dias segurar a posição contrária */
  diasSegurar: number;
  taxaTaker: number;
  slippage: number;
}

export const PARAMETROS_PADRAO: ParametrosContrario = {
  janelaDias: 60, percentilExtremo: 0.10, diasSegurar: 5,
  taxaTaker: 0.0005, slippage: 0.0005,
};

export interface TradeContrario {
  entradaIdx: number;
  saidaIdx: number;
  direcao: 'long' | 'short';
  fundingNaEntrada: number;
  /** retorno líquido, fração do notional */
  retorno: number;
}

/** Funding médio do dia — usa a média das leituras de 8h daquele dia civil UTC. */
function fundingPorDia(bars: Bar[], registros: RegistroFunding[]): (number | null)[] {
  const porDia = new Map<string, number[]>();
  for (const r of registros) {
    const dia = new Date(r.t).toISOString().slice(0, 10);
    if (!porDia.has(dia)) porDia.set(dia, []);
    porDia.get(dia)!.push(r.fundingRate);
  }
  return bars.map((b) => {
    const dia = new Date(b.t).toISOString().slice(0, 10);
    const vals = porDia.get(dia);
    if (!vals || !vals.length) return null;
    return vals.reduce((a, c) => a + c, 0) / vals.length;
  });
}

/** Percentil de um array já ordenado. */
function percentilOrdenado(ordenado: number[], p: number): number {
  if (!ordenado.length) return 0;
  const idx = Math.min(ordenado.length - 1, Math.max(0, Math.floor(p * ordenado.length)));
  return ordenado[idx];
}

/**
 * Roda o backtest sobre UM ativo. `bars` e `registrosFunding` não precisam
 * estar alinhados por índice — a função alinha por dia civil UTC.
 */
export function backtestContrario(
  bars: Bar[], registrosFunding: RegistroFunding[], p: ParametrosContrario = PARAMETROS_PADRAO,
): TradeContrario[] {
  const fundingDiario = fundingPorDia(bars, registrosFunding);
  const trades: TradeContrario[] = [];
  let emPosicao: { idx: number; direcao: 'long' | 'short'; funding: number } | null = null;

  for (let i = p.janelaDias; i < bars.length; i++) {
    if (emPosicao) {
      const dentro = i - emPosicao.idx;
      if (dentro >= p.diasSegurar || i === bars.length - 1) {
        const precoEntrada = bars[emPosicao.idx].c, precoSaida = bars[i].c;
        const retornoPreco = precoSaida / precoEntrada - 1;
        const bruto = emPosicao.direcao === 'long' ? retornoPreco : -retornoPreco;
        const custo = (p.taxaTaker + p.slippage) * 2; // 1 perna, entrada+saída
        trades.push({
          entradaIdx: emPosicao.idx, saidaIdx: i, direcao: emPosicao.direcao,
          fundingNaEntrada: emPosicao.funding, retorno: bruto - custo,
        });
        emPosicao = null;
      }
      continue;
    }

    const fundingHoje = fundingDiario[i];
    if (fundingHoje == null) continue;

    // janela causal: só funding de dias ANTERIORES a hoje, nunca inclui hoje
    const janela = fundingDiario.slice(Math.max(0, i - p.janelaDias), i).filter((v): v is number => v != null);
    if (janela.length < p.janelaDias * 0.5) continue; // dado esparso demais pra confiar no percentil

    const ordenado = [...janela].sort((a, b) => a - b);
    const limiarAlto = percentilOrdenado(ordenado, 1 - p.percentilExtremo);
    const limiarBaixo = percentilOrdenado(ordenado, p.percentilExtremo);

    // Desigualdade ESTRITA de propósito: "extremo" precisa ULTRAPASSAR o
    // limiar, não empatar com ele. Com igualdade (>=), uma janela onde o
    // valor modal já toca o percentil (comum quando há poucos valores
    // distintos) reabriria posição todo dia em que o dia atual repetisse
    // esse valor — achado testando com dado sintético "calmo" (funding
    // quase constante), onde o p90 de 60 dias quase idênticos é o próprio
    // valor típico.
    if (fundingHoje > limiarAlto && limiarAlto > 0) {
      // funding muito positivo: mercado lotado de comprado -> aposta CONTRÁRIA: short
      emPosicao = { idx: i, direcao: 'short', funding: fundingHoje };
    } else if (fundingHoje < limiarBaixo && limiarBaixo < 0) {
      // funding muito negativo: mercado lotado de vendido -> aposta CONTRÁRIA: long
      emPosicao = { idx: i, direcao: 'long', funding: fundingHoje };
    }
  }
  return trades;
}
