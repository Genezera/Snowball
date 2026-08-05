/**
 * RISCO DE LIQUIDAÇÃO POR PERNA — a lacuna que faltava fechar.
 *
 * O bootstrap de `desafio.ts` usa o `retorno` que `backtestPar` calcula —
 * mas esse número assume que a posição SEMPRE chega ao seu desfecho natural
 * (reversão, timeout, fim de dado). Ele não verifica se, no CAMINHO até lá,
 * alguma das duas pernas se moveu contra a margem o suficiente para ser
 * liquidada primeiro — o que forçaria o fechamento num preço muito pior, e
 * quebraria a estrutura market-neutral (uma perna liquidada deixa a outra
 * exposta, direcional, sem hedge).
 *
 * Medido nos 487 trades pooled (descoberta+holdout, meia-vida≤20): os 10
 * piores movimentos adversos intra-trade vão de 100% a 252% do preço de
 * entrada — moedas pequenas, com eventos de listagem/delistagem ou choques
 * de liquidez que o z-score do spread não captura, porque olha a DIFERENÇA
 * entre as pernas, não o nível absoluto de cada uma.
 *
 * ── por que isso muda a conclusão sobre concorrência ───────────────────────
 *
 * `desafio.ts` mostrava N=7 pares simultâneos (a concorrência real medida)
 * como "nem o melhor nem o pior caso", com 82,8% de chance de sucesso. Isso
 * ignorava que, a 5x de alavancagem com N=7, a margem por perna só aguenta
 * ~35% de movimento adverso antes de liquidar — e 12,7% dos trades reais
 * excedem isso. Ajustar o resultado para refletir liquidação de verdade (não
 * simplesmente substituir por um número fixo — isso mascarava o problema em
 * vez de resolvê-lo) exige ou parar de contar aqueles trades como o
 * `retorno` modelado, ou reduzir N até a margem aguentar o histórico
 * observado.
 *
 * A segunda opção é a que fica em produção: **N baixo o bastante para que a
 * liquidação seja desprezível**, aceitando crescimento mais lento em troca de
 * não estar exposto a um risco que o bootstrap simples não via.
 */
import type { Bar } from '../core/types.ts';
import type { TradePar } from './backtest.ts';

export interface ExcursaoTrade {
  /** maior movimento adverso, em qualquer uma das duas pernas, durante o trade */
  piorMovimento: number;
}

/**
 * Calcula, para cada trade, o pior movimento adverso de preço em QUALQUER
 * das duas pernas durante a janela aberta — usando máxima/mínima intrabarra
 * (high/low), não só o fechamento, porque é isso que decide liquidação numa
 * exchange de verdade.
 */
export function excursoesAdversas(
  trades: TradePar[], barsA: Bar[], barsB: Bar[],
): ExcursaoTrade[] {
  return trades.map((t) => {
    const precoEntradaA = barsA[t.entradaIdx].c, precoEntradaB = barsB[t.entradaIdx].c;
    let piorA = 0, piorB = 0;
    for (let i = t.entradaIdx; i <= t.saidaIdx && i < barsA.length; i++) {
      // curtoA: vendido em A (perde se A sobe), comprado em B (perde se B desce)
      const movA = t.direcao === 'curtoA' ? barsA[i].h / precoEntradaA - 1 : 1 - barsA[i].l / precoEntradaA;
      const movB = t.direcao === 'curtoA' ? 1 - barsB[i].l / precoEntradaB : barsB[i].h / precoEntradaB - 1;
      piorA = Math.max(piorA, movA);
      piorB = Math.max(piorB, movB);
    }
    return { piorMovimento: Math.max(piorA, piorB) };
  });
}

/**
 * Distância até liquidação de UMA perna, em fração de movimento adverso de
 * preço que a margem aguenta.
 *
 * Sob margem ISOLADA por posição (a suposição do resto deste projeto —
 * `tesouraria.ts` já trata cada posição com orçamento de margem próprio),
 * margem e notional da perna escalam JUNTOS por 1/N (quantos pares dividem o
 * capital) — a RAZÃO entre eles, que é o que decide liquidação, não depende
 * de N. Só depende da alavancagem:
 *
 *   margem/perna = (capital/N)/2
 *   notional/perna = margem/perna × alavancagem
 *   distância = margem/notional − mmr = 1/alavancagem − mmr
 *
 * Isto CORRIGE uma versão anterior deste arquivo que multiplicava
 * `(1/N/2) × alavancagem` e chamava o resultado de "distância até
 * liquidação" — esse número é na verdade NOTIONAL COMO FRAÇÃO DO CAPITAL, o
 * inverso do que o nome dizia. `paresSimultaneos` aceito no parâmetro só por
 * compatibilidade de assinatura; o valor não entra na conta.
 */
export function distanciaLiquidacaoPorPerna(_paresSimultaneos: number, alavancagem: number, mmr = 0.01): number {
  return 1 / alavancagem - mmr;
}

/**
 * Fração dos trades onde alguma perna teria liquidado, dada a alavancagem.
 * `paresSimultaneos` não afeta ISTO (ver `distanciaLiquidacaoPorPerna`) — só
 * afeta quanto do capital total uma liquidação, se acontecer, consome.
 * Não corrige o retorno — só mede.
 */
export function fracaoQueLiquidaria(
  excursoes: ExcursaoTrade[], paresSimultaneos: number, alavancagem: number, mmr = 0.01,
): number {
  if (!excursoes.length) return 0;
  const dist = distanciaLiquidacaoPorPerna(paresSimultaneos, alavancagem, mmr);
  return excursoes.filter((e) => e.piorMovimento > dist).length / excursoes.length;
}

/**
 * A maior ALAVANCAGEM tal que a fração de trades que liquidaria fica abaixo
 * de `toleranciaMax`. Ao contrário de uma versão anterior (que varria N,
 * pares simultâneos — parâmetro que não afeta liquidação por perna), esta
 * varre a grandeza que realmente decide: a alavancagem.
 */
export function maiorAlavancagemSegura(
  excursoes: ExcursaoTrade[], toleranciaMax = 0.03, mmr = 0.01, passo = 0.1, alavancagemMax = 20,
): number {
  let melhor = 1;
  for (let alav = passo; alav <= alavancagemMax; alav += passo) {
    if (fracaoQueLiquidaria(excursoes, 1, alav, mmr) <= toleranciaMax) melhor = alav;
    else break; // fração só cresce com alavancagem — primeiro que estourar, para
  }
  return melhor;
}
