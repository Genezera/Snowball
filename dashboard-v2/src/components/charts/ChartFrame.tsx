import { type ReactNode } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { Skeleton, EmptyIllustration, DataStateBanner } from '../feedback/DataState';
import { pageEnter } from '../../theme/motion';

export type ChartDataState = 'loading' | 'empty' | 'partial' | 'stale' | 'corrupted' | 'error' | 'success';

interface Props {
  title: string;
  subtitle?: string;
  state: ChartDataState;
  motivo?: string;
  idadeMs?: number;
  /** descrição textual pra leitor de tela — todo gráfico precisa de uma, mesmo tendo tooltip visual */
  description: string;
  height?: number;
  children: ReactNode;
  actions?: ReactNode;
}

/**
 * Casca comum de TODO gráfico do Dashboard 2.0 — trata os 7 estados de
 * dado de forma idêntica em qualquer lugar que apareça, então nenhuma
 * página reimplementa "o que mostrar quando não tem dado ainda". Nunca
 * desenha um gráfico vazio como se fosse zero: `empty` é uma ilustração,
 * não um eixo sem barras.
 */
export function ChartFrame({ title, subtitle, state, motivo, idadeMs, description, height = 260, children, actions }: Props) {
  const reduceMotion = useReducedMotion();
  return (
    <motion.section
      variants={reduceMotion ? undefined : pageEnter} initial="hidden" animate="visible"
      aria-label={title}
      style={{
        background: 'var(--surface-glass)', backdropFilter: 'blur(14px)', border: '1px solid var(--border-hairline)',
        borderRadius: 'var(--radius-lg)', padding: 'var(--space-5)', display: 'flex', flexDirection: 'column', gap: 'var(--space-3)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 'var(--space-3)' }}>
        <div>
          <h3 style={{ margin: 0, fontSize: 'var(--text-sm)', fontWeight: 700, color: 'var(--ink-1)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>{title}</h3>
          {subtitle && <p style={{ margin: '2px 0 0', fontSize: 'var(--text-xs)', color: 'var(--ink-3)' }}>{subtitle}</p>}
        </div>
        {actions}
      </div>

      <span className="sr-only" style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0,0,0,0)' }}>{description}</span>

      {state === 'stale' && <DataStateBanner kind="stale" idadeMs={idadeMs} />}
      {state === 'corrupted' && <DataStateBanner kind="corrupted" motivo={motivo} />}
      {state === 'error' && <DataStateBanner kind="error" motivo={motivo} />}
      {state === 'partial' && <DataStateBanner kind="stale" motivo={motivo ?? 'dado parcial — parte da série não está disponível'} />}

      {state === 'loading' && <Skeleton height={height} />}
      {state === 'empty' && <div style={{ minHeight: height, display: 'flex', alignItems: 'center', justifyContent: 'center' }}><EmptyIllustration label="Sem dados suficientes" /></div>}
      {(state === 'success' || state === 'stale' || state === 'partial') && <div style={{ height }}>{children}</div>}
      {state === 'error' && <div style={{ minHeight: height / 2 }} />}
      {state === 'corrupted' && <div style={{ minHeight: height / 2 }} />}
    </motion.section>
  );
}
