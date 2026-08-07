import { useMemo } from 'react';
import { useLiveStore } from '../stores/liveStore';
import { PageHeader, Section, DataTable, StatusBadge, RankBar, fmt, type Coluna } from '../components/ui/kit';
import { DataStateBanner } from '../components/feedback/DataState';
import type { LinhaMultiStrategy } from '../schemas/multiStrategy';

/**
 * STRATEGY UNIVERSE — catálogo de TODAS as estratégias (leaderboardMulti),
 * separado por categoria. Nunca cria ranking entre estratégias
 * incomparáveis: a coluna "janela" deixa explícito quem é comparável e o
 * PnL de quem está fora da janela comum vem marcado como tal.
 */
type Categoria = 'Champion' | 'Control' | 'Challengers' | 'Baselines' | 'Experiments';

function classificar(l: LinhaMultiStrategy): Categoria {
  if (l.familia === 'funding-champion') return 'Champion';
  if (l.familia === 'baseline') return 'Baselines';
  if (l.familia === 'momentum' || l.familia === 'pairs') return 'Experiments';
  if (/control|controle/i.test(l.strategyId)) return 'Control';
  return 'Challengers';
}

const ORDEM: Categoria[] = ['Champion', 'Control', 'Challengers', 'Baselines', 'Experiments'];
const COR_CAT: Record<Categoria, string> = {
  Champion: 'var(--engine-funding)', Control: 'var(--engine-baseline)', Challengers: 'var(--snow-accent)',
  Baselines: 'var(--engine-baseline)', Experiments: 'var(--engine-pairs)',
};

export function StrategyUniverse() {
  const profitLab = useLiveStore((s) => s.profitLab);
  const linhas = profitLab?.estado === 'sucesso' ? profitLab.dado.leaderboardMulti?.linhas ?? [] : [];

  const porCategoria = useMemo(() => {
    const m = new Map<Categoria, LinhaMultiStrategy[]>();
    for (const l of linhas) {
      const c = classificar(l);
      if (!m.has(c)) m.set(c, []);
      m.get(c)!.push(l);
    }
    for (const arr of m.values()) arr.sort((a, b) => b.pnlDesdeOInicio - a.pnlDesdeOInicio);
    return m;
  }, [linhas]);

  const maxPnl = Math.max(1, ...linhas.map((l) => Math.abs(l.pnlDesdeOInicio)));

  const colunas: Coluna<LinhaMultiStrategy>[] = [
    { chave: 'id', titulo: 'Estratégia', render: (l) => <span style={{ fontWeight: 700, color: 'var(--ink-0)' }}>{l.strategyId}</span> },
    { chave: 'cap', titulo: 'Capital virtual', alinhar: 'right', render: (l) => fmt.usd(l.capitalVirtual) },
    { chave: 'pnl', titulo: 'PnL', alinhar: 'right', render: (l) => <span style={{ color: fmt.corPnl(l.pnlDesdeOInicio), fontWeight: 700 }}>{fmt.usd(l.pnlDesdeOInicio)}</span> },
    { chave: 'pct', titulo: '%', alinhar: 'right', render: (l) => <span style={{ color: fmt.corPnl(l.pnlPct) }}>{fmt.pct(l.pnlPct)}</span> },
    { chave: 'bar', titulo: '', largura: '110px', render: (l) => <RankBar valor={l.pnlDesdeOInicio} max={maxPnl} tom={l.pnlDesdeOInicio >= 0 ? 'gain' : 'loss'} /> },
    { chave: 'dd', titulo: 'Drawdown', alinhar: 'right', render: (l) => fmt.pct(-Math.abs(l.drawdownMaxPct)) },
    { chave: 'dias', titulo: 'Rodando', alinhar: 'right', render: (l) => fmt.dias(l.diasRodando) },
    { chave: 'jan', titulo: 'Janela', alinhar: 'center', render: (l) => l.comparavelNaJanela ? <StatusBadge label="comparável" tom="info" /> : <StatusBadge label="fora" tom="neutral" /> },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-5)' }}>
      <PageHeader titulo="Strategy Universe" sub="Catálogo de todas as estratégias do laboratório, por categoria. Capital dos challengers é 100% virtual — nunca somado ao Champion. O ranking respeita a janela comum: quem está fora não é comparado diretamente." />

      {profitLab?.estado === 'erro' && <DataStateBanner kind="offline" motivo={profitLab.motivo} />}
      {profitLab?.estado === 'corrompido' && <DataStateBanner kind="corrupted" motivo={profitLab.motivo} />}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(180px, 100%), 1fr))', gap: 'var(--space-3)' }}>
        {ORDEM.map((cat) => {
          const arr = porCategoria.get(cat) ?? [];
          const pnl = arr.reduce((s, l) => s + l.pnlDesdeOInicio, 0);
          return (
            <div key={cat} style={{ position: 'relative', overflow: 'hidden', background: 'var(--surface-glass)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-md)', padding: 'var(--space-4)' }}>
              <span aria-hidden style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 2, background: `linear-gradient(90deg, ${COR_CAT[cat]}, transparent 70%)` }} />
              <div style={{ fontSize: 'var(--text-2xs)', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--ink-2)' }}>{cat}</div>
              <div className="tabular" style={{ fontSize: 'var(--text-xl)', fontWeight: 800, marginTop: 4 }}>{arr.length}</div>
              <div className="tabular" style={{ fontSize: 'var(--text-xs)', color: fmt.corPnl(pnl), marginTop: 2 }}>{fmt.usd(pnl)}</div>
            </div>
          );
        })}
      </div>

      {ORDEM.map((cat) => {
        const arr = porCategoria.get(cat) ?? [];
        if (!arr.length) return null;
        return (
          <Section key={cat} titulo={`${cat} · ${arr.length}`} sub={cat === 'Challengers' ? 'Todos com capital virtual. PnL fora da janela comum não é diretamente comparável ao champion.' : undefined}>
            <DataTable aria={`Estratégias — ${cat}`} colunas={colunas} linhas={arr} chaveLinha={(l) => l.strategyId} />
          </Section>
        );
      })}

      {!linhas.length && profitLab?.estado === 'sucesso' && (
        <Section><p style={{ color: 'var(--ink-3)', fontSize: 'var(--text-sm)' }}>Sem estratégias no leaderboard ainda.</p></Section>
      )}
    </div>
  );
}
