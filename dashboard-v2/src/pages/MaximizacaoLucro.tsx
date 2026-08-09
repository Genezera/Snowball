import { useMaximizacao } from '../hooks/useMaximizacao';
import { PageHeader, Section, StatusBadge, fmt } from '../components/ui/kit';
import { DataStateBanner } from '../components/feedback/DataState';

/**
 * MAXIMIZAÇÃO DE LUCRO — o que estamos fazendo AGORA para extrair mais lucro do
 * Champion e escolher as 2 melhores exchanges para o dinheiro real ($100 cada).
 * Tudo paper e read-only. Fonte: /api/v2/profit-maximization.
 */
function Stat({ rotulo, valor, cor, sub }: { rotulo: string; valor: string; cor?: string; sub?: string }) {
  return (
    <Section>
      <div style={{ fontSize: '0.6rem', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--ink-3)', fontWeight: 800 }}>{rotulo}</div>
      <div className="tabular" style={{ fontSize: 'var(--text-2xl)', fontWeight: 800, color: cor ?? 'var(--ink-1)' }}>{valor}</div>
      {sub && <div style={{ fontSize: 'var(--text-2xs)', color: 'var(--ink-3)' }}>{sub}</div>}
    </Section>
  );
}

export function MaximizacaoLucro() {
  const res = useMaximizacao();
  const d = res?.estado === 'sucesso' ? (res.dado?.dados ?? null) : null;
  const ch = d?.champion ?? null;
  const h2h = d?.headToHead ?? null;
  const ranking = d?.ranking2Exchanges ?? null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-5)' }}>
      <PageHeader titulo="Maximização de Lucro" sub="Extrair mais lucro do Champion e escolher as 2 melhores exchanges para o dinheiro real ($100 cada). Tudo paper e read-only." />
      {res?.estado === 'erro' && <DataStateBanner kind="offline" motivo={res.motivo} />}

      {/* O QUE ESTAMOS FAZENDO */}
      <Section titulo="O que estamos fazendo agora" sub="Resumo simples do experimento em curso.">
        <ul style={{ margin: 0, paddingLeft: 18, display: 'flex', flexDirection: 'column', gap: 8, fontSize: 'var(--text-sm)', color: 'var(--ink-2)' }}>
          {(d?.oQueEstamosFazendo ?? ['Carregando…']).map((t: string, i: number) => <li key={i}>{t}</li>)}
        </ul>
      </Section>

      {/* CHAMPION — economia real */}
      <Section titulo="Champion (real, em paper)" sub={ch ? `${fmt.int(ch.dias)} dias rodando · custo consome ${ch.custoSobreFunding}% do funding` : 'Carregando…'}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 'var(--space-3)' }}>
          <Stat rotulo="Lucro líquido" valor={fmt.usd(ch?.lucroLiquido ?? null)} cor={fmt.corPnl(ch?.lucroLiquido ?? null)} sub={`de $${ch?.capitalInicial ?? 600}`} />
          <Stat rotulo="Retorno / dia" valor={ch ? `${ch.pctPorDia}%` : '—'} cor={fmt.corPnl(ch?.pctPorDia ?? null)} sub={ch ? `$${ch.lucroPorDia}/dia` : ''} />
          <Stat rotulo="Funding bruto" valor={fmt.usd(ch?.fundingTotal ?? null)} cor="var(--engine-funding)" />
          <Stat rotulo="Custos" valor={fmt.usd(ch ? -ch.custosTotal : null)} cor="var(--loss-500)" sub={ch ? `${ch.custoSobreFunding}% do funding` : ''} />
          <Stat rotulo="Capital atual" valor={fmt.usd(ch?.capital ?? null)} />
        </div>
      </Section>

      {/* HEAD-TO-HEAD ao vivo */}
      <Section titulo="Head-to-head ao vivo — qual par de 2 exchanges" sub={h2h?.acumulando ? 'Competidores prospectivos — entram só após 30min de sinal persistente. Volte em algumas horas.' : `Líder: ${h2h?.lider ?? '—'}`}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-4)' }}>
          {(h2h?.competidores ?? []).map((c: any) => (
            <Section key={c.label} style={{ borderColor: c.vivo ? 'var(--engine-funding)' : 'var(--border-hairline)' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ fontWeight: 800, fontSize: 'var(--text-base)' }}>{c.par}</span>
                <StatusBadge label={c.vivo ? 'vivo' : 'parado'} tom={c.vivo ? 'info' : 'neutral'} />
              </div>
              <div className="tabular" style={{ fontSize: 'var(--text-2xl)', fontWeight: 800, color: fmt.corPnl(c.net ?? null) }}>{fmt.usd(c.net ?? null)}</div>
              <div style={{ fontSize: 'var(--text-2xs)', color: 'var(--ink-3)' }}>
                net · capital {fmt.usd(c.capital ?? null)} · {c.abertas ?? 0} abertas / {c.fechadas ?? 0} fechadas
              </div>
              <div style={{ fontSize: 'var(--text-2xs)', color: 'var(--ink-3)' }}>funding +{c.fundingAcum ?? 0} · custos -{c.custosAcum ?? 0} · aguardando persistência: {c.persistencePending ?? 0}</div>
            </Section>
          ))}
        </div>
      </Section>

      {/* RANKING 2-exchanges */}
      <Section titulo="Ranking das 2 exchanges (dados reconciliados)" sub={ranking?.nota}>
        <div>
          {(ranking?.pares ?? []).map((p: any, i: number) => (
            <div key={p.par} style={{ display: 'grid', gridTemplateColumns: '24px 1fr auto auto', alignItems: 'center', gap: 'var(--space-3)', padding: '8px 0', borderBottom: '1px solid var(--border-hairline)' }}>
              <span style={{ fontWeight: 800, color: 'var(--ink-3)' }}>{i + 1}</span>
              <span style={{ fontWeight: i === 0 ? 800 : 600 }}>{p.par}</span>
              <span className="tabular" style={{ color: 'var(--ink-3)', fontSize: 'var(--text-2xs)' }}>{p.posicoes} pos</span>
              <span className="tabular" style={{ fontWeight: 800, color: fmt.corPnl(p.net) }}>{fmt.usd(p.net)}</span>
            </div>
          ))}
        </div>
        {ranking && (
          <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div style={{ fontSize: 'var(--text-sm)' }}><strong style={{ color: 'var(--snow-primary)' }}>Recomendação: {ranking.recomendacaoPrimaria}</strong> — {ranking.motivoPrimaria}</div>
            <div style={{ fontSize: 'var(--text-2xs)', color: 'var(--ink-3)' }}>Alternativa: {ranking.alternativa} — {ranking.motivoAlternativa}</div>
          </div>
        )}
      </Section>

      {/* COMO VAI MELHORAR — counterfactual */}
      {d?.comoVaiMelhorar && (
        <Section titulo="Como vamos melhorar o lucro (dados)" sub={d.comoVaiMelhorar.nota}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-4)', alignItems: 'start' }}>
            <Section style={{ borderColor: 'var(--engine-funding)' }}>
              <div style={{ fontWeight: 800, fontSize: 'var(--text-sm)' }}>Lever 1 — Ordens maker (limite)</div>
              <div style={{ fontSize: 'var(--text-2xs)', color: 'var(--ink-3)', marginBottom: 6 }}>{d.comoVaiMelhorar.lever1_maker?.explicacao}</div>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
                <span className="tabular" style={{ color: 'var(--ink-3)' }}>{fmt.usd(d.comoVaiMelhorar.lever1_maker?.champion6exAtual ?? null)}</span>
                <span style={{ color: 'var(--ink-3)' }}>→</span>
                <span className="tabular" style={{ fontSize: 'var(--text-xl)', fontWeight: 800, color: 'var(--gain-500)' }}>{fmt.usd(d.comoVaiMelhorar.lever1_maker?.champion6exComMaker ?? null)}</span>
                <StatusBadge label={`+${d.comoVaiMelhorar.lever1_maker?.ganhoPct}%`} tom="info" />
              </div>
              <div style={{ fontSize: 'var(--text-2xs)', color: 'var(--ink-3)' }}>custo cai de {d.comoVaiMelhorar.lever1_maker?.custoAtualPct}% do funding</div>
            </Section>
            <Section>
              <div style={{ fontWeight: 800, fontSize: 'var(--text-sm)', marginBottom: 6 }}>Lever 2 — Melhor par 2-ex, taker → maker</div>
              {(d.comoVaiMelhorar.lever2_paresMaker ?? []).map((p: any) => (
                <div key={p.par} style={{ display: 'grid', gridTemplateColumns: '1fr auto auto auto', gap: 8, alignItems: 'center', padding: '4px 0', borderBottom: '1px solid var(--border-hairline)' }}>
                  <span style={{ fontSize: 'var(--text-2xs)' }}>{p.par}</span>
                  <span className="tabular" style={{ color: 'var(--ink-3)', fontSize: 'var(--text-2xs)' }}>{fmt.usd(p.netTaker)}</span>
                  <span style={{ color: 'var(--ink-3)' }}>→</span>
                  <span className="tabular" style={{ fontWeight: 700, color: 'var(--gain-500)', fontSize: 'var(--text-2xs)' }}>{fmt.usd(p.netMaker)} (+{p.ganhoPct}%)</span>
                </div>
              ))}
            </Section>
          </div>
          <div style={{ marginTop: 10, fontSize: 'var(--text-sm)' }}><strong style={{ color: 'var(--snow-primary)' }}>Melhor caminho:</strong> {d.comoVaiMelhorar.melhorCaminho}</div>
        </Section>
      )}

      {/* LEVERS */}
      <Section titulo="Levers de maximização" sub="O que aumenta o lucro — e o que acelera.">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {(d?.leversDeMaximizacao ?? []).map((l: any, i: number) => (
            <div key={i} style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 'var(--space-3)', alignItems: 'start', paddingBottom: 8, borderBottom: '1px solid var(--border-hairline)' }}>
              <div>
                <div style={{ fontWeight: 700, fontSize: 'var(--text-sm)' }}>{l.lever}</div>
                <div style={{ fontSize: 'var(--text-2xs)', color: 'var(--ink-3)' }}>{l.descricao}</div>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'flex-end' }}>
                <StatusBadge label={l.impacto} tom="violet" />
                <span style={{ fontSize: 'var(--text-2xs)', color: 'var(--ink-3)' }}>{l.status}</span>
              </div>
            </div>
          ))}
        </div>
      </Section>

      {/* ML + próximos passos */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-4)' }}>
        <Section titulo="Machine Learning">
          <p style={{ fontSize: 'var(--text-sm)', color: 'var(--ink-2)', margin: 0 }}>{d?.ml?.veredito ?? 'Carregando…'}</p>
        </Section>
        <Section titulo="Próximos passos">
          <ol style={{ margin: 0, paddingLeft: 18, display: 'flex', flexDirection: 'column', gap: 6, fontSize: 'var(--text-sm)', color: 'var(--ink-2)' }}>
            {(d?.proximosPassos ?? []).map((t: string, i: number) => <li key={i}>{t}</li>)}
          </ol>
        </Section>
      </div>

      <p style={{ fontSize: 'var(--text-2xs)', color: 'var(--ink-3)', margin: 0 }}>{d?.honestidade ?? 'Tudo paper e read-only. Champion intacto. Nenhuma ordem real.'}</p>
    </div>
  );
}
