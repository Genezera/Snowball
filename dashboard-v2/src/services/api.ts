/**
 * CAMADA DE DADOS — único lugar que fala com o backend. Lê, valida contra
 * schema (Zod), nunca recalcula nada financeiro. Se a validação falhar, o
 * dado é tratado como corrompido — nunca passa adiante um objeto que não
 * bateu com o contrato, e nunca produz um valor fabricado como fallback.
 *
 * Parte 4 ("Isolamento Real"): SÓ fala com a API exclusiva do Dashboard 2.0
 * (`dashboard-v2/api/server.ts`, porta 5184 por padrão, configurável via
 * `VITE_DASHBOARD_V2_API_URL`). Nenhuma chamada aqui cai pra 8787/porta
 * antiga — se a variável de ambiente não estiver setada, toda chamada
 * retorna erro explícito em vez de tentar um fallback silencioso.
 */
import { EventosRecentesRespostaSchema, type EventosRecentesResposta } from '../schemas/events';

export type Resultado<T> =
  | { estado: 'sucesso'; dado: T; recebidoEm: number }
  | { estado: 'erro'; motivo: string; recebidoEm: number }
  | { estado: 'corrompido'; motivo: string; recebidoEm: number };

const BASE = import.meta.env.VITE_DASHBOARD_V2_API_URL;
const SEM_BASE_CONFIGURADA = 'VITE_DASHBOARD_V2_API_URL não configurada — nenhuma chamada é feita pra API antiga como alternativa; configure a variável de ambiente.';

async function buscarValidado<T>(url: string, schema: { parse: (v: unknown) => T }): Promise<Resultado<T>> {
  const recebidoEm = Date.now();
  if (!BASE) return { estado: 'erro', motivo: SEM_BASE_CONFIGURADA, recebidoEm };
  let r: Response;
  try {
    r = await fetch(BASE + url, { headers: { Accept: 'application/json' } });
  } catch (e) {
    // falha de REDE (timeout, conexão recusada, DNS) — o servidor nunca respondeu
    return { estado: 'erro', motivo: e instanceof Error ? e.message : 'falha de rede', recebidoEm };
  }
  if (!r.ok) return { estado: 'erro', motivo: `HTTP ${r.status}`, recebidoEm };

  // achado ao vivo (Teste D — resiliência): JSON malformado é dado
  // CORROMPIDO (o servidor respondeu, só que com algo ilegível), não uma
  // falha de rede — separado do try acima de propósito, senão caía no
  // branch 'erro' junto com timeout/DNS, que é uma categoria diferente.
  let bruto: unknown;
  try {
    bruto = await r.json();
  } catch (e) {
    return { estado: 'corrompido', motivo: e instanceof Error ? `JSON inválido: ${e.message}` : 'JSON inválido', recebidoEm };
  }

  try {
    const dado = schema.parse(bruto);
    return { estado: 'sucesso', dado, recebidoEm };
  } catch (e) {
    return { estado: 'corrompido', motivo: e instanceof Error ? e.message : 'schema inválido', recebidoEm };
  }
}

// Champion e Profit Lab (bloco "6 exchanges") foram ARQUIVADOS — ver
// arquivo-6-exchanges/README.md. buscarChampion/buscarProfitLab/
// buscarOportunidades saíram junto (só existiam pra alimentar páginas que
// não existem mais).
// Maximização de lucro: schema lenient (o builder é a fonte da verdade; a página é só leitura).
export function buscarMaximizacao(): Promise<Resultado<{ dados: any } | null>> {
  return buscarValidado('/api/v2/profit-maximization', { parse: (v: unknown) => v as { dados: any } | null });
}
// Detalhe rico dos competidores 2-exchange (a dupla, cada um separado).
export function buscarCompetidores(): Promise<Resultado<{ competidores: any[] } | null>> {
  return buscarValidado('/api/v2/competidores', { parse: (v: unknown) => v as { competidores: any[] } | null });
}
// Oportunidades spot-perp (cash-and-carry no perp) do coletor — dado real, leitura.
export function buscarSpotperp(): Promise<Resultado<{ total: number; porExchange: Record<string, number>; geradoEm: number | null; top: any[] } | null>> {
  return buscarValidado('/api/v2/spotperp', { parse: (v: unknown) => v as any });
}
export function buscarEventosIncremental(cursor: string | null, limit: number): Promise<Resultado<EventosRecentesResposta>> {
  const qs = new URLSearchParams({ limit: String(limit) });
  if (cursor) qs.set('after', cursor);
  return buscarValidado(`/api/v2/events?${qs.toString()}`, EventosRecentesRespostaSchema);
}
// Saúde do motor 2-ex + infra compartilhada (scanner, spot-perp) — schema lenient, a API é a fonte de verdade.
export function buscarSystemHealth(): Promise<Resultado<{ dominios: any[]; geradoEm: number } | null>> {
  return buscarValidado('/api/v2/system-health', { parse: (v: unknown) => v as any });
}

/** Lista de chamadas de rede que este arquivo pode fazer — auditável (Parte 13, item 5). */
export const CHAMADAS_DE_REDE_PERMITIDAS = [
  '/api/v2/events', '/api/v2/health', '/api/v2/profit-maximization', '/api/v2/competidores', '/api/v2/spotperp', '/api/v2/system-health',
] as const;
