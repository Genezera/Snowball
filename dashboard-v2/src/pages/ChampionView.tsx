import { useMemo } from 'react';
import { useLiveStore, idadeDoDado, LIMITE_STALE_MS } from '../stores/liveStore';
import { Section, StatusBadge, fmt } from '../components/ui/kit';
import { EquityCurve } from '../components/charts/EquityCurve';
import { DrawdownChart } from '../components/charts/DrawdownChart';
import { DataStateBanner, EmptyIllustration } from '../components/feedback/DataState';
import type { ChartDataState } from '../components/charts/ChartFrame';

/**
 * CHAMPION — COCKPIT operacional (item 11). A unidade visual central é a
 * POSIÇÃO: cada posição é um painel rico com as duas pernas, preços de
 * entrada e mark, PnL aberto por perna, funding, custos, margem, distância
 * de liquidação, desbalanceamento e próximo settlement. Os gráficos ficam a
 * serviço das posições, não soltos. Tudo PAPER.
 */
interface PosMarc {
  symbol: string; markPriceShort: number; markPriceLong: number; precoEntradaShort: number; precoEntradaLong: number;
  notionalShort: number; notionalLong: number; pnlNaoRealizadoShort: number; pnlNaoRealizadoLong: number;
  pnlNaoRealizadoTotal: number; fundingAcumulado: number; custoEstimadoFechamento: number;
}

