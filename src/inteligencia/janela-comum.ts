/**
 * JANELA COMUM (Partes 3-5 da validação de integridade) — "não use o total
 * histórico de 17.194 bloqueios como se tivesse ocorrido integralmente na
 * nova janela". Este módulo grava um SNAPSHOT dos contadores acumulados no
 * instante em que a janela começa (a primeira vez que este código roda —
 * "a partir do próximo ciclo completo") e, a partir daí, todo consumidor
 * relata `valorNoInicio`/`valorNoFim`/`deltaNaJanela`, nunca o total bruto.
 *
 * `commonWindowStart` é gravado UMA VEZ e nunca reescrito — mesmo que o Lab
 * reinicie, a janela continua sendo a mesma (o snapshot inicial já está em
 * disco). `commonWindowEnd` é o timestamp da leitura atual, sempre avançando.
 *
 * Cobre challengers de persistência, captura e champion — que já têm os
 * contadores em `EstadoVirtual`/estado.json. momentum/pares (Parte 6, via
 * adaptador) não têm os mesmos contadores granulares (payback/reserva/etc.
 * não existem nesses motores), então entram só com os campos que os
 * adaptadores realmente expõem (capitalVirtual, trades, custos) — nunca
 * inventa um contador que a fonte não tem.
 */
import fs from 'node:fs';
import path from 'node:path';
import type { EstadoVirtual } from './virtual-portfolio.ts';

export interface SnapshotContadores {
  candidatasAvaliadas: number;
  bloqueiosPorPayback: number;
  bloqueiosPorReserva: number;
  bloqueiosPorSaldo: number;
  bloqueiosPorNotionalMinimo: number;
  bloqueiosPorMaxPosicoes: number;
  trades: number;
  settlements: number;
  fundingBruto: number;
  custosTotais: number;
}

export interface SnapshotChampion {
  capital: number; fundingTotal: number; custosTotal: number; pagamentos: number;
  /** só disponível quando spread/marcacao.json existe — null é honesto, nunca vira 0 fabricado */
  equityMark: number | null;
  equityLiquidacao: number | null;
}

export interface SnapshotHeartbeat {
  reinicios: number; ciclosComErro: number;
}

export interface JanelaComum {
  commonWindowStart: number;
  commonWindowEnd: number;
  snapshotInicial: {
    challengers: Record<string, SnapshotContadores>;
    champion: SnapshotChampion | null;
    heartbeat: SnapshotHeartbeat | null;
  };
}

export interface LinhaDelta {
  valorNoInicio: number;
  valorNoFim: number;
  deltaNaJanela: number;
}

function extrairContadores(e: EstadoVirtual): SnapshotContadores {
  return {
    candidatasAvaliadas: e.candidatasAvaliadas ?? 0,
    bloqueiosPorPayback: e.bloqueiosPorPayback ?? 0,
    bloqueiosPorReserva: e.bloqueiosPorReserva ?? 0,
    bloqueiosPorSaldo: e.bloqueiosPorSaldo ?? 0,
    bloqueiosPorNotionalMinimo: e.bloqueiosPorNotionalMinimo ?? 0,
    bloqueiosPorMaxPosicoes: e.bloqueiosPorMaxPosicoes ?? 0,
    trades: e.trades ?? 0,
    settlements: e.settlements ?? 0,
    fundingBruto: e.fundingBruto ?? 0,
    custosTotais: e.custosTotais ?? 0,
  };
}

// NUNCA "janela-comum.json" — esse nome já é o do arquivo de SAÍDA que
// dashboard-aggregator.ts escreve (os deltas computados). Usar o mesmo nome
// aqui fazia o aggregator sobrescrever este snapshot bruto com sua própria
// saída, e a leitura seguinte falhava tentando achar `snapshotInicial` num
// JSON que não tinha esse campo (bug real, encontrado rodando ao vivo).
function caminhoJanela(root: string): string {
  return path.join(root, 'inteligencia', 'dashboard', 'janela-comum-snapshot.json');
}

