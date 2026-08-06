/**
 * MONITOR DE PREENCHIMENTO — mede, ao vivo, se ordem limite (maker) preenche
 * rápido o suficiente para valer a pena trocar por ordem a mercado (taker).
 *
 * NÃO envia ordem nenhuma. Para cada perna dos melhores candidatos da
 * vigilância, simula uma ordem limite "no toque" (posta no bid para comprar,
 * no ask para vender) e observa o preço real (`last`) para decidir se/quando
 * ela teria preenchido — usando as funções puras de `preenchimento.ts`.
 *
 * Cada resultado (preencheu ou expirou, e o que o preço fez depois) vai para
 * um diário append-only. O dashboard lê o agregado; ninguém tira conclusão
 * daqui com poucas amostras — a mesma cautela que `vigilancia.ts` já aplica
 * ao ciclo de vida das oportunidades.
 */
import fs from 'node:fs';
import path from 'node:path';
import ccxt from 'ccxt';
import { ROOT } from '../data/store.ts';
import { lerVigilancia } from '../funding/ponte.ts';
import {
  precoNoToque, avaliarPreenchimento, classificarReacao,
  type Lado, type OrdemSimulada, type TickPreco,
} from '../funding/preenchimento.ts';

const DIR = path.join(ROOT, 'preenchimento');
const ESTADO = path.join(DIR, 'estado.json');
const DIARIO = path.join(DIR, 'diario.jsonl');

/** Tempo máximo de espera por preenchimento antes de declarar expirado. */
export const JANELA_MAX_MS = 5 * 60_000;
/** Depois de preencher, por quanto tempo observar o preço para medir reação. */
export const JANELA_REACAO_MS = 2 * 60_000;
/** Quantos candidatos do topo da vigilância acompanhar ao mesmo tempo. */
export const TOP_CANDIDATOS = 5;

interface Slot {
  chave: string;
  exchange: string;
  symbol: string;
  lado: Lado;
  ordem?: OrdemSimulada;
  ticks: TickPreco[];
  aguardandoReacao?: { precoPreenchimento: number; tsPreenchimento: number; msParaEncher: number; ticksPos: TickPreco[] };
}

export interface RegistroPreenchimento {
  ts: number;
  chave: string;
  exchange: string;
  symbol: string;
  lado: Lado;
  preco: number;
  preenchido: boolean;
  msParaEncher?: number;
  retornoPosPct?: number;
  favoravel?: boolean;
}

interface Estado {
  iniciadoEm: number;
  ciclos: number;
  slots: Record<string, Slot>;
}

function carregar(): Estado {
  fs.mkdirSync(DIR, { recursive: true });
  if (fs.existsSync(ESTADO)) {
    try { return JSON.parse(fs.readFileSync(ESTADO, 'utf8')); } catch { /* recomeça limpo */ }
  }
  return { iniciadoEm: Date.now(), ciclos: 0, slots: {} };
}

function salvar(e: Estado) {
  fs.writeFileSync(ESTADO, JSON.stringify(e, null, 2));
}

function registrar(r: RegistroPreenchimento) {
  fs.appendFileSync(DIARIO, JSON.stringify(r) + '\n');
}

const pool: Record<string, any> = {};
const marketsCarregados = new Set<string>();

/** Timeout defensivo — a gate, em especial, já travou `loadMarkets` por mais
 * de 60s numa passada. Uma exchange lenta não pode bloquear as outras.
 *
 * `Promise.race` não cancela a promessa perdedora — ela continua rodando em
 * segundo plano. Se `p` rejeitar DEPOIS que o timeout já resolveu a corrida,
 * essa rejeição fica sem ninguém escutando (`unhandledRejection`), e por
 * padrão o Node mata o processo inteiro nisso. Foi exatamente o que derrubou
 * o monitor: a bybit demorava mais que o timeout e, quando finalmente
 * respondia com erro, a exceção não tinha mais handler. O `.catch` vazio
 * aqui existe só pra isso — descartar com segurança um resultado que já não
 * importa mais, não pra tratar o erro de verdade (isso já acontece em quem
 * chama, via o valor de `fallback`).
 */
async function comTimeout<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
  p.catch(() => {});
  return Promise.race([p, new Promise<T>((r) => setTimeout(() => r(fallback), ms))]);
}

async function exchangePara(id: string) {
  // bybit por padrão também carrega mercado de OPÇÕES no loadMarkets — o
  // endpoint dela (instruments-info?category=option) trava ~10s por request
  // neste ambiente e nunca é usado aqui (só perpétuo). Restringir os tipos
  // evita esperar por algo que nunca vai preencher pedido nenhum. É uma
  // opção ESPECÍFICA da bybit — outras exchanges usam convenção de tipo
  // diferente ('swap' em vez de 'linear', etc.) e quebram se ela for
  // aplicada por igual (visto ao vivo: okx e bitget passaram a errar).
  const opts: any = { enableRateLimit: true };
  if (id === 'bybit') opts.options = { fetchMarkets: { types: ['spot', 'linear', 'inverse'] } };
  if (!pool[id]) pool[id] = new (ccxt as any)[id](opts);
  if (!marketsCarregados.has(id)) {
    const ok = await comTimeout(pool[id].loadMarkets().then(() => true), 15_000, false);
    if (ok) marketsCarregados.add(id); // timeout: não marca — tenta carregar de novo na próxima passada
  }
  return pool[id];
}

