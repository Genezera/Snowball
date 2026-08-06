/**
 * MEDIÇÃO DE PREENCHIMENTO DE ORDEM MAKER (limite) vs TAKER (mercado).
 *
 * ── por que isto existe ────────────────────────────────────────────────────
 *
 * O motor sempre usou ordem a mercado (taker, ~0,05-0,06%). Uma ordem limite
 * (maker) custaria bem menos — tipicamente 0,02% — porque quem fornece
 * liquidez é pago por isso em vez de pagar por atravessar o livro. Isso entra
 * direto no portão de valor esperado (`taxa × 4 / spread`): cortar a taxa
 * pela metade corta o payback exigido quase pela metade, o que destravaria
 * candidatas que hoje ficam em 40-60% do caminho e nunca passam.
 *
 * O problema é que ordem limite só preenche quando o preço TOCA nela — e
 * quando toca, correlaciona com o preço continuar se movendo naquela direção
 * (seleção adversa). Se o preenchimento for raro ou vier sempre acompanhado
 * de um movimento ruim logo depois, a economia de taxa não compensa o risco
 * de perna (uma perna preenche e a outra não, ou demora).
 *
 * Este módulo não assume nada sobre isso — mede. As funções aqui são puras:
 * recebem uma série de preços já observada e dizem se/quando uma ordem
 * hipotética teria preenchido, e o que aconteceu depois. Quem produz a série
 * (o monitor ao vivo) fica em outro arquivo, para que a lógica de decisão
 * seja testável sem rede.
 */

export type Lado = 'compra' | 'venda';

export interface TickPreco {
  ts: number;
  last: number;
}

export interface OrdemSimulada {
  lado: Lado;
  preco: number;
  abertaEm: number;
}

export interface ResultadoPreenchimento {
  preenchido: boolean;
  ts?: number;
  msParaEncher?: number;
  motivo: string;
}

/**
 * Preço de uma ordem limite "no toque" — junta a melhor oferta do lado em que
 * se está fornecendo liquidez, sem tentar melhorar preço (post-only simples).
 *
 * Vender como maker = postar no ask. Comprar como maker = postar no bid.
 */
export function precoNoToque(lado: Lado, bid: number, ask: number): number {
  return lado === 'venda' ? ask : bid;
}

/**
 * Avalia se uma ordem limite hipotética teria preenchido dentro da janela,
 * usando o preço de negociação (`last`) como proxy de quando o mercado
 * atravessou o nível da ordem.
 *
 * Proxy padrão de backtesting de ordem limite: uma venda a `preco` preenche
 * no primeiro tick em que `last >= preco` (o mercado negociou no nível ou
 * acima); uma compra preenche no primeiro tick com `last <= preco`. Sem fita
 * de negócios tick-a-tick, isto é a aproximação honesta disponível a partir
 * de um ticker.
 */
export function avaliarPreenchimento(
  ordem: OrdemSimulada,
  ticks: TickPreco[],
  janelaMaxMs: number,
): ResultadoPreenchimento {
  const limite = ordem.abertaEm + janelaMaxMs;
  for (const t of ticks) {
    if (t.ts < ordem.abertaEm) continue;
    if (t.ts > limite) break;
    const tocou = ordem.lado === 'venda' ? t.last >= ordem.preco : t.last <= ordem.preco;
    if (tocou) {
      return { preenchido: true, ts: t.ts, msParaEncher: t.ts - ordem.abertaEm, motivo: 'preço tocou o nível' };
    }
  }
  return { preenchido: false, motivo: `expirou sem tocar em ${(janelaMaxMs / 60_000).toFixed(0)}min` };
}

export interface ReacaoPosPreenchimento {
  retornoPct: number;
  favoravel: boolean;
}

/**
 * Mede o que o preço fez depois do preenchimento, na direção que interessa
 * para quem forneceu a liquidez.
 *
 * `retornoPct` positivo = o preço continuou se movendo NA MESMA direção que
 * fez a contraparte querer negociar com a gente (ex.: vendemos e o preço
 * subiu mais — quem comprou de nós comprou barato demais, sinal de fluxo
 * informado). Não é lucro ou prejuízo da operação em si (isto é arb
 * delta-neutro, a exposição de preço se cancela entre as pernas) — é o sinal
 * clássico de seleção adversa: preenchimento correlacionado com movimento
 * desfavorável indica que preencher rápido não é de graça.
 */
export function classificarReacao(
  precoPreenchimento: number,
  lado: Lado,
  ticksApos: TickPreco[],
): ReacaoPosPreenchimento | null {
  if (ticksApos.length === 0) return null;
  const ultimo = ticksApos[ticksApos.length - 1].last;
  const direcao = lado === 'venda' ? 1 : -1;
  const retornoPct = ((ultimo - precoPreenchimento) / precoPreenchimento) * direcao;
  return { retornoPct, favoravel: retornoPct <= 0 };
}

export interface EstatisticasPreenchimento {
  amostras: number;
  taxaPreenchimento: number;
  msParaEncherMediana: number | null;
  retornoPosPreenchimentoMedio: number | null;
  fracaoFavoravel: number | null;
}

export function agregarEstatisticas(
  registros: { preenchido: boolean; msParaEncher?: number; reacao?: ReacaoPosPreenchimento | null }[],
): EstatisticasPreenchimento {
  const amostras = registros.length;
  if (amostras === 0) {
    return { amostras: 0, taxaPreenchimento: 0, msParaEncherMediana: null, retornoPosPreenchimentoMedio: null, fracaoFavoravel: null };
  }
  const preenchidos = registros.filter((r) => r.preenchido);
  const taxaPreenchimento = preenchidos.length / amostras;

  const tempos = preenchidos.map((r) => r.msParaEncher!).filter((v) => v != null).sort((a, b) => a - b);
  const msParaEncherMediana = tempos.length ? tempos[Math.floor(tempos.length / 2)] : null;

  const reacoes = preenchidos.map((r) => r.reacao).filter((r): r is ReacaoPosPreenchimento => !!r);
  const retornoPosPreenchimentoMedio = reacoes.length
    ? reacoes.reduce((s, r) => s + r.retornoPct, 0) / reacoes.length
    : null;
  const fracaoFavoravel = reacoes.length
    ? reacoes.filter((r) => r.favoravel).length / reacoes.length
    : null;

  return { amostras, taxaPreenchimento, msParaEncherMediana, retornoPosPreenchimentoMedio, fracaoFavoravel };
}
