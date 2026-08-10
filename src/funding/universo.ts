/**
 * VARREDURA DO MERCADO — FOCO ESTRITO EM BYBIT+BITGET.
 *
 * Historicamente isto escaneava 6 exchanges (binanceusdm, bybit, okx, gate,
 * bitget, bingx) via `fetchFundingRates()` em massa, pra alimentar o Champion
 * (motor de referência 6-ex). O Champion foi ARQUIVADO (ver
 * arquivo-6-exchanges/README.md) e o projeto é estritamente 2 exchanges —
 * pedido explícito: "qualquer e absolutamente qualquer coisa de 6 exchanges
 * sair do projeto". A varredura foi restrita a bybit+bitget: além de
 * alinhar com o foco, isso FECHA um ponto cego real que o escopo de 6
 * exchanges causava — com 6 exchanges, o "melhor par por símbolo" podia ser
 * bitget-gate ou bitget-okx em vez de bitget-bybit, e a posição do motor
 * real em bitget-bybit ficava sem observação nova por horas mesmo com dado
 * saudável disponível nas duas exchanges (achado ao vivo, ver commit da
 * correção do vigilancia.ts arquivado por engano). Com só 2 exchanges, o
 * par bybit-bitget é sempre o único possível — nunca mais "perde" pra outro
 * par no ranking.
 */
import ccxt from 'ccxt';

/** As únicas 2 exchanges do foco atual — nada de varredura ampla de 6 exchanges. */
export const EXCHANGES_MASSA = ['bybit', 'bitget'];

export interface ParUniverso {
  symbol: string;
  exchange: string;
  funding: number;
  /** intervalo de funding em horas, quando a exchange informa */
  intervaloHoras: number;
  volume24h: number;
  marca: number;
}

export interface OportunidadeUniverso {
  symbol: string;
  exchangeShort: string;
  exchangeLong: string;
  fundingShort: number;
  fundingLong: number;
  spread: number;
  aprSpread: number;
  /** em quantas exchanges o ativo existe — mais pontas, mais robusto */
  presencaEm: number;
  volumeMinimo: number;
  /** diferença de preço entre as pontas, em fração — risco de base */
  desvioPreco: number;
}

const pool = new Map<string, { ex: any; ts: number }>();
const VALIDADE = 60 * 60_000;

async function ex(id: string): Promise<any> {
  const c = pool.get(id);
  if (c && Date.now() - c.ts < VALIDADE) return c.ex;
  const e = c?.ex ?? new (ccxt as any)[id]({ enableRateLimit: true });
  await e.loadMarkets(c ? true : undefined);
  pool.set(id, { ex: e, ts: Date.now() });
  return e;
}

/**
 * A binanceusdm não expõe o intervalo real de funding pelo endpoint em massa
 * (`fetchFundingRates`) — cai sempre no default de 8h. Medido direto na
 * exchange (`fetchFundingRateHistory`), em 04/08/2026:
 *
 *   BANK   liquida a cada  1h  (não 8h)
 *   WAXP   liquida a cada  4h  (não 8h)
 *   HOME   liquida a cada  4h  (não 8h)
 *   BTC    liquida a cada  8h  (o padrão está certo pros majors)
 *
 * Um funding de 1h tratado como se fosse de 8h fica sub-escalado em até 8x
 * na normalização — e essa distorção caiu em cima exatamente dos pares que
 * mais pareciam "oportunidade incrível" (BANK, WAXP, HOME, DEXE: as maiores
 * APR instantâneas já vistas no projeto). O portão de payback ainda exige
 * horas de vida provada antes de abrir qualquer coisa, então isto não abre
 * posição sozinho — mas distorce RANKING e PAYBACK, e WAXP (a única posição
 * já aberta) usava exatamente este cálculo.
 *
 * Custo controlado: só verifica o intervalo real de quem já teria funding
 * "gritante" o bastante pra mudar decisão com o default errado — não o
 * universo inteiro, que manteria a varredura lenta à toa.
 */
export const LIMIAR_FUNDING_SUSPEITO = 0.001; // 0,1% no período assumido de 8h ~ 137% de APR

export function candidatosParaVerificarIntervalo(pares: ParUniverso[], exchangeAlvo: string): ParUniverso[] {
  return pares.filter((p) => p.exchange === exchangeAlvo && Math.abs(p.funding) >= LIMIAR_FUNDING_SUSPEITO);
}

