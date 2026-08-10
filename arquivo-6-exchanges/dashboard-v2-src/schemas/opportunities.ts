import { z } from 'zod';

/** Campo que a fonte pode não medir — nunca zero, sempre explícito. */
const Rastreado = z.object({ valor: z.number().nullable(), tracked: z.boolean() });

export const OportunidadeSchema = z.object({
  observationId: z.string(),
  opportunityKey: z.string(),
  episodeId: z.string(),
  identity: z.string(),
  symbol: z.string(),
  exchangeLong: z.string(),
  exchangeShort: z.string(),
  spread: z.number(),
  apr: Rastreado,
  fundingCombined: Rastreado,
  liquidity: Rastreado,
  valorEsperado: z.number(),
  valorPorHora: z.number(),
  custo: z.number(),
  paybackSlack: z.number(),
  qualityScore: z.number(),
  capitalNecessario: z.number(),
  eligible: z.boolean(),
  blocked: z.boolean(),
  blockReasons: z.array(z.string()),
  persistenceCycles: z.number(),
  observationCount: z.number(),
  firstSeenAt: z.number(),
  lastSeenAt: z.number(),
  episodeStartedAt: z.number(),
  episodeEndedAt: z.number().nullable(),
  active: z.boolean(),
  observedAt: z.number(),
  settlementAt: Rastreado,
  source: z.string(),
  schemaVersion: z.number(),
}).passthrough();

export const OportunidadesRespostaSchema = z.object({
  ok: z.boolean(),
  items: z.array(OportunidadeSchema),
  summary: z.object({
    total: z.number(), eligible: z.number(), blocked: z.number(), ativas: z.number().optional(),
    novasUltimaHora: z.number(), persistenciaMediaCiclos: z.number(),
    melhorQualidade: z.number().nullable(), capturaAtiva: z.number(),
  }).passthrough(),
  coverage: z.object({
    ciclosLidos: z.number(), janelaHoras: z.number(),
    arquivosProcessados: z.array(z.string()).optional(), registrosLidos: z.number().optional(),
    registrosDescartados: z.number().optional(), errosLeitura: z.number().optional(),
    primeiroTs: z.number().nullable().optional(), ultimoTs: z.number().nullable().optional(),
  }).passthrough(),
  collectorStatus: z.object({
    estado: z.enum(['live', 'stale', 'offline', 'empty']),
    ultimoCicloTs: z.number().nullable(), idadeMs: z.number().nullable(),
  }).passthrough(),
  sourceUpdatedAt: z.number().nullable(),
  serverTime: z.number(),
  hasMore: z.boolean().optional(),
}).passthrough();

export type Oportunidade = z.infer<typeof OportunidadeSchema>;
export type OportunidadesResposta = z.infer<typeof OportunidadesRespostaSchema>;