export function ChampionView() {
  const champion = useLiveStore((s) => s.champion);
  const est = champion?.estado === 'sucesso' ? champion.dado.estado : null;
  const marc = champion?.estado === 'sucesso' ? (champion.dado.marcacao as { equityMark?: number; equityLiquidacao?: number; pnlNaoRealizadoMark?: number; custoEstimadoFechamentoTotal?: number; posicoes?: PosMarc[] } | null) : null;
  const posicoes = champion?.estado === 'sucesso' ? champion.dado.posicoes ?? [] : [];
  const curva = champion?.estado === 'sucesso' ? champion.dado.curva ?? [] : [];

  const idade = idadeDoDado(champion);
  const stale = idade != null && idade > LIMITE_STALE_MS;
  const chartState: ChartDataState = champion?.estado === 'sucesso' ? (stale ? 'stale' : 'success') : champion?.estado === 'corrompido' ? 'corrupted' : champion?.estado === 'erro' ? 'error' : 'loading';
  const pontos = curva.map((p) => ({ ts: p.ts, valor: p.capital }));

  const pnlReal = est ? est.capital - est.capitalInicial : null;
  const margem = posicoes.reduce((s, p) => s + (p.margemShort ?? 0) + (p.margemLong ?? 0), 0);
  const distMin = posicoes.length ? Math.min(...posicoes.map((p) => p.distanciaMinima)) : null;

  // funde estado.posicoes (margens, distâncias, tempo) com marcacao.posicoes (notional/PnL por perna a mark)
  const cockpit = useMemo(() => posicoes.map((p) => ({
    p, m: (marc?.posicoes ?? []).find((x) => x.symbol === p.symbol) ?? null,
  })), [posicoes, marc]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-5)' }}>
      <div>
        <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 'var(--text-2xl)', margin: 0, fontWeight: 700 }}>Champion</h1>
        <p style={{ color: 'var(--ink-2)', fontSize: 'var(--text-sm)', margin: '4px 0 0' }}>Cockpit do Funding Arbitrage — a posição é a unidade central. Capital simulado (paper), sistema principal.</p>
      </div>

      {champion?.estado === 'erro' && <DataStateBanner kind="offline" motivo={champion.motivo} />}
      {champion?.estado === 'corrompido' && <DataStateBanner kind="corrupted" motivo={champion.motivo} />}
      {stale && <DataStateBanner kind="stale" idadeMs={idade} origem="/api/v2/champion" />}

      {/* HERO OPERACIONAL — banda */}
      <div style={{ display: 'flex', flexWrap: 'wrap', background: 'linear-gradient(180deg, rgba(23,217,255,0.05), var(--surface-glass))', border: '1px solid var(--border-strong)', borderRadius: 'var(--radius-lg)', overflow: 'hidden' }}>
        {[
          ['Capital · PAPER', fmt.usd(est?.capital ?? null), 'var(--snow-primary)', true],
          ['PnL realizado', fmt.usd(pnlReal), fmt.corPnl(pnlReal)],
          ['PnL aberto (mark)', fmt.usd(marc?.pnlNaoRealizadoMark ?? null), fmt.corPnl(marc?.pnlNaoRealizadoMark ?? null)],
          ['Funding', fmt.usd(est?.fundingTotal ?? null), 'var(--gain-500)'],
          ['Custos', fmt.usd(est?.custosTotal ?? null), 'var(--warn-500)'],
          ['Margem', fmt.usd(margem), 'var(--warn-500)'],
          ['Posições', String(posicoes.length), 'var(--ink-0)'],
          ['Dist. liq. mínima', distMin != null ? fmt.pct(distMin * 100) : '—', distMin != null && distMin < 0.15 ? 'var(--loss-500)' : 'var(--ink-0)'],
        ].map(([lbl, val, cor, hero], i) => (
          <div key={lbl as string} style={{ flex: '1 1 150px', minWidth: 140, padding: 'var(--space-4)', borderLeft: i > 0 ? '1px solid var(--border-hairline)' : 'none' }}>
            <div style={{ fontSize: '0.6rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--ink-3)' }}>{lbl}</div>
            <div className="tabular" style={{ fontSize: hero ? 'var(--text-xl)' : 'var(--text-lg)', fontWeight: 800, marginTop: 3, color: cor as string }}>{val}</div>
          </div>
        ))}
      </div>

      {/* curva + drawdown + painel de risco */}
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 2fr) minmax(280px, 1fr)', gap: 'var(--space-4)', alignItems: 'start' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-4)' }}>
          <Section titulo="Curva de capital"><div style={{ height: 240 }}><EquityCurve titulo="" pontos={pontos.length ? pontos : null} state={chartState} cor="var(--snow-primary)" /></div></Section>
          <Section titulo="Drawdown"><div style={{ height: 240 }}><DrawdownChart pontos={pontos.length ? pontos : null} state={chartState} /></div></Section>
        </div>
        <Section titulo="Painel de risco">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {[
              ['Margem utilizada', fmt.usd(margem), 'var(--warn-500)'],
              ['Distância liq. mínima', distMin != null ? fmt.pct(distMin * 100) : '—', distMin != null && distMin < 0.15 ? 'var(--loss-500)' : 'var(--gain-500)'],
              ['Custo est. fechamento', fmt.usd(marc?.custoEstimadoFechamentoTotal ?? null), 'var(--warn-500)'],
              ['Equity liquidação', fmt.usd(marc?.equityLiquidacao ?? null), 'var(--ink-0)'],
              ['Pernas em risco', String(posicoes.filter((p) => p.distanciaMinima < 0.15).length), posicoes.some((p) => p.distanciaMinima < 0.15) ? 'var(--loss-500)' : 'var(--gain-500)'],
            ].map(([lbl, val, cor]) => (
              <div key={lbl} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 0', borderBottom: '1px solid var(--border-hairline)' }}>
                <span style={{ fontSize: 'var(--text-xs)', color: 'var(--ink-2)' }}>{lbl}</span>
                <span className="tabular" style={{ fontSize: 'var(--text-sm)', fontWeight: 700, color: cor as string }}>{val}</span>
              </div>
            ))}
          </div>
        </Section>
      </div>

      {/* POSIÇÕES — a unidade central */}
      <Section aria="Posições abertas — cockpit" titulo={`Posições abertas · ${posicoes.length}`} sub="Cada posição são DUAS pernas market-neutral. Preços, PnL por perna, funding, custos e distância de liquidação.">
        {cockpit.length ? (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(420px, 100%), 1fr))', gap: 'var(--space-4)' }}>
            {cockpit.map(({ p, m }) => {
              const desbalanco = m ? m.notionalLong - m.notionalShort : null;
              const risco = p.distanciaMinima < 0.15;
              return (
                <div key={p.symbol + p.abertaEm} style={{ position: 'relative', overflow: 'hidden', background: 'linear-gradient(180deg, var(--surface-glass), rgba(12,21,38,0.45))', border: `1px solid ${risco ? 'var(--loss-500)' : 'var(--border-subtle)'}`, borderRadius: 'var(--radius-lg)', padding: 'var(--space-4)' }}>
                  <span aria-hidden style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 2, background: risco ? 'var(--loss-500)' : 'var(--snow-primary)' }} />
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                    <span style={{ fontWeight: 800, fontSize: 'var(--text-base)' }}>{p.symbol.replace('/USDT:USDT', '')}</span>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <StatusBadge label={`${p.horasAberta.toFixed(1)}h aberta`} tom="neutral" />
                      {risco ? <StatusBadge label="RISCO LIQ." tom="loss" /> : <StatusBadge label="neutro" tom="ok" />}
                    </div>
                  </div>
                  {/* duas pernas */}
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 10 }}>
                    {(['short', 'long'] as const).map((lado) => {
                      const ex = lado === 'short' ? p.exchangeShort : p.exchangeLong;
                      const entrada = m ? (lado === 'short' ? m.precoEntradaShort : m.precoEntradaLong) : p.precoEntrada;
                      const mark = m ? (lado === 'short' ? m.markPriceShort : m.markPriceLong) : (lado === 'short' ? p.precoAoVivoShort : p.precoAoVivoLong);
                      const notional = m ? (lado === 'short' ? m.notionalShort : m.notionalLong) : p.notionalPorPerna;
                      const pnl = m ? (lado === 'short' ? m.pnlNaoRealizadoShort : m.pnlNaoRealizadoLong) : null;
                      return (
                        <div key={lado} style={{ background: 'var(--surface-1)', borderRadius: 'var(--radius-sm)', padding: '8px 10px' }}>
                          <div style={{ fontSize: '0.6rem', textTransform: 'uppercase', color: lado === 'short' ? 'var(--loss-500)' : 'var(--gain-500)', fontWeight: 800 }}>{lado} · {ex}</div>
                          <div className="tabular" style={{ fontSize: 'var(--text-xs)', color: 'var(--ink-1)', marginTop: 3 }}>{fmt.usd(notional ?? 0)}</div>
                          <div className="tabular" style={{ fontSize: '0.62rem', color: 'var(--ink-3)' }}>entrada {entrada?.toFixed(5) ?? '—'} → mark {mark != null ? mark.toFixed(5) : '—'}</div>
                          {pnl != null && <div className="tabular" style={{ fontSize: '0.66rem', color: fmt.corPnl(pnl), fontWeight: 700 }}>{fmt.usd(pnl)}</div>}
                        </div>
                      );
                    })}
                  </div>
                  {/* métricas da posição */}
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 6, fontSize: 'var(--text-2xs)' }}>
                    {[
                      ['PnL aberto', m ? fmt.usd(m.pnlNaoRealizadoTotal) : '—', m ? fmt.corPnl(m.pnlNaoRealizadoTotal) : 'var(--ink-2)'],
                      ['Funding', fmt.usd(p.fundingAcumulado), 'var(--gain-500)'],
                      ['Dist. liq.', fmt.pct(p.distanciaMinima * 100), risco ? 'var(--loss-500)' : 'var(--ink-1)'],
                      ['Desbalanço', desbalanco != null ? fmt.usd(desbalanco) : '—', 'var(--ink-2)'],
                    ].map(([l, v, c]) => (
                      <div key={l}><div style={{ color: 'var(--ink-3)', fontWeight: 700, textTransform: 'uppercase', fontSize: '0.55rem' }}>{l}</div><div className="tabular" style={{ color: c as string, fontWeight: 700, marginTop: 2 }}>{v}</div></div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div style={{ background: 'var(--surface-1)', border: '1px dashed var(--border-subtle)', borderRadius: 'var(--radius-lg)' }}>
            <EmptyIllustration label="Nenhuma posição aberta no momento" />
          </div>
        )}
      </Section>
    </div>
  );
}