async function intervaloReal(exchange: any, symbol: string): Promise<number | null> {
  try {
    const hist = await exchange.fetchFundingRateHistory(symbol, undefined, 2);
    if (!Array.isArray(hist) || hist.length < 2) return null;
    const horas = (hist[1].timestamp - hist[0].timestamp) / 3_600_000;
    return horas > 0 ? Math.round(horas) : null;
  } catch { return null; }
}

/** Corrige `intervaloHoras` in-place para os pares suspeitos de `exchangeAlvo`. */
export async function corrigirIntervalosSuspeitos(pares: ParUniverso[], exchangeAlvo: string): Promise<number> {
  const suspeitos = candidatosParaVerificarIntervalo(pares, exchangeAlvo);
  if (!suspeitos.length) return 0;
  const exchange = await ex(exchangeAlvo);
  let corrigidos = 0;
  await Promise.all(suspeitos.map(async (p) => {
    const horas = await intervaloReal(exchange, p.symbol);
    if (horas && horas !== p.intervaloHoras) { p.intervaloHoras = horas; corrigidos++; }
  }));
  return corrigidos;
}

/**
 * Lê o funding de TODOS os pares de todas as exchanges com endpoint em massa.
 *
 * Uma requisição por exchange. O resultado é o mercado inteiro, não uma amostra.
 */
export async function lerUniverso(opts: {
  onProgresso?: (ex: string, n: number, ms: number) => void;
} = {}): Promise<ParUniverso[]> {
  const todos: ParUniverso[] = [];

  await Promise.all(EXCHANGES_MASSA.map(async (id) => {
    const t0 = Date.now();
    try {
      const e = await ex(id);
      // O `fetchTickers` de algumas exchanges é lento e às vezes trava. Quando
      // ele derruba a chamada inteira, a exchange devolve zero pares — foi o
      // que aconteceu com a bybit, que sumiu da varredura por 10,8s de espera.
      // O funding é obrigatório; o ticker é complemento e não pode derrubar.
      const taxas = await e.fetchFundingRates();
      // `{ type: 'swap' }` NÃO é detalhe — sem ele, okx, gate, bitget e bingx
      // devolvem tickers do mercado À VISTA, e nenhum deles casa com o símbolo
      // de perpétuo (`.../USDT:USDT`). O volume dessas quatro exchanges ficava
      // zerado, o filtro de liquidez descartava todo par que as envolvesse, e
      // o sistema inteiro rodava só em binanceusdm↔bybit sem nunca dizer isso.
      // Medido em 05/08/2026: 0 perpétuos casados antes, 421/878/743/801 depois.
      const tickers = await Promise.race([
        e.fetchTickers(undefined, { type: 'swap' }).catch(() => ({})),
        new Promise((r) => setTimeout(() => r({}), 8000)),
      ]) as Record<string, any>;
      let n = 0;
      for (const [sym, fr] of Object.entries<any>(taxas)) {
        if (fr?.fundingRate == null) continue;
        // só perpétuos com cotação em USDT: são os comparáveis entre exchanges
        if (!sym.endsWith('/USDT:USDT')) continue;
        const t: any = (tickers as any)[sym] ?? {};
        const vol = t.quoteVolume ?? (t.baseVolume && t.last ? t.baseVolume * t.last : 0) ?? 0;
        todos.push({
          symbol: sym, exchange: id, funding: fr.fundingRate,
          intervaloHoras: fr.interval ? Number(String(fr.interval).replace(/\D/g, '')) || 8 : 8,
          volume24h: Number(vol) || 0,
          marca: fr.markPrice ?? t.last ?? 0,
        });
        n++;
      }
      opts.onProgresso?.(id, n, Date.now() - t0);
    } catch {
      opts.onProgresso?.(id, 0, Date.now() - t0);
    }
  }));

  // só a binanceusdm tem o buraco de intervalo — as outras exchanges massa
  // (bybit, okx, gate, bitget) reportam `interval` corretamente
  await corrigirIntervalosSuspeitos(todos, 'binanceusdm');

  return todos;
}