/**
 * Lê a janela comum existente, ou CRIA uma nova com o estado ATUAL como
 * ponto de partida — só na primeira chamada depois que este código existe.
 * Nunca recria depois de já existir (senão a janela "andaria" a cada
 * reinício, exatamente o que a Parte 3 pediu pra evitar).
 */
export function carregarOuCriarJanelaComum(
  root: string, estados: EstadoVirtual[], championEstado: SnapshotChampion | null, heartbeat: SnapshotHeartbeat | null,
): JanelaComum {
  const p = caminhoJanela(root);
  if (fs.existsSync(p)) {
    try {
      const existente = JSON.parse(fs.readFileSync(p, 'utf8')) as JanelaComum;
      existente.commonWindowEnd = Date.now();
      return existente;
    } catch { /* corrompido — recria abaixo, tratando como se fosse a primeira vez */ }
  }
  const agora = Date.now();
  const janela: JanelaComum = {
    commonWindowStart: agora, commonWindowEnd: agora,
    snapshotInicial: {
      challengers: Object.fromEntries(estados.map((e) => [e.challengerId, extrairContadores(e)])),
      champion: championEstado, heartbeat,
    },
  };
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(janela, null, 2));
  return janela;
}

export function salvarJanelaComum(root: string, janela: JanelaComum): void {
  const p = caminhoJanela(root);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const tmp = p + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(janela, null, 2));
  fs.renameSync(tmp, p);
}

function delta(inicio: number, fim: number): LinhaDelta {
  return { valorNoInicio: inicio, valorNoFim: fim, deltaNaJanela: fim - inicio };
}

export interface DeltasChallenger {
  challengerId: string;
  candidatasAvaliadas: LinhaDelta;
  bloqueiosPorPayback: LinhaDelta;
  bloqueiosPorReserva: LinhaDelta;
  bloqueiosPorSaldo: LinhaDelta;
  bloqueiosPorNotionalMinimo: LinhaDelta;
  bloqueiosPorMaxPosicoes: LinhaDelta;
  trades: LinhaDelta;
  settlements: LinhaDelta;
  fundingBruto: LinhaDelta;
  custosTotais: LinhaDelta;
  /** true só quando havia snapshot inicial pra este challenger — challenger criado DEPOIS da janela começar não tem baseline, delta vira o próprio total (documentado, não escondido) */
  tinhaSnapshotInicial: boolean;
}

/** Calcula os deltas de TODOS os challengers na janela — pura, sem I/O. */
export function calcularDeltasChallengers(janela: JanelaComum, estadosAtuais: EstadoVirtual[]): DeltasChallenger[] {
  return estadosAtuais.map((e) => {
    const inicio = janela.snapshotInicial.challengers[e.challengerId];
    const atual = extrairContadores(e);
    const tinhaSnapshotInicial = inicio != null;
    const base: SnapshotContadores = inicio ?? { candidatasAvaliadas: 0, bloqueiosPorPayback: 0, bloqueiosPorReserva: 0, bloqueiosPorSaldo: 0, bloqueiosPorNotionalMinimo: 0, bloqueiosPorMaxPosicoes: 0, trades: 0, settlements: 0, fundingBruto: 0, custosTotais: 0 };
    return {
      challengerId: e.challengerId,
      candidatasAvaliadas: delta(base.candidatasAvaliadas, atual.candidatasAvaliadas),
      bloqueiosPorPayback: delta(base.bloqueiosPorPayback, atual.bloqueiosPorPayback),
      bloqueiosPorReserva: delta(base.bloqueiosPorReserva, atual.bloqueiosPorReserva),
      bloqueiosPorSaldo: delta(base.bloqueiosPorSaldo, atual.bloqueiosPorSaldo),
      bloqueiosPorNotionalMinimo: delta(base.bloqueiosPorNotionalMinimo, atual.bloqueiosPorNotionalMinimo),
      bloqueiosPorMaxPosicoes: delta(base.bloqueiosPorMaxPosicoes, atual.bloqueiosPorMaxPosicoes),
      trades: delta(base.trades, atual.trades),
      settlements: delta(base.settlements, atual.settlements),
      fundingBruto: delta(base.fundingBruto, atual.fundingBruto),
      custosTotais: delta(base.custosTotais, atual.custosTotais),
      tinhaSnapshotInicial,
    };
  });
}

