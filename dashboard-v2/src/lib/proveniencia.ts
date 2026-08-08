/**
 * PROVENIÊNCIA ESTRUTURADA DO EVENTO — item 4 do "fechamento das cinco
 * páginas centrais".
 *
 * Regra única e honesta:
 *   1. Se a API traz o campo estruturado (sourceId/generation/byteOffset),
 *      ele PREVALECE — `{ valor, derived: false }`.
 *   2. Se não traz, mas o `eventId` sintético legado casa o padrão
 *      `fonte:g<geração>:b<byteOffset>`, deriva do texto —
 *      `{ valor, derived: true, derivedFrom: 'eventId' }`.
 *   3. Se nenhum dos dois, o campo é honestamente NÃO INSTRUMENTADO —
 *      `{ valor: 'não instrumentado', derived: false }` (nada foi derivado
 *      porque não havia de onde; nunca se inventa um zero).
 *
 * Campos estruturados SEMPRE vencem o parsing, inclusive quando divergem do
 * texto do eventId (o texto pode ser um id de produtor arbitrário; a
 * proveniência estruturada é a verdade do servidor).
 */
export const NAO_INSTRUMENTADO = 'não instrumentado';

export interface CampoProveniencia {
  valor: string;
  derived: boolean;
  derivedFrom?: string;
}

export interface ProvenienciaEvento {
  sourceId: CampoProveniencia;
  generation: CampoProveniencia;
  byteOffset: CampoProveniencia;
}

export interface EntradaProveniencia {
  eventId?: string | null;
  sourceId?: string | null;
  generation?: number | null;
  byteOffset?: number | null;
}

/** `fonte:g<geração>:b<byteOffset>` — o eventId sintético legado/colisão. */
const PADRAO_SINTETICO = /^(.+):g(\d+):b(\d+)$/;

function resolver(estruturado: string | number | null | undefined, doTexto: string | undefined): CampoProveniencia {
  // 1) estruturado prevalece (mesmo divergindo do texto do eventId)
  if (estruturado !== null && estruturado !== undefined && estruturado !== '') {
    return { valor: String(estruturado), derived: false };
  }
  // 2) fallback: derivado do eventId
  if (doTexto !== undefined) {
    return { valor: doTexto, derived: true, derivedFrom: 'eventId' };
  }
  // 3) não instrumentado
  return { valor: NAO_INSTRUMENTADO, derived: false };
}

export function derivarProveniencia(ev: EntradaProveniencia): ProvenienciaEvento {
  const m = PADRAO_SINTETICO.exec(ev.eventId ?? '');
  return {
    sourceId: resolver(ev.sourceId, m?.[1]),
    generation: resolver(ev.generation, m?.[2]),
    byteOffset: resolver(ev.byteOffset, m?.[3]),
  };
}
