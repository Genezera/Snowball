/**
 * PORTFÓLIO MISTO — combina `ts-momentum` (direcional, tendência) com pares
 * cointegrados (mercado-neutro, reversão) no mesmo bootstrap por blocos.
 *
 * Motivação: `bootstrap-concorrente.ts` (Resultado 12) mostrou que
 * `ts-momentum` sozinho tem correlação real de +0,13 entre posições
 * simultâneas — 54 apostas que se parecem umas com as outras, não 54
 * apostas independentes. Medido aqui: a correlação entre trades de
 * `ts-momentum` e trades de PARES que se sobrepõem no tempo é só +0,065 —
 * BEM menor, porque pares é mercado-neutro (aposta na convergência de um
 * spread, não na direção do mercado) e reage a choques sistêmicos de um
 * jeito estruturalmente diferente. Adicionar uma fatia de risco em pares,
 * MESMO SEM aumentar o risco total, reduz o risco agregado de ruína porque
 * dilui a concentração num único fator de risco (a correlação
 * cripto-com-cripto do momentum).
 *
 * A correção de liquidação de pares (`pairs/liquidacao.ts`, Resultado 7) é
 * aplicada dinamicamente por trade, dado o `riscoPares` testado — sem ela,
 * `riscoPares` alto parece bom demais (o retorno cru de `backtestPar`
 * assume que a posição sempre chega ao desfecho natural, sem checar
 * liquidação no meio do caminho). Ver docs/RESULTADOS.md item 14.
 */
import { distanciaLiquidacaoPorPerna } from '../pairs/liquidacao.ts';

const DIA_MS = 86_400_000;

export interface TradeMisto {
  entryTime: number;
  exitTime: number;
  r: number;
  estrategia: string;
  /** só pares usa: pior movimento adverso intra-trade, pra correção de liquidação */
  piorMovimento?: number;
}

interface TradeDoBlocoMisto {
  entryOffset: number;
  exitOffset: number;
  r: number;
  estrategia: string;
  piorMovimento?: number;
}

export interface BlocosMistos {
  blocos: TradeDoBlocoMisto[][];
  blocoDias: number;
}

/** Igual a `construirBlocos` de `bootstrap-concorrente.ts`, mas preserva `estrategia`/`piorMovimento`. */
export function construirBlocosMistos(trades: TradeMisto[], blocoDias: number): BlocosMistos {
  if (!trades.length) throw new Error('lista de trades vazia');
  const blocoMs = blocoDias * DIA_MS;
  const minT = Math.min(...trades.map((t) => t.entryTime));
  const maxT = Math.max(...trades.map((t) => t.exitTime));
  const nBlocos = Math.floor((maxT - minT) / blocoMs);
  const blocos: TradeDoBlocoMisto[][] = [];
  for (let k = 0; k < nBlocos; k++) {
    const inicio = minT + k * blocoMs;
    const fim = inicio + blocoMs;
    const doBloco = trades
      .filter((t) => t.entryTime >= inicio && t.entryTime < fim)
      .map((t) => ({ entryOffset: t.entryTime - inicio, exitOffset: t.exitTime - inicio, r: t.r, estrategia: t.estrategia, piorMovimento: t.piorMovimento }));
    if (doBloco.length > 0) blocos.push(doBloco);
  }
  if (!blocos.length) throw new Error('nenhum bloco com trades — blocoDias grande demais para o período disponível');
  return { blocos, blocoDias };
}

function criarRng(semente: number) {
  let s = semente >>> 0;
  return () => {
    s ^= s << 13; s >>>= 0;
    s ^= s >> 17;
    s ^= s << 5; s >>>= 0;
    return s / 4294967296;
  };
}

interface EventoSaida { tempo: number; tamanho: number; r: number }

class HeapTempo {
  private a: EventoSaida[] = [];
  get length(): number { return this.a.length; }
  push(item: EventoSaida): void {
    const a = this.a; a.push(item);
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (a[p].tempo <= a[i].tempo) break;
      [a[p], a[i]] = [a[i], a[p]]; i = p;
    }
  }
  peek(): EventoSaida { return this.a[0]; }
  pop(): EventoSaida {
    const a = this.a; const top = a[0]; const last = a.pop()!;
    if (a.length) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = 2 * i + 2; let m = i;
        if (l < a.length && a[l].tempo < a[m].tempo) m = l;
        if (r < a.length && a[r].tempo < a[m].tempo) m = r;
        if (m === i) break;
        [a[m], a[i]] = [a[i], a[m]]; i = m;
      }
    }
    return top;
  }
}

export interface ResultadoMisto {
  pSucesso: number;
  pRuina: number;
  pArrastando: number;
  mesesMediano: number;
}

interface EventoEntrada { tempo: number; exitDias: number; r: number; estrategia: string; piorMovimento?: number }

