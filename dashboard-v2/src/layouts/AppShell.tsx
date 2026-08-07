import { type ReactNode, useEffect } from 'react';
import { Sidebar } from '../components/navigation/Sidebar';
import { useLiveStore } from '../stores/liveStore';

const STATUS_LABEL: Record<string, string> = { conectando: 'conectando', aoVivo: 'ao vivo', reconectando: 'reconectando' };
const STATUS_COLOR: Record<string, string> = { conectando: 'var(--warn-500)', aoVivo: 'var(--gain-500)', reconectando: 'var(--loss-500)' };

function Pill({ label, status }: { label: string; status: string }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 6, padding: '5px 11px', borderRadius: 'var(--radius-full)',
      background: 'var(--surface-2)', border: '1px solid var(--border-subtle)', fontSize: 'var(--text-2xs)', fontWeight: 700, color: 'var(--ink-1)',
    }}>
      <span style={{ width: 6, height: 6, borderRadius: '50%', background: STATUS_COLOR[status] ?? 'var(--ink-3)' }} />
      {label} · {STATUS_LABEL[status] ?? status}
    </div>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const iniciar = useLiveStore((s) => s.iniciar);
  const championStatus = useLiveStore((s) => s.championStatus);
  const profitLabStatus = useLiveStore((s) => s.profitLabStatus);

  useEffect(() => iniciar(), [iniciar]);

  return (
    <div style={{ display: 'flex', height: '100vh', width: '100%' }}>
      <Sidebar />
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        {/* achado real (responsividade mobile): header rígido sem flex-wrap +
            padding fixo forçava overflow horizontal na PÁGINA INTEIRA em
            telas estreitas (o badge + 2 pills nunca cabiam lado a lado
            abaixo de ~430px). flexWrap + padding/altura responsivos corrigem
            sem mudar nada visualmente em telas largas. */}
        <header style={{
          display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 'var(--space-2)',
          padding: 'var(--space-2) clamp(12px, 4vw, var(--space-6))', minHeight: 56, flex: 'none',
          borderBottom: '1px solid var(--border-hairline)', background: 'var(--surface-0)',
        }}>
          <span style={{
            fontSize: 'var(--text-2xs)', fontWeight: 800, letterSpacing: '0.08em', color: 'var(--brass-300)',
            border: '1px solid var(--brass-700)', borderRadius: 4, padding: '2px 7px',
          }}>PAPER · VIRTUAL · NÃO REAL</span>
          <div style={{ flex: 1 }} />
          <Pill label="Champion" status={championStatus} />
          <Pill label="Profit Lab" status={profitLabStatus} />
        </header>
        <main style={{ flex: 1, overflowY: 'auto', padding: 'var(--space-6)' }}>
          {children}
        </main>
      </div>
    </div>
  );
}
