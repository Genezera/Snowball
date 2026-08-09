import { NavLink } from 'react-router-dom';
import { motion } from 'framer-motion';
import { useState } from 'react';
import { useT } from '../../i18n';

interface NavItem { to: string; label: string; glyph: string }
interface NavGroup { titulo: string; itens: NavItem[] }

/**
 * SIDEBAR — navegação agrupada com a identidade Snowball (marca com brilho
 * ciano, estado ativo em ciano glacial, grupos recolhíveis). Focada no plano
 * de 2 exchanges: núcleo (Command Center, Competidores, Maximização, Champion)
 * + operação/mercado + sistema. Todas as páginas listadas são reais.
 */
const GRUPOS: NavGroup[] = [
  {
    titulo: 'Snowball 2-Ex',
    itens: [
      { to: '/', label: 'Command Center', glyph: 'M4 4h7v7H4zM13 4h7v4h-7zM13 10h7v10h-7zM4 13h7v7H4z' },
      { to: '/competidores', label: 'Competidores 2-Ex', glyph: 'M8 6h8M8 12h8M8 18h8M4 6h.01M4 12h.01M4 18h.01' },
      { to: '/maximizacao', label: 'Maximização de Lucro', glyph: 'M3 17l6-6 4 4 8-8M21 7v6h-6' },
      { to: '/champion', label: 'Champion (referência)', glyph: 'M12 2 L20 12 L12 22 L4 12 Z' },
    ],
  },
  {
    titulo: 'Operação & Mercado',
    itens: [
      { to: '/opportunities', label: 'Varredura do Mercado', glyph: 'M5 12a7 7 0 1114 0 7 7 0 01-14 0zM12 5v2M12 17v2M5 12h2M17 12h2' },
      { to: '/costs', label: 'Custos & Maker', glyph: 'M12 1v22M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6' },
      { to: '/risk', label: 'Risco (liquidação)', glyph: 'M12 2l9 5v6c0 5-3.8 8-9 9-5.2-1-9-4-9-9V7z' },
      { to: '/capture', label: 'Funding & Settlements', glyph: 'M12 2a10 10 0 100 20 10 10 0 000-20zM12 6v6l4 2' },
    ],
  },
  {
    titulo: 'Sistema',
    itens: [
      { to: '/historico', label: 'Histórico', glyph: 'M3 3v5h5M3.05 13a9 9 0 105-8.5L3 8M12 7v5l4 2' },
      { to: '/system', label: 'Saúde do Sistema', glyph: 'M12 2a5 5 0 00-5 5v3H5a2 2 0 00-2 2v8a2 2 0 002 2h14a2 2 0 002-2v-8a2 2 0 00-2-2h-2V7a5 5 0 00-5-5z' },
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
