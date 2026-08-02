/**
 * SPREAD ENTRE EXCHANGES — a versão mais eficiente da renda delta-neutra.
 *
 * Em vez de comprar spot e vender perpétuo, aqui as DUAS pernas são perpétuos,
 * em exchanges diferentes:
 *
 *   VENDIDO na exchange que paga funding alto     → recebe
 *   COMPRADO na exchange que paga funding baixo   → recebe (ou paga pouco)
 *
 * Duas vantagens grandes sobre o spot+perp:
 *
 *   1. NENHUM CAPITAL PARADO. No spot+perp, 75% do dinheiro fica comprado no
 *      ativo rendendo zero. Aqui as duas pernas são margem, então o capital
 *      inteiro sustenta notional.
 *
 *   2. FUNCIONA EM ATIVOS LÍQUIDOS. O funding simples só é alto em altcoins
 *      obscuras com risco de deslistagem. O spread aparece em BTC e DOGE, que
 *      são os pares mais líquidos do mercado.
 *
 * O que custa: conta em duas exchanges, e o spread muda o tempo todo — pode
 * fechar ou inverter, e aí a posição precisa ser desmontada.
 */
import ccxt from 'ccxt';

export interface OportunidadeSpread {
  symbol: string;
  exchangeShort: string;
  exchangeLong: string;
  fundingShort: number;
  fundingLong: number;
  /** spread MÉDIO no histórico — é por ele que se escolhe */
  spread: number;
  /** spread no instante, só para referência */
  spreadInstantaneo: number;
  /**
   * Fração dos períodos em que o spread se manteve positivo.
   *
   * É a métrica que decide. O UNI marcava 25,3% de APR com 64% de
   * consistência — o spread inverte em mais de um terço dos períodos. O ATOM
   * marca 19,4% com 100%: nunca fechou em 14 dias.
   *
   * Para renda DIÁRIA, consistência vale mais que APR alto e instável.
   */
  consistencia: number;
  aprSpread: number;
  /** pontuação de seleção: spread médio × consistência² */
  pontuacao: number;
  /** volume 24h no menor dos dois lados — o gargalo de liquidez */
  volumeMinimo: number;
}

/**
 * Quanto mais venues, mais largos os extremos.
 *
 * A observação que motivou expandir: com 3 exchanges o melhor spread era DOGE
 * a 13,3% APR. Assim que a `gate` entrou, apareceu XRP a 17,7%. O spread é a
 * diferença entre o máximo e o mínimo — cada exchange nova só pode alargar,
 * nunca estreitar.
 *
 * As menores tendem a ter os extremos mais interessantes justamente porque têm
 * menos arbitradores. O preço disso é liquidez menor e risco de contraparte
 * maior, e é por isso que o filtro de volume existe.
 */
const EXCHANGES = [
  'binanceusdm', 'bybit', 'okx', 'gate',
  'kucoinfutures', 'bitget', 'mexc', 'htx', 'bingx', 'phemex',
];

/**
 * Varre exchanges e ativos procurando a maior diferença de funding.
 *
 * O ativo precisa existir e ter liquidez nas DUAS pontas — não adianta um
 * spread enorme se um dos lados não tem profundidade para montar a posição.
 */
/**
 * Instâncias de exchange, criadas uma vez e reaproveitadas.
 *
 * Sem este cache o processo vazava memória de forma severa: cada varredura
 * criava 10 instâncias novas e chamava `loadMarkets()` em todas. Medido:
 * gate carrega 6.347 mercados e custa 36 MB, okx 4.172 mercados e 31 MB.
 * Uma passada nas cinco maiores custa ~96 MB.
 *
 * Com varredura a cada 10-20 minutos, o processo saía de 130 MB para 234 MB
 * em quarenta minutos — o coletor de lixo não acompanhava o ritmo de criação.
 *
 * Os mercados mudam raramente (listagens novas), então recarregar de hora em
 * hora é mais que suficiente.
 */
const poolExchanges = new Map<string, { ex: any; carregadoEm: number }>();
const VALIDADE_MERCADOS = 60 * 60_000;

async function obterExchange(id: string, ativosUsados: string[]): Promise<any> {
  const cache = poolExchanges.get(id);
  if (cache && Date.now() - cache.carregadoEm < VALIDADE_MERCADOS) return cache.ex;
  const ex = cache?.ex ?? new (ccxt as any)[id]({ enableRateLimit: true });
  await ex.loadMarkets(cache ? true : undefined);

  // PODA DOS MERCADOS — a segunda metade do vazamento.
  //
  // As 10 exchanges carregam 28.133 mercados somados, e o projeto opera 32.
  // A gate sozinha traz 6.347. Cada definição de mercado é um objeto com
  // dezenas de campos (limites, precisão, taxas, metadados do fee tier), e o
  // conjunto inteiro fica preso na instância enquanto ela viver.
  //
  // Manter só os pares que serão consultados derruba o consumo em uma ordem de
  // grandeza sem mudar nada no comportamento — ccxt só precisa do mercado que
  // está sendo chamado.
  const manter = new Set(ativosUsados);
  const podados: Record<string, any> = {};
  for (const [sym, m] of Object.entries(ex.markets ?? {})) {
    if (manter.has(sym)) podados[sym] = m;
  }
  ex.markets = podados;
  ex.symbols = Object.keys(podados);
  ex.markets_by_id = undefined;
  ex.ids = undefined;

  poolExchanges.set(id, { ex, carregadoEm: Date.now() });
  return ex;
}

