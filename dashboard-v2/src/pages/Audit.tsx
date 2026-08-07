import { useMemo, useState } from 'react';
import { useEventosRecentes } from '../hooks/useEventosRecentes';
import { PageHeader, Section, DataTable, StatusBadge, fmt, type Coluna } from '../components/ui/kit';
import type { EventoRecente } from '../schemas/events';

/**
 * AUDIT — timeline forense read-only. Diferente de Logs (stream técnico
 * cru): aqui cada linha é um evento AUDITÁVEL, com correlationId (cycleId),
 * origem e resultado. Marca explicitamente colisões de eventId reescritas
 * (eventIdOriginal preservado) e eventos legados. As rotações de arquivo
 * detectadas pelo transporte aparecem como incidentes.
 */
function hora(ts: number): string {
  return new Date(ts).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

export function Audit() {
  const { eventos, resultado } = useEventosRecentes();
  const [filtro, setFiltro] = useState<string>('todos');

  const rotacoes = resultado?.estado === 'sucesso' ? resultado.dado.rotacoesDetectadas ?? [] : [];

  const tipos = useMemo(() => ['todos', ...Array.from(new Set(eventos.map((e) => e.evento)))], [eventos]);
  const filtrados = useMemo(() => {
    const arr = filtro === 'todos' ? eventos : eventos.filter((e) => e.evento === filtro);
    return [...arr].reverse();
  }, [eventos, filtro]);

  const colisoes = eventos.filter((e) => e.eventIdOriginal != null).length;
  const legados = eventos.filter((e) => e.idLegado).length;

  const colunas: Coluna<EventoRecente>[] = [
    { chave: 'ts', titulo: 'Timestamp', render: (e) => <span className="tabular" style={{ color: 'var(--ink-2)' }}>{hora(e.timestamp)}</span> },
    { chave: 'origem', titulo: 'Origem', render: (e) => <span style={{ fontWeight: 700, color: 'var(--ink-0)' }}>{e.challengerId}</span> },
    { chave: 'evento', titulo: 'Evento', render: (e) => <StatusBadge label={e.evento} tom={e.evento === 'bloqueado' ? 'neutral' : e.evento === 'fecha' ? 'warn' : e.evento === 'funding' ? 'ok' : 'info'} /> },
    { chave: 'motivo', titulo: 'Detalhe', render: (e) => <span style={{ color: 'var(--ink-2)', whiteSpace: 'normal' }}>{e.motivo ?? '—'}</span> },
    { chave: 'corr', titulo: 'correlationId', render: (e) => <code style={{ fontSize: 'var(--text-2xs)', color: 'var(--ink-3)' }}>{e.cycleId ?? '—'}</code> },
    { chave: 'flags', titulo: 'Flags', alinhar: 'center', render: (e) => (
      <span style={{ display: 'inline-flex', gap: 4 }}>
        {e.eventIdOriginal != null && <StatusBadge label="colisão" tom="warn" />}
        {e.idLegado && <StatusBadge label="legado" tom="neutral" />}
      </span>
    ) },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-5)' }}>
      <PageHeader titulo="Audit" sub="Timeline forense read-only — eventos auditáveis com correlationId, colisões de eventId reescritas e rotações de arquivo. Exportação apenas de leitura." />

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(170px, 100%), 1fr))', gap: 'var(--space-3)' }}>
        <MiniAudit label="Eventos na janela" valor={fmt.int(eventos.length)} />
        <MiniAudit label="Colisões de eventId" valor={fmt.int(colisoes)} tom={colisoes > 0 ? 'warn' : 'ok'} />
        <MiniAudit label="Eventos legados" valor={fmt.int(legados)} />
        <MiniAudit label="Rotações detectadas" valor={fmt.int(rotacoes.length)} tom={rotacoes.length > 0 ? 'warn' : 'ok'} />
      </div>

      {rotacoes.length > 0 && (
        <Section titulo="Rotações de arquivo (incidentes de transporte)" style={{ borderColor: 'var(--warn-500)' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {rotacoes.map((r, i) => (
              <div key={i} style={{ display: 'flex', gap: 12, alignItems: 'center', fontSize: 'var(--text-xs)', padding: '6px 10px', background: 'var(--surface-1)', borderRadius: 'var(--radius-sm)' }}>
                <StatusBadge label={r.cursorResetReason} tom="warn" />
                <span style={{ fontWeight: 700 }}>{r.fonte}</span>
                <span className="tabular" style={{ color: 'var(--ink-3)' }}>geração {r.oldGeneration} → {r.newGeneration}, replay do byte {r.replayFrom}</span>
              </div>
            ))}
          </div>
        </Section>
      )}

      <Section
        titulo={`Eventos auditáveis · ${filtrados.length}`}
        acao={
          <select value={filtro} onChange={(e) => setFiltro(e.target.value)} aria-label="Filtrar por tipo de evento"
            style={{ background: 'var(--surface-2)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-sm)', color: 'var(--ink-0)', fontSize: 'var(--text-xs)', padding: '6px 10px' }}>
            {tipos.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        }
      >
        {filtrados.length
          ? <DataTable aria="Eventos auditáveis" colunas={colunas} linhas={filtrados.slice(0, 300)} chaveLinha={(e) => e.eventId} />
          : <p style={{ color: 'var(--ink-3)', fontSize: 'var(--text-sm)' }}>Sem eventos na janela atual.</p>}
      </Section>
    </div>
  );
}

function MiniAudit({ label, valor, tom = 'neutral' }: { label: string; valor: string; tom?: 'ok' | 'warn' | 'neutral' }) {
  const cor = tom === 'ok' ? 'var(--gain-500)' : tom === 'warn' ? 'var(--warn-500)' : 'var(--ink-0)';
  return (
    <div style={{ background: 'var(--surface-glass)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-md)', padding: 'var(--space-4)' }}>
      <div style={{ fontSize: 'var(--text-2xs)', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--ink-2)' }}>{label}</div>
      <div className="tabular" style={{ fontSize: 'var(--text-xl)', fontWeight: 800, marginTop: 4, color: cor }}>{valor}</div>
    </div>
  );
}
