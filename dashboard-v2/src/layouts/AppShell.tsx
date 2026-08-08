import { type ReactNode, useEffect, useState } from 'react';
import { Sidebar } from '../components/navigation/Sidebar';
import { Ticker } from '../components/navigation/Ticker';
import { LangToggle } from '../components/navigation/LangToggle';
import { useLiveStore } from '../stores/liveStore';
import { useT, useLang, localeDe } from '../i18n';

/** Relógio local + UTC (item 6) — dado, atualiza a cada segundo, sem piscar. */
function Relogio() {
  const loc = localeDe(useLang());
  const [agora, setAgora] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setAgora(new Date()), 1000);
    return () => clearInterval(id);
  }, []);
  const local = agora.toLocaleTimeString(loc, { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const utc = agora.toLocaleTimeString(loc, { hour: '2-digit', minute: '2-digit', timeZone: 'UTC' });
  return (
    <div className="tabular" style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 'var(--text-2xs)', color: 'var(--ink-2)', whiteSpace: 'nowrap' }}>
      <span style={{ color: 'var(--ink-1)', fontWeight: 700 }}>{local}</span>
      <span style={{ color: 'var(--ink-3)' }}>· {utc} UTC</span>
    </div>
  );
}

const STATUS_LABEL: Record<string, string> = { conectando: 'conectando', aoVivo: 'ao vivo', reconectando: 'reconectando' };
const STATUS_COLOR: Record<string, string> = { conectando: 'var(--warn-500)', aoVivo: 'var(--gain-500)', reconectando: 'var(--loss-500)' };

/** LED pulsante (identidade Snowball) só quando ao vivo; estático nos demais estados. */
function Pill({ label, status }: { label: string; status: string }) {
  const t = useT();
  const aoVivo = status === 'aoVivo';
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 6, padding: '5px 11px', borderRadius: 'var(--radius-full)',
      background: 'var(--surface-glass)', border: '1px solid var(--border-subtle)', fontSize: 'var(--text-2xs)', fontWeight: 700, color: 'var(--ink-1)',
    }}>
      <span style={{
        width: 6, height: 6, borderRadius: '50%', background: STATUS_COLOR[status] ?? 'var(--ink-3)',
        animation: aoVivo ? 'snow-pulse 1.8s infinite' : 'none',
      }} />
      {label} · {t(STATUS_LABEL[status] ?? status)}
    </div>
  );
}

/** Detecta viewport mobile (matchMedia) — nav própria, nunca "sidebar desktop comprimida". */
function useEhMobile(): boolean {
  const [ehMobile, setEhMobile] = useState(() => typeof window !== 'undefined' && window.matchMedia('(max-width: 899px)').matches);
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 899px)');
    const onChange = () => setEhMobile(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);
  return ehMobile;
}

export function AppShell({ children }: { children: ReactNode }) {
  const iniciar = useLiveStore((s) => s.iniciar);
  const championStatus = useLiveStore((s) => s.championStatus);
  const profitLabStatus = useLiveStore((s) => s.profitLabStatus);
  const ehMobile = useEhMobile();
  const [drawerAberto, setDrawerAberto] = useState(false);
  const t = useT();

  useEffect(() => iniciar(), [iniciar]);
  // ao voltar pra desktop, garante o drawer fechado
  useEffect(() => { if (!ehMobile) setDrawerAberto(false); }, [ehMobile]);
  // Escape fecha o drawer
  useEffect(() => {
    if (!drawerAberto) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setDrawerAberto(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [drawerAberto]);

  return (
    <div style={{ display: 'flex', height: '100vh', width: '100%' }}>
      {/* Desktop: sidebar fixa. Mobile: nada aqui — a nav vem pelo drawer. */}
      {!ehMobile && <Sidebar />}

      {/* Mobile: drawer off-canvas + backdrop, aberto pelo hambúrguer do header. */}
      {ehMobile && drawerAberto && (
        <>
          <div
            onClick={() => setDrawerAberto(false)}
            style={{ position: 'fixed', inset: 0, background: 'rgba(3,8,18,0.6)', backdropFilter: 'blur(2px)', zIndex: 90 }}
          />
          <div style={{ position: 'fixed', top: 0, left: 0, height: '100vh', zIndex: 100, boxShadow: 'var(--elevation-3)' }}>
            <Sidebar modoMobile aoNavegar={() => setDrawerAberto(false)} />
          </div>
        </>
      )}

      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        <header style={{
          display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 'var(--space-2)',
          padding: 'var(--space-2) clamp(12px, 4vw, var(--space-6))', minHeight: 56, flex: 'none',
          borderBottom: '1px solid var(--border-hairline)', background: 'var(--surface-glass)', backdropFilter: 'blur(18px)',
          position: 'sticky', top: 0, zIndex: 35,
        }}>
          {ehMobile && (
            <button
              onClick={() => setDrawerAberto((a) => !a)}
              aria-label={drawerAberto ? t('Fechar menu') : t('Abrir menu')} aria-expanded={drawerAberto}
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 'none',
                width: 36, height: 36, borderRadius: 'var(--radius-sm)',
                background: 'rgba(255,255,255,0.04)', border: '1px solid var(--border-subtle)', color: 'var(--ink-1)', cursor: 'pointer',
              }}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M4 6h16M4 12h16M4 18h16" strokeLinecap="round" /></svg>
            </button>
          )}
          <span style={{
            fontSize: 'var(--text-2xs)', fontWeight: 800, letterSpacing: '0.08em', color: 'var(--snow-primary)',
            border: '1px solid var(--brass-700)', borderRadius: 4, padding: '2px 7px', textShadow: '0 0 10px var(--snow-glow)',
          }}>{t('PAPER · VIRTUAL · NÃO REAL')}</span>
          <div style={{ flex: 1 }} />
          <Relogio />
          <LangToggle />
          <span style={{ width: 1, height: 20, background: 'var(--border-subtle)', flex: 'none' }} aria-hidden />
          <Pill label="Champion" status={championStatus} />
          <Pill label="Profit Lab" status={profitLabStatus} />
        </header>
        <Ticker />
        {/* tabIndex=0: o <main> é o container de scroll vertical. Em páginas
            sem elemento interativo (ex.: Processos, System Health) ele é uma
            região rolável sem foco — axe (scrollable-region-focusable) exige
            que uma região rolável seja alcançável por teclado. Tornar o
            próprio main focável resolve universalmente, sem depender do
            conteúdo ter um botão/link. */}
        <main tabIndex={0} aria-label={t('Conteúdo da página')} style={{ flex: 1, overflowY: 'auto', padding: 'var(--space-6)' }}>
          {children}
        </main>
      </div>
    </div>
  );
}
