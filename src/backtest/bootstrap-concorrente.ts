/**
 * BOOTSTRAP COM CONCORRÊNCIA REAL — corrige um viés do bootstrap i.i.d.
 *
 * `bootstrap.ts` (e `dp-risco.ts` em cima dele) reamostra R-múltiplos como
 * se cada trade fosse um sorteio INDEPENDENTE, um de cada vez. Isso não é
 * como `ts-momentum` realmente opera: em média 54,5 das 57 posições do
 * universo ficam abertas AO MESMO TEMPO (ver `docs/RESULTADOS.md` item 12),
 * e trades cujas janelas se sobrepõem têm correlação real de +0,13 (contra
 * ~0 para pares aleatórios sem controle de tempo) — um crash de mercado
 * atinge várias ao mesmo tempo, não uma de cada vez.
 *
 * A correção: BLOCK BOOTSTRAP no calendário. Em vez de reamostrar trades
 * individuais, reamostra BLOCOS de dias reais consecutivos (~63 dias) — a
 * ordem e a simultaneidade real dos trades DENTRO de cada bloco é
 * preservada, então qualquer clusterização real de perdas (crash de
 * mercado) permanece intacta. A variação vem de QUAIS blocos (e em que
 * ordem) saem sorteados para compor os 60 meses simulados.
 *
 * Cada posição arrisca uma fração PEQUENA e FIXA do capital no momento em
 * que abre (`riscoPorPosicao`) — não uma fração grande por "operação"
 * sequencial como em `bootstrap.ts`, porque na realidade dezenas de
 * posições coexistem, cada uma pequena.
 */
import type { Trade } from '../core/types.ts';

const DIA_MS = 86_400_000;

export interface TradeDoBloco {
  entryOffset: number; // ms desde o inicio do bloco
  exitOffset: number; // ms desde o inicio do bloco (pode passar do fim do bloco)
  r: number;
}

export interface BlocosCalendario {
  blocos: TradeDoBloco[][];
  blocoDias: number;
}

/** Converte trades reais em R-múltiplos, iguais a `paraRMultiplos` de `bootstrap.ts`. */
export function paraRMultiplosComTempo(trades: Trade[], riscoDoBacktest: number): { entryTime: number; exitTime: number; r: number }[] {
  if (riscoDoBacktest <= 0) throw new Error('riscoDoBacktest precisa ser positivo');
  return trades.map((t) => ({ entryTime: t.entryTime, exitTime: t.exitTime, r: t.rEquity / riscoDoBacktest }));
}

/**
 * Particiona os trades em blocos de calendário de `blocoDias` dias, pela
 * data de ENTRADA. A saída pode cair fora do bloco (fica com offset > fim
 * do bloco) — o trade não é cortado nem descartado por isso. Descartar
 * trades cuja saída não coubesse no mesmo bloco foi tentado e causa um viés
 * real: numa estratégia de tendência com alvo largo, os trades mais longos
 * são desproporcionalmente os grandes vencedores, e cortá-los enviesa a
 * amostra para baixo (medido: R médio dos descartados +0,48 vs -0,04 dos
 * mantidos, quando o filtro exigia saída também dentro do bloco).
 */
