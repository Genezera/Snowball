/**
 * ADAPTADORES DE MOTORES JÁ EXISTENTES (Parte 6 da etapa de auditoria) —
 * `momentum-live.ts` e `pares-live.ts` já rodam ao vivo em paper, com capital
 * e diário próprios, DESDE ANTES desta sessão. Pedido explícito: trazer os
 * dois pro mesmo framework de comparação sem reescrever a lógica de
 * estratégia. Isto aqui é 100% LEITURA — nunca importa `momentum-live.ts`
 * nem `pares-live.ts`, nunca escreve em `momentum/` nem `pares/`, só lê os
 * arquivos que esses processos já gravam sozinhos.
 *
 * Os dois motores compartilham quase o mesmo formato de estado (capital,
 * capitalInicial, pico, posicoes, fechados, vitorias, custosTotal,
 * pnlAcumulado, halted) — por isso um adaptador genérico serve pros dois,
 * parametrizado só pelo diretório e pelo nome.
 *
 * Limitação honesta: nem todo campo do "equity de liquidação" pedido é
 * calculável sem reimplementar a lógica de marcação de cada motor (que
 * pertence à estratégia, não ao adaptador). Onde a marcação a mercado não
 * está disponível a partir do estado gravado, `equityMark` cai para
 * `capital` (só o realizado) e o campo `pnlNaoRealizadoDisponivel` avisa
 * disso explicitamente — nunca inventa um número.
 */
import fs from 'node:fs';
import path from 'node:path';

export interface EstadoMotorExistente {
  iniciadoEm?: number;
  capital: number;
  capitalInicial: number;
  pico?: number;
  posicoes?: { symbol?: string; side?: string; entryPrice?: number; notional?: number }[];
  fechados?: number;
  vitorias?: number;
  custosTotal?: number;
  pnlAcumulado?: number;
  halted?: boolean;
  haltReason?: string;
  ultimoCicloTs?: number;
}

export interface ResumoMotorAdaptado {
  strategyId: string;
  origem: 'momentum-live.ts' | 'pares-live.ts';
  disponivel: boolean;
  capitalVirtual: number;
  capitalInicial: number;
  pnlRealizado: number;
  pnlNaoRealizadoDisponivel: boolean;
  custosTotais: number;
  drawdownMaxPct: number;
  trades: number;
  vitorias: number;
  taxaVitoria: number | null;
  posicoesAbertas: number;
  halted: boolean;
  haltReason?: string;
  iniciadoEm: number | null;
  ultimaAtualizacao: number | null;
  idadeMinutos: number | null;
}

function lerEstadoSeguro(caminho: string): EstadoMotorExistente | null {
  try {
    if (!fs.existsSync(caminho)) return null;
    return JSON.parse(fs.readFileSync(caminho, 'utf8')) as EstadoMotorExistente;
  } catch { return null; }
}

function adaptar(strategyId: string, origem: ResumoMotorAdaptado['origem'], e: EstadoMotorExistente | null): ResumoMotorAdaptado {
  if (!e) {
    return {
      strategyId, origem, disponivel: false, capitalVirtual: 0, capitalInicial: 0,
      pnlRealizado: 0, pnlNaoRealizadoDisponivel: false, custosTotais: 0, drawdownMaxPct: 0,
      trades: 0, vitorias: 0, taxaVitoria: null, posicoesAbertas: 0, halted: false,
      iniciadoEm: null, ultimaAtualizacao: null, idadeMinutos: null,
    };
  }
  const pico = e.pico ?? e.capital;
  const drawdownMaxPct = pico > 0 ? Math.max(0, ((pico - e.capital) / pico) * 100) : 0;
  const ultimaAtualizacao = e.ultimoCicloTs ?? null;
  return {
    strategyId, origem, disponivel: true,
    capitalVirtual: e.capital, capitalInicial: e.capitalInicial,
    pnlRealizado: e.capital - e.capitalInicial,
    // nenhum dos dois motores grava marcação a mercado separada do capital
    // realizado hoje — reportar isso como indisponível é mais honesto que
    // fingir equityMark == capital como se fosse a mesma coisa
    pnlNaoRealizadoDisponivel: false,
    custosTotais: e.custosTotal ?? 0,
    drawdownMaxPct,
    trades: e.fechados ?? 0,
    vitorias: e.vitorias ?? 0,
    taxaVitoria: (e.fechados ?? 0) > 0 ? (e.vitorias ?? 0) / (e.fechados as number) : null,
    posicoesAbertas: (e.posicoes ?? []).length,
    halted: !!e.halted, haltReason: e.haltReason,
    iniciadoEm: e.iniciadoEm ?? null,
    ultimaAtualizacao,
    idadeMinutos: ultimaAtualizacao ? (Date.now() - ultimaAtualizacao) / 60_000 : null,
  };
}

export function lerMomentumAdaptado(root: string): ResumoMotorAdaptado {
  return adaptar('momentum-ts', 'momentum-live.ts', lerEstadoSeguro(path.join(root, 'momentum', 'estado.json')));
}
export function lerParesAdaptado(root: string): ResumoMotorAdaptado {
  return adaptar('pares-cointegrados', 'pares-live.ts', lerEstadoSeguro(path.join(root, 'pares', 'estado.json')));
}
