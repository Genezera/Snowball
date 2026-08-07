import { z } from 'zod';

export const LinhaMultiStrategySchema = z.object({
  strategyId: z.string(),
  familia: z.string(),
  disponivel: z.boolean(),
  capitalVirtual: z.number(),
  pnlDesdeOInicio: z.number(),
  pnlPct: z.number(),
  drawdownMaxPct: z.number(),
  iniciadoEm: z.number().nullable(),
  diasRodando: z.number().nullable(),
  dentroDaJanelaComumDesdeOInicio: z.boolean(),
  comparavelNaJanela: z.boolean(),
  nota: z.string(),
}).passthrough();

export const LeaderboardMultiSchema = z.object({
  geradoEm: z.number(),
  janelaComum: z.object({ desde: z.number(), ate: z.number(), descricao: z.string() }).passthrough(),
  historicoTotalChampion: z.object({ desde: z.number(), ate: z.number(), descricao: z.string() }).passthrough(),
  linhas: z.array(LinhaMultiStrategySchema),
  aviso: z.string(),
}).passthrough().nullable();

const linhaDeltaSchema = z.object({ valorNoInicio: z.number(), valorNoFim: z.number(), deltaNaJanela: z.number() });

export const JanelaComumSchema = z.object({
  geradoEm: z.number(),
  commonWindowStart: z.number(),
  commonWindowEnd: z.number(),
  duracaoJanelaMinutos: z.number(),
  aviso: z.string(),
  champion: z.object({
    fundingTotal: linhaDeltaSchema, custosTotal: linhaDeltaSchema,
    capital: linhaDeltaSchema, pnlEconomicoNaJanela: z.number().nullable(),
  }).passthrough().nullable(),
}).passthrough().nullable();

export type LinhaMultiStrategy = z.infer<typeof LinhaMultiStrategySchema>;
export type LeaderboardMulti = z.infer<typeof LeaderboardMultiSchema>;
export type JanelaComumDados = z.infer<typeof JanelaComumSchema>;
export const _linhaDeltaSchema = linhaDeltaSchema;
