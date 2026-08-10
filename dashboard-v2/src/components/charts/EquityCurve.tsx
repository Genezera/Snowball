import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, ReferenceDot } from 'recharts';
import { ChartFrame, type ChartDataState } from './ChartFrame';

export interface PontoEquity { ts: number; valor: number }
export interface MarcadorEquity { ts: number; valor: number; tipo: 'abre' | 'fecha'; motivo?: string | null; symbol?: string }

interface Props {
  titulo: string;
  pontos: PontoEquity[] | null;
  state: ChartDataState;
  cor?: string;
  motivo?: string;
  idadeMs?: number;
  /** altura da ÁREA do gráfico (px). O card ainda soma cabeçalho/padding — não envolva em div de altura fixa. */
  height?: number;
  /** 'usd' (padrão, curva de capital) ou 'pct' (série de APR/spread por posição). */
  unidade?: 'usd' | 'pct';
  /** eventos abre/fecha pra marcar na curva — opcional, só a curva principal usa. */
  marcadores?: MarcadorEquity[];
}

function fmtHora(ts: number): string {
  return new Date(ts).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}
function fmtUsd(n: number): string {
  return 'US$ ' + n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function fmtPct(n: number): string {
  return n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + '%';
}

function TooltipCustom({ active, payload, label, unidade }: any) {
  if (!active || !payload?.length) return null;
  const fmt = unidade === 'pct' ? fmtPct : fmtUsd;
  return (
    <div style={{ background: 'var(--surface-2)', border: '1px solid var(--border-subtle)', borderRadius: 8, padding: '8px 12px', fontSize: 12 }}>
      <div style={{ color: 'var(--ink-3)', marginBottom: 2 }}>{fmtHora(label)}</div>
      <div className="tabular" style={{ color: 'var(--ink-0)', fontWeight: 700 }}>{fmt(payload[0].value)}</div>
    </div>
  );
}

/** Curva de equity/APR — serve pra mark, pra liquidação e pro APR por posição, mudando a fonte de `pontos`, a cor e a `unidade`. */
export function EquityCurve({ titulo, pontos, state, cor = 'var(--brass-300)', motivo, idadeMs, height = 260, unidade = 'usd', marcadores }: Props) {
  const fmt = unidade === 'pct' ? fmtPct : fmtUsd;
  return (
    <ChartFrame title={titulo} state={pontos && pontos.length < 2 ? 'empty' : state} motivo={motivo} idadeMs={idadeMs} height={height}
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
            <YAxis stroke="var(--ink-3)" fontSize={10} tickLine={false} axisLine={false} domain={['auto', 'auto']} width={64} tickFormatter={(v) => fmt(v)} />
            <Tooltip content={<TooltipCustom unidade={unidade} />} />
            <Area type="monotone" dataKey="valor" stroke={cor} strokeWidth={2} fill="url(#equity-fill)" isAnimationActive={false} />
            {marcadores?.map((m, i) => (
              <ReferenceDot key={i} x={m.ts} y={m.valor} r={4}
                fill={m.tipo === 'abre' ? 'var(--gain-500)' : 'var(--loss-500)'} stroke="var(--surface-1)" strokeWidth={1}
              />
            ))}
          </AreaChart>
        </ResponsiveContainer>
      )}
    </ChartFrame>
  );
}
