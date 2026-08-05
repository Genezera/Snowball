/**
 * ESCORREGAMENTO MEDIDO NO LIVRO, par a par — em vez de uma constante única.
 *
 * ── por que isto existe ────────────────────────────────────────────────────
 *
 * `ESCORREGAMENTO_PERNA` (custos-reais.ts) é uma constante de pior caso
 * aplicada a TODOS os pares: 0,07%. Ela nasceu de uma medição honesta, mas de
 * uma amostra de seis pares, e o custo dela é grande porque o escorregamento
 * responde por ~57% do custo total de uma operação (o resto é taxa).
 *
 * Medido no livro real em 04/08/2026, notional US$ 250/perna, nos doze pares
 * que a vigilância tinha vivos naquele instante:
 *
 *   TQQQ     0,0000%     SAMSUNG  0,0021%     OPENAI   0,0029%
 *   FIL      0,0060%     ZAMA     0,0075%     ORDI     0,0116%
 *   NIL      0,0255%     PEOPLE   0,0323%     BOME     0,0326%
 *   1000RATS 0,0366%     TUT      0,0792%     HFT      0,0808%
 *
 *   mediana 0,0255% · p75 0,0366% · p90 0,0792% · máximo 0,0808%
 *
 * A constante única erra nos DOIS sentidos, e o segundo é o que custa dinheiro:
 *
 *   · superestima os líquidos — TQQQ e SAMSUNG pagam 0,07% num livro que cobra
 *     quase zero. O portão exige deles um payback ~2,7× maior que o real, e
 *     eles são barrados sem motivo.
 *
 *   · SUBESTIMA os ilíquidos — HFT (0,0808%) e TUT (0,0792%) custam mais que a
 *     constante. E HFT é justamente o par que o motor mais avaliou como "quase
 *     passando" (dezenas de eventos `bloqueado` com ele em primeiro lugar).
 *     Ou seja: o motor estava sendo otimista exatamente com o candidato de
 *     quem estava mais perto de aceitar.
 *
 * Trocar a constante pela medição não afrouxa o portão — deixa ele mais certo
 * nos dois sentidos. Pares líquidos passam a ser avaliados pelo custo que
 * realmente têm; pares rasos passam a ser penalizados pelo que realmente
 * custam.
 *
 * ── o que "livro raso" significa ───────────────────────────────────────────
 *
 * Se os níveis do livro não somam o notional pedido, a ordem não executa
 * inteira ao preço estimado — ela varre o livro e para. Isso não é erro de
 * medição, é a informação mais importante que o livro dá: **este par não
 * comporta o tamanho.** Devolve `Infinity`, e quem chama trata como
 * inviável, não como "usa o padrão".
 */

/** Um nível de livro: [preço, tamanho]. Mesmo formato que o ccxt devolve. */
export type NivelLivro = [number, number];

/**
 * Escorregamento de atravessar o livro para preencher `notional` dólares.
 *
 * Pura de propósito — recebe os níveis já lidos, não fala com exchange
 * nenhuma. É o que dá para testar sem rede.
 *
 * Devolve a fração entre o preço médio de execução e o topo do livro.
 * `Infinity` quando o livro não comporta o notional.
 */
export function escorregamentoDoLivro(niveis: NivelLivro[] | undefined, notional: number): number {
  if (!niveis || niveis.length === 0 || notional <= 0) return Infinity;
  const topo = niveis[0][0];
  if (!(topo > 0)) return Infinity;

  let restante = notional, gasto = 0, quantidade = 0;
  for (const [preco, tamanho] of niveis) {
    if (!(preco > 0) || !(tamanho > 0)) continue;
    const valorDoNivel = preco * tamanho;
    const usar = Math.min(restante, valorDoNivel);
    gasto += usar;
    quantidade += usar / preco;
    restante -= usar;
    if (restante <= 1e-9) break;
  }
  // Livro raso: não é "medida ruim", é "não cabe". Quem chama precisa saber.
  if (restante > 1e-9 || quantidade <= 0) return Infinity;

  return Math.abs(gasto / quantidade - topo) / topo;
}

/**
 * Escorregamento de uma perna, considerando que ela atravessa os dois lados do
 * livro ao longo da vida da posição (entra de um lado, sai do outro).
 *
 * Usa o PIOR dos dois lados, não a média: o custo que importa é o do lado que
 * vai doer, e a posição precisa poder sair tanto quanto entrar.
 */
export function escorregamentoDaPerna(
  livro: { bids?: NivelLivro[]; asks?: NivelLivro[] } | undefined,
  notional: number,
): number {
  if (!livro) return Infinity;
  const compra = escorregamentoDoLivro(livro.asks, notional);
  const venda = escorregamentoDoLivro(livro.bids, notional);
  return Math.max(compra, venda);
}

/**
 * Escorregamento de uma operação de duas pernas.
 *
 * Também o pior das duas — a operação inteira depende da perna mais cara, não
 * da média delas. Uma perna barata não compensa uma perna que não executa.
 */
export function escorregamentoDoPar(
  livroShort: { bids?: NivelLivro[]; asks?: NivelLivro[] } | undefined,
  livroLong: { bids?: NivelLivro[]; asks?: NivelLivro[] } | undefined,
  notional: number,
): number {
  return Math.max(
    escorregamentoDaPerna(livroShort, notional),
    escorregamentoDaPerna(livroLong, notional),
  );
}

/**
 * Teto de sanidade. Acima disto o par é inviável de qualquer forma, e devolver
 * um número gigante (ou Infinity) faria o payback estourar para NaN/Infinity em
 * quem consome. Marcar com um teto explícito mantém a conta bem-comportada e
 * deixa o portão barrar naturalmente, sem ramo especial.
 */
export const ESCORREGAMENTO_TETO = 0.01; // 1% por perna

export function escorregamentoLimitado(valor: number): number {
  if (!isFinite(valor) || valor > ESCORREGAMENTO_TETO) return ESCORREGAMENTO_TETO;
  return Math.max(0, valor);
}
