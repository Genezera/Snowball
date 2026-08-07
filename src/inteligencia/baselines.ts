/**
 * BASELINES (Parte 5 da etapa de auditoria) — "resultado supera um baseline
 * simples?" não tinha resposta no Lab até agora. Este módulo é
 * deliberadamente SEPARADO de `virtual-portfolio.ts`: aquele framework
 * reconcilia PnL a partir de fluxo de caixa (funding − custos), que é o
 * modelo certo pra arbitragem delta-neutra mas ERRADO pra buy-and-hold — lá
 * o lucro é 100% variação de preço de uma posição nunca fechada, que o
 * `pnlPaperBase` de `leaderboard.ts` simplesmente não captura (ficaria
 * sempre ~0, escondendo o resultado real). Em vez de forçar um baseline
 * dentro de um modelo que não serve pra ele, este arquivo tem sua própria
 * contabilidade mínima e honesta.
 *
 * 4 baselines pedidos:
 *   baseline-cash               nunca compra nada — a régua "capital parado"
 *   baseline-btc-buy-hold       compra BTC uma vez, nunca vende
 *   baseline-eth-buy-hold       compra ETH uma vez, nunca vende
 *   baseline-equal-weight-btc-eth  50/50 BTC+ETH, comprado uma vez
 *
 * Custo de entrada modelado uma única vez (taker + slippage, mesmas
 * constantes já medidas em `funding/custos-reais.ts` — não reinventa um
 * número novo), nunca mais — não é uma estratégia que gerencia posição, é
 * literalmente "compra e esquece".
 */
import fs from 'node:fs';
import path from 'node:path';
import { ESCORREGAMENTO_PERNA } from '../funding/custos-reais.ts';

/** taxa taker de referência — mesma ordem de grandeza já usada no projeto pra custo de entrada spot/perp */
const TAXA_ENTRADA_BASELINE = 0.0005;

export interface AtivoBaseline { symbol: string; exchange: string; peso: number }

export interface ConfigBaseline {
  id: string;
  tipo: 'cash' | 'buy-hold' | 'equal-weight';
  ativos: AtivoBaseline[];
  capitalInicial: number;
  hipotese: string;
}

export interface PosicaoBaseline {
  symbol: string; exchange: string; precoEntrada: number; notionalLiquido: number;
}

export interface EstadoBaseline {
  id: string;
  tipo: ConfigBaseline['tipo'];
  capitalInicial: number;
  posicoes: PosicaoBaseline[];
  custoEntrada: number;
  comprado: boolean;
  pico: number;
  drawdownMaxPct: number;
  iniciadoEm: number;
  eliminado?: { ts: number; motivo: string };
}

export const BASELINE_CASH: ConfigBaseline = {
  id: 'baseline-cash', tipo: 'cash', ativos: [], capitalInicial: 200,
  hipotese: 'capital parado, sem nenhuma decisão — a régua mínima que qualquer motor precisa superar',
};
export const BASELINE_BTC_BUY_HOLD: ConfigBaseline = {
  id: 'baseline-btc-buy-hold', tipo: 'buy-hold',
  ativos: [{ symbol: 'BTC/USDT:USDT', exchange: 'binanceusdm', peso: 1 }],
  capitalInicial: 200,
  hipotese: 'comprar BTC e nunca vender — quanto do resultado de uma estratégia é só direção de mercado',
};
export const BASELINE_ETH_BUY_HOLD: ConfigBaseline = {
  id: 'baseline-eth-buy-hold', tipo: 'buy-hold',
  ativos: [{ symbol: 'ETH/USDT:USDT', exchange: 'binanceusdm', peso: 1 }],
  capitalInicial: 200,
  hipotese: 'mesma pergunta do BTC, ativo diferente — evita que a resposta dependa de qual moeda',
};
export const BASELINE_EQUAL_WEIGHT: ConfigBaseline = {
  id: 'baseline-equal-weight-btc-eth', tipo: 'equal-weight',
  ativos: [{ symbol: 'BTC/USDT:USDT', exchange: 'binanceusdm', peso: 0.5 }, { symbol: 'ETH/USDT:USDT', exchange: 'binanceusdm', peso: 0.5 }],
  capitalInicial: 200,
  hipotese: '50/50 BTC+ETH comprado uma vez — diversificação mínima sem nenhuma decisão ativa',
};
export const BASELINES_APROVADOS: ConfigBaseline[] = [BASELINE_CASH, BASELINE_BTC_BUY_HOLD, BASELINE_ETH_BUY_HOLD, BASELINE_EQUAL_WEIGHT];

