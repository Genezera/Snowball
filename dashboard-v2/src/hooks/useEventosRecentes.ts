import { useEffect, useRef, useState } from 'react';
import { buscarEventosIncremental as buscarPagina, type Resultado } from '../services/api';
import type { EventoRecente, ManifestoCobertura, EventosRecentesResposta } from '../schemas/events';

export const INTERVALO_POLL_MS = 5000;
const LIMITE_POR_PAGINA = 300;

export type EstadoConexao = 'conectando' | 'ativo' | 'erro';

/**
 * TRANSPORTE INCREMENTAL POR CURSOR (Parte 5) — cada tick pede só o que é
 * NOVO desde `cursorAtual` (`GET /api/v2/events?after=<cursor>&limit=<n>`),
 * nunca a janela inteira. Se `hasMore` vier true, a próxima página é pedida
 * imediatamente (sem esperar o intervalo) até esvaziar o backlog — só
 * depois volta a esperar `INTERVALO_POLL_MS`.
 *
 * FREEZE/RESUME (Parte 5/6): congelar NUNCA pausa a rede — o poll continua
 * avançando o cursor e recebendo eventos normalmente, só que em vez de ir
 * pra lista visível eles vão pro BUFFER. Isso significa: nenhum evento é
 * perdido enquanto congelado, e retomar nunca precisa rebuscar a janela
 * inteira (o cursor já está atualizado). Ao retomar, o buffer inteiro entra
 * de uma vez, em ordem, no fim da lista visível (que só cresce por append —
 * nunca reordena o que já estava lá, então a posição de rolagem de quem
 * está olhando eventos antigos não pula).
 *
 * DEDUPLICAÇÃO: por `eventId` (nunca por índice/timestamp) — um Set
 * acumulado entre todas as páginas já vistas. `duplicadosDescartados` só
 * conta duplicata REAL (eventId repetido), nunca incrementa por causa do
 * freeze — mesmo congelado, um evento que chega pela primeira vez conta
 * como recebido, não como duplicado.
 */
export function useEventosRecentes() {
  const [resultado, setResultado] = useState<Resultado<EventosRecentesResposta> | null>(null);
  const [eventosVisiveis, setEventosVisiveis] = useState<EventoRecente[]>([]);
  const [congelado, setCongeladoState] = useState(false);
  const [cursorAtual, setCursorAtual] = useState<string | null>(null);
  const [ultimoEventId, setUltimoEventId] = useState<string | null>(null);
  const [eventosRecebidos, setEventosRecebidos] = useState(0);
  const [duplicadosDescartados, setDuplicadosDescartados] = useState(0);
  const [eventosNoBuffer, setEventosNoBuffer] = useState(0);
  const [estadoDaConexao, setEstadoDaConexao] = useState<EstadoConexao>('conectando');
  const [ultimaAtualizacao, setUltimaAtualizacao] = useState<number | null>(null);
  const [tentativas, setTentativas] = useState(0);
  const [cobertura, setCobertura] = useState<ManifestoCobertura | undefined>(undefined);

  const congeladoRef = useRef(false);
  congeladoRef.current = congelado;
  const cursorRef = useRef<string | null>(null);
  const idsVistosRef = useRef<Set<string>>(new Set());
  const bufferRef = useRef<EventoRecente[]>([]);
  const visiveisRef = useRef<EventoRecente[]>([]);

  useEffect(() => {
    let ativo = true;
    let timer: ReturnType<typeof setTimeout> | null = null;

    async function tick() {
      if (!ativo) return;
      const r = await buscarPagina(cursorRef.current, LIMITE_POR_PAGINA);
      if (!ativo) return;
      setResultado(r);

      if (r.estado !== 'sucesso') {
        setTentativas((t) => t + 1);
        setEstadoDaConexao('erro');
        timer = setTimeout(tick, INTERVALO_POLL_MS);
        return;
      }

      setEstadoDaConexao('ativo');
      setTentativas(0);
      cursorRef.current = r.dado.nextCursor;
      setCursorAtual(r.dado.nextCursor);
      setUltimaAtualizacao(Date.now());
      if (r.dado.cobertura) setCobertura(r.dado.cobertura);

      const novos: EventoRecente[] = [];
      for (const ev of r.dado.eventos) {
        if (idsVistosRef.current.has(ev.eventId)) { setDuplicadosDescartados((d) => d + 1); continue; }
        idsVistosRef.current.add(ev.eventId);
        novos.push(ev);
      }
      if (novos.length) {
        setEventosRecebidos((n) => n + novos.length);
        setUltimoEventId(novos[novos.length - 1].eventId);
        if (congeladoRef.current) {
          bufferRef.current = [...bufferRef.current, ...novos].sort((a, b) => a.timestamp - b.timestamp);
          setEventosNoBuffer(bufferRef.current.length);
        } else {
          visiveisRef.current = [...visiveisRef.current, ...novos].sort((a, b) => a.timestamp - b.timestamp);
          setEventosVisiveis(visiveisRef.current);
        }
      }

      // backlog grande (ex.: primeira carga, ou depois de uma rotação com
      // replay) — busca a próxima página já, sem esperar o intervalo normal
      timer = setTimeout(tick, r.dado.hasMore ? 50 : INTERVALO_POLL_MS);
    }
    tick();
    return () => { ativo = false; if (timer) clearTimeout(timer); };
  }, []);

  function congelar() { setCongeladoState(true); }
  function retomar() {
    if (bufferRef.current.length) {
      visiveisRef.current = [...visiveisRef.current, ...bufferRef.current].sort((a, b) => a.timestamp - b.timestamp);
      setEventosVisiveis(visiveisRef.current);
      bufferRef.current = [];
      setEventosNoBuffer(0);
    }
    setCongeladoState(false);
  }

  const ultimoEventoTs = eventosVisiveis.length ? eventosVisiveis[eventosVisiveis.length - 1].timestamp : null;

  return {
    resultado, eventos: eventosVisiveis, cobertura,
    congelado, congelar, retomar,
    cursorAtual, ultimoEventId, eventosRecebidos, duplicadosDescartados, eventosNoBuffer,
    estadoDaConexao, ultimaAtualizacao, ultimoEventoTs, tentativas,
  };
}
