import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useLiveStore, idadeDoDado, LIMITE_STALE_MS } from '../stores/liveStore';
import { useOportunidades } from '../hooks/useOportunidades';
import { Section, StatusBadge, fmt } from '../components/ui/kit';
import { SnowballCore } from '../components/portfolio/SnowballCore';
import { calcularRankingComparavel } from '../components/portfolio/ComparableRanking';
import { EquityCurve } from '../components/charts/EquityCurve';
import type { ChartDataState } from '../components/charts/ChartFrame';
import { DataStateBanner } from '../components/feedback/DataState';

/**
 * COMMAND CENTER — visão EXECUTIVA (item 10). Layout próprio, não uma grade
 * uniforme de cards: uma faixa executiva no topo que responde "saúde /
 * capital / PnL / uso / exposição / risco" em segundos, um centro com a
 * curva de capital, e uma coluna lateral com posições, settlements,
 * oportunidades e o coletor. Nada de dinheiro real: tudo PAPER.
 */
interface PosMarc { symbol: string; notionalShort: number; notionalLong: number; pnlNaoRealizadoTotal: number }

export function CommandCenter() {
  const champion = useLiveStore((s) => s.champion);
  const profitLab = useLiveStore((s) => s.profitLab);
  const oport = useOportunidades();

  const est = champion?.estado === 'sucesso' ? champion.dado.estado : null;
  const marc = champion?.estado === 'sucesso' ? (champion.dado.marcacao as { equityMark?: number; equityLiquidacao?: number; pnlNaoRealizadoMark?: number; posicoes?: PosMarc[] } | null) : null;
  const posicoes = champion?.estado === 'sucesso' ? champion.dado.posicoes ?? [] : [];
  const curva = champion?.estado === 'sucesso' ? champion.dado.curva ?? [] : [];
  const resumo = profitLab?.estado === 'sucesso' ? profitLab.dado.resumo : null;
  const multi = profitLab?.estado === 'sucesso' ? profitLab.dado.leaderboardMulti : null;
  const capturas = profitLab?.estado === 'sucesso' ? profitLab.dado.capturaStatus ?? [] : [];
  const ranking = multi ? calcularRankingComparavel(multi.linhas) : null;

  const championIdade = idadeDoDado(champion);
  const stale = championIdade != null && championIdade > LIMITE_STALE_MS;
  const chartState: ChartDataState = champion?.estado === 'sucesso' ? (stale ? 'stale' : 'success') : champion?.estado === 'corrompido' ? 'corrupted' : champion?.estado === 'erro' ? 'error' : 'loading';

  const pnlReal = est ? est.capital - est.capitalInicial : null;
  const notionalBruto = (marc?.posicoes ?? []).reduce((s, p) => s + p.notionalShort + p.notionalLong, 0);
  const margem = posicoes.reduce((s, p) => s + (p.margemShort ?? 0) + (p.margemLong ?? 0), 0);
  const emRisco = posicoes.filter((p) => p.distanciaMinima < 0.15).length;
  const cs = oport?.estado === 'sucesso' ? oport.dado.collectorStatus : null;
  const saude = champion?.estado === 'sucesso' && !stale && profitLab?.estado === 'sucesso';

  const proximosSettlements = useMemo(() => capturas
    .filter((c) => c.proximaLiquidacaoEm != null && c.status === 'posicao_aberta')
    .sort((a, b) => (a.proximaLiquidacaoEm ?? 0) - (b.proximaLiquidacaoEm ?? 0)).slice(0, 4), [capturas]);

  const pontos = curva.map((p) => ({ ts: p.ts, valor: p.capital }));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-5)' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--space-4)', flexWrap: 'wrap' }}>
        <div>
          <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 'var(--text-2xl)', margin: 0, fontWeight: 700 }}>Command Center</h1>
          <p style={{ color: 'var(--ink-2)', fontSize: 'var(--text-sm)', margin: '4px 0 0' }}>Visão executiva do Champion (paper) e do Paper Profit Lab (virtual) — nunca misturados.</p>
        </div>
        <StatusBadge label={saude ? 'sistema saudável' : stale ? 'dado stale' : 'atenção'} tom={saude ? 'ok' : 'warn'} />
      </div>

      {champion?.estado === 'erro' && <DataStateBanner kind="offline" motivo={champion.motivo} />}
      {stale && <DataStateBanner kind="stale" idadeMs={championIdade} origem="/api/v2/champion" />}

      {/* FAIXA EXECUTIVA — banda contínua, não grade de cards */}
      <div style={{ display: 'flex', flexWrap: 'wrap', background: 'linear-gradient(180deg, var(--surface-glass), rgba(12,21,38,0.5))', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-lg)', overflow: 'hidden' }}>
        {[
          ['Capital · PAPER', fmt.usd(est?.capital ?? null), 'var(--snow-primary)', true],
          ['PnL realizado', fmt.usd(pnlReal), fmt.corPnl(pnlReal)],
          ['Equity mark', fmt.usd(marc?.equityMark ?? null), 'var(--ink-0)'],
          ['Equity liquidação', fmt.usd(marc?.equityLiquidacao ?? null), 'var(--ink-0)'],
          ['Margem em uso', fmt.usd(margem), 'var(--warn-500)'],
          ['Exposição (notional)', fmt.usd(notionalBruto), 'var(--ink-0)'],
          ['Posições', `${posicoes.length}${emRisco ? ` · ${emRisco} em risco` : ''}`, emRisco ? 'var(--loss-500)' : 'var(--ink-0)'],
        ].map(([lbl, val, cor, hero], i) => (
          <div key={lbl as string} style={{ flex: '1 1 160px', minWidth: 150, padding: 'var(--space-4) var(--space-5)', borderLeft: i > 0 ? '1px solid var(--border-hairline)' : 'none' }}>
            <div style={{ fontSize: '0.6rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--ink-3)' }}>{lbl}</div>
            <div className="tabular" style={{ fontSize: hero ? 'var(--text-2xl)' : 'var(--text-xl)', fontWeight: 800, marginTop: 4, color: cor as string }}>{val}</div>
          </div>
        ))}
      </div>

      {/* CENTRO + LATERAL */}
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 2fr) minmax(300px, 1fr)', gap: 'var(--space-4)', alignItems: 'start' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
          <Section titulo="Curva de capital (paper)" sub={`Capital inicial ${fmt.usd(est?.capitalInicial ?? null)} → atual ${fmt.usd(est?.capital ?? null)} · funding ${fmt.usd(est?.fundingTotal ?? null)} − custos ${fmt.usd(est?.custosTotal ?? null)}`}>
            <div style={{ height: 300 }}><EquityCurve titulo="" pontos={pontos.length ? pontos : null} state={chartState} cor="var(--snow-primary)" /></div>
          </Section>
          <Section titulo="Motores" sub="Champion (paper), challengers (paper lab) e experimentos — nunca somados.">
            <SnowballCore championCapital={est?.capital ?? 0} challengersCapital={resumo?.capitalVirtualTotal ?? 0} numeroChallengers={resumo?.numeroAtivos ?? 0} />
          </Section>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
          <Section titulo={`Posições abertas · ${posicoes.length}`} acao={<Link to="/champion" style={{ fontSize: 'var(--text-2xs)', color: 'var(--snow-primary)', textDecoration: 'none' }}>ver cockpit →</Link>}>
            {posicoes.length ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {posicoes.slice(0, 5).map((p) => {
                  const mp = (marc?.posicoes ?? []).find((x) => x.symbol === p.symbol);
                  return (
                    <div key={p.symbol + p.abertaEm} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, padding: '7px 10px', background: 'var(--surface-1)', borderRadius: 'var(--radius-sm)', borderLeft: `2px solid ${p.distanciaMinima < 0.15 ? 'var(--loss-500)' : 'var(--gain-500)'}` }}>
                      <div><div style={{ fontWeight: 700, fontSize: 'var(--text-xs)' }}>{p.symbol.replace('/USDT:USDT', '')}</div><div style={{ fontSize: '0.6rem', color: 'var(--ink-3)' }}>{p.exchangeShort} → {p.exchangeLong}</div></div>
                      <div style={{ textAlign: 'right' }}>
                        <div className="tabular" style={{ fontSize: 'var(--text-xs)', color: mp ? fmt.corPnl(mp.pnlNaoRealizadoTotal) : 'var(--ink-2)' }}>{mp ? fmt.usd(mp.pnlNaoRealizadoTotal) : '—'}</div>
                        <div style={{ fontSize: '0.6rem', color: 'var(--ink-3)' }}>liq {fmt.pct(p.distanciaMinima * 100)}</div>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : <p style={{ color: 'var(--ink-3)', fontSize: 'var(--text-xs)' }}>Nenhuma posição aberta.</p>}
          </Section>

          <Section titulo="Próximos settlements">
            {proximosSettlements.length ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {proximosSettlements.map((c) => (
                  <div key={c.challengerId} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 'var(--text-xs)', padding: '5px 0', borderBottom: '1px solid var(--border-hairline)' }}>
                    <span>{c.symbol?.replace('/USDT:USDT', '') ?? c.challengerId} · {c.janelaMin}m</span>
                    <span className="tabular" style={{ color: 'var(--ink-3)' }}>{c.proximaLiquidacaoEm ? new Date(c.proximaLiquidacaoEm).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : '—'}</span>
                  </div>
                ))}
              </div>
            ) : <p style={{ color: 'var(--ink-3)', fontSize: 'var(--text-xs)' }}>Nenhum settlement iminente.</p>}
          </Section>

          <Section titulo="Oportunidades" acao={<Link to="/opportunities" style={{ fontSize: 'var(--text-2xs)', color: 'var(--snow-primary)', textDecoration: 'none' }}>ver mapa →</Link>}>
            {oport?.estado === 'sucesso' ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 'var(--text-xs)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}><span style={{ color: 'var(--ink-2)' }}>Observadas</span><span className="tabular" style={{ fontWeight: 700 }}>{fmt.int(oport.dado.summary.total)}</span></div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}><span style={{ color: 'var(--ink-2)' }}>Elegíveis</span><span className="tabular" style={{ color: 'var(--gain-500)', fontWeight: 700 }}>{fmt.int(oport.dado.summary.eligible)}</span></div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}><span style={{ color: 'var(--ink-2)' }}>Coletor</span><StatusBadge label={cs?.estado ?? '—'} tom={cs?.estado === 'live' ? 'ok' : cs?.estado === 'stale' ? 'warn' : 'loss'} /></div>
              </div>
            ) : <p style={{ color: 'var(--ink-3)', fontSize: 'var(--text-xs)' }}>Carregando coletor…</p>}
          </Section>

          {ranking && ranking.comparaveis.length > 0 && (
            <Section titulo="Melhor / pior motor (janela comum)">
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 'var(--text-xs)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}><span style={{ color: 'var(--gain-500)' }}>▲ {ranking.melhor?.strategyId}</span><span className="tabular">{ranking.melhor && fmt.usd(ranking.melhor.pnlDesdeOInicio)}</span></div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}><span style={{ color: 'var(--loss-500)' }}>▼ {ranking.pior?.strategyId}</span><span className="tabular">{ranking.pior && fmt.pct(ranking.pior.pnlPct)}</span></div>
              </div>
            </Section>
          )}
        </div>
      </div>
    </div>
  );
}
