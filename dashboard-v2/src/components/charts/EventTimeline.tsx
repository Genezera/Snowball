import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
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
}

const COR_EVENTO: Record<string, string> = {
  abre: 'var(--gain-500)', fecha: 'var(--loss-500)', funding: 'var(--brass-300)',
  escalona: 'var(--slate-500)', apara: 'var(--warn-500)', reinveste: 'var(--gain-500)',
  bloqueado: 'var(--ink-3)', leitura: 'var(--ink-3)',
};

function fmtHora(ts: number): string {
  return new Date(ts).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

async function copiarId(id: string) {
  try { await navigator.clipboard.writeText(id); } catch { /* clipboard indisponível — silencioso, não é crítico */ }
}

/**
 * Timeline ao vivo — cada evento entra com `eventEnter` (desliza+clareia),
 * nunca reordena o que já está na tela (`AnimatePresence mode="popLayout"`
 * evita o salto). `congelado` pausa a entrada de novos itens sem perder o
 * que já chegou — é a mesma lista, só para de crescer.
 */
export function EventTimeline({ eventos, state, congelado }: Props) {
  const reduceMotion = useReducedMotion();
  if (state === 'loading') return <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>{[...Array(6)].map((_, i) => <Skeleton key={i} height={36} />)}</div>;
  if (!eventos?.length) return <EmptyIllustration label="Nenhum evento ainda nesta janela" />;

  return (
    <div role="log" aria-live={congelado ? 'off' : 'polite'} style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 520, overflowY: 'auto' }}>
      <AnimatePresence initial={false} mode="popLayout">
        {eventos.map((ev) => (
          <motion.div
            key={ev.eventId} layout
            variants={reduceMotion ? undefined : eventEnter} initial="hidden" animate="visible" exit={{ opacity: 0 }}
            style={{
              display: 'grid', gridTemplateColumns: '84px 10px 1fr auto', alignItems: 'center', gap: 10,
              padding: '7px 10px', borderRadius: 8, background: 'var(--surface-1)', border: '1px solid var(--border-hairline)',
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
              onClick={() => copiarId(ev.eventId)} aria-label={`Copiar eventId ${ev.eventId}`}
              style={{ background: 'transparent', border: '1px solid var(--border-subtle)', borderRadius: 6, color: 'var(--ink-3)', fontSize: 10, padding: '3px 7px', cursor: 'pointer' }}
            >
              copiar id
            </button>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
