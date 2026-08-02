/**
 * Monitor de funding — encontra e pontua oportunidades delta-neutras.
 *
 * A lição que este projeto aprendeu da forma cara: ordenar por retorno bruto
 * seleciona artefato. O leaderboard do trader.dev ordenado por lucro tinha
 * +172 bilhões por cento no topo. Aqui a tentação equivalente é ordenar por
 * APR — e o SKHYNIX lidera com 47% tendo funding positivo em apenas 45% dos
 * períodos. Isso não é renda, é volatilidade com sinal trocado.
 *
 * A pontuação abaixo pesa CONSISTÊNCIA acima de magnitude, porque o objetivo
 * declarado é receber toda semana, não receber muito às vezes.
 */
import ccxt from 'ccxt';

export interface Oportunidade {
  symbol: string;
  /** volume 24h em USDT — liquidez para montar e desmontar sem sofrer */
  volume24h: number;
  amostras: number;
  mediaPor8h: number;
  medianaPor8h: number;
  apr: number;
  /** fração dos períodos com funding positivo — o número que importa para renda semanal */
  fracaoPositiva: number;
  desvio: number;
  pior: number;
  /** autocorrelação lag-1: mede se o funding de hoje prevê o de amanhã */
  persistencia: number;
  /** funding atual, o mais recente observado */
  atual: number;
  /** média das últimas 21 leituras (uma semana) */
  ultimaSemana: number;
  pontuacao: number;
  /** taxas cruas, para o preditor treinar depois */
  historico: number[];
  motivosDeRejeicao: string[];
}

/**
 * Autocorrelação de lag 1. É o que diz se vale a pena escolher com base no
 * passado recente — se for perto de zero, o funding de ontem não informa nada
 * sobre o de hoje e qualquer seleção vira sorteio.
 */
function autocorrelacao(x: number[]): number {
  const n = x.length;
  if (n < 30) return 0;
  const m = x.reduce((a, b) => a + b, 0) / n;
  let num = 0, den = 0;
  for (let i = 1; i < n; i++) num += (x[i] - m) * (x[i - 1] - m);
  for (let i = 0; i < n; i++) den += (x[i] - m) ** 2;
  return den > 0 ? num / den : 0;
}

/**
 * Pontuação de uma oportunidade.
 *
 * O peso dominante é `fracaoPositiva^2` — consistência elevada ao quadrado.
 * Um ativo com 100% de períodos positivos e 20% de APR pontua acima de um com
 * 45% de períodos positivos e 47% de APR, e é assim que deve ser: o segundo
 * paga bem em média e não paga toda semana.
 *
 * O APR entra com raiz quadrada, que achata as diferenças grandes — a
 * diferença entre 20% e 40% importa menos que a diferença entre receber
 * sempre e receber às vezes.
 */
function pontuar(o: Omit<Oportunidade, 'pontuacao' | 'motivosDeRejeicao'>): number {
  if (o.apr <= 0) return 0;
  const consistencia = o.fracaoPositiva ** 2;
  const magnitude = Math.sqrt(Math.max(0, o.apr));
  // penaliza funding instável: desvio alto significa que a renda varia muito
  const estabilidade = o.desvio > 0 ? 1 / (1 + (o.desvio / Math.max(1e-9, Math.abs(o.mediaPor8h))) * 0.3) : 1;
  // persistência positiva significa que o passado recente informa o futuro
  const previsibilidade = 0.7 + 0.3 * Math.max(0, Math.min(1, o.persistencia * 2));
  return consistencia * magnitude * estabilidade * previsibilidade;
}

export interface FiltroFunding {
  volumeMinimo: number;
  amostrasMinimas: number;
  /** fração mínima de períodos positivos — o portão de renda semanal */
  fracaoPositivaMinima: number;
  aprMinimo: number;
  /** pior funding tolerado num único período */
  piorTolerado: number;
}

export const FILTRO_PADRAO: FiltroFunding = {
  volumeMinimo: 50e6,
  amostrasMinimas: 300,
  fracaoPositivaMinima: 0.80,
  aprMinimo: 0.08,
  piorTolerado: -0.005,
};

