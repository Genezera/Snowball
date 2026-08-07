import { motion } from 'framer-motion';
import type { ReactNode } from 'react';
import { AnimatedNumber } from './AnimatedNumber';
import { Skeleton } from '../feedback/DataState';

interface Props {
  label: string;
  value: number | null;
  formatar: (v: number) => string;
  sub?: string;
  tone?: 'neutral' | 'gain' | 'loss' | 'warn';
  icon?: ReactNode;
  /** destaque: métrica PRINCIPAL ganha borda/realce ciano mais forte */
  destaque?: boolean;
}

const TONE_COLOR: Record<string, string> = {
  neutral: 'var(--snow-text-primary)', gain: 'var(--gain-500)', loss: 'var(--loss-500)', warn: 'var(--warn-500)',
};
const TONE_GLOW: Record<string, string> = {
  neutral: 'rgba(23,217,255,0.10)', gain: 'var(--gain-glow)', loss: 'var(--loss-glow)', warn: 'var(--warn-glow)',
};

/**
 * KPI Snowball — vidro com borda ciano discreta, número grande em mono
 * tabular (fácil de escanear), contagem animada ao atualizar (AnimatedNumber
 * — sem piscar) e leve elevação no hover. Herdado da personalidade do
 * dashboard antigo (`.kpi`/`.card`), não um bloco genérico.
 */
export function MetricCard({ label, value, formatar, sub, tone = 'neutral', icon, destaque = false }: Props) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.28, ease: [0.2, 0.7, 0.2, 1] }}
      whileHover={{ y: -2, borderColor: 'var(--border-strong)' }}
      style={{
        background: destaque
          ? 'linear-gradient(180deg, rgba(23,217,255,0.06), var(--surface-glass))'
          : 'linear-gradient(180deg, var(--surface-glass), rgba(12,21,38,0.5))',
        backdropFilter: 'blur(14px)',
        border: `1px solid ${destaque ? 'var(--border-strong)' : 'var(--border-subtle)'}`,
        borderRadius: 'var(--radius-lg)', padding: 'var(--space-4) var(--space-5)',
        display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0, position: 'relative', overflow: 'hidden',
        boxShadow: destaque ? '0 0 24px -8px var(--snow-glow)' : 'none',
      }}
    >
      {/* fio de acento no topo — some no neutro sem destaque */}
      {(destaque || tone !== 'neutral') && (
        <span aria-hidden style={{
          position: 'absolute', top: 0, left: 0, right: 0, height: 2,
          background: `linear-gradient(90deg, ${TONE_GLOW[tone]}, transparent 70%)`,
        }} />
      )}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <span style={{ fontSize: 'var(--text-2xs)', fontWeight: 800, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--ink-2)' }}>{label}</span>
        {icon}
      </div>
      {value == null
        ? <Skeleton width={96} height={30} />
        : (
          <span className="tabular" style={{
            fontSize: destaque ? 'var(--text-3xl)' : 'var(--text-2xl)', fontWeight: 800,
            color: TONE_COLOR[tone], lineHeight: 1.05, letterSpacing: '-0.01em',
            textShadow: tone !== 'neutral' ? `0 0 18px ${TONE_GLOW[tone]}` : 'none',
          }}>
            <AnimatedNumber value={value} formatar={formatar} className="" />
          </span>
        )}
      {sub && <span style={{ fontSize: 'var(--text-xs)', color: 'var(--ink-3)', lineHeight: 1.4 }}>{sub}</span>}
    </motion.div>
  );
}
