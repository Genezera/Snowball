import { useRef } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { motion, useReducedMotion } from 'framer-motion';
import { eventEnter } from '../../theme/motion';
import { EmptyIllustration, Skeleton } from '../feedback/DataState';
import type { ChartDataState } from './ChartFrame';

export interface EventoTimeline {
  eventId: string;
  sequenceNumber: number;
  cycleId: string;
  timestamp: number;
  challengerId: string;
  evento: string;
  motivo?: string;
}

interface Props {
  eventos: EventoTimeline[] | null;
  state: ChartDataState;
  congelado?: boolean;
  onSelecionar?: (ev: EventoTimeline) => void;
  selecionado?: string;
  maxAltura?: number;
}

const COR_EVENTO: Record<string, string> = {
  abre: 'var(--gain-500)', fecha: 'var(--loss-500)', funding: 'var(--brass-300)',
  escalona: 'var(--slate-500)', apara: 'var(--warn-500)', reinveste: 'var(--gain-500)',
  bloqueado: 'var(--ink-3)', leitura: 'var(--ink-3)',
};

const ALTURA_LINHA = 44; // altura fixa por linha, em px — usada pela virtualização calcular offsets sem medir o DOM

function fmtHora(ts: number): string {
  return new Date(ts).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

async function copiarId(id: string) {
  try { await navigator.clipboard.writeText(id); } catch { /* clipboard indisponível — silencioso, não é crítico */ }
}

/**
 * Timeline ao vivo — VIRTUALIZADA (Quality Gate de Interface, item 15):
 * antes desta versão, cada evento acumulado virava um nó DOM permanente —
 * com o Live Operations rodando por horas/dias e nenhum teto na lista
 * acumulada, isso significava milhares de nós DOM reais, degradando scroll
 * e memória. Agora só as linhas VISÍVEIS (+ uma margem de overscan) existem
 * no DOM, mesmo com 10.000+ eventos na lista lógica — `useVirtualizer`
 * (@tanstack/react-virtual) recalcula a janela visível a cada scroll.
 *
 * `congelado` continua funcionando igual: quem passa a lista pra este
 * componente já decidiu o que está "visível" (o hook de dados é quem
 * separa visível vs buffer) — este componente só renderiza o que recebe,
 * virtualizado.
 */
export function EventTimeline({ eventos, state, congelado, onSelecionar, selecionado, maxAltura = 520 }: Props) {
  const reduceMotion = useReducedMotion();
  const containerRef = useRef<HTMLDivElement>(null);

  const virtualizer = useVirtualizer({
    count: eventos?.length ?? 0,
    getScrollElement: () => containerRef.current,
    estimateSize: () => ALTURA_LINHA,
    overscan: 12,
  });

  if (state === 'loading') return <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>{[...Array(6)].map((_, i) => <Skeleton key={i} height={36} />)}</div>;
  if (!eventos?.length) return <EmptyIllustration label="Nenhum evento ainda nesta janela" />;

  const itensVirtuais = virtualizer.getVirtualItems();

  return (
    <div
      ref={containerRef}
      role="log" aria-live={congelado ? 'off' : 'polite'}
      data-testid="event-timeline-scroll" data-total-eventos={eventos.length}
      style={{ maxHeight: maxAltura, overflowY: 'auto', position: 'relative' }}
    >
      <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
        {itensVirtuais.map((item) => {
          const ev = eventos[item.index];
          return (
            <motion.div
              key={ev.eventId}
              data-index={item.index}
              onClick={onSelecionar ? () => onSelecionar(ev) : undefined}
              variants={reduceMotion ? undefined : eventEnter} initial="hidden" animate="visible"
              style={{
                position: 'absolute', top: 0, left: 0, right: 0, transform: `translateY(${item.start}px)`,
                height: ALTURA_LINHA - 4, marginBottom: 4,
                display: 'grid', gridTemplateColumns: '84px 10px 1fr auto', alignItems: 'center', gap: 10,
                padding: '7px 10px', borderRadius: 8,
                background: selecionado === ev.eventId ? 'rgba(23,217,255,0.10)' : 'var(--surface-1)',
                border: `1px solid ${selecionado === ev.eventId ? 'var(--border-strong)' : 'var(--border-hairline)'}`,
                cursor: onSelecionar ? 'pointer' : 'default',
                fontSize: 'var(--text-xs)',
              }}
            >
              <span className="tabular" style={{ color: 'var(--ink-3)' }}>{fmtHora(ev.timestamp)}</span>
              <span aria-hidden style={{ width: 8, height: 8, borderRadius: '50%', background: COR_EVENTO[ev.evento] ?? 'var(--ink-3)', justifySelf: 'center' }} />
              <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                <strong style={{ color: 'var(--ink-0)' }}>{ev.challengerId}</strong>
                <span style={{ color: 'var(--ink-2)' }}> · {ev.evento}</span>
                {ev.motivo && <span style={{ color: 'var(--ink-3)' }}> · {ev.motivo}</span>}
              </span>
              <button
                onClick={(e) => { e.stopPropagation(); copiarId(ev.eventId); }} aria-label={`Copiar eventId ${ev.eventId}`}
                style={{ background: 'transparent', border: '1px solid var(--border-subtle)', borderRadius: 6, color: 'var(--ink-3)', fontSize: 10, padding: '3px 7px', cursor: 'pointer' }}
              >
                copiar id
              </button>
            </motion.div>
          );
        })}
      </div>
    </div>
  );
}
