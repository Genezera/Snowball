import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell, LabelList } from 'recharts';
import { ChartFrame, type ChartDataState } from './ChartFrame';

export interface EtapaWaterfall { label: string; valor: number }

interface Props {
  titulo?: string;
  /** primeira etapa é sempre o funding bruto (positivo), as seguintes são deduções (negativas) — última é o resultado calculado, não somado aqui de novo */
  etapas: EtapaWaterfall[] | null;
  state: ChartDataState;
}

function fmtUsd(n: number): string {
  const s = n < 0 ? '-' : n > 0 ? '+' : '';
  return s + 'US$ ' + Math.abs(n).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/**
 * Waterfall de funding bruto até PnL líquido — o valor de CADA barra já vem
 * pronto do backend (decomposição de custo em 8 buckets, nunca somado duas
 * vezes). Este componente só desenha; não soma nem recalcula nada.
 */
export function PnLWaterfall({ titulo = 'Funding bruto até PnL líquido', etapas, state }: Props) {
  const dados = etapas?.length ? construirBases(etapas) : null;
  return (
    <ChartFrame title={titulo} state={dados ? state : 'empty'} height={280}
      description="Waterfall mostrando cada dedução de custo entre funding bruto e PnL líquido.">
      {dados && (
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={dados} margin={{ top: 20, right: 12, left: 0, bottom: 0 }}>
            <XAxis dataKey="label" stroke="var(--ink-3)" fontSize={10} tickLine={false} axisLine={false} interval={0} angle={-20} textAnchor="end" height={60} />
            <YAxis stroke="var(--ink-3)" fontSize={10} tickLine={false} axisLine={false} width={64} tickFormatter={fmtUsd} />
            <Tooltip
              formatter={(_: unknown, __: unknown, item: any) => [fmtUsd(item.payload.delta), item.payload.label]}
              contentStyle={{ background: 'var(--surface-2)', border: '1px solid var(--border-subtle)', borderRadius: 8, fontSize: 12 }}
            />
            <Bar dataKey="base" stackId="w" fill="transparent" isAnimationActive={false} />
            <Bar dataKey="delta" stackId="w" isAnimationActive={false} radius={[3, 3, 3, 3]}>
              {dados.map((d, i) => (
                <Cell key={i} fill={d.tipo === 'total' ? 'var(--brass-300)' : d.delta >= 0 ? 'var(--gain-500)' : 'var(--loss-500)'} />
              ))}
              <LabelList dataKey="delta" position="top" formatter={(v: unknown) => fmtUsd(Number(v))} style={{ fontSize: 10, fill: 'var(--ink-2)' }} />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      )}
    </ChartFrame>
  );
}

function construirBases(etapas: EtapaWaterfall[]) {
  let acumulado = 0;
  return etapas.map((e, i) => {
    const isTotal = i === etapas.length - 1;
    const base = isTotal ? 0 : Math.min(acumulado, acumulado + e.valor);
    if (!isTotal) acumulado += e.valor;
    return { label: e.label, base, delta: isTotal ? acumulado : e.valor, tipo: isTotal ? 'total' : 'etapa' as const };
  });
}
