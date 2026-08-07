/**
 * OPORTUNIDADES — serviço read-only que AGREGA a fonte PERSISTENTE já
 * escrita pelo sistema de trading (o motor `spread-live.ts`/coletor grava
 * cada ciclo de decisão em `inteligencia/oportunidades/YYYY-MM-DD.jsonl` via
 * `registrarCiclo`). Ou seja: a coleta NÃO depende do dashboard — ela roda
 * no processo do motor, sobrevive a fechar o navegador, trocar de página,
 * reiniciar o frontend ou a API. Esta API só LÊ e agrega.
 *
 * Cada candidata registrada vira uma OBSERVAÇÃO; observações da mesma
 * identidade (`symbol|exchangeLong|exchangeShort`) são deduplicadas e
 * acumuladas — firstSeenAt/lastSeenAt/observationCount/persistenceCycles.
 * Campos que a fonte não mede saem como `{valor:null, tracked:false}`,
 * nunca zero.
 */
import fs from 'node:fs';
import path from 'node:path';

interface CandidataRegistrada {
  symbol: string; exchangeShort: string; exchangeLong: string;
  spread: number; consistencia: number; duracaoHoras: number;
  valorEsperado: number; valorPorHora: number; folga: number; custo: number;
  escorregamento: number; escorregamentoMedido: boolean;
  capitalNecessario: number; saldoDisponivel: number; score: number;
  aprovada: boolean; motivoRejeicao?: string;
}
interface CicloOportunidades {
  cycleId: string; ts: number; modo: 'persistencia' | 'captura';
  candidatas: CandidataRegistrada[]; escolhida?: string; aprovadasNaoEscolhidas?: string[];
}

export interface OportunidadeObservada {
  observationId: string;
  opportunityKey: string;    // combinação de mercado (symbol|long|short) — eterna
  episodeId: string;         // uma aparição CONTÍNUA (quebra após gap) — vida
  identity: string;          // = opportunityKey (compat)
  symbol: string;
  exchangeLong: string;
  exchangeShort: string;
  spread: number;
  apr: { valor: number | null; tracked: boolean };
  fundingCombined: { valor: number | null; tracked: boolean };
  liquidity: { valor: number | null; tracked: boolean };
  valorEsperado: number;
  valorPorHora: number;
  custo: number;
  paybackSlack: number;      // "folga" — a mesma conta do portão real
  qualityScore: number;      // "score"
  capitalNecessario: number;
  eligible: boolean;         // "aprovada"
  blocked: boolean;
  blockReasons: string[];
  persistenceCycles: number; // observações NO episódio atual
  observationCount: number;  // observações totais da chave na janela
  firstSeenAt: number;       // primeira observação da CHAVE na janela
  lastSeenAt: number;        // última observação (do episódio atual)
  episodeStartedAt: number;  // início do episódio atual
  episodeEndedAt: number | null; // fim do episódio (null = ainda ativo)
  active: boolean;           // episódio ainda vivo (última obs recente)
  observedAt: number;
  settlementAt: { valor: number | null; tracked: boolean };
  source: string;
  schemaVersion: number;
}

const SCHEMA_VERSION = 2;
/** Gap que encerra um episódio: sem observação por este tempo → nova aparição. */
const GAP_EPISODIO_MS = 30 * 60_000;

function arquivoDoDia(root: string, data: Date): string {
  const dia = data.toISOString().slice(0, 10);
  return path.join(root, 'inteligencia', 'oportunidades', `${dia}.jsonl`);
}

interface MetaLeitura {
  arquivosProcessados: string[]; registrosLidos: number; registrosDescartados: number;
  errosLeitura: number; primeiroTs: number | null; ultimoTs: number | null;
}
function lerCiclosRecentes(root: string, maxCiclos: number): { ciclos: CicloOportunidades[]; meta: MetaLeitura } {
  const agora = new Date();
  const ontem = new Date(agora.getTime() - 24 * 3600_000);
  const meta: MetaLeitura = { arquivosProcessados: [], registrosLidos: 0, registrosDescartados: 0, errosLeitura: 0, primeiroTs: null, ultimoTs: null };
  const linhas: string[] = [];
  for (const arq of [arquivoDoDia(root, ontem), arquivoDoDia(root, agora)]) {
    try {
      if (fs.existsSync(arq)) {
        linhas.push(...fs.readFileSync(arq, 'utf8').split('\n').filter(Boolean));
        meta.arquivosProcessados.push(`inteligencia/oportunidades/${arq.split(/[\\/]/).pop()}`);
      }
    } catch { meta.errosLeitura++; }
  }
  const ciclos: CicloOportunidades[] = [];
  for (const l of linhas.slice(-maxCiclos)) {
    try {
      const c = JSON.parse(l);
      if (Array.isArray(c.candidatas)) {
        ciclos.push(c); meta.registrosLidos++;
        meta.primeiroTs = meta.primeiroTs == null ? c.ts : Math.min(meta.primeiroTs, c.ts);
        meta.ultimoTs = meta.ultimoTs == null ? c.ts : Math.max(meta.ultimoTs, c.ts);
      } else meta.registrosDescartados++;
    } catch { meta.registrosDescartados++; }
  }
  return { ciclos, meta };
}

export interface ResultadoOportunidades {
  ok: boolean;
  items: OportunidadeObservada[];
  summary: {
    total: number; eligible: number; blocked: number; ativas: number;
    novasUltimaHora: number; persistenciaMediaCiclos: number;
    melhorQualidade: number | null; capturaAtiva: number;
  };
  coverage: {
    ciclosLidos: number; janelaHoras: number;
    arquivosProcessados: string[]; registrosLidos: number; registrosDescartados: number;
    errosLeitura: number; primeiroTs: number | null; ultimoTs: number | null;
  };
  collectorStatus: { estado: 'live' | 'stale' | 'offline' | 'empty'; ultimoCicloTs: number | null; idadeMs: number | null };
  sourceUpdatedAt: number | null;
  serverTime: number;
}

