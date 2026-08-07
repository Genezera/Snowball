import { useMemo, useState } from 'react';
import { useEventosRecentes, INTERVALO_POLL_MS } from '../hooks/useEventosRecentes';
import { EventTimeline } from '../components/charts/EventTimeline';
import { DataStateBanner } from '../components/feedback/DataState';
import { TransportIndicator } from '../components/feedback/TransportIndicator';

export function LiveOperations() {
  const {
    resultado, eventos, cobertura, congelado, congelar, retomar,
    eventosRecebidos, duplicadosDescartados, eventosNoBuffer,
    estadoDaConexao, ultimaAtualizacao, ultimoEventoTs, tentativas,
  } = useEventosRecentes();
  const [filtroMotor, setFiltroMotor] = useState('');
  const [filtroTipo, setFiltroTipo] = useState('');
  const [busca, setBusca] = useState('');
  const [mostrarCobertura, setMostrarCobertura] = useState(false);

  const filtrados = useMemo(() => {
    return eventos.filter((e) => {
      if (filtroMotor && e.challengerId !== filtroMotor) return false;
      if (filtroTipo && e.evento !== filtroTipo) return false;
      if (busca && !`${e.challengerId} ${e.evento} ${e.motivo ?? ''}`.toLowerCase().includes(busca.toLowerCase())) return false;
      return true;
    });
  }, [eventos, filtroMotor, filtroTipo, busca]);

  const motores = useMemo(() => [...new Set(eventos.map((e) => e.challengerId))].sort(), [eventos]);
  const tipos = useMemo(() => [...new Set(eventos.map((e) => e.evento))].sort(), [eventos]);

  const state = resultado == null ? 'loading' : resultado.estado === 'sucesso' ? 'success' : resultado.estado === 'corrompido' ? 'corrupted' : eventos.length ? 'success' : 'error';
  const totalAprovados = cobertura?.challengersDeclarados ?? 0;
  const cobertos = cobertura?.challengersComEventosNaJanela ?? 0;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-5)' }}>
      <div>
        <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 'var(--text-2xl)', margin: 0, fontWeight: 600 }}>Live Operations</h1>
        <p style={{ color: 'var(--ink-2)', fontSize: 'var(--text-sm)', margin: '4px 0 0' }}>
          Feed mesclado de eventos reais, transporte incremental por cursor — champion + até {totalAprovados} challengers aprovados (nem todos têm evento na janela atual, ver cobertura abaixo).
        </p>
      </div>

      <TransportIndicator
        modo="cursor-incremental" status={estadoDaConexao === 'erro' ? 'erro' : congelado ? 'pausado' : 'ativo'}
        ultimoEvento={ultimoEventoTs} ultimaAtualizacao={ultimaAtualizacao} intervaloMs={INTERVALO_POLL_MS}
        tentativas={tentativas} eventosDescartadosComoDuplicados={duplicadosDescartados}
        eventosRecebidos={eventosRecebidos} eventosNoBuffer={eventosNoBuffer}
      />

      {state === 'error' && <DataStateBanner kind="offline" motivo={resultado && 'motivo' in resultado ? resultado.motivo : undefined} />}
      {resultado?.estado === 'corrompido' && <DataStateBanner kind="corrupted" motivo={resultado.motivo} />}

      <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap', alignItems: 'center' }}>
        <select value={filtroMotor} onChange={(e) => setFiltroMotor(e.target.value)} style={selectStyle}>
          <option value="">Todos os motores</option>
          {motores.map((m) => <option key={m} value={m}>{m}</option>)}
        </select>
        <select value={filtroTipo} onChange={(e) => setFiltroTipo(e.target.value)} style={selectStyle}>
          <option value="">Todos os tipos</option>
          {tipos.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
        <input placeholder="Buscar…" value={busca} onChange={(e) => setBusca(e.target.value)} style={{ ...selectStyle, flex: 1, minWidth: 160 }} />
        <button onClick={() => (congelado ? retomar() : congelar())} style={{ ...selectStyle, cursor: 'pointer', fontWeight: 700, color: congelado ? 'var(--warn-500)' : 'var(--ink-2)', borderColor: congelado ? 'var(--warn-500)' : 'var(--border-subtle)' }}>
          {congelado ? `▶ retomar (${eventosNoBuffer} no buffer)` : '⏸ congelar'}
        </button>
        <button onClick={() => setMostrarCobertura((v) => !v)} style={{ ...selectStyle, cursor: 'pointer' }}>
          cobertura: {cobertos}/{totalAprovados} {mostrarCobertura ? '▲' : '▼'}
        </button>
      </div>

      {mostrarCobertura && cobertura && (
        <div style={{ overflowX: 'auto', border: '1px solid var(--border-hairline)', borderRadius: 'var(--radius-lg)' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 'var(--text-2xs)' }}>
            <thead>
              <tr style={{ background: 'var(--surface-2)' }}>
                {['Challenger', 'Estado', 'Diário', 'No feed', 'Motivo'].map((h) => (
                  <th key={h} style={{ textAlign: 'left', padding: '6px 10px', color: 'var(--ink-2)', fontWeight: 700, textTransform: 'uppercase' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {cobertura.linhas.map((c) => (
                <tr key={c.challengerId} style={{ borderTop: '1px solid var(--border-hairline)' }}>
                  <td style={{ padding: '5px 10px', fontWeight: 600 }}>{c.challengerId}</td>
                  <td style={{ padding: '5px 10px' }}>{c.possuiEstado ? '✓' : '—'}</td>
                  <td style={{ padding: '5px 10px' }}>{c.possuiDiario ? '✓' : '—'}</td>
                  <td style={{ padding: '5px 10px', color: c.possuiEventosNaJanela ? 'var(--gain-500)' : 'var(--warn-500)', fontWeight: 700 }}>
                    {c.possuiEventosNaJanela ? 'sim' : 'ativo · sem eventos na janela'}
                  </td>
                  <td style={{ padding: '5px 10px', color: 'var(--ink-3)' }}>{c.motivoAusencia ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <EventTimeline
        eventos={filtrados.map((e) => ({ eventId: e.eventId, sequenceNumber: e.sequenceNumber ?? 0, cycleId: e.cycleId ?? '—', timestamp: e.timestamp, challengerId: e.challengerId, evento: e.evento, motivo: e.motivo ?? undefined }))}
        state={state}
        congelado={congelado}
      />
    </div>
  );
}

const selectStyle: React.CSSProperties = {
  background: 'var(--surface-1)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-sm)',
  color: 'var(--ink-1)', fontSize: 'var(--text-xs)', padding: '7px 10px',
};
