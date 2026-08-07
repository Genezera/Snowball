/**
 * AUDITOR AO VIVO — liga o Auditor (src/audit/auditor.ts) aos motores que
 * realmente estão rodando (momentum-live, pares-live), em vez de só existir
 * como ferramenta sob demanda (`npm run team`, que audita um portfólio
 * hipotético em backtest, não os motores em paper que estão de pé agora).
 *
 * Por que isto não existia: `docs/EQUIPE.md` registrava o Auditor como "o
 * único papel vazio", mas o código em `src/audit/auditor.ts` já estava
 * pronto e testado — só nunca tinha sido conectado ao que está em produção.
 * A lacuna real não era o Auditor em si, era a ligação.
 *
 * Mesma disciplina do pipeline de ML (`src/ml/prontidao-vigilancia.ts`):
 * dormente até haver dado suficiente, e diz EXPLICITAMENTE que ainda não tem
 * dado em vez de fabricar um veredito. Com 07/08/2026: momentum tem 1 trade
 * fechado, pares tem 0 — ambos vão devolver EVIDENCIA_INSUFICIENTE por
 * enquanto, e isso é o resultado CORRETO, não um bug deste módulo.
 *
 * Read-only, por desenho: audita e relata, não fecha posição nem troca par
 * sozinho — mesma divisão de trabalho que custódia (detecta) / motor
 * (decide) já usa no resto do projeto.
 *
 * A expectativa (o que o backtest validado promete) é cara de calcular —
 * roda um backtest real sobre o universo inteiro — então é computada uma vez
 * por processo e cacheada em módulo, não a cada chamada.
 */
import fs from 'node:fs';
import path from 'node:path';
import { buildExpectation, audit, type AuditReport, type Expectation } from './auditor.ts';
import type { Trade } from '../core/types.ts';
import { runBacktest } from '../backtest/engine.ts';
import { buildStrategy } from '../strategies/index.ts';
import { makeConfig } from '../config.ts';
import { loadSeries } from '../data/store.ts';
import { UNIVERSO_MOMENTUM, PARAMS_VALIDADOS, MAX_BARS_VALIDADO } from '../data/momentum-universe.ts';
import { poolComTempo } from '../pairs/validado.ts';

const ROOT = process.cwd();
const MIN_TRADES = 25; // mesmo mínimo do Auditor em si — não duplicar o número

export interface AuditoriaMotor {
  motor: 'momentum' | 'pares';
  disponivel: boolean;
  motivo?: string;
  tradesRealizados: number;
  tradesMinimos: number;
  report?: AuditReport;
}

// ── expectativas: cacheadas em módulo, calculadas uma vez ──────────────────

let expectativaMomentumCache: Expectation | null = null;
function expectativaMomentum(): Expectation {
  if (expectativaMomentumCache) return expectativaMomentumCache;
  const cfg = makeConfig({
    initialEquity: 10_000,
    costPreset: 'binance-futures-maker',
    riskProfile: 'seed',
    maxBarsInTrade: MAX_BARS_VALIDADO,
  });
  const trades: Trade[] = [];
  for (const sym of UNIVERSO_MOMENTUM) {
    let series;
    try { series = loadSeries('binanceusdm', sym, '1d'); } catch { continue; }
    const res = runBacktest(series, buildStrategy('ts-momentum', PARAMS_VALIDADOS), cfg);
    trades.push(...res.trades);
  }
  // ddStop 0.3: mesma ordem de grandeza usada no bootstrap por blocos
  // (Resultado 12/14, docs/RESULTADOS.md) para o cenário de risco realista.
  expectativaMomentumCache = buildExpectation(trades, 0.3);
  return expectativaMomentumCache;
}

let expectativaParesCache: Expectation | null = null;
function expectativaPares(): Expectation {
  if (expectativaParesCache) return expectativaParesCache;
  const pool = poolComTempo();
  // poolComTempo() devolve { entryTime, exitTime, r, piorMovimento }, não
  // Trade completo — buildExpectation/monteCarlo só leem rEquity e exitTime,
  // então o resto do formato Trade fica com placeholder inofensivo.
  const trades = pool.map((t) => ({
    symbol: '', side: 'long', entryTime: t.entryTime, entryPrice: 0, exitTime: t.exitTime,
    exitPrice: 0, exitReason: 'signal', barsHeld: 0, notional: 0, cost: 0,
    pnl: t.r, rEquity: t.r, rPrice: t.r, equityAfter: 0,
  })) as unknown as Trade[];
  // ddStop 0.2: alavancagem de pares roda a 1x na produção (docs/RESULTADOS.md,
  // Resultado 7) — o único nível em que a expectância corrigida por liquidação
  // continua positiva.
  expectativaParesCache = buildExpectation(trades, 0.2);
  return expectativaParesCache;
}

// ── trades realizados: lidos do diario.jsonl de cada motor ao vivo ─────────

function lerLinhasJsonl(p: string): any[] {
  if (!fs.existsSync(p)) return [];
  return fs.readFileSync(p, 'utf8').trim().split('\n').filter(Boolean).map((l) => {
    try { return JSON.parse(l); } catch { return null; }
  }).filter(Boolean);
}

function tradesFechados(dir: string): { rEquity: number; exitTime: number }[] {
  const eventos = lerLinhasJsonl(path.join(ROOT, dir, 'diario.jsonl'));
  const out: { rEquity: number; exitTime: number }[] = [];
  for (const e of eventos) {
    if (e.evento !== 'fecha' || typeof e.pnl !== 'number' || typeof e.capital !== 'number') continue;
    const capitalAntes = e.capital - e.pnl;
    if (capitalAntes <= 0) continue; // evita divisão degenerada logo após o piso
    out.push({ rEquity: e.pnl / capitalAntes, exitTime: e.ts ?? Date.now() });
  }
  return out;
}

function auditarMotor(motor: 'momentum' | 'pares'): AuditoriaMotor {
  const trades = tradesFechados(motor);
  if (trades.length < MIN_TRADES) {
    return {
      motor,
      disponivel: false,
      motivo: `${trades.length} de ${MIN_TRADES} trades fechados necessários — julgar antes disso é ruído, não sinal`,
      tradesRealizados: trades.length,
      tradesMinimos: MIN_TRADES,
    };
  }
  const expectation = motor === 'momentum' ? expectativaMomentum() : expectativaPares();
  const report = audit(expectation, { trades: trades as unknown as Trade[] }, { minTrades: MIN_TRADES });
  return { motor, disponivel: true, tradesRealizados: trades.length, tradesMinimos: MIN_TRADES, report };
}

/** Ponto de entrada único, chamado pelo dashboard. Nunca lança — falha vira `disponivel:false`. */
export function auditoriaAoVivo(): { momentum: AuditoriaMotor; pares: AuditoriaMotor } {
  const seguro = (fn: () => AuditoriaMotor, motor: 'momentum' | 'pares'): AuditoriaMotor => {
    try { return fn(); } catch (err) {
      return {
        motor, disponivel: false,
        motivo: `erro calculando auditoria: ${(err as Error).message}`,
        tradesRealizados: 0, tradesMinimos: MIN_TRADES,
      };
    }
  };
  return {
    momentum: seguro(() => auditarMotor('momentum'), 'momentum'),
    pares: seguro(() => auditarMotor('pares'), 'pares'),
  };
}
