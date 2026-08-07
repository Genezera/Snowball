import { useLiveStore } from '../stores/liveStore';
import { PageHeader, Section, DataTable, fmt, type Coluna } from '../components/ui/kit';
import { EquityCurve } from '../components/charts/EquityCurve';
import type { ChartDataState } from '../components/charts/ChartFrame';
import { DataStateBanner } from '../components/feedback/DataState';

/**
 * HISTÓRICO — análise temporal read-only do Champion: curva de capital e
 * funding recebido por dia. Não mistura janelas incompatíveis — mostra a
 * série vitalícia do champion (dinheiro real simulado), rotulada como tal.
 */
export function Historico() {
  const champion = useLiveStore((s) => s.champion);
  const dado = champion?.estado === 'sucesso' ? champion.dado : null;
  const curva = dado?.curva ?? [];
  const pagamentos = (dado?.pagamentosPorDia ?? []) as { dia: string; total: number }[];

  const chartState: ChartDataState = champion?.estado === 'sucesso' ? 'success' : champion?.estado === 'corrompido' ? 'corrupted' : champion?.estado === 'erro' ? 'error' : 'loading';
  const pontos = curva.map((p) => ({ ts: p.ts, valor: p.capital }));

  const totalFunding = pagamentos.reduce((s, p) => s + p.total, 0);
  const maxDia = Math.max(0, ...pagamentos.map((p) => p.total));

  const colunas: Coluna<{ dia: string; total: number }>[] = [
    { chave: 'dia', titulo: 'Dia', render: (p) => <span style={{ fontWeight: 700 }}>{p.dia}</span> },
    { chave: 'total', titulo: 'Funding recebido', alinhar: 'right', render: (p) => <span style={{ color: 'var(--gain-500)', fontWeight: 700 }}>{fmt.usd(p.total)}</span> },
    { chave: 'bar', titulo: '', render: (p) => (
      <div style={{ height: 6, borderRadius: 99, background: 'rgba(255,255,255,0.05)', overflow: 'hidden' }}>
        <div style={{ height: '100%', width: `${maxDia ? (p.total / maxDia * 100) : 0}%`, background: 'var(--gain-500)', boxShadow: '0 0 8px var(--gain-glow)' }} />
      </div>
    ) },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-5)' }}>
      <PageHeader titulo="Histórico" sub="Análise temporal do Champion (dinheiro simulado real). Série vitalícia — nunca misturada com janelas de comparação dos challengers." />
      {champion?.estado === 'erro' && <DataStateBanner kind="offline" motivo={champion.motivo} />}

      <Section titulo="Curva de capital (vitalícia)">
        <div style={{ height: 320 }}>
          <EquityCurve titulo="" pontos={pontos.length ? pontos : null} state={chartState} cor="var(--snow-primary)" />
        </div>
      </Section>

      <Section titulo="Funding recebido por dia" sub={`Total no período: ${fmt.usd(totalFunding)} em ${pagamentos.length} dia(s).`}>
        {pagamentos.length
          ? <DataTable aria="Funding por dia" colunas={colunas} linhas={[...pagamentos].reverse()} chaveLinha={(p) => p.dia} />
          : <p style={{ color: 'var(--ink-3)', fontSize: 'var(--text-sm)' }}>Sem série diária de funding disponível ainda.</p>}
      </Section>
    </div>
  );
}
