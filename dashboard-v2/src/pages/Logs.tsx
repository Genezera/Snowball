import { useMemo, useState } from 'react';
import { useEventosRecentes } from '../hooks/useEventosRecentes';
import { PageHeader, Section, StatusBadge, fmt } from '../components/ui/kit';

/**
 * LOGS — stream técnico cru, read-only, derivado do transporte incremental
 * de eventos (a única fonte de stream que a API V2 expõe). Diferente de
 * Audit (forense, por evento auditável) e de Live Operations (timeline
 * operacional master-detail): aqui é uma lista densa estilo terminal, com
 * severidade por cor, pausa e auto-scroll. Um endpoint de logs de PROCESSO
 * (stdout/stderr dos motores) é um item read-only documentado da próxima
 * sub-etapa — não é fabricado aqui.
 */
const SEV: Record<string, { c: string; s: string }> = {
  bloqueado: { c: 'var(--ink-3)', s: 'DEBUG' },
  leitura: { c: 'var(--ink-3)', s: 'TRACE' },
  funding: { c: 'var(--gain-500)', s: 'INFO' },
  abre: { c: 'var(--snow-accent)', s: 'INFO' },
  fecha: { c: 'var(--warn-500)', s: 'WARN' },
  socorre: { c: 'var(--warn-500)', s: 'WARN' },
  erro: { c: 'var(--loss-500)', s: 'ERROR' },
};
function sevDe(evento: string) { return SEV[evento] ?? { c: 'var(--ink-1)', s: 'INFO' }; }
function hora(ts: number) { return new Date(ts).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' }); }

export function Logs() {
  const { eventos, congelado, congelar, retomar, eventosNoBuffer } = useEventosRecentes();
  const [busca, setBusca] = useState('');

  const linhas = useMemo(() => {
    const arr = busca
      ? eventos.filter((e) => (e.challengerId + ' ' + e.evento + ' ' + (e.motivo ?? '')).toLowerCase().includes(busca.toLowerCase()))
      : eventos;
    return [...arr].slice(-500).reverse();
  }, [eventos, busca]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-5)', height: '100%' }}>
      <PageHeader titulo="Logs" sub="Stream técnico read-only derivado do transporte de eventos. Pausa congela o stream visível sem perder nada (buffer continua). Um endpoint de log de processo é item documentado." />

      <Section
        titulo={`Stream · ${linhas.length} linhas${congelado ? ` · ${eventosNoBuffer} no buffer` : ''}`}
        acao={
          <div style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center' }}>
            <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Filtrar…" aria-label="Filtrar logs"
              style={{ background: 'var(--surface-2)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-sm)', color: 'var(--ink-0)', fontSize: 'var(--text-xs)', padding: '6px 10px', width: 180 }} />
            <button onClick={() => congelado ? retomar() : congelar()} aria-pressed={congelado}
              style={{ background: congelado ? 'rgba(255,200,87,0.14)' : 'var(--surface-2)', border: `1px solid ${congelado ? 'var(--warn-500)' : 'var(--border-subtle)'}`, borderRadius: 'var(--radius-sm)', color: congelado ? 'var(--warn-500)' : 'var(--ink-2)', fontSize: 'var(--text-2xs)', fontWeight: 700, padding: '6px 12px', cursor: 'pointer' }}>
              {congelado ? `▶ retomar (${eventosNoBuffer})` : '⏸ pausar'}
            </button>
          </div>
        }
        style={{ flex: 1, minHeight: 0 }}
      >
        <div role="log" tabIndex={0} aria-label="Stream de logs" style={{ flex: 1, overflowY: 'auto', fontFamily: 'var(--font-mono)', fontSize: 'var(--text-2xs)', background: 'rgba(3,8,18,0.5)', border: '1px solid var(--border-hairline)', borderRadius: 'var(--radius-md)', padding: 'var(--space-3)' }}>
          {linhas.length ? linhas.map((e) => {
            const sv = sevDe(e.evento);
            return (
              <div key={e.eventId} style={{ display: 'flex', gap: 10, padding: '2px 0', borderBottom: '1px solid rgba(255,255,255,0.02)', lineHeight: 1.6 }}>
                <span style={{ color: 'var(--ink-3)', flex: 'none', width: 62 }}>{hora(e.timestamp)}</span>
                <span style={{ color: sv.c, fontWeight: 700, flex: 'none', width: 46 }}>{sv.s}</span>
                <span style={{ color: 'var(--ink-2)', flex: 'none', width: 180, overflow: 'hidden', textOverflow: 'ellipsis' }}>{e.challengerId}</span>
                <span style={{ color: 'var(--ink-1)' }}>{e.evento}{e.motivo ? ` · ${e.motivo}` : ''}</span>
              </div>
            );
          }) : <span style={{ color: 'var(--ink-3)' }}>Sem linhas no filtro atual.</span>}
        </div>
      </Section>

      <div style={{ display: 'flex', gap: 8 }}>
        <StatusBadge label="read-only" tom="info" />
        <span style={{ fontSize: 'var(--text-2xs)', color: 'var(--ink-3)' }}>Total recebido nesta sessão: {fmt.int(eventos.length)} eventos (transporte por cursor, dedup por eventId).</span>
      </div>
    </div>
  );
}
