import { useMemo } from 'react';
import { useLiveStore } from '../stores/liveStore';
import { PageHeader, Section, DataTable, StatusBadge, RankBar, fmt, type Coluna } from '../components/ui/kit';
import { MetricCard } from '../components/cards/MetricCard';
import { DataStateBanner } from '../components/feedback/DataState';

/**
 * PORTFOLIO — exposição agregada do CHAMPION (dinheiro simulado real).
 * O capital virtual dos challengers aparece SEPARADO e NUNCA é somado ao
 * patrimônio real (aviso permanente). Exposição por ativo, por exchange e
 * por direção vem das posições abertas.
 */
export function Portfolio() {
  const champion = useLiveStore((s) => s.champion);
  const profitLab = useLiveStore((s) => s.profitLab);
  const dado = champion?.estado === 'sucesso' ? champion.dado : null;
  const est = dado?.estado ?? null;
  const marc = dado?.marcacao as { equityMark?: number; equityLiquidacao?: number; custoEstimadoFechamentoTotal?: number } | null;
  const posicoes = dado?.posicoes ?? [];
  const resumo = profitLab?.estado === 'sucesso' ? profitLab.dado.resumo : null;

  const porAtivo = useMemo(() => {
    const m = new Map<string, { notional: number; funding: number }>();
    for (const p of posicoes) {
      const sym = p.symbol.replace('/USDT:USDT', '');
      const cur = m.get(sym) ?? { notional: 0, funding: 0 };
      cur.notional += (p.notionalPorPerna ?? 0) * 2;
      cur.funding += p.fundingAcumulado ?? 0;
      m.set(sym, cur);
    }
    return [...m.entries()].map(([sym, v]) => ({ sym, ...v })).sort((a, b) => b.notional - a.notional);
  }, [posicoes]);

  const notionalTotal = porAtivo.reduce((s, a) => s + a.notional, 0);
  const maxNot = Math.max(1, ...porAtivo.map((a) => a.notional));

  const colAtivo: Coluna<{ sym: string; notional: number; funding: number }>[] = [
    { chave: 'sym', titulo: 'Ativo', render: (a) => <span style={{ fontWeight: 700, color: 'var(--ink-0)' }}>{a.sym}</span> },
    { chave: 'not', titulo: 'Notional (2 pernas)', alinhar: 'right', render: (a) => fmt.usd(a.notional) },
    { chave: 'bar', titulo: '', largura: '140px', render: (a) => <RankBar valor={a.notional} max={maxNot} tom="info" /> },
    { chave: 'fund', titulo: 'Funding acum.', alinhar: 'right', render: (a) => <span style={{ color: 'var(--gain-500)' }}>{fmt.usd(a.funding)}</span> },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-5)' }}>
      <PageHeader titulo="Portfolio" sub="Exposição agregada do Champion — dinheiro simulado real. O capital virtual dos challengers é mostrado à parte e nunca somado a este patrimônio." />
      {champion?.estado === 'erro' && <DataStateBanner kind="offline" motivo={champion.motivo} />}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(190px, 100%), 1fr))', gap: 'var(--space-3)' }}>
        <MetricCard label="Capital realizado" value={est?.capital ?? null} formatar={fmt.usd} destaque sub="champion — real simulado" />
        <MetricCard label="Equity mark" value={marc?.equityMark ?? null} formatar={fmt.usd} />
        <MetricCard label="Equity liquidação" value={marc?.equityLiquidacao ?? null} formatar={fmt.usd} />
        <MetricCard label="Notional exposto" value={notionalTotal} formatar={fmt.usd} sub={`${posicoes.length} posições · ${porAtivo.length} ativos`} />
        <MetricCard label="Custo estimado de fechamento" value={marc?.custoEstimadoFechamentoTotal ?? null} formatar={fmt.usd} tone="warn" sub="estimativa, não somada ao realizado" />
      </div>

      <Section titulo="Capital virtual dos challengers — SEPARADO" style={{ borderColor: 'var(--warn-500)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
          <div className="tabular" style={{ fontSize: 'var(--text-2xl)', fontWeight: 800, color: 'var(--snow-violet)' }}>{fmt.usd(resumo?.capitalVirtualTotal ?? null)}</div>
          <StatusBadge label="PAPER · não é capital real ou disponível" tom="violet" />
        </div>
        <p style={{ fontSize: 'var(--text-2xs)', color: 'var(--warn-500)', margin: 0 }}>Soma de {fmt.int(resumo?.numeroChallengers)} carteiras paper independentes. Nunca representa dinheiro real nem é somado ao patrimônio do Champion.</p>
      </Section>

      <Section titulo="Exposição por ativo" sub="Notional agregado (as duas pernas) e funding acumulado, por ativo das posições abertas.">
        {porAtivo.length ? <DataTable aria="Exposição por ativo" colunas={colAtivo} linhas={porAtivo} chaveLinha={(a) => a.sym} />
          : <p style={{ color: 'var(--ink-3)', fontSize: 'var(--text-sm)' }}>Nenhuma posição aberta no momento.</p>}
      </Section>
    </div>
  );
}
