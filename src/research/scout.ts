/**
 * O BATEDOR — pesquisa contínua de estratégias.
 *
 * ---------------------------------------------------------------------------
 * O QUE ESTE MÓDULO NÃO É
 *
 * Não é uma IA que "descobre" estratégias lucrativas na internet. Se isso
 * funcionasse, quem publicou a estratégia estaria operando ela em vez de
 * publicar.
 *
 * O que ele faz é mais modesto e mais útil: mantém uma FILA de candidatos
 * genuinamente novos, deduplicados contra o que já foi testado, priorizados
 * por plausibilidade, para que o funil de validação nunca fique ocioso.
 *
 * O gargalo do projeto nunca foi falta de ideias — foi que nada sobrevive à
 * validação. Um batedor que traz 200 ideias por semana para um funil que
 * aprova zero é uma máquina de gerar trabalho. Por isso este módulo mede a
 * própria taxa de aproveitamento e reporta quando está trazendo lixo.
 * ---------------------------------------------------------------------------
 *
 * Fontes com acesso programático real:
 *   trader.dev  — 32k estratégias, Pine legível, KPIs completos
 *   busca web   — GitHub, notícias, papers (via o agente, não daqui)
 *
 * A tradução de Pine para o motor deste projeto é MANUAL. O batedor prepara o
 * material e diz o que vale a pena portar; ele não porta sozinho.
 */
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from '../data/store.ts';

export interface Candidate {
  id: string;
  source: 'trader.dev' | 'github' | 'news' | 'manual';
  name: string;
  symbol: string;
  timeframe: string;
  /** métricas como reportadas pela fonte — NÃO revalidadas */
  reported: {
    netProfitPct?: number;
    profitFactor?: number;
    sharpeRatio?: number;
    maxDrawdownPct?: number;
    totalTrades?: number;
    barsEvaluated?: number;
    fromTs?: number;
    toTs?: number;
  };
  /** assinatura das regras, para deduplicar contra o que já foi testado */
  signature: string;
  /** indicadores usados, extraídos do código */
  indicators: string[];
  url?: string;
  discoveredAt: number;
  status: 'novo' | 'enfileirado' | 'portado' | 'descartado';
  /** por que foi descartado, quando aplicável */
  verdict?: string;
}

const QUEUE = path.join(ROOT, 'research', 'queue.json');

export function loadQueue(): Candidate[] {
  if (!fs.existsSync(QUEUE)) return [];
  return JSON.parse(fs.readFileSync(QUEUE, 'utf8'));
}

export function saveQueue(q: Candidate[]) {
  fs.mkdirSync(path.dirname(QUEUE), { recursive: true });
  fs.writeFileSync(QUEUE, JSON.stringify(q, null, 2));
}

/**
 * Assinatura das regras a partir do código-fonte.
 *
 * Deduplicar por NOME é inútil — a base do trader.dev está cheia de
 * "SuperTrend v2c", "SuperTrend v2c (fork)", "SuperTrend v2c final" que são a
 * mesma coisa. Deduplicar pelo conjunto de indicadores + estrutura de saída
 * captura o que realmente distingue uma estratégia de outra.
 */
