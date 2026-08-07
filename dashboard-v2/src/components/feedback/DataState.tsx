/**
 * Todo componente que mostra dado real passa por aqui — nunca renderiza
 * "0" ou um card vazio como se fosse valor conhecido. Cobre os 8 estados
 * pedidos: loading/success/empty/stale/partial/corrupted/error/offline.
 */
import type { ReactNode } from 'react';
import { motion } from 'framer-motion';

export type DataStateKind = 'loading' | 'empty' | 'stale' | 'corrupted' | 'error' | 'offline';

interface Props {
  kind: DataStateKind;
  motivo?: string;
  idadeMs?: number | null;
  origem?: string;
}

const COPY: Record<DataStateKind, { titulo: string; cor: string }> = {
  loading: { titulo: 'Carregando…', cor: 'var(--ink-2)' },
  empty: { titulo: 'Sem dados suficientes', cor: 'var(--ink-2)' },
  stale: { titulo: 'DADO ANTIGO — EXIBINDO ÚLTIMO SNAPSHOT VÁLIDO', cor: 'var(--warn-500)' },
  corrupted: { titulo: 'Dado corrompido — schema não bateu', cor: 'var(--loss-500)' },
  error: { titulo: 'Falha ao carregar', cor: 'var(--loss-500)' },
  offline: { titulo: 'Sem conexão com o servidor', cor: 'var(--loss-500)' },
};

function fmtIdade(ms: number): string {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s atrás`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}min atrás`;
  return `${Math.round(m / 60)}h atrás`;
}

export function DataStateBanner({ kind, motivo, idadeMs, origem }: Props) {
  const c = COPY[kind];
  return (
    <motion.div
      initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.18 }}
      role="status"
      style={{
        display: 'flex', alignItems: 'center', gap: 'var(--space-2)',
        padding: 'var(--space-2) var(--space-3)', borderRadius: 'var(--radius-sm)',
        background: 'var(--surface-2)', border: `1px solid ${c.cor}33`, color: c.cor,
        fontSize: 'var(--text-xs)', fontWeight: 700, letterSpacing: '0.02em',
      }}
    >
      <span aria-hidden style={{ width: 6, height: 6, borderRadius: '50%', background: c.cor, flex: 'none' }} />
      <span>{c.titulo}</span>
      {motivo && <span style={{ color: 'var(--ink-3)', fontWeight: 500 }}>· {motivo}</span>}
      {idadeMs != null && <span style={{ color: 'var(--ink-3)', fontWeight: 500 }}>· {fmtIdade(idadeMs)}</span>}
      {origem && <span style={{ color: 'var(--ink-3)', fontWeight: 500 }}>· origem: {origem}</span>}
    </motion.div>
  );
}

/** Skeleton loader — nunca um número, nunca "0", só forma. */
export function Skeleton({ width = '100%', height = 16 }: { width?: string | number; height?: number }) {
  return (
    <div
      aria-hidden
      style={{
        width, height, borderRadius: 6, background: 'linear-gradient(90deg, var(--surface-2), var(--surface-3), var(--surface-2))',
        backgroundSize: '200% 100%', animation: 'skeleton-sweep 1.6s ease-in-out infinite',
      }}
    />
  );
}

export function EmptyIllustration({ label, children }: { label: string; children?: ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 'var(--space-3)', padding: 'var(--space-10) var(--space-4)', color: 'var(--ink-3)' }}>
      <svg width="56" height="56" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.2" opacity="0.5">
        <circle cx="12" cy="12" r="9" strokeDasharray="2 3" />
        <path d="M9 12h6" strokeLinecap="round" />
      </svg>
      <span style={{ fontSize: 'var(--text-sm)' }}>{label}</span>
      {children}
    </div>
  );
}
