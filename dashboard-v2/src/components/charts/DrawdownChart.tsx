import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, ReferenceLine } from 'recharts';
import { ChartFrame, type ChartDataState } from './ChartFrame';

interface Props {
  pontos: { ts: number; valor: number }[] | null; // valor = capital naquele instante
  state: ChartDataState;
}

function fmtHora(ts: number): string { return new Date(ts).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }); }

/** Underwater chart — % abaixo do pico até então, sempre ≤ 0. Calculado no cliente (é só um running-max sobre dado já real, não uma métrica financeira nova). */
function paraUnderwater(pontos: { ts: number; valor: number }[]): { ts: number; drawdownPct: number }[] {
  let pico = -Infinity;
  return pontos.map((p) => {
    pico = Math.max(pico, p.valor);
    const drawdownPct = pico > 0 ? ((p.valor - pico) / pico) * 100 : 0;
    return { ts: p.ts, drawdownPct };
  });
}

export function DrawdownChart({ pontos, state }: Props) {
  const serie = pontos && pontos.length >= 2 ? paraUnderwater(pontos) : null;
  return (
    <ChartFrame title="Drawdown (underwater)" state={serie ? state : 'empty'} height={180}
      description="Percentual abaixo do pico histórico de equity, ao longo do tempo.">
      {serie && (
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={serie}>
            <CartesianGrid stroke="var(--border-hairline)" vertical={false} />
            <XAxis dataKey="ts" tickFormatter={fmtHora} stroke="var(--ink-3)" fontSize={10} tickLine={false} axisLine={false} />
            <YAxis stroke="var(--ink-3)" fontSize={10} tickLine={false} axisLine={false} width={44} tickFormatter={(v) => v.toFixed(1) + '%'} />
            <ReferenceLine y={0} stroke="var(--border-subtle)" />
            <Tooltip formatter={(v: unknown) => [Number(v).toFixed(3) + '%', 'Drawdown']} labelFormatter={(l: unknown) => fmtHora(Number(l))}
              contentStyle={{ background: 'var(--surface-2)', border: '1px solid var(--border-subtle)', borderRadius: 8, fontSize: 12 }} />
            <Area type="monotone" dataKey="drawdownPct" stroke="var(--loss-500)" fill="var(--loss-glow)" strokeWidth={1.6} isAnimationActive={false} />
          </AreaChart>
        </ResponsiveContainer>
      )}
    </ChartFrame>
  );
}
