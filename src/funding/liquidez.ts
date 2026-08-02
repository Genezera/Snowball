/**
 * Verificação de liquidez real, direto no livro de ofertas.
 *
 * Existe porque a varredura de spread confia em `quoteVolume`, e várias
 * exchanges simplesmente não preenchem esse campo. O filtro trata volume zero
 * como "não sei" em vez de "ilíquido" — o que evita descartar bons candidatos,
 * mas deixa passar candidatos que não dá para executar.
 *
 * Volume de 24h não responde a pergunta que importa. A pergunta é: **quanto o
 * preço se move se eu montar minha posição AGORA?** Só o livro responde isso.
 *
 * Um spread de 44% ao ano não vale nada se montar a posição custa 2% em
 * impacto de mercado.
 */
import ccxt from 'ccxt';

export interface AnaliseLivro {
  exchange: string;
  symbol: string;
  disponivel: boolean;
  /** melhor compra e melhor venda */
  bid: number;
  ask: number;
  /** spread do livro, em fração — custo imediato de entrar e sair */
  spreadLivro: number;
  /** profundidade acumulada até 0,5% do preço, em USDT */
  profundidade05: number;
  /** impacto estimado ao executar `notional` a mercado, em fração */
  impacto: number;
  /** notional máximo que cabe com impacto abaixo de 0,3% */
  notionalSeguro: number;
  erro?: string;
}

/**
 * Lê o livro e calcula o impacto de uma ordem de mercado do tamanho desejado.
 *
 * O cálculo percorre os níveis do livro somando volume até cobrir o notional
 * pedido, e mede quanto o preço médio de execução se afasta do topo. É a
 * medida honesta de custo de entrada — muito melhor que assumir slippage fixo.
 */
export async function analisarLivro(
  exchangeId: string, symbol: string, notionalDesejado: number,
): Promise<AnaliseLivro> {
  const base: AnaliseLivro = {
    exchange: exchangeId, symbol, disponivel: false,
    bid: 0, ask: 0, spreadLivro: 0, profundidade05: 0, impacto: 0, notionalSeguro: 0,
  };
  try {
    const ex = new (ccxt as any)[exchangeId]({ enableRateLimit: true });
    await ex.loadMarkets();
    if (!ex.markets[symbol]) return { ...base, erro: 'par não existe' };

    const livro = await ex.fetchOrderBook(symbol, 50);
    const bids = livro.bids ?? [];
    const asks = livro.asks ?? [];
    if (!bids.length || !asks.length) return { ...base, erro: 'livro vazio' };

    const bid = bids[0][0];
    const ask = asks[0][0];
    const meio = (bid + ask) / 2;

    // profundidade até 0,5% acima do meio (lado da compra a mercado)
    let prof = 0;
    for (const [preco, qtd] of asks) {
      if (preco > meio * 1.005) break;
      prof += preco * qtd;
    }

    // impacto de executar o notional desejado comprando a mercado
    let restante = notionalDesejado;
    let custoTotal = 0;
    let qtdTotal = 0;
    for (const [preco, qtd] of asks) {
      const valorNivel = preco * qtd;
      const usar = Math.min(restante, valorNivel);
      custoTotal += usar;
      qtdTotal += usar / preco;
      restante -= usar;
      if (restante <= 0) break;
    }
    const precoMedio = qtdTotal > 0 ? custoTotal / qtdTotal : ask;
    const impacto = restante > 0 ? 1 : precoMedio / ask - 1;

    // maior notional com impacto abaixo de 0,3%
    let seguro = 0, acum = 0, qAcum = 0;
    for (const [preco, qtd] of asks) {
      acum += preco * qtd;
      qAcum += qtd;
      const pm = acum / qAcum;
      if (pm / ask - 1 > 0.003) break;
      seguro = acum;
    }

    return {
      exchange: exchangeId, symbol, disponivel: true,
      bid, ask, spreadLivro: (ask - bid) / meio,
      profundidade05: prof, impacto, notionalSeguro: seguro,
    };
  } catch (e) {
    return { ...base, erro: (e as Error).message.slice(0, 60) };
  }
}

/**
 * Verifica as DUAS pernas de uma oportunidade de spread.
 *
 * O gargalo é sempre a perna pior. Um spread só é executável se as duas pontas
 * aguentam o notional — não adianta a binance ter profundidade infinita se a
 * outra ponta não tem.
 */
export async function verificarPar(
  exShort: string, exLong: string, symbol: string, notional: number,
): Promise<{
  short: AnaliseLivro; long: AnaliseLivro;
  executavel: boolean; custoTotalEntrada: number; notionalMaximo: number; motivo: string;
}> {
  const [short, long] = await Promise.all([
    analisarLivro(exShort, symbol, notional),
    analisarLivro(exLong, symbol, notional),
  ]);

  const motivos: string[] = [];
  if (!short.disponivel) motivos.push(`${exShort}: ${short.erro}`);
  if (!long.disponivel) motivos.push(`${exLong}: ${long.erro}`);

  const notionalMaximo = Math.min(short.notionalSeguro, long.notionalSeguro);
  // custo de entrada real: impacto + metade do spread do livro, nas duas pernas
  const custoTotalEntrada =
    short.impacto + long.impacto + short.spreadLivro / 2 + long.spreadLivro / 2;

  if (short.disponivel && long.disponivel) {
    if (notionalMaximo < notional) motivos.push(`profundidade só aguenta US$ ${notionalMaximo.toFixed(0)}`);
    if (custoTotalEntrada > 0.01) motivos.push(`custo de entrada ${(custoTotalEntrada * 100).toFixed(2)}% alto demais`);
  }

  return {
    short, long,
    executavel: motivos.length === 0,
    custoTotalEntrada, notionalMaximo,
    motivo: motivos.length ? motivos.join(' · ') : 'executável',
  };
}
