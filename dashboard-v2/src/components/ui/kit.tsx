import { motion } from 'framer-motion';
import type { ReactNode, CSSProperties } from 'react';

/**
 * UI KIT SNOWBALL (reconstrução desktop) — primitivos compartilhados por
 * TODAS as páginas, garantindo consistência visual sem que toda página vire
 * a mesma grade de cards. Cada página compõe estes blocos numa estrutura
 * PRÓPRIA. Vidro + borda ciano discreta + entrada animada, herdados da
 * identidade do dashboard antigo.
 */

export function PageHeader({ titulo, sub, acao }: { titulo: string; sub?: string; acao?: ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 'var(--space-4)', flexWrap: 'wrap', marginBottom: 'var(--space-2)' }}>
      <div>
        <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 'var(--text-2xl)', margin: 0, fontWeight: 700, letterSpacing: '-0.01em' }}>{titulo}</h1>
        {sub && <p style={{ color: 'var(--ink-2)', fontSize: 'var(--text-sm)', margin: '4px 0 0', maxWidth: 720 }}>{sub}</p>}
      </div>
      {acao}
    </div>
  );
}

/** Painel titulado — o "card" grande com personalidade Snowball. */
export function Section({ titulo, sub, acao, children, style, span }: {
  titulo?: string; sub?: string; acao?: ReactNode; children: ReactNode; style?: CSSProperties; span?: number;
}) {
  return (
    <motion.section
      initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3, ease: [0.2, 0.7, 0.2, 1] }}
      style={{
        gridColumn: span ? `span ${span}` : undefined,
        background: 'linear-gradient(180deg, var(--surface-glass), rgba(12,21,38,0.45))',
        backdropFilter: 'blur(12px)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-lg)',
        padding: 'var(--space-5)', display: 'flex', flexDirection: 'column', gap: 'var(--space-3)', minWidth: 0, ...style,
      }}
    >
      {(titulo || acao) && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--space-3)', flexWrap: 'wrap' }}>
          <div>
            {titulo && <h2 style={{ fontSize: 'var(--text-sm)', fontWeight: 800, margin: 0, color: 'var(--ink-1)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{titulo}</h2>}
            {sub && <p style={{ fontSize: 'var(--text-2xs)', color: 'var(--ink-3)', margin: '3px 0 0', lineHeight: 1.5, maxWidth: 640 }}>{sub}</p>}
          </div>
          {acao}
        </div>
      )}
      {children}
    </motion.section>
  );
}

/** Grade responsiva de colunas (auto-fit, nunca overflow). */
export function Grid({ min = 220, gap = 'var(--space-3)', children, style }: { min?: number; gap?: string; children: ReactNode; style?: CSSProperties }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: `repeat(auto-fit, minmax(min(${min}px, 100%), 1fr))`, gap, ...style }}>
      {children}
    </div>
  );
}

const TOM: Record<string, { c: string; bg: string }> = {
  ok: { c: 'var(--gain-500)', bg: 'rgba(54,227,160,0.14)' },
  gain: { c: 'var(--gain-500)', bg: 'rgba(54,227,160,0.14)' },
  loss: { c: 'var(--loss-500)', bg: 'rgba(255,92,122,0.14)' },
  warn: { c: 'var(--warn-500)', bg: 'rgba(255,200,87,0.14)' },
  info: { c: 'var(--snow-accent)', bg: 'rgba(23,217,255,0.12)' },
  neutral: { c: 'var(--ink-2)', bg: 'rgba(255,255,255,0.05)' },
  violet: { c: 'var(--snow-violet)', bg: 'rgba(139,108,242,0.16)' },
};
export function StatusBadge({ label, tom = 'neutral' }: { label: string; tom?: keyof typeof TOM }) {
  const t = TOM[tom] ?? TOM.neutral;
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: '0.62rem', fontWeight: 800, letterSpacing: '0.04em',
      textTransform: 'uppercase', padding: '3px 9px', borderRadius: 'var(--radius-full)', color: t.c, background: t.bg, whiteSpace: 'nowrap',
    }}>{label}</span>
  );
}