export async function varrerFunding(opts: {
  dias?: number;
  topN?: number;
  filtro?: Partial<FiltroFunding>;
  onProgresso?: (i: number, total: number, sym: string) => void;
} = {}): Promise<{ todas: Oportunidade[]; aprovadas: Oportunidade[] }> {
  const dias = opts.dias ?? 180;
  const filtro = { ...FILTRO_PADRAO, ...opts.filtro };
  const ex = new (ccxt as any).binanceusdm({ enableRateLimit: true });
  await ex.loadMarkets();
  const tickers = await ex.fetchTickers();

  const candidatos = Object.values(ex.markets)
    .filter((m: any) => m.swap && m.quote === 'USDT' && m.active)
    .map((m: any) => ({ sym: m.symbol, vol: tickers[m.symbol]?.quoteVolume ?? 0 }))
    .filter((x: any) => x.vol >= filtro.volumeMinimo)
    .sort((x: any, y: any) => y.vol - x.vol)
    .slice(0, opts.topN ?? 40);

  const todas: Oportunidade[] = [];
  const desde = Date.now() - dias * 86_400_000;

  for (let i = 0; i < candidatos.length; i++) {
    const c = candidatos[i];
    opts.onProgresso?.(i + 1, candidatos.length, c.sym);
    try {
      const hist: number[] = [];
      let since = desde;
      for (let k = 0; k < 3; k++) {
        const lote = await ex.fetchFundingRateHistory(c.sym, since, 1000);
        if (!lote.length) break;
        hist.push(...lote.map((f: any) => f.fundingRate as number));
        const ult = lote[lote.length - 1].timestamp;
        if (ult <= since) break;
        since = ult + 1;
        if (since > Date.now()) break;
      }
      if (hist.length < filtro.amostrasMinimas) continue;

      const media = hist.reduce((x, y) => x + y, 0) / hist.length;
      const ordenado = [...hist].sort((x, y) => x - y);
      const mediana = ordenado[Math.floor(ordenado.length / 2)];
      const desvio = Math.sqrt(hist.reduce((x, y) => x + (y - media) ** 2, 0) / hist.length);
      const positivos = hist.filter((t) => t > 0).length;
      const ultimaSemana = hist.slice(-21);

      const base = {
        symbol: c.sym, volume24h: c.vol, amostras: hist.length,
        mediaPor8h: media, medianaPor8h: mediana, apr: media * 3 * 365,
        fracaoPositiva: positivos / hist.length, desvio,
        pior: Math.min(...hist), persistencia: autocorrelacao(hist),
        atual: hist[hist.length - 1],
        ultimaSemana: ultimaSemana.reduce((x, y) => x + y, 0) / ultimaSemana.length,
        historico: hist,
      };

      const motivos: string[] = [];
      if (base.fracaoPositiva < filtro.fracaoPositivaMinima)
        motivos.push(`positivo só ${(base.fracaoPositiva * 100).toFixed(0)}% (mín ${(filtro.fracaoPositivaMinima * 100).toFixed(0)}%)`);
      if (base.apr < filtro.aprMinimo)
        motivos.push(`APR ${(base.apr * 100).toFixed(1)}% abaixo do mínimo`);
      if (base.pior < filtro.piorTolerado)
        motivos.push(`pior período ${(base.pior * 100).toFixed(2)}% além do tolerado`);

      todas.push({ ...base, pontuacao: pontuar(base), motivosDeRejeicao: motivos });
    } catch { /* segue */ }
  }

  todas.sort((x, y) => y.pontuacao - x.pontuacao);
  return { todas, aprovadas: todas.filter((o) => !o.motivosDeRejeicao.length) };
}

/**
 * Quanto tempo a posição precisa ficar montada para pagar o custo de entrada e
 * saída. Com capital pequeno esta é a restrição que impede trocar de ativo o
 * tempo todo — girar toda semana consome o funding inteiro em taxa.
 */
export function diasParaPagarCusto(mediaPor8h: number, custoIdaEVolta = 0.003): number {
  const porDia = mediaPor8h * 3;
  return porDia > 0 ? custoIdaEVolta / porDia : Infinity;
}
