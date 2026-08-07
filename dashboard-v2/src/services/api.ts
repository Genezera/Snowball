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
import { ChampionDadosSchema, type ChampionDados } from '../schemas/champion';
import { ProfitLabDadosSchema, type ProfitLabDados } from '../schemas/profitLab';
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

export function buscarChampion(): Promise<Resultado<ChampionDados>> {
  return buscarValidado('/api/v2/champion', ChampionDadosSchema);
}
export function buscarProfitLab(): Promise<Resultado<ProfitLabDados>> {
  return buscarValidado('/api/v2/profit-lab', ProfitLabDadosSchema);
}
export function buscarEventosIncremental(cursor: string | null, limit: number): Promise<Resultado<EventosRecentesResposta>> {
  const qs = new URLSearchParams({ limit: String(limit) });
  if (cursor) qs.set('after', cursor);
  return buscarValidado(`/api/v2/events?${qs.toString()}`, EventosRecentesRespostaSchema);
}

/** Lista de chamadas de rede que este arquivo pode fazer — auditável (Parte 13, item 5). */
export const CHAMADAS_DE_REDE_PERMITIDAS = [
  '/api/v2/champion', '/api/v2/profit-lab', '/api/v2/events', '/api/v2/waterfall', '/api/v2/health',
] as const;
