import { NavLink } from 'react-router-dom';
import { motion } from 'framer-motion';
import { useState } from 'react';
import { useT } from '../../i18n';

interface NavItem { to: string; label: string; glyph: string; pendente?: boolean }
interface NavGroup { titulo: string; itens: NavItem[] }

/**
 * SIDEBAR DEFINITIVA (Etapa A, item 7) — navegação agrupada com a
 * identidade Snowball: marca com brilho ciano, estado ativo em ciano
 * glacial, grupos recolhíveis. Só as 6 páginas já construídas são reais;
 * as demais abrem a `PaginaPendente` (stubs de Etapa B/C) e ficam marcadas
 * com um ponto "em breve" pra não confundir o que já existe.
 */
// Grupos conforme a spec de reconstrução desktop (item 5). Os rótulos das 6
// páginas JÁ construídas ficam nos nomes que os testes E2E e os <h1> das
// páginas usam (renomear quebraria keyboard.spec + os headings) — a
// tradução dos rótulos é polimento coordenado posterior.
const GRUPOS: NavGroup[] = [
  {
    titulo: 'Overview',
    itens: [
      { to: '/', label: 'Command Center', glyph: 'M4 4h7v7H4zM13 4h7v4h-7zM13 10h7v10h-7zM4 13h7v7H4z' },
      { to: '/champion', label: 'Champion', glyph: 'M12 2 L20 12 L12 22 L4 12 Z' },
    ],
  },
  {
    titulo: 'Operações',
    itens: [
      { to: '/live', label: 'Live Operations', glyph: 'M3 12h4l3-8 4 16 3-8h4' },
      { to: '/capture', label: 'Settlement Capture', glyph: 'M12 2a10 10 0 100 20 10 10 0 000-20zM12 6v6l4 2' },
      { to: '/opportunities', label: 'Opportunity Map', glyph: 'M5 12a7 7 0 1114 0 7 7 0 01-14 0zM12 5v2M12 17v2M5 12h2M17 12h2' },
      { to: '/portfolio', label: 'Portfolio', glyph: 'M3 3v18h18M7 15l4-4 3 3 5-6' },
    ],
  },
  {
    titulo: 'Estratégias',
    itens: [
      { to: '/strategies', label: 'Strategy Universe', glyph: 'M12 2l8.5 5v10L12 22l-8.5-5V7z' },
      { to: '/arena', label: 'Challenger Arena', glyph: 'M12 2a10 10 0 100 20 10 10 0 000-20zM12 7v5l3 3' },
      { to: '/champion-vs-control', label: 'Champion vs. Control', glyph: 'M4 6h7M4 12h7M4 18h7M13 6h7M13 12h7M13 18h7' },
      { to: '/experiments', label: 'Experiment Lab', glyph: 'M9 2h6M10 2v6l-5 9a2 2 0 002 3h10a2 2 0 002-3l-5-9V2' },
    ],
  },
  {
    titulo: 'Inteligência financeira',
    itens: [
      { to: '/costs', label: 'Cost Intelligence', glyph: 'M12 1v22M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6' },
      { to: '/risk', label: 'Risk Center', glyph: 'M12 2l9 5v6c0 5-3.8 8-9 9-5.2-1-9-4-9-9V7z' },
      { to: '/exchanges', label: 'Exchanges', glyph: 'M4 7h13l-3-3M20 17H7l3 3' },
    ],
  },
  {
    titulo: 'Sistema',
    itens: [
      { to: '/processes', label: 'Processos', glyph: 'M9 3H5a2 2 0 00-2 2v4M15 3h4a2 2 0 012 2v4M9 21H5a2 2 0 01-2-2v-4M15 21h4a2 2 0 002-2v-4M9 9h6v6H9z' },
      { to: '/system', label: 'System Health', glyph: 'M12 2a5 5 0 00-5 5v3H5a2 2 0 00-2 2v8a2 2 0 002 2h14a2 2 0 002-2v-8a2 2 0 00-2-2h-2V7a5 5 0 00-5-5z' },
      { to: '/pesquisa', label: 'Pesquisa', glyph: 'M11 4a7 7 0 100 14 7 7 0 000-14zM21 21l-5-5' },
      { to: '/historico', label: 'Histórico', glyph: 'M3 3v5h5M3.05 13a9 9 0 105-8.5L3 8M12 7v5l4 2' },
      { to: '/logs', label: 'Logs', glyph: 'M4 4h16v16H4zM8 8h8M8 12h8M8 16h5' },
      { to: '/audit', label: 'Audit', glyph: 'M9 12l2 2 4-4M5 3h14v18l-7-4-7 4z' },
    ],
  },
];