export function construirBlocos(trades: { entryTime: number; exitTime: number; r: number }[], blocoDias: number): BlocosCalendario {
  if (!trades.length) throw new Error('lista de trades vazia');
  const blocoMs = blocoDias * DIA_MS;
  const minT = Math.min(...trades.map((t) => t.entryTime));
  const maxT = Math.max(...trades.map((t) => t.exitTime));
  const nBlocos = Math.floor((maxT - minT) / blocoMs);
  const blocos: TradeDoBloco[][] = [];
  for (let k = 0; k < nBlocos; k++) {
    const inicio = minT + k * blocoMs;
    const fim = inicio + blocoMs;
    const doBloco = trades
      .filter((t) => t.entryTime >= inicio && t.entryTime < fim)
      .map((t) => ({ entryOffset: t.entryTime - inicio, exitOffset: t.exitTime - inicio, r: t.r }));
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

/** Min-heap por `tempo` — evita re-ordenar a fila de saídas pendentes a cada evento (O(n²) → O(n log n)). */
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

export interface ResultadoConcorrente {
  pSucesso: number;
  pRuina: number;
  pArrastando: number;
  mesesMediano: number;
}

interface EventoEntrada { tempo: number; exitDias: number; r: number }

/** Processa uma trajetória (eventos de entrada já ordenados por tempo) contra um risco fixo por posição. */
function processarTrajetoria(eventos: EventoEntrada[], capitalInicial: number, alvo: number, pisoRuina: number, riscoPorPosicao: number, horizonteDias: number): { desfecho: 'sucesso' | 'ruina' | 'arrastando'; dias: number } {
  let capital = capitalInicial;
  const saidas = new HeapTempo();
  for (const ev of eventos) {
    if (ev.tempo > horizonteDias) break;
    while (saidas.length && saidas.peek().tempo <= ev.tempo) {
      const s = saidas.pop();
      capital += s.tamanho * s.r;
      if (capital >= alvo) return { desfecho: 'sucesso', dias: s.tempo };
      if (capital <= pisoRuina) return { desfecho: 'ruina', dias: s.tempo };
    }
    saidas.push({ tempo: ev.exitDias, tamanho: capital * riscoPorPosicao, r: ev.r });
  }
  while (saidas.length) {
    const s = saidas.pop();
    if (s.tempo > horizonteDias) continue;
    capital += s.tamanho * s.r;
    if (capital >= alvo) return { desfecho: 'sucesso', dias: s.tempo };
    if (capital <= pisoRuina) return { desfecho: 'ruina', dias: s.tempo };
  }
  return { desfecho: 'arrastando', dias: horizonteDias };
}

function gerarEventosBootstrap(rng: () => number, blocos: TradeDoBloco[][], blocoDias: number, horizonteDias: number): EventoEntrada[] {
  const eventos: EventoEntrada[] = [];
  let cursorDias = 0;
  while (cursorDias < horizonteDias) {
    const bloco = blocos[Math.floor(rng() * blocos.length)];
    for (const t of bloco) eventos.push({ tempo: cursorDias + t.entryOffset / DIA_MS, exitDias: cursorDias + t.exitOffset / DIA_MS, r: t.r });
    cursorDias += blocoDias;
  }
  eventos.sort((a, b) => a.tempo - b.tempo);
  return eventos;
}

/**
 * Simula `caminhos` trajetórias reamostrando BLOCOS de calendário (não
 * trades individuais), preservando a correlação real dentro de cada bloco.
 * Cada posição arrisca `riscoPorPosicao` do capital no momento em que abre.
 */
export function simularPortfolioConcorrente(opts: {
  blocosCalendario: BlocosCalendario;
  capitalInicial: number;
  alvo: number;
  pisoRuina: number;
  riscoPorPosicao: number;
  horizonteMeses: number;
  caminhos?: number;
  semente?: number;
}): ResultadoConcorrente {
  const { blocosCalendario, capitalInicial, alvo, pisoRuina, riscoPorPosicao, horizonteMeses } = opts;
  const caminhos = opts.caminhos ?? 3000;
  const horizonteDias = horizonteMeses * 30;
  const rng = criarRng(opts.semente ?? 777);

  let sucessos = 0, ruinas = 0;
  const meses: number[] = [];
  for (let c = 0; c < caminhos; c++) {
    const eventos = gerarEventosBootstrap(rng, blocosCalendario.blocos, blocosCalendario.blocoDias, horizonteDias);
    const r = processarTrajetoria(eventos, capitalInicial, alvo, pisoRuina, riscoPorPosicao, horizonteDias);
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

/**
 * Replay ÚNICO e determinístico da história real, em ordem, sem
 * reamostragem — o que teria literalmente acontecido rodando a estratégia
 * com posições concorrentes reais. Útil como checagem de sanidade
 * independente do bootstrap (sem ruído de amostragem).
 */
export function replayHistoricoReal(blocosCalendario: BlocosCalendario, capitalInicial: number, alvo: number, pisoRuina: number, riscoPorPosicao: number): { desfecho: 'sucesso' | 'ruina' | 'arrastando'; capitalFinal: number } {
  const { blocos, blocoDias } = blocosCalendario;
  const eventos: EventoEntrada[] = [];
  for (let k = 0; k < blocos.length; k++) {
    const baseDias = k * blocoDias;
    for (const t of blocos[k]) eventos.push({ tempo: baseDias + t.entryOffset / DIA_MS, exitDias: baseDias + t.exitOffset / DIA_MS, r: t.r });
  }
  eventos.sort((a, b) => a.tempo - b.tempo);
  const horizonteDias = blocos.length * blocoDias + 1;
  let capital = capitalInicial;
  const saidas = new HeapTempo();
  for (const ev of eventos) {
    while (saidas.length && saidas.peek().tempo <= ev.tempo) {
      const s = saidas.pop();
      capital += s.tamanho * s.r;
      if (capital >= alvo) return { desfecho: 'sucesso', capitalFinal: capital };
      if (capital <= pisoRuina) return { desfecho: 'ruina', capitalFinal: capital };
    }
    saidas.push({ tempo: ev.exitDias, tamanho: capital * riscoPorPosicao, r: ev.r });
  }
  while (saidas.length) {
    const s = saidas.pop();
    capital += s.tamanho * s.r;
    if (capital >= alvo) return { desfecho: 'sucesso', capitalFinal: capital };
    if (capital <= pisoRuina) return { desfecho: 'ruina', capitalFinal: capital };
  }
  return { desfecho: 'arrastando', capitalFinal: capital };
}
