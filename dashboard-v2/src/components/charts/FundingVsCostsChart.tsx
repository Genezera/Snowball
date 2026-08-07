import { ComposedChart, Bar, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend } from 'recharts';
import { ChartFrame, type ChartDataState } from './ChartFrame';

export interface PontoFundingCustos { dia: string; funding: number; custos: number }

interface Props {
  pontos: PontoFundingCustos[] | null;
  state: ChartDataState;
}

function fmtUsd(n: number): string { return 'US$ ' + n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }

/** Funding recebido por dia (barra) vs. custo acumulado (linha) — dado já vem pronto do backend (pagamentosPorDia + custos/dashboard-aggregator), nunca recalculado aqui. */
export function FundingVsCostsChart({ pontos, state }: Props) {
  return (
    <ChartFrame title="Funding vs. custos" state={pontos?.length ? state : 'empty'} height={240}
      description="Funding recebido por dia comparado à tendência de custos acumulados.">
      {pontos?.length ? (
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={pontos}>
            <CartesianGrid stroke="var(--border-hairline)" vertical={false} />
            <XAxis dataKey="dia" stroke="var(--ink-3)" fontSize={10} tickLine={false} axisLine={false} />
            <YAxis stroke="var(--ink-3)" fontSize={10} tickLine={false} axisLine={false} width={64} tickFormatter={fmtUsd} />
            <Tooltip formatter={(v: unknown) => fmtUsd(Number(v))} contentStyle={{ background: 'var(--surface-2)', border: '1px solid var(--border-subtle)', borderRadius: 8, fontSize: 12 }} />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            <Bar dataKey="funding" name="Funding" fill="var(--gain-500)" radius={[3, 3, 0, 0]} isAnimationActive={false} />
            <Line type="monotone" dataKey="custos" name="Custos" stroke="var(--loss-500)" strokeWidth={2} dot={false} isAnimationActive={false} />
          </ComposedChart>
        </ResponsiveContainer>
      ) : null}
    </ChartFrame>
  );
}
