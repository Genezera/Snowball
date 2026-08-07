import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';
import { ChartFrame, type ChartDataState } from './ChartFrame';

export interface PontoEquity { ts: number; valor: number }

interface Props {
  titulo: string;
  pontos: PontoEquity[] | null;
  state: ChartDataState;
  cor?: string;
  motivo?: string;
  idadeMs?: number;
}

function fmtHora(ts: number): string {
  return new Date(ts).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}
function fmtUsd(n: number): string {
  return 'US$ ' + n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function TooltipCustom({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div style={{ background: 'var(--surface-2)', border: '1px solid var(--border-subtle)', borderRadius: 8, padding: '8px 12px', fontSize: 12 }}>
      <div style={{ color: 'var(--ink-3)', marginBottom: 2 }}>{fmtHora(label)}</div>
      <div className="tabular" style={{ color: 'var(--ink-0)', fontWeight: 700 }}>{fmtUsd(payload[0].value)}</div>
    </div>
  );
}

/** Curva de equity — serve pra mark e pra liquidação, mudando só a fonte de `pontos` e a cor. */
export function EquityCurve({ titulo, pontos, state, cor = 'var(--brass-300)', motivo, idadeMs }: Props) {
  return (
    <ChartFrame title={titulo} state={pontos && pontos.length < 2 ? 'empty' : state} motivo={motivo} idadeMs={idadeMs}
      description={`Curva de equity ao longo do tempo — ${pontos?.length ?? 0} pontos observados.`}>
      {pontos && pontos.length >= 2 && (
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={pontos.map((p) => ({ ts: p.ts, valor: p.valor }))}>
            <defs>
              <linearGradient id="equity-fill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={cor} stopOpacity={0.28} />
                <stop offset="100%" stopColor={cor} stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid stroke="var(--border-hairline)" vertical={false} />
            <XAxis dataKey="ts" tickFormatter={fmtHora} stroke="var(--ink-3)" fontSize={10} tickLine={false} axisLine={false} />
            <YAxis stroke="var(--ink-3)" fontSize={10} tickLine={false} axisLine={false} domain={['auto', 'auto']} width={64} tickFormatter={(v) => fmtUsd(v)} />
            <Tooltip content={<TooltipCustom />} />
            <Area type="monotone" dataKey="valor" stroke={cor} strokeWidth={2} fill="url(#equity-fill)" isAnimationActive={false} />
          </AreaChart>
        </ResponsiveContainer>
      )}
    </ChartFrame>
  );
}
