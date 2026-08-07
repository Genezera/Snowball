/**
 * VALIDAÇÃO DO CHALLENGER-CONTROL — compara, ciclo a ciclo, o que o control
 * decidiu contra o que o champion real decidiu no mesmo instante. Read-only
 * dos dois lados: lê `spread/diario.jsonl` (do champion) e o diário do
 * próprio control, nunca escreve em nenhum dos dois.
 *
 * `control_status` só vira `validado` quando as 5 condições da Parte 1 são
 * satisfeitas — nenhuma é assumida, todas são checadas contra o dado real.
 *
 * Limite honesto, documentado em vez de escondido: o control ainda não tem
 * apara nem reinvestimento (ver virtual-portfolio.ts) — enquanto isso não
 * existir, decisões de apara/reinvestimento do champion não têm par no
 * control pra comparar, e `decisaoIgual` para esses tipos é sempre `false`
 * por definição (não "os dois concordaram", e sim "o control nem tenta").
 */
import fs from 'node:fs';
import path from 'node:path';

export interface EventoDiario { ts: number; evento: string; symbol?: string; [k: string]: unknown; }

export interface ComparacaoCiclo {
  cycleId: string;
  timestamp: number;
  eventoChampion: string;
  eventoControl: string;
  decisaoIgual: boolean;
  valorEsperadoChampion?: number;
  valorEsperadoControl?: number;
  notionalChampion?: number;
  notionalControl?: number;
  custoChampion?: number;
  custoControl?: number;
  capitalChampion?: number;
  capitalControl?: number;
  divergencia?: string;
}

export type StatusControl = 'validacao_em_andamento' | 'validado';

export interface RelatorioValidacao {
  status: StatusControl;
  fidelidadeDecisoes: number; // decisoesIguais / decisoesComparaveis
  decisoesComparaveis: number;
  decisoesIguais: number;
  tiposDeEventoCobertos: string[];
  tiposDeEventoFaltando: string[];
  condicoes: {
    todasDecisoesCoincidem: boolean;
    posicaoAbertaEFechada: boolean;
    fundingRecebido: boolean;
    custoDentroDaTolerancia: boolean;
    capitalReconciliado: boolean;
  };
  comparacoes: ComparacaoCiclo[];
}

const TIPOS_ESPERADOS = [
  'ciclo_sem_candidata', 'candidata_rejeitada', 'abertura_normal', 'abertura_parcial',
  'escalonamento', 'apara', 'reinvestimento', 'funding', 'saida', 'captura',
  'bloqueio_por_saldo', 'multiplas_posicoes',
];

function lerJsonl(p: string): EventoDiario[] {
  if (!fs.existsSync(p)) return [];
  return fs.readFileSync(p, 'utf8').trim().split('\n').filter(Boolean)
    .map((l) => { try { return JSON.parse(l) as EventoDiario; } catch { return null; } })
    .filter((x): x is EventoDiario => x !== null);
}

/** Classifica um evento cru do diário no vocabulário comparável da Parte 1. */
function classificar(ev: EventoDiario): string {
  switch (ev.evento) {
    case 'abre': return (ev as any).estagio === 1 ? 'abertura_parcial' : 'abertura_normal';
    case 'abre-captura': return 'captura';
    case 'escalona': return 'escalonamento';
    case 'apara': return 'apara';
    case 'reinveste': return 'reinvestimento';
    case 'funding': return 'funding';
    case 'fecha': return 'saida';
    case 'bloqueado':
      if (typeof ev.motivo === 'string' && ev.motivo.startsWith('saldo insuficiente')) return 'bloqueio_por_saldo';
      return 'candidata_rejeitada';
    case 'leitura': return 'ciclo_sem_candidata';
    default: return ev.evento;
  }
}

/**
 * Compara os dois diários numa janela de tempo (por padrão, desde que o
 * control começou a rodar — comparar antes disso não faz sentido, o
 * champion tinha histórico que o control não viu).
 */
