import { useMemo } from 'react';
import { useLiveStore } from '../stores/liveStore';
import { useEventosRecentes } from '../hooks/useEventosRecentes';
import { PageHeader, Section, DataTable, StatusBadge, RankBar, fmt, type Coluna } from '../components/ui/kit';

/**
 * OPPORTUNITY MAP — oportunidades OBSERVADAS, nunca ordens. OBSERVATION
 * ONLY: esta superfície nunca executa nada. Os dados vêm do que a API V2
 * read-only expõe hoje: o resumo de vigilância (quantas oportunidades o
 * mercado tem sob observação) e a distribuição REAL dos motivos de bloqueio,
 * derivada dos eventos "bloqueado" do transporte. A tabela por-candidato
 * detalhada (spread/APR/liquidez individuais) depende de um endpoint
 * read-only de candidatas ainda não exposto — marcado honestamente, nunca
 * preenchido com dado fabricado.
 */
export function OpportunityMap() {
  const champion = useLiveStore((s) => s.champion);
  const { eventos } = useEventosRecentes();
  const vig = champion?.estado === 'sucesso' ? (champion.dado as { vigilancia?: { candidatos?: number; varreduras?: number; vivas?: number; fonte?: string; motivo?: string } }).vigilancia : null;

  const motivosBloqueio = useMemo(() => {
    const m = new Map<string, number>();
    for (const e of eventos) {
      if (e.evento !== 'bloqueado' || !e.motivo) continue;
      const chave = e.motivo.replace(/[0-9]+([.,][0-9]+)?/g, 'N').split('·')[0].trim().slice(0, 48);
      m.set(chave, (m.get(chave) ?? 0) + 1);
    }
    return [...m.entries()].map(([motivo, n]) => ({ motivo, n })).sort((a, b) => b.n - a.n).slice(0, 12);
  }, [eventos]);

  const maxN = Math.max(1, ...motivosBloqueio.map((m) => m.n));
  const totalBloqueios = motivosBloqueio.reduce((s, m) => s + m.n, 0);

  const colunas: Coluna<{ motivo: string; n: number }>[] = [
    { chave: 'motivo', titulo: 'Motivo de bloqueio', render: (m) => <span style={{ color: 'var(--ink-1)', whiteSpace: 'normal' }}>{m.motivo}</span> },
    { chave: 'n', titulo: 'Ocorrências', alinhar: 'right', render: (m) => <span className="tabular" style={{ fontWeight: 700 }}>{fmt.int(m.n)}</span> },
    { chave: 'bar', titulo: '', largura: '160px', render: (m) => <RankBar valor={m.n} max={maxN} tom="warn" /> },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-5)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', flexWrap: 'wrap' }}>
        <PageHeader titulo="Opportunity Map" sub="Oportunidades observadas pelo motor — nunca ordens. Vigilância do mercado inteiro e por que as candidatas são barradas." />
        <StatusBadge label="OBSERVATION ONLY" tom="info" />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(180px, 100%), 1fr))', gap: 'var(--space-3)' }}>
        <MiniOp label="Candidatas sob observação" valor={fmt.int(vig?.candidatos)} tom="info" />
        <MiniOp label="Varreduras" valor={fmt.int(vig?.varreduras)} />
        <MiniOp label="Oportunidades vivas" valor={fmt.int(vig?.vivas)} tom="ok" />
        <MiniOp label="Bloqueios na janela" valor={fmt.int(totalBloqueios)} tom="warn" />
      </div>

      {vig?.motivo && (
        <Section titulo="Vigilância de mercado">
          <p style={{ fontSize: 'var(--text-sm)', color: 'var(--ink-2)', margin: 0 }}>{vig.fonte} — {vig.motivo}</p>
        </Section>
      )}

      <Section titulo="Por que as oportunidades são barradas" sub="Distribuição real dos motivos de bloqueio, agregada dos eventos do transporte. A conta de EV/payback é a mesma que o portão real usa.">
        {motivosBloqueio.length
          ? <DataTable aria="Motivos de bloqueio" colunas={colunas} linhas={motivosBloqueio} chaveLinha={(m) => m.motivo} />
          : <p style={{ color: 'var(--ink-3)', fontSize: 'var(--text-sm)' }}>Sem eventos de bloqueio na janela atual.</p>}
      </Section>

      <Section titulo="Tabela por-candidato detalhada" style={{ borderColor: 'var(--border-hairline)' }}>
        <p style={{ fontSize: 'var(--text-2xs)', color: 'var(--ink-3)', margin: 0, lineHeight: 1.6 }}>
          A tabela por-candidato (symbol · long/short · funding · spread · APR · persistência · payback · folga · liquidez · qualidade) depende de um endpoint read-only de candidatas que ainda não está exposto pela API V2 — a fonte existe nos diários, mas exporá-la é um item documentado da próxima sub-etapa. Nada é fabricado aqui: mostramos apenas o que a API já entrega.
        </p>
      </Section>
    </div>
  );
}

function MiniOp({ label, valor, tom = 'neutral' }: { label: string; valor: string; tom?: 'ok' | 'warn' | 'info' | 'neutral' }) {
  const cor = tom === 'ok' ? 'var(--gain-500)' : tom === 'warn' ? 'var(--warn-500)' : tom === 'info' ? 'var(--snow-accent)' : 'var(--ink-0)';
  return (
    <div style={{ background: 'var(--surface-glass)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-md)', padding: 'var(--space-4)' }}>
      <div style={{ fontSize: 'var(--text-2xs)', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--ink-2)' }}>{label}</div>
      <div className="tabular" style={{ fontSize: 'var(--text-xl)', fontWeight: 800, marginTop: 4, color: cor }}>{valor}</div>
    </div>
  );
}