/** Barra de comparação (ranking) — largura proporcional, cor semântica. */
export function RankBar({ valor, max, tom = 'info' }: { valor: number; max: number; tom?: keyof typeof TOM }) {
  const t = TOM[tom] ?? TOM.info;
  const pct = max > 0 ? Math.min(100, Math.abs(valor) / max * 100) : 0;
  return (
    <div style={{ height: 6, borderRadius: 99, background: 'rgba(255,255,255,0.05)', overflow: 'hidden', minWidth: 60 }}>
      <motion.div initial={{ width: 0 }} animate={{ width: `${pct}%` }} transition={{ duration: 0.5, ease: [0.2, 0.7, 0.2, 1] }}
        style={{ height: '100%', background: t.c, boxShadow: `0 0 8px ${t.c}` }} />
    </div>
  );
}

export interface Coluna<T> { chave: string; titulo: string; alinhar?: 'left' | 'right' | 'center'; render: (linha: T) => ReactNode; largura?: string }

/** Tabela densa, legível, com hover e cabeçalho discreto (item 13). */
export function DataTable<T>({ colunas, linhas, chaveLinha, onSelecionar, selecionada, aria }: {
  colunas: Coluna<T>[]; linhas: T[]; chaveLinha: (l: T) => string;
  onSelecionar?: (l: T) => void; selecionada?: string; aria: string;
}) {
  return (
    <div tabIndex={0} role="region" aria-label={aria} style={{ overflowX: 'auto', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-hairline)' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 'var(--text-xs)', minWidth: 520 }}>
        <thead>
          <tr>
            {colunas.map((c) => (
              <th key={c.chave} style={{
                textAlign: c.alinhar ?? 'left', padding: '9px 12px', fontSize: '0.62rem', fontWeight: 800, textTransform: 'uppercase',
                letterSpacing: '0.05em', color: 'var(--ink-3)', borderBottom: '1px solid var(--border-subtle)', width: c.largura, whiteSpace: 'nowrap',
                background: 'rgba(5,11,24,0.5)', position: 'sticky', top: 0,
              }}>{c.titulo}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {linhas.map((l) => {
            const k = chaveLinha(l);
            const sel = selecionada === k;
            return (
              <tr key={k}
                onClick={onSelecionar ? () => onSelecionar(l) : undefined}
                style={{
                  cursor: onSelecionar ? 'pointer' : 'default',
                  background: sel ? 'rgba(23,217,255,0.08)' : 'transparent',
                  borderLeft: sel ? '2px solid var(--snow-primary)' : '2px solid transparent',
                  transition: 'background var(--dur-fast) var(--ease-out)',
                }}
                onMouseEnter={(e) => { if (!sel) e.currentTarget.style.background = 'rgba(255,255,255,0.03)'; }}
                onMouseLeave={(e) => { if (!sel) e.currentTarget.style.background = 'transparent'; }}
              >
                {colunas.map((c) => (
                  <td key={c.chave} className={c.alinhar === 'right' ? 'tabular' : undefined}
                    style={{ textAlign: c.alinhar ?? 'left', padding: '9px 12px', borderBottom: '1px solid var(--border-hairline)', color: 'var(--ink-1)', whiteSpace: 'nowrap' }}>
                    {c.render(l)}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** Formatação consistente (item 11). */
export const fmt = {
  usd: (n: number | null | undefined) => n == null ? '—' : (n < 0 ? '-' : '') + 'US$ ' + Math.abs(n).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
  pct: (n: number | null | undefined) => n == null ? '—' : (n >= 0 ? '+' : '') + n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + '%',
  int: (n: number | null | undefined) => n == null ? '—' : n.toLocaleString('pt-BR', { maximumFractionDigits: 0 }),
  dias: (n: number | null | undefined) => n == null ? '—' : n.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + ' d',
  tomPnl: (n: number | null | undefined): 'gain' | 'loss' | 'neutral' => n == null ? 'neutral' : n >= 0 ? 'gain' : 'loss',
  corPnl: (n: number | null | undefined) => n == null ? 'var(--ink-2)' : n >= 0 ? 'var(--gain-500)' : 'var(--loss-500)',
};

/** Faixa fina de acento no topo de painéis de destaque. */
export function AccentTop({ cor = 'var(--snow-primary)' }: { cor?: string }) {
  return <span aria-hidden style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 2, background: `linear-gradient(90deg, ${cor}, transparent 65%)` }} />;
}