/** Monta os slots que deveriam existir agora, a partir do topo da vigilância. */
function candidatosAtuais(): { exchange: string; symbol: string; lado: Lado }[] {
  const vig = lerVigilancia(3);
  if (!vig.disponivel) return [];
  const out: { exchange: string; symbol: string; lado: Lado }[] = [];
  for (const o of vig.oportunidades.slice(0, TOP_CANDIDATOS)) {
    out.push({ exchange: o.exchangeShort, symbol: o.symbol, lado: 'venda' });
    out.push({ exchange: o.exchangeLong, symbol: o.symbol, lado: 'compra' });
  }
  return out;
}

export async function ciclo(estado: Estado): Promise<void> {
  estado.ciclos++;
  const alvos = candidatosAtuais();
  const chavesAlvo = new Set(alvos.map((a) => `${a.symbol}|${a.exchange}|${a.lado}`));

  // remove slots de candidatos que saíram do topo — não faz sentido continuar
  // medindo um par que a vigilância já não considera bom o suficiente
  for (const k of Object.keys(estado.slots)) {
    if (!chavesAlvo.has(k)) delete estado.slots[k];
  }

  for (const a of alvos) {
    const chave = `${a.symbol}|${a.exchange}|${a.lado}`;
    if (!estado.slots[chave]) {
      estado.slots[chave] = { chave, exchange: a.exchange, symbol: a.symbol, lado: a.lado, ticks: [] };
    }
  }

  // agrupa por exchange para uma chamada fetchTickers em lote, mesmo padrão
  // já usado no dashboard para não estourar limite de taxa
  const porExchange = new Map<string, Set<string>>();
  for (const s of Object.values(estado.slots)) {
    if (!porExchange.has(s.exchange)) porExchange.set(s.exchange, new Set());
    porExchange.get(s.exchange)!.add(s.symbol);
  }

  const tickersPorExchange = new Map<string, Record<string, any>>();
  await Promise.all([...porExchange.entries()].map(async ([exchange, symbolsSet]) => {
    try {
      const ex = await exchangePara(exchange);
      const tickers = await comTimeout(ex.fetchTickers([...symbolsSet]), 12_000, null);
      if (tickers) tickersPorExchange.set(exchange, tickers);
    } catch (e) {
      // exchange fora do ar ou travada nesta passada — a perna fica sem tick
      // e tenta de novo no próximo ciclo, não trava as outras exchanges
      console.error(`[preenchimento] ${exchange}: ${(e as Error).message}`);
    }
  }));

  const agora = Date.now();

  for (const s of Object.values(estado.slots)) {
    const t = tickersPorExchange.get(s.exchange)?.[s.symbol];
    if (!t) continue;
    const bid = t.bid, ask = t.ask, last = t.last ?? t.close;
    if (!(bid > 0) || !(ask > 0) || !(last > 0)) continue;

    if (s.aguardandoReacao) {
      s.aguardandoReacao.ticksPos.push({ ts: agora, last });
      if (agora - s.aguardandoReacao.tsPreenchimento >= JANELA_REACAO_MS) {
        const reacao = classificarReacao(s.aguardandoReacao.precoPreenchimento, s.lado, s.aguardandoReacao.ticksPos);
        registrar({
          ts: s.aguardandoReacao.tsPreenchimento, chave: s.chave, exchange: s.exchange, symbol: s.symbol,
          lado: s.lado, preco: s.aguardandoReacao.precoPreenchimento, preenchido: true,
          msParaEncher: s.aguardandoReacao.msParaEncher,
          retornoPosPct: reacao?.retornoPct, favoravel: reacao?.favoravel,
        });
        s.aguardandoReacao = undefined;
        s.ticks = [];
      }
      continue;
    }

    if (!s.ordem) {
      const preco = precoNoToque(s.lado, bid, ask);
      s.ordem = { lado: s.lado, preco, abertaEm: agora };
      s.ticks = [{ ts: agora, last }];
      continue;
    }

    s.ticks.push({ ts: agora, last });
    const r = avaliarPreenchimento(s.ordem, s.ticks, JANELA_MAX_MS);
    if (r.preenchido) {
      s.aguardandoReacao = { precoPreenchimento: s.ordem.preco, tsPreenchimento: r.ts!, msParaEncher: r.msParaEncher!, ticksPos: [] };
      s.ordem = undefined;
    } else if (agora - s.ordem.abertaEm >= JANELA_MAX_MS) {
      registrar({
        ts: s.ordem.abertaEm, chave: s.chave, exchange: s.exchange, symbol: s.symbol,
        lado: s.lado, preco: s.ordem.preco, preenchido: false,
      });
      // abre a próxima tentativa já neste ciclo, no preço atual
      const preco = precoNoToque(s.lado, bid, ask);
      s.ordem = { lado: s.lado, preco, abertaEm: agora };
      s.ticks = [{ ts: agora, last }];
    }
  }
}

export async function rodar(intervaloMs = 10_000): Promise<never> {
  console.log(`\n${'='.repeat(90)}`);
  console.log('MONITOR DE PREENCHIMENTO MAKER · mede se ordem limite preenche rápido o bastante');
  console.log(`${'='.repeat(90)}`);
  console.log(`\nacompanha os ${TOP_CANDIDATOS} melhores candidatos da vigilância, ambas as pernas`);
  console.log(`janela de preenchimento: ${JANELA_MAX_MS / 60_000}min · janela de reação: ${JANELA_REACAO_MS / 60_000}min`);
  console.log('NENHUMA ORDEM É ENVIADA — só leitura de ticker.\n');

  const estado = carregar();
  for (;;) {
    try {
      await ciclo(estado);
      salvar(estado);
    } catch (e) {
      console.error(`[preenchimento] erro no ciclo: ${(e as Error).message}`);
    }
    await new Promise((r) => setTimeout(r, intervaloMs));
  }
}
