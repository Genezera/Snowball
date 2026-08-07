/**
 * CONTRATO DE DADOS — auditoria da Etapa 1 do Dashboard 2.0.
 *
 * Schemas Zod pro payload REAL de `/api/profit-lab/dados` (definido em
 * `src/dashboard/server.ts` → `montarProfitLab()`, que só LÊ os arquivos já
 * calculados por `dashboard-aggregator.ts` — nenhum recálculo acontece no
 * servidor, e este dashboard não recalcula nada também).
 *
 * `.passthrough()` em todo objeto de propósito: o backend pode ganhar
 * campos novos sem quebrar este contrato — só os campos que o Command
 * Center realmente usa são validados como obrigatórios.
 */
import { z } from 'zod';
import { LeaderboardMultiSchema, JanelaComumSchema } from './multiStrategy';

export const StatusLabSchema = z.enum(['saudavel', 'degradado', 'stale', 'parado', 'erro']);

export const HeartbeatSchema = z.object({
  pid: z.number(),
  startedAt: z.number(),
  ultimoCiclo: z.number(),
  ciclosProcessados: z.number(),
  ciclosComErro: z.number(),
  reinicios: z.number(),
  statusPorChallenger: z.record(z.string(), z.string()),
}).passthrough();

export const ChampionResumoSchema = z.object({
  pnlRealizado: z.number(),
  pnlNaoRealizadoMark: z.number(),
  pnlNaoRealizadoExecutavel: z.number(),
  equityMark: z.number(),
  equityLiquidacao: z.number(),
  fundingBruto: z.number(),
  custosTotais: z.number(),
  capitalInicial: z.number(),
  capitalAtual: z.number(),
  pnlPct: z.number(),
  marcacaoDisponivel: z.boolean(),
}).passthrough();

export const CardMelhorSchema = z.object({
  challengerId: z.string().nullable(),
  valor: z.number(),
}).passthrough();

export const ResumoSchema = z.object({
  geradoEm: z.number(),
  champion: ChampionResumoSchema,
  control: z.object({ pnlBase: z.number(), pnlAjustado: z.number(), retornoPct: z.number(), trades: z.number() }).passthrough().nullable(),
  melhorPnlBase: CardMelhorSchema,
  melhorPnlAjustado: CardMelhorSchema,
  melhorRetornoPorMargem: CardMelhorSchema,
  menorDrawdown: CardMelhorSchema,
  maiorFrequencia: CardMelhorSchema,
  menorCusto: CardMelhorSchema,
  capitalVirtualTotal: z.number(),
  tradesTotaisPaper: z.number(),
  settlementsTotaisPaper: z.number(),
  numeroChallengers: z.number(),
  numeroAtivos: z.number(),
  numeroPausados: z.number(),
  numeroEliminados: z.number(),
}).passthrough();

export const LinhaLeaderboardSchema = z.object({
  challengerId: z.string(),
  familia: z.string().optional(),
  hipotese: z.string().optional(),
  altoRiscoAlavancagem: z.boolean(),
  cenarios: z.object({ ideal: z.number(), base: z.number(), conservador: z.number(), stress: z.number() }).partial().optional(),
  pnlPaperBase: z.number(),
  pnlPaperAjustado: z.number(),
  retornoPct: z.number(),
  drawdownMaxPct: z.number(),
  trades: z.number(),
  settlements: z.number(),
  custosTotais: z.number(),
  // Infinity no backend (sem funding ainda pra dividir) vira `null` na
  // serialização JSON (JSON não representa Infinity) — achado validando
  // contra o schema de verdade, não um bug: nullable é o contrato real.
  feeToGross: z.number().nullable(),
  retornoPorMargem: z.number(),
  nivelEvidencia: z.string(),
  eliminado: z.boolean(),
  pausado: z.boolean(),
  pnlIncremental: z.number(),
}).passthrough();