/** Memória ocupada pelo pool, para diagnóstico. */
export function statusPool(): { exchanges: number; mercados: number } {
  let mercados = 0;
  for (const { ex } of poolExchanges.values()) mercados += Object.keys(ex.markets ?? {}).length;
  return { exchanges: poolExchanges.size, mercados };
}

export async function varrerSpreads(opts: {
  ativos?: string[];
  volumeMinimo?: number;
  onProgresso?: (ex: string, n: number) => void;
} = {}): Promise<OportunidadeSpread[]> {
  const ativos = opts.ativos ?? [
    // majors: spread menor, mas liquidez e segurança máximas
    'BTC/USDT:USDT', 'ETH/USDT:USDT', 'SOL/USDT:USDT', 'BNB/USDT:USDT',
    'XRP/USDT:USDT', 'DOGE/USDT:USDT', 'ADA/USDT:USDT', 'TRX/USDT:USDT',
    // segunda linha: spreads mais largos, ainda líquidos
    'LINK/USDT:USDT', 'AVAX/USDT:USDT', 'DOT/USDT:USDT', 'LTC/USDT:USDT',
    'BCH/USDT:USDT', 'NEAR/USDT:USDT', 'UNI/USDT:USDT', 'APT/USDT:USDT',
    'FIL/USDT:USDT', 'ARB/USDT:USDT', 'OP/USDT:USDT', 'INJ/USDT:USDT',
    'SUI/USDT:USDT', 'SEI/USDT:USDT', 'TIA/USDT:USDT', 'ATOM/USDT:USDT',
    'ETC/USDT:USDT', 'HBAR/USDT:USDT', 'AAVE/USDT:USDT', 'ENA/USDT:USDT',
    'WIF/USDT:USDT', 'PEPE/USDT:USDT', 'SHIB/USDT:USDT', 'LDO/USDT:USDT',
  ];
  const volMin = opts.volumeMinimo ?? 20e6;

  const dados = new Map<string, Map<string, { funding: number; volume: number; historico: number[] }>>();

  for (const exId of EXCHANGES) {
    try {
      const ex = await obterExchange(exId, ativos);
      // fetchTickers sem argumento devolve TODOS os pares da exchange — em
      // gate são milhares de objetos por chamada, a cada varredura. Pedir
      // apenas os que interessam corta isso.
      const tickers = await ex.fetchTickers(ativos).catch(() => ex.fetchTickers().catch(() => ({})));
      const m = new Map<string, { funding: number; volume: number; historico: number[] }>();
      for (const sym of ativos) {
        try {
          if (!ex.markets[sym]) continue;
          const fr = await ex.fetchFundingRate(sym);
          if (fr?.fundingRate == null) continue;
          // Histórico de 14 dias: é dele que sai a média e a consistência.
          // Selecionar pelo instantâneo pega pico — o INJ marcava 44,8% no
          // instante e tem 15,9% de média.
          let historico: number[] = [];
          try {
            const h = await ex.fetchFundingRateHistory(sym, Date.now() - 14 * 86_400_000, 100);
            historico = h.map((f: any) => f.fundingRate as number);
          } catch { /* sem histórico: cai para o instantâneo */ }
          // Cada exchange reporta volume num campo diferente. Sem esta cascata,
          // exchanges que não preenchem `quoteVolume` marcam volume zero e são
          // filtradas por engano — o que esvazia a varredura inteira.
          const t: any = (tickers as any)[sym] ?? {};
          const volume =
            t.quoteVolume ??
            (t.baseVolume != null && t.last != null ? t.baseVolume * t.last : 0) ??
            t.info?.turnover24h ?? t.info?.quoteVolume ?? 0;
          m.set(sym, { funding: fr.fundingRate, volume: Number(volume) || 0, historico });
        } catch { /* segue */ }
      }
      dados.set(exId, m);
      opts.onProgresso?.(exId, m.size);
    } catch { opts.onProgresso?.(exId, 0); }
  }

  const media = (v: number[]) => (v.length ? v.reduce((x, y) => x + y, 0) / v.length : 0);

  const oportunidades: OportunidadeSpread[] = [];
  for (const sym of ativos) {
    const pontas: { ex: string; funding: number; volume: number; historico: number[] }[] = [];
    for (const [exId, m] of dados) {
      const d = m.get(sym);
      if (d) pontas.push({ ex: exId, ...d });
    }
    if (pontas.length < 2) continue;

    // Ordena pela MÉDIA histórica, não pelo instantâneo. Quem lidera no
    // instante frequentemente não lidera no período.
    const comMedia = pontas.map((p) => ({ ...p, mediaHist: p.historico.length ? media(p.historico) : p.funding }));
    comMedia.sort((x, y) => y.mediaHist - x.mediaHist);
    const alto = comMedia[0];
    const baixo = comMedia[comMedia.length - 1];
    const spreadMedio = alto.mediaHist - baixo.mediaHist;
    if (spreadMedio <= 0) continue;

    // Consistência: em quantos períodos o spread se manteve positivo.
    let consistencia = 1;
    if (alto.historico.length >= 10 && baixo.historico.length >= 10) {
      const n = Math.min(alto.historico.length, baixo.historico.length);
      let positivos = 0;
      for (let i = 0; i < n; i++) {
        const a = alto.historico[alto.historico.length - n + i];
        const b = baixo.historico[baixo.historico.length - n + i];
        if (a - b > 0) positivos++;
      }
      consistencia = positivos / n;
    }

    const volumes = [alto.volume, baixo.volume].filter((v) => v > 0);
    const volMinimo = volumes.length ? Math.min(...volumes) : 0;
    if (volumes.length && volMinimo < volMin) continue;

    oportunidades.push({
      symbol: sym, exchangeShort: alto.ex, exchangeLong: baixo.ex,
      fundingShort: alto.mediaHist, fundingLong: baixo.mediaHist,
      spread: spreadMedio, spreadInstantaneo: alto.funding - baixo.funding,
      consistencia, aprSpread: spreadMedio * 3 * 365,
      // Consistência ao QUADRADO: um spread que fecha em 36% dos períodos
      // (UNI) perde para um que nunca fecha (ATOM), mesmo tendo APR maior.
      pontuacao: spreadMedio * consistencia ** 2,
      volumeMinimo: volMinimo,
    });
  }

  return oportunidades.sort((x, y) => y.pontuacao - x.pontuacao);
}

