import { motion } from 'framer-motion';
import type { PosicaoChampion } from '../../schemas/champion';

function fmtUsd(n: number): string {
  const s = n < 0 ? '-' : '';
  return s + 'US$ ' + Math.abs(n).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function fmtPct(n: number): string { return (n * 100).toFixed(2) + '%'; }

/**
 * Uma posição do champion — as DUAS pernas, lado a lado. Todo campo vem
 * direto de `spread/estado.json` via `/api/dados` (`posicoes[]`), nunca
 * recalculado aqui — `distanciaMinima`/`spreadNaEntrada`/`fundingAcumulado`
 * já chegam prontos do backend.
 */
export function PositionLegCard({ p }: { p: PosicaoChampion }) {
  const risco = p.distanciaMinima < 0.15 ? 'var(--loss-500)' : p.distanciaMinima < 0.30 ? 'var(--warn-500)' : 'var(--gain-500)';
  return (
    <motion.div layout initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}
      style={{ background: 'var(--surface-1)', border: '1px solid var(--border-hairline)', borderRadius: 'var(--radius-lg)', padding: 'var(--space-4)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
        <span style={{ fontWeight: 700, fontSize: 'var(--text-base)' }}>{p.symbol.replace('/USDT:USDT', '')}</span>
        <span style={{ fontSize: 'var(--text-2xs)', color: 'var(--ink-3)' }}>{p.horasAberta.toFixed(1)}h aberta</span>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr auto 1fr', alignItems: 'center', gap: 10, marginBottom: 12 }}>
        <div style={{ textAlign: 'center', padding: '8px', background: 'var(--surface-2)', borderRadius: 8 }}>
          <div style={{ fontSize: 'var(--text-2xs)', color: 'var(--ink-3)', textTransform: 'uppercase' }}>Short</div>
          <div style={{ fontWeight: 700 }}>{p.exchangeShort}</div>
          {p.precoAoVivoShort != null && <div className="tabular" style={{ fontSize: 'var(--text-2xs)', color: 'var(--ink-2)' }}>{fmtUsd(p.precoAoVivoShort)}</div>}
        </div>
        <svg width="22" height="14" viewBox="0 0 22 14" aria-hidden>
          <path d="M1 7h20M15 2l6 5-6 5" fill="none" stroke="var(--brass-300)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <div style={{ textAlign: 'center', padding: '8px', background: 'var(--surface-2)', borderRadius: 8 }}>
          <div style={{ fontSize: 'var(--text-2xs)', color: 'var(--ink-3)', textTransform: 'uppercase' }}>Long</div>
          <div style={{ fontWeight: 700 }}>{p.exchangeLong}</div>
          {p.precoAoVivoLong != null && <div className="tabular" style={{ fontSize: 'var(--text-2xs)', color: 'var(--ink-2)' }}>{fmtUsd(p.precoAoVivoLong)}</div>}
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, fontSize: 'var(--text-xs)' }}>
        <div><div style={{ color: 'var(--ink-3)' }}>Notional/perna</div><div className="tabular">{fmtUsd(p.notionalPorPerna)}</div></div>
        <div><div style={{ color: 'var(--ink-3)' }}>Spread na entrada</div><div className="tabular">{fmtPct(p.spreadNaEntrada)}</div></div>
        <div><div style={{ color: 'var(--ink-3)' }}>Funding acumulado</div><div className="tabular" style={{ color: 'var(--gain-500)' }}>{fmtUsd(p.fundingAcumulado)}</div></div>
        <div><div style={{ color: 'var(--ink-3)' }}>Pagamentos</div><div className="tabular">{p.pagamentos}</div></div>
        <div><div style={{ color: 'var(--ink-3)' }}>Distância liquidação</div><div className="tabular" style={{ color: risco, fontWeight: 700 }}>{fmtPct(p.distanciaMinima)}</div></div>
        <div><div style={{ color: 'var(--ink-3)' }}>Perna em risco</div><div>{p.pernaEmRisco}</div></div>
      </div>
    </motion.div>
  );
}