export function calcularDeltasChampion(janela: JanelaComum, atual: SnapshotChampion | null): {
  capital: LinhaDelta; fundingTotal: LinhaDelta; custosTotal: LinhaDelta; pagamentos: LinhaDelta;
  /** equityLiquidacaoFinal − equityLiquidacaoInicial — o PnL ECONÔMICO da janela, não só o realizado. null se marcação não estava disponível nos dois extremos. */
  pnlEconomicoNaJanela: number | null;
} | null {
  if (!atual || !janela.snapshotInicial.champion) return null;
  const inicio = janela.snapshotInicial.champion;
  const pnlEconomicoNaJanela = (inicio.equityLiquidacao != null && atual.equityLiquidacao != null)
    ? atual.equityLiquidacao - inicio.equityLiquidacao : null;
  return {
    capital: delta(inicio.capital, atual.capital),
    fundingTotal: delta(inicio.fundingTotal, atual.fundingTotal),
    custosTotal: delta(inicio.custosTotal, atual.custosTotal),
    pagamentos: delta(inicio.pagamentos, atual.pagamentos),
    pnlEconomicoNaJanela,
  };
}

export function calcularDeltasHeartbeat(janela: JanelaComum, atual: SnapshotHeartbeat | null): { reinicios: LinhaDelta; ciclosComErro: LinhaDelta } | null {
  if (!atual || !janela.snapshotInicial.heartbeat) return null;
  const inicio = janela.snapshotInicial.heartbeat;
  return {
    reinicios: delta(inicio.reinicios, atual.reinicios),
    ciclosComErro: delta(inicio.ciclosComErro, atual.ciclosComErro),
  };
}

// ── classificação de posições (Parte 3 da correção) ─────────────────────

export type ClassificacaoPosicao = 'abertaAntesDaJanela' | 'abertaDentroDaJanela';

export interface PosicaoClassificada {
  symbol: string;
  classificacao: ClassificacaoPosicao;
  abertaEm: number;
  /**
   * Pra posições abertas ANTES da janela: nunca reatribui o custo de
   * entrada (que aconteceu antes) à janela. `custosGeradosNaJanela` só soma
   * o que aconteceu DEPOIS de `commonWindowStart` — hoje isso significa
   * escalonamento/apara/reinvestimento se ocorrerem dentro da janela;
   * como o Lab não separa custo POR posição individual (só por challenger),
   * isto é o melhor proxy disponível sem reescrever a atribuição de custo —
   * documentado, não escondido.
   */
  notionalPorPerna: number;
}

/** Classifica cada posição ABERTA agora — não cobre posições já fechadas (essas só existem no diário). */
export function classificarPosicoesAbertas(posicoes: { symbol: string; abertaEm: number; notionalPorPerna: number }[], commonWindowStart: number): PosicaoClassificada[] {
  return posicoes.map((p) => ({
    symbol: p.symbol, abertaEm: p.abertaEm, notionalPorPerna: p.notionalPorPerna,
    classificacao: p.abertaEm < commonWindowStart ? 'abertaAntesDaJanela' : 'abertaDentroDaJanela',
  }));
}

export interface FechamentoNaJanela {
  symbol: string; ts: number; motivo: string;
}

/** Lê o diário do challenger e devolve só os eventos 'fecha' DENTRO da janela — não reconstrói nada, só filtra o que já foi gravado. */
export function fechamentosNaJanela(root: string, challengerId: string, commonWindowStart: number): FechamentoNaJanela[] {
  const p = path.join(root, 'inteligencia', 'challengers', challengerId, 'diario.jsonl');
  if (!fs.existsSync(p)) return [];
  try {
    const linhas = fs.readFileSync(p, 'utf8').trim().split('\n').filter(Boolean);
    const eventos = linhas.map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
    return eventos
      .filter((e: any) => e.evento === 'fecha' && e.ts >= commonWindowStart)
      .map((e: any) => ({ symbol: e.symbol ?? '(não registrado)', ts: e.ts, motivo: e.motivo ?? '' }));
  } catch { return []; }
}