export const LeaderboardSchema = z.object({
  geradoEm: z.number(),
  championPnlPct: z.number(),
  linhas: z.array(LinhaLeaderboardSchema),
}).passthrough();

export const CustosChampionSchema = z.object({
  taxaEntrada: z.number(), taxaSaida: z.number(),
  custoEscalonamento: z.number(), custoApara: z.number(), custoReinvestimento: z.number(),
  custoRebalanceamento: z.number(), custoEmergencial: z.number(),
  custoTradingPuro: z.number(), custoGerenciamento: z.number(), custoTotal: z.number(),
  feeToGrossTrading: z.number().nullable(), feeToGrossTotal: z.number().nullable(),
  fundingBruto: z.number(),
}).passthrough().nullable();

export const LinhaCustosChallengerSchema = z.object({
  challengerId: z.string(),
  custoTradingPuro: z.number(), custoGerenciamento: z.number(), custoTotal: z.number(),
  feeToGrossTrading: z.number().nullable(), feeToGrossTotal: z.number().nullable(),
}).passthrough();

export const CustosSchema = z.object({
  champion: CustosChampionSchema,
  porChallenger: z.array(LinhaCustosChallengerSchema),
}).passthrough().nullable();

export const LinhaRiscoSchema = z.object({
  challengerId: z.string(), familia: z.string().optional(),
  drawdownMaxPct: z.number(), concentracaoMaxima: z.number(), altoRiscoAlavancagem: z.boolean(),
  posicoesAbertas: z.number(), capitalOcioso: z.number(),
}).passthrough();
export const RiscosSchema = z.object({ porChallenger: z.array(LinhaRiscoSchema) }).passthrough().nullable();

export const TelemetriaSchema = z.object({
  pid: z.number(),
  uptimeMs: z.number(),
  ciclosProcessados: z.number(),
  ciclosComErro: z.number(),
  reinicios: z.number(),
  latencia: z.object({ p50: z.number(), p95: z.number(), p99: z.number(), max: z.number() }),
  errosUltimas24h: z.number(),
  statusPorChallenger: z.record(z.string(), z.string()),
}).passthrough().nullable();

export const CapturaStatusSchema = z.enum(['observando', 'posicao_aberta', 'funding_pendente', 'fechando', 'concluida', 'erro']);
export const StatusJanelaCapturaSchema = z.object({
  challengerId: z.string(), janelaMin: z.number(), status: CapturaStatusSchema,
  symbol: z.string().nullable(), exchangeShort: z.string().nullable(), exchangeLong: z.string().nullable(),
  proximaLiquidacaoEm: z.number().nullable(), fundingJaRecebido: z.boolean().nullable(),
  trades: z.number().nullable(), settlements: z.number().nullable(), pnlRealizado: z.number().nullable(),
  custosTotais: z.number().nullable(),
  notionalPorPerna: z.number().nullable(), spread8hEntrada: z.number().nullable(), intervaloHorasLiquidacao: z.number().nullable(),
}).passthrough();

export const ProfitLabDadosSchema = z.object({
  status: StatusLabSchema,
  statusMotivo: z.string(),
  heartbeat: HeartbeatSchema.nullable(),
  resumo: ResumoSchema.nullable(),
  leaderboard: LeaderboardSchema.nullable(),
  leaderboardMulti: LeaderboardMultiSchema,
  janelaComum: JanelaComumSchema,
  custos: CustosSchema,
  riscos: RiscosSchema,
  telemetria: TelemetriaSchema,
  championVsControl: z.record(z.string(), z.unknown()).nullable().optional(),
  capturaStatus: z.array(StatusJanelaCapturaSchema).optional(),
  geradoEm: z.number(),
}).passthrough();

export type ProfitLabDados = z.infer<typeof ProfitLabDadosSchema>;
export type LinhaLeaderboard = z.infer<typeof LinhaLeaderboardSchema>;
export type Resumo = z.infer<typeof ResumoSchema>;
