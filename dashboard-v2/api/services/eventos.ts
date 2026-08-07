/**
 * TRANSPORTE INCREMENTAL DE EVENTOS — substitui o polling-da-janela-inteira
 * do endpoint antigo (`/api/profit-lab/eventos-recentes`, que baixava ~300
 * eventos completos a cada 5s e descartava os já vistos no cliente).
 *
 * Cursor é POR FONTE (cada challenger + o champion), nunca um timestamp
 * único global. Desde a Parte 6 ("cursor resistente a rotação") cada fonte
 * carrega, além da posição, a IDENTIDADE do arquivo que ela leu por último
 * (`fileIdentity`) e uma `generation` — se o arquivo for truncado,
 * substituído ou recriado, a próxima leitura detecta isso e SOBE a geração
 * em vez de tentar continuar de um byte-offset que não corresponde mais ao
 * mesmo conteúdo. `position` é BYTE OFFSET (preferido a número de linha —
 * pedido explícito da Parte 6/7), não timestamp e não índice da resposta.
 */
import { lerJsonlComNumeroDeLinha, identidadeArquivo, caminhoDiarioChallenger } from '../readers/arquivos.ts';
import path from 'node:path';

export interface EventoV2 {
  eventId: string;
  sequenceNumber: number | null;
  cycleId: string | null;
  challengerId: string;
  timestamp: number;
  evento: string;
  motivo: string | null;
  /** true = veio de um registro sem sequenceNumber (diário legado do champion) — ID estável por generation+byteOffset, não por timestamp */
  idLegado: boolean;
}

/** Campo interno, nunca serializado pra fora. */
interface EventoV2Interno extends EventoV2 { _fonte: string; _posicao: number }

export interface CursorFonte {
  fileIdentity: string; // combinação tamanho-de-criação + hash do cabeçalho — muda se o arquivo for substituído
  generation: number;
  position: number; // byte offset da última linha ENTREGUE desta fonte, nesta geração
  lastEventId: string | null;
}
export type CursorState = Record<string, CursorFonte>;

export function decodificarCursor(cursorBase64: string | null): CursorState {
  if (!cursorBase64) return {};
  try {
    const bruto = JSON.parse(Buffer.from(cursorBase64, 'base64').toString('utf8'));
    // tolera cursor de formato antigo (número puro, pré-Parte-6) — trata como fonte nunca vista, nunca lança
    const saida: CursorState = {};
    for (const [k, v] of Object.entries(bruto ?? {})) {
      if (v && typeof v === 'object' && 'position' in (v as any)) saida[k] = v as CursorFonte;
    }
    return saida;
  } catch { return {}; }
}
export function codificarCursor(estado: CursorState): string {
  return Buffer.from(JSON.stringify(estado), 'utf8').toString('base64');
}

interface FonteEventos { fonte: string; ehChampion: boolean; }

export interface RotacaoDetectada { fonte: string; cursorResetReason: 'arquivo_recriado' | 'arquivo_truncado'; oldGeneration: number; newGeneration: number; replayFrom: number }

function fileIdentityDe(caminho: string): string {
  const id = identidadeArquivo(caminho);
  return `${id.criadoEmMs ?? 0}:${id.hashCabecalho}`;
}

/**
 * Lê os eventos NOVOS de uma fonte desde o cursor. Detecta rotação ANTES de
 * ler: se a identidade do arquivo mudou, ou se a posição salva é maior que
 * o tamanho atual do arquivo (truncamento), a leitura reinicia do byte 0
 * numa geração nova — nunca reaproveita um byte-offset que pode apontar
 * pra outro conteúdo agora.
 */
