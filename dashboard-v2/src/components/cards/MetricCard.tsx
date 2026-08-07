import { motion } from 'framer-motion';
import type { ReactNode } from 'react';
import { AnimatedNumber } from './AnimatedNumber';
import { Skeleton } from '../feedback/DataState';

interface Props {
  label: string;
  value: number | null;
  formatar: (v: number) => string;
  sub?: string;
  tone?: 'neutral' | 'gain' | 'loss';
  icon?: ReactNode;
}

const TONE_COLOR: Record<string, string> = { neutral: 'var(--ink-0)', gain: 'var(--gain-500)', loss: 'var(--loss-500)' };

export function MetricCard({ label, value, formatar, sub, tone = 'neutral', icon }: Props) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.24, ease: [0.16, 1, 0.3, 1] }}
      style={{
        background: 'var(--surface-glass)', backdropFilter: 'blur(14px)', border: '1px solid var(--border-hairline)',
        borderRadius: 'var(--radius-lg)', padding: 'var(--space-4) var(--space-5)',
        display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ fontSize: 'var(--text-2xs)', fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase', color: 'var(--ink-2)' }}>{label}</span>
        {icon}
      </div>
      {value == null
        ? <Skeleton width={96} height={26} />
        : (
          <span style={{ fontSize: 'var(--text-2xl)', fontWeight: 700, color: TONE_COLOR[tone], lineHeight: 1.1 }}>
            <AnimatedNumber value={value} formatar={formatar} className="" />
          </span>
        )}
      {sub && <span style={{ fontSize: 'var(--text-xs)', color: 'var(--ink-3)' }}>{sub}</span>}
    </motion.div>
  );
}
