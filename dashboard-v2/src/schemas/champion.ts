/**
 * Contrato pra `/api/v2/champion` — API exclusiva do Dashboard 2.0, porta
 * 5184. `.passthrough()` no que não é obrigatório: o backend pode ganhar
 * campos novos sem quebrar este contrato.
 */
import { z } from 'zod';

export const EstadoChampionSchema = z.object({
  capital: z.number(),
  capitalInicial: z.number(),
  pico: z.number(),
  fundingTotal: z.number(),
  custosTotal: z.number(),
  pagamentos: z.number(),
  posicoes: z.array(z.record(z.string(), z.unknown())).optional(),
  iniciadoEm: z.number().optional(),
}).passthrough().nullable();

export const ProcessoSchema = z.object({
  chave: z.string(),
  nome: z.string(),
  vivo: z.boolean(),
  memoriaMB: z.number(),
  desde: z.number(),
}).passthrough();

export const VigilanciaSchema = z.object({
  viva: z.boolean().optional(),
  candidatos: z.number().optional(),
  fonte: z.string().optional(),
}).passthrough();

export const PontoCurvaSchema = z.object({ ts: z.number(), capital: z.number(), evento: z.string().optional() }).passthrough();
export const PagamentoDiaSchema = z.object({ dia: z.string(), total: z.number() }).passthrough();
export const PosicaoChampionSchema = z.object({
  symbol: z.string(), exchangeShort: z.string(), exchangeLong: z.string(),
  margemShort: z.number(), margemLong: z.number(), notionalPorPerna: z.number(),
  precoEntrada: z.number(), precoUltimo: z.number(), abertaEm: z.number(),
  spreadNaEntrada: z.number(), fundingAcumulado: z.number(), pagamentos: z.number(),
  distanciaShort: z.number(), distanciaLong: z.number(), distanciaMinima: z.number(),
  pernaEmRisco: z.string(), horasAberta: z.number(),
  precoAoVivoShort: z.number().nullable().optional(), precoAoVivoLong: z.number().nullable().optional(),
  variacaoShort: z.number().optional(), variacaoLong: z.number().optional(),
}).passthrough();

/** Bucket não instrumentado pelo motor atual — nunca `0`, sempre explícito sobre o motivo (Parte 10). */
export const BucketNaoRastreadoSchema = z.object({ valor: z.null(), tracked: z.literal(false), motivo: z.string() });

export const CustosChampionV2Schema = z.object({
  autoritativo: z.object({
    fundingTotalLifetime: z.number(), custosTotalLifetime: z.number(), pnlRealizadoLifetime: z.number(),
    reconciliado: z.boolean(), diferenca: z.number(), tolerancia: z.number(),
    origemFunding: z.string(), origemCustos: z.string(), origemPnL: z.string(), atualizadoEm: z.number(),
  }).passthrough().nullable(),
  decomposicao: z.object({
    escopo: z.enum(['complete', 'partial']),
    linhasLidas: z.number(), linhasTotaisNoArquivo: z.number(),
    buckets: z.object({
      entrada: z.number(), saida: z.number(),
      slippageEntrada: BucketNaoRastreadoSchema, slippageSaida: BucketNaoRastreadoSchema,
      escalonamento: z.number(), apara: z.number(), reinvestimento: z.number(),
      emergencial: BucketNaoRastreadoSchema,
      fechamentoEstimado: z.number().nullable(), outros: z.number(),
    }).passthrough(),
    notas: z.object({ slippage: z.string(), emergencial: z.string(), fechamentoEstimado: z.string() }).passthrough(),
    fundingBrutoNoEscopo: z.number(), custoTotalNoEscopo: z.number(),
    decomposicaoCompleta: z.boolean(), custosNaoClassificados: z.number().nullable(),
  }).passthrough().nullable(),
}).passthrough().nullable();

export const ChampionDadosSchema = z.object({
  estado: EstadoChampionSchema,
  marcacao: z.record(z.string(), z.unknown()).nullable().optional(),
  posicoes: z.array(PosicaoChampionSchema).optional(),
  curva: z.array(PontoCurvaSchema).optional(),
  pagamentosPorDia: z.array(PagamentoDiaSchema).optional(),
  processos: z.array(ProcessoSchema),
  vigilancia: VigilanciaSchema,
  custos: CustosChampionV2Schema.optional(),
  equityMark: z.number().nullable().optional(),
  equityLiquidacao: z.number().nullable().optional(),
  fundingTotal: z.number().nullable().optional(),
  custosTotal: z.number().nullable().optional(),
  pnlRealizado: z.number().nullable().optional(),
  atualizadoEm: z.number(),
}).passthrough();

export type ChampionDados = z.infer<typeof ChampionDadosSchema>;
export type PosicaoChampion = z.infer<typeof PosicaoChampionSchema>;
export type PontoCurva = z.infer<typeof PontoCurvaSchema>;