function lerNovosDeUmaFonte(
  root: string, f: FonteEventos, cursorAnterior: CursorFonte | undefined, capPorFonte: number,
): { eventos: EventoV2Interno[]; novoCursorFonte: CursorFonte; rotacao: RotacaoDetectada | null } {
  const caminho = f.ehChampion ? path.join(root, 'spread', 'diario.jsonl') : caminhoDiarioChallenger(root, f.fonte);
  const idAtual = identidadeArquivo(caminho);
  const identidadeAtualStr = `${idAtual.criadoEmMs ?? 0}:${idAtual.hashCabecalho}`;

  let generation = cursorAnterior?.generation ?? 0;
  // -1, não 0: byteOffset 0 é uma posição VÁLIDA (primeira linha do
  // arquivo) — achado ao vivo: usar 0 como sentinela de "nada lido ainda"
  // fazia `posicaoDoRegistro <= posicaoDeParte` descartar a própria
  // primeira linha do arquivo (0 <= 0). sequenceNumber nunca começa em 0
  // (começa em 1), então não tinha esse problema — só byteOffset tinha.
  let posicaoDeParte = cursorAnterior?.position ?? -1;
  let rotacao: RotacaoDetectada | null = null;

  if (cursorAnterior) {
    const identidadeMudou = cursorAnterior.fileIdentity !== '' && cursorAnterior.fileIdentity !== identidadeAtualStr;
    const truncado = cursorAnterior.position > idAtual.tamanhoBytes;
    if (identidadeMudou || truncado) {
      rotacao = {
        fonte: f.fonte,
        cursorResetReason: identidadeMudou ? 'arquivo_recriado' : 'arquivo_truncado',
        oldGeneration: generation, newGeneration: generation + 1, replayFrom: 0,
      };
      generation += 1;
      posicaoDeParte = -1; // mesmo sentinela de "nada lido ainda" — byteOffset 0 da geração nova precisa passar
    }
  }

  const linhas = lerJsonlComNumeroDeLinha(caminho);
  const eventos: EventoV2Interno[] = [];
  let novaPosicao = posicaoDeParte;

  // achado ao vivo: sem este corte, uma fonte com histórico MUITO mais
  // longo que as outras dominava a página inteira — ver "seleção justa" abaixo.
  for (const { linha, byteOffset } of linhas) {
    if (eventos.length >= capPorFonte) break;
    const ev = linha as any;
    if (f.ehChampion && ev.evento === 'leitura') continue; // heartbeat do champion, não é decisão
    const temSequence = typeof ev.sequenceNumber === 'number';
    // challengers modernos continuam usando sequenceNumber (posição lógica,
    // sobrevive a qualquer rotação de arquivo); só o legado usa byteOffset.
    const posicaoDoRegistro = temSequence ? ev.sequenceNumber : byteOffset;
    if (posicaoDoRegistro <= posicaoDeParte) continue;

    const eventId = ev.eventId ?? `${f.fonte}:g${generation}:b${byteOffset}`;
    eventos.push({
      eventId,
      sequenceNumber: temSequence ? ev.sequenceNumber : null,
      cycleId: ev.cycleId ?? null,
      challengerId: f.ehChampion ? 'funding-arbitrage-champion' : f.fonte,
      timestamp: ev.ts, evento: ev.evento, motivo: ev.motivo ?? null,
      idLegado: !temSequence,
      _fonte: f.fonte, _posicao: posicaoDoRegistro,
    });
    if (posicaoDoRegistro > novaPosicao) novaPosicao = posicaoDoRegistro;
  }

  return {
    eventos, rotacao,
    novoCursorFonte: {
      fileIdentity: identidadeAtualStr, generation, position: novaPosicao,
      lastEventId: eventos.length ? eventos[eventos.length - 1].eventId : (cursorAnterior?.lastEventId ?? null),
    },
  };
}

export interface ResultadoEventosIncremental {
  eventos: EventoV2[];
  nextCursor: string;
  hasMore: boolean;
  serverTime: number;
  oldestAvailableCursor: string;
  rotacoesDetectadas: RotacaoDetectada[];
  /** Parte 3 (manifesto formal) — por fonte: quantos eventos existiam NOVOS desde o cursor (antes da seleção justa cortar) e quantos de fato couberam nesta página. Reusado pelo manifesto de cobertura pra nunca reler o diário só pra contar. */
  disponivelPorFonte: Record<string, number>;
  entreguePorFonte: Record<string, number>;
}

/**
 * Busca incremental de verdade — só lê o que é NOVO desde o cursor
 * recebido, nunca a janela inteira. `limit` corta o total DEPOIS de juntar
 * tudo que é novo (ordenado por timestamp), e `hasMore` avisa quando
 * sobrou mais do que coube.
 */
