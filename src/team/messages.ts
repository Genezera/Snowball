/**
 * Contratos de mensagem entre os módulos decisórios.
 *
 * Por que isto existe: até agora os módulos eram seis scripts de linha de
 * comando que eu rodava à mão e cujos resultados eu lia e interpretava. Isso
 * não é uma equipe, é um organograma com seis funcionários que não se falam.
 *
 * Estes tipos são o que os faz conversar. A regra de projeto: **toda mensagem
 * carrega evidência, não só conclusão.** Um módulo nunca diz "aprovado" — diz
 * "aprovado, com estes números, medidos assim, com estas ressalvas". É isso que
 * permite ao módulo seguinte discordar com base em algo, em vez de obedecer.
 */
import type { Trade } from '../core/types.ts';
import type { AuditReport } from '../audit/auditor.ts';

/** Quem emitiu. Aparece no log para que a decisão seja rastreável. */
export type Role = 'analista' | 'pesquisador' | 'risco' | 'alocador' | 'operador' | 'auditor';

export interface Evidence {
  /** o que foi medido */
  metric: string;
  value: number | string;
  /** como foi medido, para o leitor poder discordar */
  method: string;
}

/** ANALISTA -> PESQUISADOR: "olha estes, parecem viáveis" */
export interface CandidateProposal {
  from: 'analista';
  symbol: string;
  timeframe: string;
  kind: 'major' | 'alt' | 'equity-token';
  evidence: Evidence[];
  /** quantos testes o funil já consumiu, para o Sharpe deflacionado */
  testsConsumed: number;
}

/** PESQUISADOR -> RISCO: "este par tem (ou não tem) edge fora da amostra" */
export interface ResearchVerdict {
  from: 'pesquisador';
  symbol: string;
  strategy: string;
  timeframe: string;
  approved: boolean;
  expectancyR: number;
  oosTrades: number;
  walkForwardEfficiency: number;
  deflatedSharpe: number;
  maxDrawdown: number;
  p5Return: number;
  p95Drawdown: number;
  reasons: string[];
  oosTradeRecord: Trade[];
}

/** RISCO -> ALOCADOR: "o capital suporta isto, deste tamanho" — ou não suporta */
export interface RiskRuling {
  from: 'risco';
  symbol: string;
  strategy: string;
  /** o veto é assimétrico: risco pode barrar qualquer módulo, ninguém barra o risco */
  vetoed: boolean;
  vetoReason?: string;
  /** fração do equity a arriscar por trade neste par */
  riskPerTrade: number;
  /** notional que isso produz no equity atual */
  notionalAtCurrentEquity: number;
  /** quantas posições simultâneas a conta suporta no total */
  maxConcurrentPositions: number;
  /** equity abaixo do qual este par deixa de ser operável */
  minViableEquity: number;
  evidence: Evidence[];
}

/** ALOCADOR -> OPERADOR: "opere isto, com este tamanho" */
export interface AllocationOrder {
  from: 'alocador';
  active: { symbol: string; strategy: string; riskPerTrade: number }[];
  benched: { symbol: string; strategy: string; reason: string }[];
  totalRiskAtOnce: number;
  correlationWarning?: string;
}

/** AUDITOR -> ANALISTA: "este par degradou, procure outro" */
export interface AuditSignal {
  from: 'auditor';
  symbol: string;
  strategy: string;
  report: AuditReport;
  /** true quando o Auditor quer que o Analista rode nova varredura */
  triggersRescan: boolean;
}

export type TeamMessage =
  | CandidateProposal
  | ResearchVerdict
  | RiskRuling
  | AllocationOrder
  | AuditSignal;

/** Log da conversa, para que a decisão final seja auditável de ponta a ponta. */
export class TeamLog {
  private entries: { seq: number; from: Role; summary: string; detail?: unknown }[] = [];
  private seq = 0;

  say(from: Role, summary: string, detail?: unknown) {
    this.entries.push({ seq: ++this.seq, from, summary, detail });
  }

  print(verbose = false) {
    const pad: Record<Role, string> = {
      analista: 'ANALISTA ', pesquisador: 'PESQUISA ', risco: 'RISCO    ',
      alocador: 'ALOCADOR ', operador: 'OPERADOR ', auditor: 'AUDITOR  ',
    };
    for (const e of this.entries) {
      console.log(`  [${String(e.seq).padStart(2)}] ${pad[e.from]} ${e.summary}`);
      if (verbose && e.detail) console.log(`        ${JSON.stringify(e.detail)}`);
    }
  }

  all() { return this.entries; }
}
