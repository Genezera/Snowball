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
  identity: string;
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
  persistenceCycles: number;
  observationCount: number;
  firstSeenAt: number;
  lastSeenAt: number;
  observedAt: number;
  settlementAt: { valor: number | null; tracked: boolean };
  source: string;
  schemaVersion: number;
}

const SCHEMA_VERSION = 1;

function arquivoDoDia(root: string, data: Date): string {
  const dia = data.toISOString().slice(0, 10);
  return path.join(root, 'inteligencia', 'oportunidades', `${dia}.jsonl`);
}

function lerCiclosRecentes(root: string, maxCiclos: number): CicloOportunidades[] {
  const agora = new Date();
  const ontem = new Date(agora.getTime() - 24 * 3600_000);
  const linhas: string[] = [];
  for (const arq of [arquivoDoDia(root, ontem), arquivoDoDia(root, agora)]) {
    try {
      if (fs.existsSync(arq)) linhas.push(...fs.readFileSync(arq, 'utf8').split('\n').filter(Boolean));
    } catch { /* ignora arquivo ilegível — nunca lança */ }
  }
  const ciclos: CicloOportunidades[] = [];
  for (const l of linhas.slice(-maxCiclos)) {
    try { const c = JSON.parse(l); if (Array.isArray(c.candidatas)) ciclos.push(c); } catch { /* linha corrompida — pulada */ }
  }
  return ciclos;
}

export interface ResultadoOportunidades {
  ok: boolean;
  items: OportunidadeObservada[];
  summary: {
    total: number; eligible: number; blocked: number;
    novasUltimaHora: number; persistenciaMediaCiclos: number;
    melhorQualidade: number | null; capturaAtiva: number;
  };
  coverage: { ciclosLidos: number; janelaHoras: number };
  collectorStatus: { estado: 'live' | 'stale' | 'offline' | 'empty'; ultimoCicloTs: number | null; idadeMs: number | null };
  sourceUpdatedAt: number | null;
  serverTime: number;
}

export function montarOportunidades(root: string, opts: { maxCiclos?: number } = {}): ResultadoOportunidades {
  const ciclos = lerCiclosRecentes(root, opts.maxCiclos ?? 400);
  const agora = Date.now();

  const porIdentidade = new Map<string, { obs: OportunidadeObservada; }>();
  let ultimoCicloTs: number | null = null;
  let capturaAtiva = 0;

  for (const ciclo of ciclos) {
    ultimoCicloTs = ultimoCicloTs == null ? ciclo.ts : Math.max(ultimoCicloTs, ciclo.ts);
    if (ciclo.modo === 'captura') capturaAtiva++;
    for (const c of ciclo.candidatas) {
      const identity = `${c.symbol}|${c.exchangeLong}|${c.exchangeShort}`;
      const existente = porIdentidade.get(identity);
      if (!existente) {
        porIdentidade.set(identity, {
          obs: {
            observationId: `${identity}@${ciclo.ts}`, identity,
            symbol: c.symbol, exchangeLong: c.exchangeLong, exchangeShort: c.exchangeShort,
            spread: c.spread,
            apr: { valor: null, tracked: false },
            fundingCombined: { valor: null, tracked: false },
            liquidity: { valor: null, tracked: false },
            valorEsperado: c.valorEsperado, valorPorHora: c.valorPorHora, custo: c.custo,
            paybackSlack: c.folga, qualityScore: c.score, capitalNecessario: c.capitalNecessario,
            eligible: c.aprovada, blocked: !c.aprovada,
            blockReasons: c.motivoRejeicao ? [c.motivoRejeicao] : [],
            persistenceCycles: 1, observationCount: 1,
            firstSeenAt: ciclo.ts, lastSeenAt: ciclo.ts, observedAt: ciclo.ts,
            settlementAt: { valor: null, tracked: false },
            source: 'inteligencia/oportunidades', schemaVersion: SCHEMA_VERSION,
          },
        });
      } else {
        // atualiza a observação existente (dedup por identidade) e acrescenta histórico
        const o = existente.obs;
        o.observationCount++;
        o.persistenceCycles++;
        o.firstSeenAt = Math.min(o.firstSeenAt, ciclo.ts);
        if (ciclo.ts >= o.lastSeenAt) {
          // o snapshot mais recente ganha — reflete o estado atual da oportunidade
          o.lastSeenAt = ciclo.ts; o.observedAt = ciclo.ts;
          o.spread = c.spread; o.valorEsperado = c.valorEsperado; o.valorPorHora = c.valorPorHora;
          o.custo = c.custo; o.paybackSlack = c.folga; o.qualityScore = c.score;
          o.capitalNecessario = c.capitalNecessario; o.eligible = c.aprovada; o.blocked = !c.aprovada;
          if (c.motivoRejeicao && !o.blockReasons.includes(c.motivoRejeicao)) o.blockReasons.push(c.motivoRejeicao);
        }
      }
    }
  }

  const items = [...porIdentidade.values()].map((v) => v.obs)
    .sort((a, b) => b.qualityScore - a.qualityScore);

  const umaHora = agora - 3600_000;
  const eligible = items.filter((i) => i.eligible).length;
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
      total: items.length, eligible, blocked: items.length - eligible,
      novasUltimaHora: items.filter((i) => i.firstSeenAt >= umaHora).length,
      persistenciaMediaCiclos: persistencias.length ? +(persistencias.reduce((s, n) => s + n, 0) / persistencias.length).toFixed(1) : 0,
      melhorQualidade, capturaAtiva,
    },
    coverage: { ciclosLidos: ciclos.length, janelaHoras: 24 },
    collectorStatus: { estado, ultimoCicloTs, idadeMs },
    sourceUpdatedAt: ultimoCicloTs,
    serverTime: agora,
  };
}
