import { useMemo } from 'react';
import { useLiveStore } from '../stores/liveStore';
import { PageHeader, Section, DataTable, StatusBadge, fmt, type Coluna } from '../components/ui/kit';
import { MetricCard } from '../components/cards/MetricCard';
import { DataStateBanner } from '../components/feedback/DataState';
import type { LinhaMultiStrategy } from '../schemas/multiStrategy';

/**
 * EXPERIMENT LAB (Paper Profit Lab) — a superfície dos experimentos paper.
 * Read-only: NENHUM controle de promover, pausar, duplicar ou alterar
 * estratégia (esses ficam só no dashboard legado até haver arquitetura
 * segura). Mostra os experimentos ativos, capital virtual, PnL e as
 * hipóteses por família.
 */
const HIPOTESES: Record<string, string> = {
  'momentum': 'Momentum time-series captura tendência de curto prazo; diversifica o risco de ruína junto com pares (Resultado 14).',
  'pairs': 'Arbitragem estatística de pares cointegrados — reversão à média, market-neutral, diversificação.',
  'capture': 'Captura isolada de settlement em janelas curtas (5–60 min) — testa se o funding capturado paga o custo de round-trip.',
};

export function ExperimentLab() {
  const profitLab = useLiveStore((s) => s.profitLab);
  const dado = profitLab?.estado === 'sucesso' ? profitLab.dado : null;
  const resumo = dado?.resumo ?? null;

  const experimentos = useMemo<LinhaMultiStrategy[]>(() => {
    const linhas = dado?.leaderboardMulti?.linhas ?? [];
    return linhas.filter((l) => l.familia === 'momentum' || l.familia === 'pairs' || l.strategyId.startsWith('capture-isolated'))
      .sort((a, b) => b.pnlDesdeOInicio - a.pnlDesdeOInicio);
  }, [dado]);

  const colunas: Coluna<LinhaMultiStrategy>[] = [
    { chave: 'id', titulo: 'Experimento', render: (l) => <span style={{ fontWeight: 700, color: 'var(--ink-0)' }}>{l.strategyId}</span> },
    { chave: 'fam', titulo: 'Família', render: (l) => <StatusBadge label={l.familia} tom="violet" /> },
    { chave: 'cap', titulo: 'Capital virtual', alinhar: 'right', render: (l) => fmt.usd(l.capitalVirtual) },
    { chave: 'pnl', titulo: 'PnL', alinhar: 'right', render: (l) => <span style={{ color: fmt.corPnl(l.pnlDesdeOInicio), fontWeight: 700 }}>{fmt.usd(l.pnlDesdeOInicio)}</span> },
    { chave: 'dias', titulo: 'Rodando', alinhar: 'right', render: (l) => fmt.dias(l.diasRodando) },
    { chave: 'estado', titulo: 'Estado', alinhar: 'center', render: (l) => <StatusBadge label={l.disponivel ? 'ativo' : 'inativo'} tom={l.disponivel ? 'ok' : 'neutral'} /> },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-5)' }}>
      <PageHeader titulo="Experiment Lab" sub="Paper Profit Lab — laboratório de experimentos com capital 100% virtual. Read-only: nenhum controle de promoção, pausa ou alteração de estratégia — são controles de ESCRITA, não migrados ao Snowball Dashboard read-only (auditados em docs/controles-legado.md)." />
      {profitLab?.estado === 'erro' && <DataStateBanner kind="offline" motivo={profitLab.motivo} />}
      {profitLab?.estado === 'corrompido' && <DataStateBanner kind="corrupted" motivo={profitLab.motivo} />}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(180px, 100%), 1fr))', gap: 'var(--space-3)' }}>
        <MetricCard label="Capital virtual agregado" value={resumo?.capitalVirtualTotal ?? null} formatar={fmt.usd} destaque sub="paper — nunca real" />
        <MetricCard label="Challengers ativos" value={resumo?.numeroAtivos ?? null} formatar={fmt.int} sub={resumo ? `${resumo.numeroPausados} pausados · ${resumo.numeroEliminados} eliminados` : undefined} />
        <MetricCard label="Trades paper" value={resumo?.tradesTotaisPaper ?? null} formatar={fmt.int} />
        <MetricCard label="Settlements paper" value={resumo?.settlementsTotaisPaper ?? null} formatar={fmt.int} />
      </div>

      <Section titulo="Experimentos não-funding (momentum, pares, captura)" sub="Estas famílias existem para diversificação e teste de hipótese, não para lucro isolado.">
        {experimentos.length
          ? <DataTable aria="Experimentos" colunas={colunas} linhas={experimentos} chaveLinha={(l) => l.strategyId} />
          : <p style={{ color: 'var(--ink-3)', fontSize: 'var(--text-sm)' }}>Sem experimentos não-funding no leaderboard atual.</p>}
      </Section>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(280px, 100%), 1fr))', gap: 'var(--space-4)' }}>
        {['momentum', 'pairs', 'capture'].map((fam) => (
          <Section key={fam} titulo={`Hipótese · ${fam}`}>
            <p style={{ fontSize: 'var(--text-sm)', color: 'var(--ink-2)', lineHeight: 1.6, margin: 0 }}>{HIPOTESES[fam]}</p>
          </Section>
        ))}
      </div>
    </div>
  );
}