export function novoEstadoBaseline(cfg: ConfigBaseline): EstadoBaseline {
  return {
    id: cfg.id, tipo: cfg.tipo, capitalInicial: cfg.capitalInicial,
    posicoes: [], custoEntrada: 0, comprado: cfg.tipo === 'cash',
    pico: cfg.capitalInicial, drawdownMaxPct: 0, iniciadoEm: Date.now(),
  };
}

export type BuscarPrecoBaseline = (exchange: string, symbol: string) => Promise<number>;

/** Compra uma vez (se ainda não comprou) e nunca decide mais nada depois disso. */
export async function cicloBaseline(cfg: ConfigBaseline, e: EstadoBaseline, buscarPreco: BuscarPrecoBaseline): Promise<void> {
  if (e.eliminado) return;
  if (e.comprado) return; // cash já nasce "comprado" (sem posição por desenho); buy-hold só passa aqui uma vez

  for (const ativo of cfg.ativos) {
    try {
      const preco = await buscarPreco(ativo.exchange, ativo.symbol);
      const notionalBruto = cfg.capitalInicial * ativo.peso;
      const custo = notionalBruto * (TAXA_ENTRADA_BASELINE + ESCORREGAMENTO_PERNA);
      e.custoEntrada += custo;
      e.posicoes.push({ symbol: ativo.symbol, exchange: ativo.exchange, precoEntrada: preco, notionalLiquido: notionalBruto - custo });
    } catch { /* preço indisponível neste ciclo — tenta de novo no próximo, nunca marca "comprado" sem ter comprado */ return; }
  }
  e.comprado = true;
}

export interface ResumoBaseline {
  id: string; tipo: string; hipotese: string;
  capitalInicial: number; custoEntrada: number;
  equityAtual: number; pnl: number; pnlPct: number;
  drawdownMaxPct: number; comprado: boolean;
}

/** Marca a mercado com preços atuais — pura, não decide nada, só reporta. */
export function resumirBaseline(cfg: ConfigBaseline, e: EstadoBaseline, precosAtuais: Record<string, number>): ResumoBaseline {
  let equityAtual = e.capitalInicial - e.custoEntrada;
  if (e.tipo !== 'cash') {
    equityAtual = 0;
    for (const p of e.posicoes) {
      const precoAtual = precosAtuais[`${p.exchange}|${p.symbol}`] ?? p.precoEntrada;
      equityAtual += p.notionalLiquido * (precoAtual / p.precoEntrada);
    }
  }
  const pnl = equityAtual - e.capitalInicial;
  e.pico = Math.max(e.pico, equityAtual);
  const dd = e.pico > 0 ? (e.pico - equityAtual) / e.pico : 0;
  e.drawdownMaxPct = Math.max(e.drawdownMaxPct, dd * 100);
  return {
    id: cfg.id, tipo: cfg.tipo, hipotese: cfg.hipotese,
    capitalInicial: e.capitalInicial, custoEntrada: e.custoEntrada,
    equityAtual, pnl, pnlPct: e.capitalInicial > 0 ? (pnl / e.capitalInicial) * 100 : 0,
    drawdownMaxPct: e.drawdownMaxPct, comprado: e.comprado,
  };
}

function caminhoEstadoBaseline(root: string, id: string): string {
  return path.join(root, 'inteligencia', 'baselines', id, 'estado.json');
}
export function salvarEstadoBaseline(root: string, e: EstadoBaseline): void {
  const p = caminhoEstadoBaseline(root, e.id);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(e, null, 2));
}
export function carregarEstadoBaseline(root: string, cfg: ConfigBaseline): EstadoBaseline {
  const p = caminhoEstadoBaseline(root, cfg.id);
  if (fs.existsSync(p)) {
    try { return JSON.parse(fs.readFileSync(p, 'utf8')) as EstadoBaseline; } catch { /* recomeça limpo se corrompido */ }
  }
  return novoEstadoBaseline(cfg);
}