/**
 * Dimensiona a posição de spread.
 *
 * O capital é dividido entre as margens das duas pernas. Com alavancagem `L`
 * em cada lado, o notional de cada perna é `(capital/2) × L`.
 *
 * A neutralidade aqui é perfeita: as duas pernas são do mesmo ativo, mesmo
 * tamanho, direções opostas. Movimento de preço não afeta o patrimônio — só
 * transfere margem de um lado para o outro.
 */
export function dimensionarSpread(capital: number, alavancagem = 3, taxaPerp = 0.0005): {
  margemPorPerna: number; notionalPorPerna: number; custoMontagem: number;
} {
  const margemPorPerna = capital / 2;
  const notionalPorPerna = margemPorPerna * alavancagem;
  // duas pernas, entrada e saída
  const custoMontagem = notionalPorPerna * taxaPerp * 2;
  return { margemPorPerna, notionalPorPerna, custoMontagem };
}

/**
 * Quanto rende por semana, líquido do custo de montagem amortizado.
 *
 * O spread paga nas duas pontas: você recebe na perna vendida e, quando o
 * funding do outro lado é negativo, recebe também na comprada.
 */
export function rendaSemanal(
  op: OportunidadeSpread, capital: number, alavancagem = 3, taxaPerp = 0.0005,
): { bruta: number; custo: number; liquida: number; diasParaPagarCusto: number } {
  const d = dimensionarSpread(capital, alavancagem, taxaPerp);
  const bruta = d.notionalPorPerna * op.spread * 21;
  const custo = d.custoMontagem;
  const porDia = d.notionalPorPerna * op.spread * 3;
  return {
    bruta, custo, liquida: bruta - custo / 4,
    diasParaPagarCusto: porDia > 0 ? custo / porDia : Infinity,
  };
}

/**
 * O risco desta estrutura, e ele não é de preço.
 *
 * Se o preço sobe, a perna vendida perde margem e a comprada ganha. O
 * patrimônio total não muda, mas a margem fica desbalanceada entre as duas
 * exchanges — e uma delas pode liquidar antes que você transfira.
 *
 * Transferir entre exchanges leva minutos e custa taxa de saque. É o risco
 * operacional real desta estratégia.
 */
export function riscoDesbalanceamento(alavancagem: number): {
  variacaoQueDesbalanceia: number;
  descricao: string;
} {
  const v = 1 / alavancagem - 0.004;
  return {
    variacaoQueDesbalanceia: v,
    descricao:
      `Um movimento de ${(v * 100).toFixed(1)}% consome a margem de uma das pernas. ` +
      `O patrimônio não muda, mas é preciso transferir margem entre as exchanges ` +
      `antes que uma delas liquide — e transferência leva minutos.`,
  };
}