export function ruleSignature(pineSource: string): { signature: string; indicators: string[] } {
  const inds = [...new Set(
    [...pineSource.matchAll(/ta\.([a-z_]+)\s*\(/g)].map((m) => m[1]),
  )].sort();

  const exits: string[] = [];
  if (/trail_points|trail_offset|trail_price/.test(pineSource)) exits.push('trailing');
  if (/qty_percent/.test(pineSource)) exits.push('parcial');
  if (/\bstop\s*=/.test(pineSource)) exits.push('stop-abs');
  if (/\blimit\s*=/.test(pineSource)) exits.push('tp-abs');
  if (/\bloss\s*=/.test(pineSource)) exits.push('stop-ticks');
  if (/strategy\.close/.test(pineSource)) exits.push('flatten');

  const atrBased = /ta\.atr/.test(pineSource) && /(stop|limit)\s*=/.test(pineSource);

  return {
    signature: `${inds.join('+')}|${exits.sort().join(',')}|${atrBased ? 'atr-risk' : 'fixed-risk'}`,
    indicators: inds,
  };
}

/**
 * Filtro de plausibilidade — roda ANTES de qualquer trabalho de porte.
 *
 * Cada motivo aqui corresponde a um erro concreto observado na base:
 *   janela curta   -> Sharpe 17 em 10 dias de backtest
 *   PF absurdo     -> artefato de composição, não estratégia
 *   poucos trades  -> amostra insuficiente para significar algo
 *   DD alto        -> bateria o circuit breaker antes de entregar
 */
export function plausible(c: Candidate, opts: { minDays?: number; minTrades?: number; maxDd?: number } = {}): {
  ok: boolean;
  reasons: string[];
} {
  const minDays = opts.minDays ?? 365;
  const minTrades = opts.minTrades ?? 80;
  const maxDd = opts.maxDd ?? 40;
  const r = c.reported;
  const reasons: string[] = [];

  const days = r.fromTs && r.toTs ? (r.toTs - r.fromTs) / 86_400_000 : 0;
  if (days < minDays) reasons.push(`janela ${days.toFixed(0)}d < ${minDays}d`);
  if ((r.totalTrades ?? 0) < minTrades) reasons.push(`${r.totalTrades ?? 0} trades < ${minTrades}`);
  if ((r.profitFactor ?? 0) > 3) reasons.push(`PF ${r.profitFactor?.toFixed(2)} implausível`);
  if ((r.sharpeRatio ?? 0) > 4) reasons.push(`Sharpe ${r.sharpeRatio?.toFixed(2)} fisicamente implausível`);
  if ((r.maxDrawdownPct ?? 100) > maxDd) reasons.push(`DD ${r.maxDrawdownPct?.toFixed(0)}% > ${maxDd}%`);
  if ((r.netProfitPct ?? 0) > 5000) reasons.push(`retorno ${r.netProfitPct?.toFixed(0)}% é artefato de composição`);

  return { ok: reasons.length === 0, reasons };
}

/**
 * Prioriza a fila. O critério NÃO é lucro — é **novidade estrutural**.
 *
 * A décima variação de cruzamento de médias não acrescenta nada ao pool; uma
 * estratégia que usa uma família de saída que eu não tenho (trailing, saída
 * parcial, risco em ATR) acrescenta muito, mesmo com métricas medianas.
 *
 * Isto responde diretamente à concentração diagnosticada: o projeto inteiro
 * está apoiado em `body-breakout`, e o que reduz esse risco é diversidade de
 * mecanismo, não mais um breakout com números bonitos.
 */
export function prioritize(queue: Candidate[], knownSignatures: Set<string>): Candidate[] {
  const knownIndicators = new Set<string>();
  for (const s of knownSignatures) for (const i of s.split('|')[0].split('+')) knownIndicators.add(i);

  return queue
    .filter((c) => c.status === 'novo' || c.status === 'enfileirado')
    .map((c) => {
      const novosInd = c.indicators.filter((i) => !knownIndicators.has(i)).length;
      const sigNova = !knownSignatures.has(c.signature);
      const r = c.reported;
      const days = r.fromTs && r.toTs ? (r.toTs - r.fromTs) / 86_400_000 : 0;
      const calmar = r.maxDrawdownPct && r.netProfitPct && days > 0
        ? ((Math.pow(1 + r.netProfitPct / 100, 365 / days) - 1) * 100) / r.maxDrawdownPct
        : 0;

      // Novidade domina. Métricas entram como desempate, e com peso pequeno.
      const score = novosInd * 10 + (sigNova ? 5 : 0) + Math.min(3, Math.max(0, calmar));
      return { c, score, novosInd, sigNova, calmar };
    })
    .sort((a, b) => b.score - a.score)
    .map((x) => ({ ...x.c, verdict: `novidade: ${x.novosInd} indicadores inéditos, assinatura ${x.sigNova ? 'nova' : 'repetida'}, Calmar ${x.calmar.toFixed(2)}` }));
}

/** Saúde do próprio batedor: está trazendo material aproveitável ou lixo? */
export function scoutHealth(queue: Candidate[]): {
  total: number;
  novos: number;
  portados: number;
  descartados: number;
  taxaAproveitamento: number;
  diagnostico: string;
} {
  const total = queue.length;
  const portados = queue.filter((c) => c.status === 'portado').length;
  const descartados = queue.filter((c) => c.status === 'descartado').length;
  const novos = queue.filter((c) => c.status === 'novo' || c.status === 'enfileirado').length;
  const avaliados = portados + descartados;
  const taxa = avaliados > 0 ? portados / avaliados : 0;

  const diagnostico =
    avaliados < 10
      ? 'amostra pequena demais para julgar o batedor'
      : taxa < 0.05
        ? 'o batedor está trazendo lixo — aperte os filtros de plausibilidade antes de aumentar o volume'
        : taxa > 0.5
          ? 'taxa de aproveitamento alta demais: os filtros podem estar frouxos'
          : 'taxa de aproveitamento saudável';

  return { total, novos, portados, descartados, taxaAproveitamento: taxa, diagnostico };
}