function ItemLink({ item, colapsado, aoNavegar }: { item: NavItem; colapsado: boolean; aoNavegar?: () => void }) {
  const t = useT();
  return (
    <NavLink
      key={item.to} to={item.to} end={item.to === '/'}
      onClick={aoNavegar}
      title={colapsado ? t(item.label) : undefined}
      style={({ isActive }) => ({
        display: 'flex', alignItems: 'center', gap: 'var(--space-3)',
        padding: '9px var(--space-3)', borderRadius: 'var(--radius-sm)',
        color: isActive ? 'var(--snow-text-primary)' : 'var(--ink-2)',
        background: isActive
          ? 'linear-gradient(90deg, rgba(23,217,255,0.16), rgba(23,217,255,0.02))'
          : 'transparent',
        border: isActive ? '1px solid var(--border-strong)' : '1px solid transparent',
        textDecoration: 'none', fontSize: 'var(--text-sm)', fontWeight: 600,
        whiteSpace: 'nowrap', position: 'relative',
        transition: 'background var(--dur-fast) var(--ease-out), color var(--dur-fast) var(--ease-out), border-color var(--dur-fast) var(--ease-out)',
      })}
    >
      {({ isActive }) => (
        <>
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none"
            stroke={isActive ? 'var(--snow-primary)' : 'currentColor'} strokeWidth="1.6"
            style={{ flex: 'none', filter: isActive ? 'drop-shadow(0 0 5px var(--snow-glow))' : 'none' }}>
            <path d={item.glyph} strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          {!colapsado && <span style={{ flex: 1 }}>{t(item.label)}</span>}
          {!colapsado && item.pendente && (
            <span title={t('Em construção (Etapa B/C)')} style={{
              fontSize: '0.55rem', fontWeight: 800, letterSpacing: '0.06em', textTransform: 'uppercase',
              color: 'var(--ink-3)', border: '1px solid var(--border-hairline)', borderRadius: 4, padding: '1px 5px',
            }}>soon</span>
          )}
        </>
      )}
    </NavLink>
  );
}

export function Sidebar({ modoMobile = false, aoNavegar }: { modoMobile?: boolean; aoNavegar?: () => void } = {}) {
  // No drawer mobile a sidebar é sempre expandida (nunca "comprimida"); o
  // recolher-pra-ícones é só do desktop.
  const t = useT();
  const [colapsadoDesktop, setColapsado] = useState(false);
  const colapsado = modoMobile ? false : colapsadoDesktop;
  const [gruposFechados, setGruposFechados] = useState<Set<string>>(new Set());

  const toggleGrupo = (t: string) => setGruposFechados((prev) => {
    const n = new Set(prev); n.has(t) ? n.delete(t) : n.add(t); return n;
  });

  return (
    <motion.aside
      animate={{ width: colapsado ? 68 : 244 }} transition={{ duration: 0.22, ease: [0.2, 0.7, 0.2, 1] }}
      style={{
        display: 'flex', flexDirection: 'column', height: '100vh', flex: 'none',
        background: 'var(--surface-glass)', backdropFilter: 'blur(20px)',
        borderRight: '1px solid var(--border-subtle)',
        padding: 'var(--space-4) var(--space-3)', gap: 'var(--space-1)', overflow: 'hidden',
      }}
    >
      {/* marca — assets OFICIAIS do Snowball (nunca recriados): símbolo
          isolado quando colapsado, logo completo quando expandido. */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', padding: '0 var(--space-2) var(--space-4)', marginBottom: 'var(--space-2)', borderBottom: '1px solid var(--border-hairline)', minHeight: 44 }}>
        {colapsado ? (
          <img src="/brand/icons/snowball-symbol.png" alt="Snowball" style={{ height: 30, width: 30, objectFit: 'contain', filter: 'drop-shadow(0 0 8px var(--snow-glow))' }} />
        ) : (
          <img src="/brand/logos/snowball-logo.png" alt="Snowball" style={{ height: 30, width: 'auto', filter: 'drop-shadow(0 0 10px var(--snow-glow))' }} />
        )}
      </div>

      <nav style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)', flex: 1, overflowY: 'auto', overflowX: 'hidden' }}>
        {GRUPOS.map((grupo) => {
          const fechado = gruposFechados.has(grupo.titulo);
          return (
            <div key={grupo.titulo} style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              {!colapsado && (
                <button
                  onClick={() => toggleGrupo(grupo.titulo)}
                  aria-expanded={!fechado}
                  style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6,
                    background: 'transparent', border: 'none', cursor: 'pointer',
                    padding: '2px var(--space-2) 4px', margin: 0,
                    fontSize: '0.6rem', fontWeight: 800, letterSpacing: '0.10em', textTransform: 'uppercase',
                    color: 'var(--ink-3)',
                  }}
                >
                  <span>{t(grupo.titulo)}</span>
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"
                    style={{ transform: fechado ? 'rotate(-90deg)' : 'none', transition: 'transform var(--dur-fast) var(--ease-out)' }}>
                    <path d="M6 9l6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </button>
              )}
              {(!fechado || colapsado) && grupo.itens.map((item) => <ItemLink key={item.to} item={item} colapsado={colapsado} aoNavegar={aoNavegar} />)}
            </div>
          );
        })}
      </nav>

      {!modoMobile && (
        <button
          onClick={() => setColapsado((c) => !c)}
          style={{
            background: 'rgba(255,255,255,0.03)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-sm)',
            color: 'var(--ink-2)', fontSize: 'var(--text-xs)', fontWeight: 700, padding: '9px', cursor: 'pointer',
            marginTop: 'var(--space-2)',
            transition: 'background var(--dur-fast) var(--ease-out), color var(--dur-fast) var(--ease-out)',
          }}
          aria-label={colapsado ? t('Expandir menu') : t('Recolher menu')}
        >
          {colapsado ? '»' : t('« Recolher')}
        </button>
      )}
    </motion.aside>
  );
}
