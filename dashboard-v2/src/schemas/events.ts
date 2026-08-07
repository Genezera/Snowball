/**
 * Contrato pra `/api/v2/events` — transporte incremental por cursor
 * (substitui o polling-da-janela-inteira do endpoint antigo).
 */
import { z } from 'zod';

export const EventoRecenteSchema = z.object({
  eventId: z.string(),
  sequenceNumber: z.number().nullable(),
  cycleId: z.string().nullable(),
  challengerId: z.string(),
  timestamp: z.number(),
  evento: z.string(),
  motivo: z.string().nullable(),
  idLegado: z.boolean(),
}).passthrough();

export const MotivoSemEventosSchema = z.enum([
  'nao_possui_diario', 'diario_vazio', 'eventos_fora_da_janela',
  'possui_eventos_mas_nenhum_no_resultado_atual',
]).nullable();

export const LinhaCoberturaSchema = z.object({
  challengerId: z.string(), declarado: z.literal(true), ativo: z.boolean(),
  possuiEstado: z.boolean(), possuiDiario: z.boolean(), diarioVazio: z.boolean(), possuiEventos: z.boolean(),
  eventosDepoisDoCursor: z.number(), eventosEntregues: z.number(),
  ultimoEvento: z.number().nullable(), motivoSemEventos: MotivoSemEventosSchema, erro: z.string().nullable(),
}).passthrough();

export const ManifestoCoberturaSchema = z.object({
  challengersDeclarados: z.number(),
  challengersComEstado: z.number(),
  challengersComDiario: z.number(),
  challengersComEventosNaJanela: z.number(),
  challengersSemEventosNaJanela: z.number(),
  challengersComErroDeLeitura: z.number(),
  linhas: z.array(LinhaCoberturaSchema),
}).passthrough();

export const RotacaoDetectadaSchema = z.object({
  fonte: z.string(),
  cursorResetReason: z.enum(['arquivo_recriado', 'arquivo_truncado']),
  oldGeneration: z.number(), newGeneration: z.number(), replayFrom: z.number(),
}).passthrough();

export const EventosRecentesRespostaSchema = z.object({
  ok: z.boolean(),
  eventos: z.array(EventoRecenteSchema),
  nextCursor: z.string(),
  hasMore: z.boolean(),
  serverTime: z.number(),
  oldestAvailableCursor: z.string(),
  rotacoesDetectadas: z.array(RotacaoDetectadaSchema).optional(),
  cobertura: ManifestoCoberturaSchema.optional(),
  erro: z.string().optional(),
}).passthrough();

export type EventoRecente = z.infer<typeof EventoRecenteSchema>;
export type LinhaCobertura = z.infer<typeof LinhaCoberturaSchema>;
export type ManifestoCobertura = z.infer<typeof ManifestoCoberturaSchema>;
export type EventosRecentesResposta = z.infer<typeof EventosRecentesRespostaSchema>;
