import { NavLink } from 'react-router-dom';
import { motion } from 'framer-motion';
import { useState } from 'react';

interface NavItem { to: string; label: string; glyph: string }

const ITEMS: NavItem[] = [
  { to: '/', label: 'Command Center', glyph: 'M4 4h7v7H4zM13 4h7v4h-7zM13 10h7v10h-7zM4 13h7v7H4z' },
  { to: '/live', label: 'Live Operations', glyph: 'M3 12h4l3-8 4 16 3-8h4' },
  { to: '/strategies', label: 'Strategies', glyph: 'M12 2l8.5 5v10L12 22l-8.5-5V7z' },
  { to: '/champion', label: 'Champion', glyph: 'M12 2 L20 12 L12 22 L4 12 Z' },
  { to: '/champion-vs-control', label: 'Champion vs. Control', glyph: 'M4 6h7M4 12h7M4 18h7M13 6h7M13 12h7M13 18h7' },
  { to: '/arena', label: 'Challenger Arena', glyph: 'M12 2a10 10 0 100 20 10 10 0 000-20zM12 7v5l3 3' },
  { to: '/experiments', label: 'Experiments', glyph: 'M9 2h6M10 2v6l-5 9a2 2 0 002 3h10a2 2 0 002-3l-5-9V2' },
  { to: '/capture', label: 'Settlement Capture', glyph: 'M12 2a10 10 0 100 20 10 10 0 000-20zM12 6v6l4 2' },
  { to: '/portfolio', label: 'Portfolio', glyph: 'M3 3v18h18M7 15l4-4 3 3 5-6' },
  { to: '/opportunities', label: 'Opportunity Map', glyph: 'M5 12a7 7 0 1114 0 7 7 0 01-14 0zM12 5v2M12 17v2M5 12h2M17 12h2' },
  { to: '/risk', label: 'Risk Center', glyph: 'M12 2l9 5v6c0 5-3.8 8-9 9-5.2-1-9-4-9-9V7z' },
  { to: '/costs', label: 'Cost Intelligence', glyph: 'M12 1v22M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6' },
  { to: '/system', label: 'System Health', glyph: 'M12 2a5 5 0 00-5 5v3H5a2 2 0 00-2 2v8a2 2 0 002 2h14a2 2 0 002-2v-8a2 2 0 00-2-2h-2V7a5 5 0 00-5-5z' },
  { to: '/audit', label: 'Audit', glyph: 'M9 12l2 2 4-4M5 3h14v18l-7-4-7 4z' },
];

export function Sidebar() {
  const [colapsado, setColapsado] = useState(false);
  return (
    <motion.aside
      animate={{ width: colapsado ? 68 : 232 }} transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
      style={{
        display: 'flex', flexDirection: 'column', height: '100vh', flex: 'none',
        background: 'var(--surface-0)', borderRight: '1px solid var(--border-hairline)',
        padding: 'var(--space-4) var(--space-2)', gap: 'var(--space-1)', overflow: 'hidden',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', padding: '0 var(--space-2)', marginBottom: 'var(--space-6)' }}>
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="var(--brass-300)" strokeWidth="1.4" style={{ flex: 'none' }}>
          <circle cx="12" cy="12" r="9" />
          <path d="M12 3v18M4.2 7.8l15.6 8.4M4.2 16.2l15.6-8.4" strokeLinecap="round" />
        </svg>
        {!colapsado && <span style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 'var(--text-lg)', letterSpacing: '-0.01em' }}>Snowball</span>}
      </div>

      <nav style={{ display: 'flex', flexDirection: 'column', gap: 2, flex: 1, overflowY: 'auto' }}>
        {ITEMS.map((item) => (
          <NavLink
            key={item.to} to={item.to} end={item.to === '/'}
            style={({ isActive }) => ({
              display: 'flex', alignItems: 'center', gap: 'var(--space-3)',
              padding: '9px var(--space-2)', borderRadius: 'var(--radius-sm)',
              color: isActive ? 'var(--ink-0)' : 'var(--ink-2)',
              background: isActive ? 'var(--surface-2)' : 'transparent',
              textDecoration: 'none', fontSize: 'var(--text-sm)', fontWeight: 600,
              whiteSpace: 'nowrap', transition: `background var(--dur-fast) var(--ease-out), color var(--dur-fast) var(--ease-out)`,
            })}
          >
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" style={{ flex: 'none' }}>
              <path d={item.glyph} strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            {!colapsado && <span>{item.label}</span>}
          </NavLink>
        ))}
      </nav>

      <button
        onClick={() => setColapsado((c) => !c)}
        style={{
          background: 'transparent', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-sm)',
          color: 'var(--ink-2)', fontSize: 'var(--text-xs)', fontWeight: 700, padding: '8px', cursor: 'pointer',
        }}
        aria-label={colapsado ? 'Expandir menu' : 'Recolher menu'}
      >
        {colapsado ? '»' : '« Recolher'}
      </button>
    </motion.aside>
  );
}