export function buscarEventosIncremental(
  root: string, fontes: FonteEventos[], cursorRecebido: string | null, limit: number,
): ResultadoEventosIncremental {
  const cursorAnterior = decodificarCursor(cursorRecebido);
  const novoCursor: CursorState = { ...cursorAnterior };
  const porFonte = new Map<string, EventoV2Interno[]>();
  const rotacoesDetectadas: RotacaoDetectada[] = [];
  let disponivelTotal = 0;

  const capPorFonte = Math.max(20, Math.ceil((limit * 2) / Math.max(1, fontes.length)));
  for (const f of fontes) {
    const { eventos, novoCursorFonte, rotacao } = lerNovosDeUmaFonte(root, f, cursorAnterior[f.fonte], capPorFonte);
    porFonte.set(f.fonte, eventos);
    novoCursor[f.fonte] = novoCursorFonte; // já grava a identidade/geração atualizada mesmo se nada foi selecionado ainda — corrigido depois se a fonte tiver entregues
    if (rotacao) rotacoesDetectadas.push(rotacao);
    disponivelTotal += eventos.length;
  }

  // SELEÇÃO JUSTA (achado ao vivo: sem isto, uma fonte com backlog enorme
  // — o champion, rodando há dias — engolia a página inteira antes de
  // qualquer challenger aparecer). Cada fonte garante uma fatia mínima
  // ANTES do corte global por timestamp; sobra é redistribuída.
  const fatiaMinima = Math.max(1, Math.floor(limit / Math.max(1, fontes.length)));
  const selecionados: EventoV2Interno[] = [];
  let orcamentoRestante = limit;
  for (const [, eventos] of porFonte) {
    const pega = Math.min(eventos.length, fatiaMinima);
    selecionados.push(...eventos.slice(0, pega));
    orcamentoRestante -= pega;
  }
  if (orcamentoRestante > 0) {
    for (const [, eventos] of porFonte) {
      if (orcamentoRestante <= 0) break;
      const jaPego = selecionados.filter((e) => e._fonte === (eventos[0]?._fonte ?? '')).length;
      const extra = eventos.slice(jaPego, jaPego + orcamentoRestante);
      selecionados.push(...extra);
      orcamentoRestante -= extra.length;
    }
  }

  selecionados.sort((a, b) => a.timestamp - b.timestamp);
  const hasMore = disponivelTotal > selecionados.length;
  const entregues = selecionados;

  // Cursor avança só até onde cada fonte teve algo de fato SELECIONADO
  // nesta página. Fonte sem nada selecionado mantém fileIdentity/generation
  // atualizadas (já gravadas acima) mas a `position` NÃO avança além do que
  // foi de fato entregue — senão o cliente perderia o que ficou de fora.
  for (const [fonte, eventos] of porFonte) {
    const entreguesDaFonte = entregues.filter((e) => e._fonte === fonte);
    const cursorFonteAtual = novoCursor[fonte];
    if (entreguesDaFonte.length) {
      novoCursor[fonte] = {
        ...cursorFonteAtual,
        position: Math.max(...entreguesDaFonte.map((e) => e._posicao)),
        lastEventId: entreguesDaFonte[entreguesDaFonte.length - 1].eventId,
      };
    } else if (eventos.length) {
      // leu mas nada coube na página desta vez (cortado pelo limit) — não avança a posição
      novoCursor[fonte] = { ...cursorFonteAtual, position: cursorAnterior[fonte]?.position ?? -1 };
    }
  }

  const entreguesPublicos: EventoV2[] = entregues.map(({ _fonte, _posicao, ...ev }) => ev);

  const disponivelPorFonte: Record<string, number> = {};
  const entreguePorFonte: Record<string, number> = {};
  for (const [fonte, eventos] of porFonte) disponivelPorFonte[fonte] = eventos.length;
  for (const ev of entregues) entreguePorFonte[ev._fonte] = (entreguePorFonte[ev._fonte] ?? 0) + 1;

  return {
    eventos: entreguesPublicos,
    nextCursor: codificarCursor(novoCursor),
    hasMore,
    serverTime: Date.now(),
    oldestAvailableCursor: codificarCursor({}),
    rotacoesDetectadas,
    disponivelPorFonte, entreguePorFonte,
  };
}
