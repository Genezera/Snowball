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
  const [selecionado, setSelecionado] = useState<string | null>(null);

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
        <select aria-label="Filtrar por motor" value={filtroMotor} onChange={(e) => setFiltroMotor(e.target.value)} style={selectStyle}>
          <option value="">Todos os motores</option>
          {motores.map((m) => <option key={m} value={m}>{m}</option>)}
        </select>
        <select aria-label="Filtrar por tipo de evento" value={filtroTipo} onChange={(e) => setFiltroTipo(e.target.value)} style={selectStyle}>
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
        <div tabIndex={0} role="region" aria-label="Tabela de cobertura dos challengers, role horizontal" style={{ overflowX: 'auto', border: '1px solid var(--border-hairline)', borderRadius: 'var(--radius-lg)' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 'var(--text-2xs)' }}>
            <thead>
              <tr style={{ background: 'var(--surface-2)' }}>
                {['Challenger', 'Estado', 'Diário', 'Na janela', 'Depois do cursor', 'Entregues', 'Último evento', 'Motivo', 'Erro'].map((h) => (
                  <th key={h} style={{ textAlign: 'left', padding: '6px 10px', color: 'var(--ink-2)', fontWeight: 700, textTransform: 'uppercase' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {cobertura.linhas.map((c) => (
                <tr key={c.challengerId} style={{ borderTop: '1px solid var(--border-hairline)' }}>
                  <td style={{ padding: '5px 10px', fontWeight: 600 }}>{c.challengerId}</td>
                  <td style={{ padding: '5px 10px' }}>{c.possuiEstado ? '✓' : '—'}</td>
                  <td style={{ padding: '5px 10px' }}>{c.diarioVazio ? 'vazio' : c.possuiDiario ? '✓' : '—'}</td>
                  <td style={{ padding: '5px 10px', color: c.possuiEventos ? 'var(--gain-500)' : 'var(--warn-500)', fontWeight: 700 }}>
                    {c.possuiEventos ? 'sim' : 'não'}
                  </td>
                  <td style={{ padding: '5px 10px' }}>{c.eventosDepoisDoCursor}</td>
                  <td style={{ padding: '5px 10px' }}>{c.eventosEntregues}</td>
                  <td style={{ padding: '5px 10px', color: 'var(--ink-3)' }}>{c.ultimoEvento ? new Date(c.ultimoEvento).toLocaleTimeString('pt-BR') : '—'}</td>
                  <td style={{ padding: '5px 10px', color: 'var(--ink-3)' }}>{c.motivoSemEventos ?? '—'}</td>
                  <td style={{ padding: '5px 10px', color: c.erro ? 'var(--loss-500)' : 'var(--ink-3)' }}>{c.erro ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* master-detail: timeline (65%) + painel de detalhe do evento (35%) */}
      <div style={{ display: 'grid', gridTemplateColumns: selecionado ? 'minmax(0, 65fr) minmax(300px, 35fr)' : '1fr', gap: 'var(--space-4)', alignItems: 'start' }}>
        <EventTimeline
          eventos={filtrados.map((e) => ({ eventId: e.eventId, sequenceNumber: e.sequenceNumber ?? 0, cycleId: e.cycleId ?? '—', timestamp: e.timestamp, challengerId: e.challengerId, evento: e.evento, motivo: e.motivo ?? undefined }))}
          state={state}
          congelado={congelado}
          onSelecionar={(ev) => setSelecionado(ev.eventId)}
          selecionado={selecionado ?? undefined}
          maxAltura={640}
        />
        {selecionado && (() => {
          const idx = filtrados.findIndex((e) => e.eventId === selecionado);
          const ev = filtrados[idx];
          if (!ev) return null;
          const anterior = filtrados[idx - 1];
          const proximo = filtrados[idx + 1];
          // sourceId/generation/byteOffset são derivados do eventId sintético
          // `fonte:g<geração>:b<byteOffset>` (legado/colisão). Para eventos
          // modernos, o eventId é o id do produtor — esses campos não são
          // instrumentados nele, então mostramos "não instrumentado" em vez
          // de inventar. NADA é declarado sem estar realmente presente.
          const m = /^(.+):g(\d+):b(\d+)$/.exec(ev.eventId);
          const NI = 'não instrumentado';
          const linhas: [string, string][] = [
            ['Evento', ev.evento],
            ['Origem (challenger)', ev.challengerId],
            ['Timestamp', new Date(ev.timestamp).toLocaleString('pt-BR')],
            ['Motivo', ev.motivo ?? '—'],
            ['eventId', ev.eventId],
            ['eventIdOriginal', (ev as { eventIdOriginal?: string | null }).eventIdOriginal ?? '—'],
            ['sourceId', m ? m[1] : NI],
            ['generation', m ? m[2] : NI],
            ['byteOffset', m ? m[3] : NI],
            ['sequenceNumber', ev.sequenceNumber != null ? String(ev.sequenceNumber) : NI],
            ['cycleId (correlationId)', ev.cycleId ?? NI],
            ['idLegado', ev.idLegado ? 'sim' : 'não'],
            ['schemaVersion', NI],
            ['payload validado', 'validado por Zod no transporte (EventoRecenteSchema)'],
            ['posição relacionada', NI],
          ];
          return (
            <div style={{ position: 'sticky', top: 0, background: 'linear-gradient(180deg, var(--surface-glass), rgba(12,21,38,0.45))', border: '1px solid var(--border-strong)', borderRadius: 'var(--radius-lg)', padding: 'var(--space-4)', display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ fontSize: 'var(--text-sm)', fontWeight: 800, color: 'var(--ink-0)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Detalhe do evento</span>
                <button onClick={() => setSelecionado(null)} aria-label="Fechar detalhe" style={{ background: 'transparent', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-sm)', color: 'var(--ink-2)', cursor: 'pointer', padding: '2px 8px' }}>✕</button>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {linhas.map(([k, v]) => (
                  <div key={k} style={{ display: 'grid', gridTemplateColumns: '130px 1fr', gap: 8, padding: '5px 0', borderBottom: '1px solid var(--border-hairline)', fontSize: 'var(--text-2xs)' }}>
                    <span style={{ color: 'var(--ink-3)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.03em' }}>{k}</span>
                    <span className="tabular" style={{ color: 'var(--ink-1)', overflowWrap: 'anywhere' }}>{v}</span>
                  </div>
                ))}
              </div>
              <div style={{ display: 'flex', gap: 8, fontSize: 'var(--text-2xs)' }}>
                <button disabled={!anterior} onClick={() => anterior && setSelecionado(anterior.eventId)} style={navBtn(!anterior)}>← anterior</button>
                <button disabled={!proximo} onClick={() => proximo && setSelecionado(proximo.eventId)} style={navBtn(!proximo)}>próximo →</button>
              </div>
            </div>
          );
        })()}
      </div>
    </div>
  );
}

function navBtn(desabilitado: boolean): React.CSSProperties {
  return {
    flex: 1, background: 'var(--surface-2)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-sm)',
    color: desabilitado ? 'var(--ink-3)' : 'var(--ink-1)', fontWeight: 700, padding: '7px', cursor: desabilitado ? 'default' : 'pointer', opacity: desabilitado ? 0.5 : 1,
  };
}

const selectStyle: React.CSSProperties = {
  background: 'var(--surface-1)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-sm)',
  color: 'var(--ink-1)', fontSize: 'var(--text-xs)', padding: '7px 10px',
};