export function montarOportunidades(root: string, opts: { maxCiclos?: number } = {}): ResultadoOportunidades {
  const { ciclos, meta } = lerCiclosRecentes(root, opts.maxCiclos ?? 400);
  const agora = Date.now();

  // 1) coleta TODAS as observações por chave de mercado (opportunityKey)
  const porChave = new Map<string, { ts: number; c: CandidataRegistrada }[]>();
  let ultimoCicloTs: number | null = null;
  let capturaAtiva = 0;
  for (const ciclo of ciclos) {
    ultimoCicloTs = ultimoCicloTs == null ? ciclo.ts : Math.max(ultimoCicloTs, ciclo.ts);
    if (ciclo.modo === 'captura') capturaAtiva++;
    for (const c of ciclo.candidatas) {
      const key = `${c.symbol}|${c.exchangeLong}|${c.exchangeShort}`;
      if (!porChave.has(key)) porChave.set(key, []);
      porChave.get(key)!.push({ ts: ciclo.ts, c });
    }
  }

  // 2) para cada chave, separa as observações em EPISÓDIOS (quebra após um
  // gap sem observação) e reporta o episódio ATUAL (o mais recente). Isso
  // distingue "mesma combinação de mercado" (opportunityKey) de "uma
  // aparição contínua" (episodeId).
  const items: OportunidadeObservada[] = [];
  for (const [key, obs] of porChave) {
    obs.sort((a, b) => a.ts - b.ts);
    const firstSeenAt = obs[0].ts;
    // encontra o início do último episódio (primeira obs após o último gap)
    let inicioEpisodio = 0;
    for (let i = 1; i < obs.length; i++) {
      if (obs[i].ts - obs[i - 1].ts > GAP_EPISODIO_MS) inicioEpisodio = i;
    }
    const episodio = obs.slice(inicioEpisodio);
    const ult = episodio[episodio.length - 1];
    const c = ult.c;
    const lastSeenAt = ult.ts;
    const episodeStartedAt = episodio[0].ts;
    const active = (agora - lastSeenAt) <= GAP_EPISODIO_MS;
    const [symbol, exchangeLong, exchangeShort] = key.split('|');
    const blockReasons = [...new Set(episodio.map((o) => o.c.motivoRejeicao).filter((r): r is string => !!r))];
    items.push({
      observationId: `${key}#${episodeStartedAt}`,
      opportunityKey: key, episodeId: `${key}#${episodeStartedAt}`, identity: key,
      symbol, exchangeLong, exchangeShort,
      spread: c.spread,
      apr: { valor: null, tracked: false },
      fundingCombined: { valor: null, tracked: false },
      liquidity: { valor: null, tracked: false },
      valorEsperado: c.valorEsperado, valorPorHora: c.valorPorHora, custo: c.custo,
      paybackSlack: c.folga, qualityScore: c.score, capitalNecessario: c.capitalNecessario,
      eligible: c.aprovada, blocked: !c.aprovada, blockReasons,
      persistenceCycles: episodio.length, observationCount: obs.length,
      firstSeenAt, lastSeenAt, episodeStartedAt, episodeEndedAt: active ? null : lastSeenAt, active,
      observedAt: lastSeenAt,
      settlementAt: { valor: null, tracked: false },
      source: 'inteligencia/oportunidades', schemaVersion: SCHEMA_VERSION,
    });
  }
  items.sort((a, b) => b.qualityScore - a.qualityScore);

  const umaHora = agora - 3600_000;
  const eligible = items.filter((i) => i.eligible).length;
  const ativas = items.filter((i) => i.active).length;
  const persistencias = items.map((i) => i.persistenceCycles);
  const melhorQualidade = items.length ? Math.max(...items.map((i) => i.qualityScore)) : null;

  // A cadência de escrita de ciclos de OPORTUNIDADE (motor) é mais lenta que
  // a de eventos do champion — o motor só grava um ciclo quando reavalia o
  // conjunto. Por isso os limiares são generosos: o importante é mostrar a
  // IDADE real honestamente (o frontend exibe o timestamp), não alarmar.
  const idadeMs = ultimoCicloTs != null ? agora - ultimoCicloTs : null;
  const estado: ResultadoOportunidades['collectorStatus']['estado'] =
    items.length === 0 ? 'empty' : idadeMs == null ? 'offline' : idadeMs < 15 * 60_000 ? 'live' : idadeMs < 120 * 60_000 ? 'stale' : 'offline';

  return {
    ok: true,
    items,
    summary: {
      total: items.length, eligible, blocked: items.length - eligible, ativas,
      novasUltimaHora: items.filter((i) => i.episodeStartedAt >= umaHora).length,
      persistenciaMediaCiclos: persistencias.length ? +(persistencias.reduce((s, n) => s + n, 0) / persistencias.length).toFixed(1) : 0,
      melhorQualidade, capturaAtiva,
    },
    coverage: {
      ciclosLidos: ciclos.length, janelaHoras: 24,
      arquivosProcessados: meta.arquivosProcessados, registrosLidos: meta.registrosLidos,
      registrosDescartados: meta.registrosDescartados, errosLeitura: meta.errosLeitura,
      primeiroTs: meta.primeiroTs, ultimoTs: meta.ultimoTs,
    },
    collectorStatus: { estado, ultimoCicloTs, idadeMs },
    sourceUpdatedAt: ultimoCicloTs,
    serverTime: agora,
  };
}