/**
 * Cruza o universo inteiro procurando spreads.
 *
 * Para cada ativo presente em duas ou mais exchanges, compara a ponta que paga
 * mais com a que paga menos. Com ~3.700 pares e centenas de ativos em comum,
 * isso gera um espaço de oportunidades muito maior que os 32 ativos anteriores.
 *
 * `desvioPreco` mede quanto os preços de marca divergem entre as pontas. Um
 * spread de funding alto acompanhado de preços muito diferentes não é
 * oportunidade — é sinal de que um dos lados está com problema de liquidez ou
 * de dado.
 */
export function cruzarUniverso(
  pares: ParUniverso[],
  filtro: { volumeMinimo?: number; spreadMinimo?: number; desvioPrecoMax?: number } = {},
): OportunidadeUniverso[] {
  const volMin = filtro.volumeMinimo ?? 5e6;
  const spMin = filtro.spreadMinimo ?? 0.00002;
  const devMax = filtro.desvioPrecoMax ?? 0.01;

  const porAtivo = new Map<string, ParUniverso[]>();
  for (const p of pares) {
    if (!porAtivo.has(p.symbol)) porAtivo.set(p.symbol, []);
    porAtivo.get(p.symbol)!.push(p);
  }

  const ops: OportunidadeUniverso[] = [];
  for (const [sym, lista] of porAtivo) {
    if (lista.length < 2) continue;

    // normaliza o funding para base de 8h — algumas exchanges usam 4h em
    // certos pares, e comparar sem normalizar infla o spread artificialmente
    const norm = lista.map((p) => ({ ...p, f8h: p.funding * (8 / (p.intervaloHoras || 8)) }));
    norm.sort((a, b) => b.f8h - a.f8h);
    const alto = norm[0], baixo = norm[norm.length - 1];
    const spread = alto.f8h - baixo.f8h;
    if (spread < spMin) continue;

    // LIQUIDEZ OBRIGATÓRIA NAS DUAS PONTAS.
    //
    // A versão anterior tratava volume zero como "não sei" e deixava passar.
    // Isso funcionava quando o universo eram 32 majors escolhidos à mão — todos
    // líquidos por construção. Varrendo o mercado inteiro, a tolerância deixou
    // passar tudo: o topo do ranking virou ERA a 482% de APR, SNOW a 337%,
    // BANK a 318%, todos com liquidez zero.
    //
    // Spread altíssimo em par que ninguém negocia não é oportunidade — é a
    // ausência de arbitradores, e o motivo dela é que não dá para executar.
    // Sem volume confirmado nas DUAS pontas, o par não entra.
    const volMinimo = Math.min(alto.volume24h, baixo.volume24h);
    if (volMinimo < volMin) continue;

    const desvio = alto.marca > 0 && baixo.marca > 0
      ? Math.abs(alto.marca / baixo.marca - 1) : 0;
    if (desvio > devMax) continue;

    ops.push({
      symbol: sym, exchangeShort: alto.exchange, exchangeLong: baixo.exchange,
      fundingShort: alto.f8h, fundingLong: baixo.f8h, spread,
      aprSpread: spread * 3 * 365, presencaEm: lista.length,
      volumeMinimo: volMinimo, desvioPreco: desvio,
    });
  }

  return ops.sort((a, b) => b.spread - a.spread);
}

/**
 * Estatísticas da varredura, para saber o que está sendo visto e o que é
 * descartado. Sem isso não dá para saber se um filtro está cortando demais.
 */
export function estatisticas(pares: ParUniverso[], ops: OportunidadeUniverso[]): {
  paresLidos: number;
  exchangesAtivas: number;
  ativosUnicos: number;
  ativosEmDuasOuMais: number;
  oportunidades: number;
  melhorApr: number;
  medianaApr: number;
} {
  const ativos = new Map<string, number>();
  for (const p of pares) ativos.set(p.symbol, (ativos.get(p.symbol) ?? 0) + 1);
  const aprs = ops.map((o) => o.aprSpread).sort((a, b) => a - b);
  return {
    paresLidos: pares.length,
    exchangesAtivas: new Set(pares.map((p) => p.exchange)).size,
    ativosUnicos: ativos.size,
    ativosEmDuasOuMais: [...ativos.values()].filter((n) => n >= 2).length,
    oportunidades: ops.length,
    melhorApr: aprs.length ? aprs[aprs.length - 1] : 0,
    medianaApr: aprs.length ? aprs[Math.floor(aprs.length / 2)] : 0,
  };
}