/**
 * Fração de risco por posição, por estratégia — chaves = `estrategia` dos
 * trades. `pesoPares.paresSimultaneosMedio` (opcional) ativa a correção de
 * liquidação dinâmica para a estratégia `'pares'`: a alavancagem implícita é
 * `riscoPorPosicao × paresSimultaneosMedio` (ver `pairs/validado.ts`), e
 * qualquer trade cuja excursão exceda a distância de liquidação naquela
 * alavancagem tem seu retorno substituído por `-1/alavancagem`.
 */
export interface OpcoesPortfolioMisto {
  blocosCalendario: BlocosMistos;
  capitalInicial: number;
  alvo: number;
  pisoRuina: number;
  riscoPorEstrategia: Record<string, number>;
  horizonteMeses: number;
  caminhos?: number;
  semente?: number;
  correcaoLiquidacaoPares?: { paresSimultaneosMedio: number; mmr?: number };
}

function rEfetivo(ev: EventoEntrada, riscoPorEstrategia: Record<string, number>, opts?: OpcoesPortfolioMisto['correcaoLiquidacaoPares']): number {
  if (ev.estrategia !== 'pares' || !opts || ev.piorMovimento === undefined) return ev.r;
  const alavancagemImplicada = (riscoPorEstrategia['pares'] ?? 0) * opts.paresSimultaneosMedio;
  if (alavancagemImplicada <= 0) return ev.r;
  const dist = distanciaLiquidacaoPorPerna(1, alavancagemImplicada, opts.mmr ?? 0.01);
  return ev.piorMovimento > dist ? -1 / alavancagemImplicada : ev.r;
}

function processarTrajetoria(eventos: EventoEntrada[], opts: OpcoesPortfolioMisto, horizonteDias: number): { desfecho: 'sucesso' | 'ruina' | 'arrastando'; dias: number } {
  let capital = opts.capitalInicial;
  const saidas = new HeapTempo();
  for (const ev of eventos) {
    if (ev.tempo > horizonteDias) break;
    while (saidas.length && saidas.peek().tempo <= ev.tempo) {
      const s = saidas.pop();
      capital += s.tamanho * s.r;
      if (capital >= opts.alvo) return { desfecho: 'sucesso', dias: s.tempo };
      if (capital <= opts.pisoRuina) return { desfecho: 'ruina', dias: s.tempo };
    }
    const risco = opts.riscoPorEstrategia[ev.estrategia] ?? 0;
    if (risco > 0) saidas.push({ tempo: ev.exitDias, tamanho: capital * risco, r: rEfetivo(ev, opts.riscoPorEstrategia, opts.correcaoLiquidacaoPares) });
  }
  while (saidas.length) {
    const s = saidas.pop();
    if (s.tempo > horizonteDias) continue;
    capital += s.tamanho * s.r;
    if (capital >= opts.alvo) return { desfecho: 'sucesso', dias: s.tempo };
    if (capital <= opts.pisoRuina) return { desfecho: 'ruina', dias: s.tempo };
  }
  return { desfecho: 'arrastando', dias: horizonteDias };
}

function gerarEventosBootstrap(rng: () => number, blocos: TradeDoBlocoMisto[][], blocoDias: number, horizonteDias: number): EventoEntrada[] {
  const eventos: EventoEntrada[] = [];
  let cursorDias = 0;
  while (cursorDias < horizonteDias) {
    const bloco = blocos[Math.floor(rng() * blocos.length)];
    for (const t of bloco) eventos.push({ tempo: cursorDias + t.entryOffset / DIA_MS, exitDias: cursorDias + t.exitOffset / DIA_MS, r: t.r, estrategia: t.estrategia, piorMovimento: t.piorMovimento });
    cursorDias += blocoDias;
  }
  eventos.sort((a, b) => a.tempo - b.tempo);
  return eventos;
}

/** Simula o portfólio misto — mesma disciplina de `simularPortfolioConcorrente`, com risco por estratégia. */
export function simularPortfolioMisto(opts: OpcoesPortfolioMisto): ResultadoMisto {
  const { blocosCalendario, horizonteMeses } = opts;
  const caminhos = opts.caminhos ?? 3000;
  const horizonteDias = horizonteMeses * 30;
  const rng = criarRng(opts.semente ?? 777);

  let sucessos = 0, ruinas = 0;
  const meses: number[] = [];
  for (let c = 0; c < caminhos; c++) {
    const eventos = gerarEventosBootstrap(rng, blocosCalendario.blocos, blocosCalendario.blocoDias, horizonteDias);
    const r = processarTrajetoria(eventos, opts, horizonteDias);
    if (r.desfecho === 'sucesso') { sucessos++; meses.push(r.dias / 30); }
    else if (r.desfecho === 'ruina') ruinas++;
  }
  meses.sort((a, b) => a - b);
  return {
    pSucesso: sucessos / caminhos,
    pRuina: ruinas / caminhos,
    pArrastando: (caminhos - sucessos - ruinas) / caminhos,
    mesesMediano: meses.length ? meses[Math.floor(meses.length / 2)] : Infinity,
  };
}