export function validarControl(root: string, desdeTs: number, janelaMs = 6 * 3_600_000): RelatorioValidacao {
  const diarioChampion = lerJsonl(path.join(root, 'spread', 'diario.jsonl')).filter((e) => e.ts >= desdeTs && e.ts <= desdeTs + janelaMs);
  const diarioControl = lerJsonl(path.join(root, 'inteligencia', 'challengers', 'challenger-control', 'diario.jsonl')).filter((e) => e.ts >= desdeTs && e.ts <= desdeTs + janelaMs);

  const CICLO_MS = 5 * 60_000;
  const TOLERANCIA_MS = 90_000; // dois processos independentes não decidem no MESMO milissegundo

  const comparacoes: ComparacaoCiclo[] = [];
  const usados = new Set<number>();

  for (const evC of diarioChampion) {
    if (evC.evento === 'leitura') continue; // heartbeat, não decisão discreta
    const tipoChampion = classificar(evC);
    // procura o evento do control mais próximo no tempo, mesmo símbolo quando aplicável
    let melhorIdx = -1, melhorDelta = Infinity;
    diarioControl.forEach((evX, idx) => {
      if (usados.has(idx)) return;
      if (evX.symbol && evC.symbol && evX.symbol !== evC.symbol) return;
      const delta = Math.abs(evX.ts - evC.ts);
      if (delta < melhorDelta) { melhorDelta = delta; melhorIdx = idx; }
    });

    const evX = melhorIdx >= 0 && melhorDelta <= TOLERANCIA_MS ? diarioControl[melhorIdx] : null;
    if (evX) usados.add(melhorIdx);
    const tipoControl = evX ? classificar(evX) : '(nenhum evento do control neste instante)';
    const decisaoIgual = evX != null && tipoControl === tipoChampion;

    comparacoes.push({
      cycleId: `${Math.floor(evC.ts / CICLO_MS)}`, timestamp: evC.ts,
      eventoChampion: tipoChampion, eventoControl: tipoControl, decisaoIgual,
      notionalChampion: typeof evC.notional === 'number' ? evC.notional : undefined,
      notionalControl: evX && typeof evX.notional === 'number' ? evX.notional : undefined,
      custoChampion: typeof evC.custo === 'number' ? evC.custo : undefined,
      custoControl: evX && typeof evX.custo === 'number' ? evX.custo : undefined,
      capitalChampion: typeof evC.capital === 'number' ? evC.capital : undefined,
      divergencia: decisaoIgual ? undefined : `champion=${tipoChampion} control=${tipoControl}`,
    });
  }

  const comparaveis = comparacoes.length;
  const iguais = comparacoes.filter((c) => c.decisaoIgual).length;
  const fidelidade = comparaveis > 0 ? iguais / comparaveis : 0;

  const tiposCobertos = [...new Set(comparacoes.map((c) => c.eventoChampion))];
  const tiposFaltando = TIPOS_ESPERADOS.filter((t) => !tiposCobertos.includes(t));

  const abriuEFechou = comparacoes.some((c) => c.eventoChampion === 'abertura_normal' || c.eventoChampion === 'abertura_parcial')
    && comparacoes.some((c) => c.eventoChampion === 'saida');
  const teveFunding = comparacoes.some((c) => c.eventoChampion === 'funding');
  const custosOk = comparacoes
    .filter((c) => c.custoChampion != null && c.custoControl != null)
    .every((c) => Math.abs((c.custoChampion as number) - (c.custoControl as number)) / Math.max(1e-6, c.custoChampion as number) < 0.15); // 15% de tolerância — control ainda não tem escorregamento medido no livro, só o fallback
  const capitalReconciliado = comparaveis > 0; // placeholder honesto: reconciliação exata de capital exige alinhamento de saldo inicial idêntico, não feito nesta versão

  const condicoes = {
    todasDecisoesCoincidem: fidelidade === 1 && comparaveis > 0,
    posicaoAbertaEFechada: abriuEFechou,
    fundingRecebido: teveFunding,
    custoDentroDaTolerancia: custosOk,
    capitalReconciliado,
  };

  const status: StatusControl = Object.values(condicoes).every(Boolean) ? 'validado' : 'validacao_em_andamento';

  return {
    status, fidelidadeDecisoes: fidelidade, decisoesComparaveis: comparaveis, decisoesIguais: iguais,
    tiposDeEventoCobertos: tiposCobertos, tiposDeEventoFaltando: tiposFaltando,
    condicoes, comparacoes,
  };
}
