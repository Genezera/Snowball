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
 * FREEZE/RESUME (Parte 5/6, redesenhado no Fechamento do Quality Gate):
 * congelar NUNCA pausa a rede — o poll continua avançando o cursor e
 * recebendo eventos normalmente. Nenhum evento é perdido enquanto
 * congelado, e retomar nunca precisa rebuscar a janela inteira (o cursor já
 * está atualizado).
 *
 * ACHADO REAL: a versão anterior decidia, EM TEMPO REAL, se cada lote novo
 * ia pra lista visível ou pro buffer, checando uma ref de "está congelado
 * agora?" dentro do poll assíncrono. Mesmo escrevendo essa ref de forma
 * síncrona no clique (tentativa de correção), o teste de freeze/resume
 * contra dados ao vivo continuava falhando de forma intermitente — a causa
 * raiz não era SÓ a leitura da ref chegar atrasada, era o desenho em si:
 * duas listas mutáveis (`visiveisRef`/`bufferRef`) sendo escritas por um
 * loop assíncrono independente do clique do usuário é uma corrida por
 * construção, não importa quão cedo a ref seja atualizada.
 *
 * Desenho novo, sem essa classe de corrida: existe UMA única lista
 * (`todosRef`, ordenada, deduplicada, sempre crescente) que o poll
 * preenche, sempre, congelado ou não — o poll nunca decide nada sobre
 * freeze. `congelar()` só grava, de forma síncrona e atômica,
 * `fronteiraRef.current = todosRef.current.length` (quantos eventos existem
 * NESTE INSTANTE). Enquanto congelado, o que é exibido é sempre
 * `todosRef.current.slice(0, fronteiraRef.current)` — uma fronteira fixa
 * sobre uma lista que continua crescendo por trás. `retomar()` só apaga a
 * fronteira. Não existe mais uma escolha "pra onde vai o lote novo" — só
 * existe "até onde a tela está autorizada a mostrar agora", decidido uma
 * vez, no clique, nunca dentro do poll.
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

  const cursorRef = useRef<string | null>(null);
  const idsVistosRef = useRef<Set<string>>(new Set());
  /** Única fonte de verdade — sempre crescente, sempre ordenada por timestamp, congelado ou não. */
  const todosRef = useRef<EventoRecente[]>([]);
  /** null = não congelado (mostra tudo). Número = índice congelado em `todosRef` no instante do clique. */
  const fronteiraRef = useRef<number | null>(null);

  /** Deriva a lista visível a partir da fronteira atual — chamado sempre que `todosRef` ou a fronteira mudam. */
  function republicarVisiveis() {
    const fronteira = fronteiraRef.current;
    setEventosVisiveis(fronteira === null ? todosRef.current : todosRef.current.slice(0, fronteira));
    setEventosNoBuffer(fronteira === null ? 0 : todosRef.current.length - fronteira);
  }

  // AUTO-CURA da fronteira: a fronteira só pode ser não-nula quando
  // `congelado` é true. Se, por qualquer motivo (ex.: Fast Refresh resetando
  // o state mas preservando o ref), a fronteira ficar presa com
  // `congelado=false`, a lista visível travaria num índice antigo enquanto
  // os eventos se acumulam — sintoma: "recebidos" sobe mas só N eventos
  // aparecem, e o botão diz "congelar". Este efeito força a consistência:
  // toda vez que `congelado` é false, a fronteira volta a null e o backlog
  // inteiro reaparece. Roda no mount também (destrava qualquer estado preso).
  useEffect(() => {
    if (!congelado && fronteiraRef.current !== null) {
      fronteiraRef.current = null;
      republicarVisiveis();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [congelado]);

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
        // sempre acumula em `todosRef` — o poll nunca decide freeze, só a fronteira (setada fora deste loop) decide o que fica visível.
        todosRef.current = [...todosRef.current, ...novos].sort((a, b) => a.timestamp - b.timestamp);
        republicarVisiveis();
      }

      // backlog grande (ex.: primeira carga, ou depois de uma rotação com
      // replay) — busca a próxima página já, sem esperar o intervalo normal
      timer = setTimeout(tick, r.dado.hasMore ? 50 : INTERVALO_POLL_MS);
    }
    tick();
    return () => { ativo = false; if (timer) clearTimeout(timer); };
  }, []);

  function congelar() {
    fronteiraRef.current = todosRef.current.length; // fronteira gravada de forma atômica e síncrona no clique — nenhum poll em voo pode mudar isso depois
    setCongeladoState(true);
    republicarVisiveis();
  }
  function retomar() {
    fronteiraRef.current = null;
    setCongeladoState(false);
    republicarVisiveis();
  }

  const ultimoEventoTs = eventosVisiveis.length ? eventosVisiveis[eventosVisiveis.length - 1].timestamp : null;

  return {
    resultado, eventos: eventosVisiveis, cobertura,
    congelado, congelar, retomar,
    cursorAtual, ultimoEventId, eventosRecebidos, duplicadosDescartados, eventosNoBuffer,
    estadoDaConexao, ultimaAtualizacao, ultimoEventoTs, tentativas,
  };
}
