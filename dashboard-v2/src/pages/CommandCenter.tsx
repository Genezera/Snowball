import { useLiveStore, idadeDoDado, LIMITE_STALE_MS } from '../stores/liveStore';
import { MetricCard } from '../components/cards/MetricCard';
import { DataStateBanner, EmptyIllustration } from '../components/feedback/DataState';
import { SnowballCore } from '../components/portfolio/SnowballCore';
import { calcularRankingComparavel } from '../components/portfolio/ComparableRanking';

function fmtUsd(n: number): string {
  const s = n < 0 ? '-' : '';
  return s + 'US$ ' + Math.abs(n).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function fmtPct(n: number): string {
  return n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + '%';
}
function fmtInt(n: number): string { return n.toLocaleString('pt-BR', { maximumFractionDigits: 0 }); }

export function CommandCenter() {
  const champion = useLiveStore((s) => s.champion);
  const profitLab = useLiveStore((s) => s.profitLab);

  const championIdade = idadeDoDado(champion);
  const labIdade = idadeDoDado(profitLab);
  const championStale = championIdade != null && championIdade > LIMITE_STALE_MS;
  const labStale = labIdade != null && labIdade > LIMITE_STALE_MS;

  const est = champion?.estado === 'sucesso' ? champion.dado.estado : null;
  const resumo = profitLab?.estado === 'sucesso' ? profitLab.dado.resumo : null;
  const multi = profitLab?.estado === 'sucesso' ? profitLab.dado.leaderboardMulti : null;

  const ranking = multi ? calcularRankingComparavel(multi.linhas) : null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-6)' }}>
      <div>
        <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 'var(--text-2xl)', margin: 0, fontWeight: 600 }}>Command Center</h1>
        <p style={{ color: 'var(--ink-2)', fontSize: 'var(--text-sm)', margin: '4px 0 0' }}>
          Champion (dinheiro simulado real) e Paper Profit Lab (capital 100% virtual) — nunca misturados.
        </p>
      </div>

      {champion?.estado === 'erro' && <DataStateBanner kind="offline" motivo={champion.motivo} />}
      {champion?.estado === 'corrompido' && <DataStateBanner kind="corrupted" motivo={champion.motivo} />}
      {championStale && <DataStateBanner kind="stale" idadeMs={championIdade} origem="/api/stream" />}

      <section aria-label="Métricas principais do champion" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(180px, 100%), 1fr))', gap: 'var(--space-3)' }}>
        {/* CORREÇÃO: este card mostrava est.capital (capital REALIZADO) rotulado
            como "Equity (mark)" — são coisas diferentes. Equity mark = capital
            realizado + PnL não realizado marcado a mercado, só disponível via
            profitLab.resumo.champion.equityMark (spread/marcacao.json). */}
        <MetricCard label="Capital realizado" value={est ? est.capital : null} formatar={fmtUsd} sub="champion — sistema principal" />
        <MetricCard label="Equity mark" value={resumo?.champion.equityMark ?? null} formatar={fmtUsd} sub={resumo && !resumo.champion.marcacaoDisponivel ? 'marcação indisponível' : 'realizado + não-realizado marcado'} />
        <MetricCard label="PnL realizado" value={est ? est.capital - est.capitalInicial : null} formatar={fmtUsd} tone={est && est.capital - est.capitalInicial >= 0 ? 'gain' : 'loss'} />
        <MetricCard label="Funding bruto" value={est ? est.fundingTotal : null} formatar={fmtUsd} />
        <MetricCard label="Custos totais" value={est ? est.custosTotal : null} formatar={fmtUsd} />
        <MetricCard label="Pagamentos recebidos" value={est ? est.pagamentos : null} formatar={fmtInt} />
      </section>

      {profitLab?.estado === 'erro' && <DataStateBanner kind="offline" motivo={profitLab.motivo} />}
      {profitLab?.estado === 'corrompido' && <DataStateBanner kind="corrupted" motivo={profitLab.motivo} />}
      {labStale && <DataStateBanner kind="stale" idadeMs={labIdade} origem="/api/profit-lab/stream" />}

      <section aria-label="Métricas principais do Paper Profit Lab" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(180px, 100%), 1fr))', gap: 'var(--space-3)' }}>
        <div style={{ gridColumn: 'span 1' }}>
          <MetricCard label="Capital virtual agregado dos experimentos" value={resumo ? resumo.capitalVirtualTotal : null} formatar={fmtUsd} />
          {/* aviso PERMANENTE, nunca removido — não é dica dispensável */}
          <p style={{ fontSize: 'var(--text-2xs)', color: 'var(--warn-500)', margin: '6px 2px 0', lineHeight: 1.4 }}>
            Soma de carteiras paper independentes. Não representa capital real ou disponível.
          </p>
        </div>
        <MetricCard label="Trades paper" value={resumo ? resumo.tradesTotaisPaper : null} formatar={fmtInt} />
        <MetricCard label="Settlements capturados" value={resumo ? resumo.settlementsTotaisPaper : null} formatar={fmtInt} />
        <MetricCard label="Challengers ativos" value={resumo ? resumo.numeroAtivos : null} formatar={fmtInt} sub={resumo ? `${resumo.numeroPausados} pausados · ${resumo.numeroEliminados} eliminados` : undefined} />
      </section>

      <section aria-label="Snowball Core" style={{
        background: 'var(--surface-glass)', backdropFilter: 'blur(14px)', border: '1px solid var(--border-hairline)',
        borderRadius: 'var(--radius-lg)', padding: 'var(--space-5)',
      }}>
        <h2 style={{ fontSize: 'var(--text-sm)', fontWeight: 700, margin: '0 0 var(--space-3)', color: 'var(--ink-1)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Snowball Core</h2>
        <SnowballCore
          championCapital={est?.capital ?? 0}
          challengersCapital={resumo?.capitalVirtualTotal ?? 0}
          numeroChallengers={resumo?.numeroAtivos ?? 0}
        />
      </section>

      <section aria-label="Melhor e pior motor (somente comparáveis na mesma janela)">
        <h2 style={{ fontSize: 'var(--text-sm)', fontWeight: 700, margin: '0 0 var(--space-3)', color: 'var(--ink-1)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
          Comparação entre motores
        </h2>
        {!ranking || !ranking.comparaveis.length ? (
          <div style={{ background: 'var(--surface-1)', border: '1px dashed var(--border-subtle)', borderRadius: 'var(--radius-lg)' }}>
            <EmptyIllustration label="Comparação indisponível — os motores ainda não possuem uma janela comum suficiente." />
          </div>
        ) : (
          <>
            {/* achado real (responsividade mobile): "1fr 1fr" rígido + nome de
                challenger longo (ex.: baseline-equal-weight-btc-eth) sem quebra
                de linha forçava overflow horizontal na página inteira em telas
                estreitas. minWidth:0 nas colunas (destrava o grid item de sua
                largura mínima de conteúdo) + overflowWrap na string do id
                resolvem sem mudar o layout em telas largas. */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(220px, 100%), 1fr))', gap: 'var(--space-3)' }}>
              <div style={{ minWidth: 0, background: 'var(--surface-1)', border: '1px solid var(--border-hairline)', borderRadius: 'var(--radius-md)', padding: 'var(--space-4)' }}>
                <span style={{ fontSize: 'var(--text-2xs)', fontWeight: 700, color: 'var(--gain-500)', textTransform: 'uppercase' }}>Melhor motor (janela comum)</span>
                <div style={{ fontSize: 'var(--text-lg)', fontWeight: 700, marginTop: 4, overflowWrap: 'anywhere' }}>{ranking.melhor?.strategyId}</div>
                <div className="tabular" style={{ color: 'var(--ink-2)', fontSize: 'var(--text-sm)' }}>{ranking.melhor && fmtUsd(ranking.melhor.pnlDesdeOInicio)}</div>
              </div>
              <div style={{ minWidth: 0, background: 'var(--surface-1)', border: '1px solid var(--border-hairline)', borderRadius: 'var(--radius-md)', padding: 'var(--space-4)' }}>
                <span style={{ fontSize: 'var(--text-2xs)', fontWeight: 700, color: 'var(--loss-500)', textTransform: 'uppercase' }}>Pior motor (janela comum)</span>
                <div style={{ fontSize: 'var(--text-lg)', fontWeight: 700, marginTop: 4, overflowWrap: 'anywhere' }}>{ranking.pior?.strategyId}</div>
                <div className="tabular" style={{ color: 'var(--ink-2)', fontSize: 'var(--text-sm)' }}>{ranking.pior && fmtPct(ranking.pior.pnlPct)}</div>
              </div>
            </div>
            <p style={{ fontSize: 'var(--text-2xs)', color: 'var(--ink-3)', margin: '8px 2px 0' }}>
              {ranking.comparaveis.length} motor(es) compartilham a mesma janela comum e participam do ranking.
            </p>
          </>
        )}

        {ranking && ranking.naoComparaveis.length > 0 && (
          <details style={{ marginTop: 'var(--space-3)' }}>
            <summary style={{ cursor: 'pointer', fontSize: 'var(--text-xs)', color: 'var(--ink-2)', fontWeight: 600 }}>
              {ranking.naoComparaveis.length} motor(es) fora da comparação — ver motivo
            </summary>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 8 }}>
              {ranking.naoComparaveis.map((l) => (
                <div key={l.strategyId} style={{ fontSize: 'var(--text-xs)', color: 'var(--ink-3)', padding: '6px 10px', background: 'var(--surface-1)', borderRadius: 'var(--radius-sm)' }}>
                  <strong style={{ color: 'var(--ink-1)' }}>{l.strategyId}</strong> — {l.nota}
                </div>
              ))}
            </div>
          </details>
        )}
      </section>
    </div>
  );
}
