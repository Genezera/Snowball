import { motion } from 'framer-motion';
import { ChartFrame, type ChartDataState } from './ChartFrame';

export interface EstagioFunil { label: string; valor: number }

interface Props {
  estagios: EstagioFunil[] | null;
  state: ChartDataState;
}

/** Funil de rejeição — cada barra é proporcional ao estágio anterior, nunca ao maior valor absoluto (senão o degrau perde sentido visual). */
export function RejectionFunnel({ estagios, state }: Props) {
  const max = estagios?.[0]?.valor ?? 1;
  return (
    <ChartFrame title="Funil de rejeição" state={estagios?.length ? state : 'empty'} height={estagios ? estagios.length * 40 + 20 : 200}
      description="Funil mostrando quantas candidatas avançaram de observadas até lucrativas, e onde foram rejeitadas.">
      {estagios?.length && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {estagios.map((e, i) => {
            const pct = max > 0 ? (e.valor / max) * 100 : 0;
            const pctAnterior = i > 0 && estagios[i - 1].valor > 0 ? (e.valor / estagios[i - 1].valor) * 100 : 100;
            return (
              <div key={e.label} style={{ display: 'grid', gridTemplateColumns: '130px 1fr 90px', alignItems: 'center', gap: 10, fontSize: 'var(--text-xs)' }}>
                <span style={{ color: 'var(--ink-2)' }}>{e.label}</span>
                <div style={{ background: 'var(--surface-2)', borderRadius: 4, height: 20, overflow: 'hidden' }}>
                  <motion.div
                    initial={{ width: 0 }} animate={{ width: `${pct}%` }} transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
                    style={{ height: '100%', background: 'var(--brass-500)', borderRadius: 4 }}
                  />
                </div>
                <span className="tabular" style={{ color: 'var(--ink-1)', fontWeight: 700 }}>
                  {e.valor.toLocaleString('pt-BR')} {i > 0 && <span style={{ color: 'var(--ink-3)', fontWeight: 400 }}>({pctAnterior.toFixed(0)}%)</span>}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </ChartFrame>
  );
}
