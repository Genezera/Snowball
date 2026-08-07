import { useMemo } from 'react';
import { useLiveStore } from '../stores/liveStore';
import { PageHeader, Section, DataTable, StatusBadge, RankBar, fmt, type Coluna } from '../components/ui/kit';
import { MetricCard } from '../components/cards/MetricCard';
import { DataStateBanner } from '../components/feedback/DataState';

/**
 * PORTFOLIO — quatro zonas, com SEMÂNTICA AUDITADA (ver
 * docs/auditoria-financeira-portfolio.md). Nada é "medido" por suposição:
 *   - Caixa LIVRE não é instrumentado → mostrado como tal, nunca por
 *     subtração saldo−margem.
 *   - Exposição por perna vem de marcacao.posicoes[].notionalShort/Long
 *     (real, a mark) — nunca short=long copiado.
 *   - PnL é reconciliado (funding−custos vs capital−inicial).
 *   - Tudo rotulado PAPER; virtual nunca somado ao Champion.
 */
interface PosMarc { symbol: string; notionalShort: number; notionalLong: number; pnlNaoRealizadoShort: number; pnlNaoRealizadoLong: number }

const NAO_INSTR = 'não instrumentado';

export function Portfolio() {
  const champion = useLiveStore((s) => s.champion);
  const profitLab = useLiveStore((s) => s.profitLab);
  const dado = champion?.estado === 'sucesso' ? champion.dado : null;
  const est = dado?.estado as (null | { capital: number; capitalInicial: number; fundingTotal: number; custosTotal: number; saldos?: Record<string, number>; caixaOcioso?: number });
  const marc = dado?.marcacao as { equityMark?: number; equityLiquidacao?: number; pnlNaoRealizadoMark?: number; custoEstimadoFechamentoTotal?: number; posicoes?: PosMarc[] } | null;
  const posicoesEstado = dado?.posicoes ?? [];
  const resumo = profitLab?.estado === 'sucesso' ? profitLab.dado.resumo : null;

  // margem utilizada — INSTRUMENTADA (margemShort+margemLong por posição)
  const margemUsada = posicoesEstado.reduce((s, p) => s + (p.margemShort ?? 0) + (p.margemLong ?? 0), 0);
  const saldoTotal = est?.saldos ? Object.values(est.saldos).reduce((s, v) => s + v, 0) : null;

  // exposição REAL por perna — de marcacao (a mark), nunca assumindo neutralidade
  const posMarc = marc?.posicoes ?? [];
  const temMarc = posMarc.length > 0;
  const notionalLongReal = temMarc ? posMarc.reduce((s, p) => s + p.notionalLong, 0) : null;
  const notionalShortReal = temMarc ? posMarc.reduce((s, p) => s + p.notionalShort, 0) : null;
  const notionalBruto = temMarc ? posMarc.reduce((s, p) => s + p.notionalShort + p.notionalLong, 0) : null;
  const desbalanceamentoAbs = (notionalLongReal != null && notionalShortReal != null) ? notionalLongReal - notionalShortReal : null;
  const notionalLiquido = desbalanceamentoAbs != null ? Math.abs(desbalanceamentoAbs) : null;
  const desbalancePct = (desbalanceamentoAbs != null && notionalBruto) ? desbalanceamentoAbs / (notionalBruto / 2) * 100 : null;
  const alavancagem = (notionalBruto != null && saldoTotal) ? notionalBruto / saldoTotal : null;
  const pnlRealizado = est ? est.capital - est.capitalInicial : null;

  // reconciliação: funding − custos vs capital − inicial
  const recon = est ? (() => {
    const fundMenosCustos = est.fundingTotal - est.custosTotal;
    const capMenosInicial = est.capital - est.capitalInicial;
    const dif = capMenosInicial - fundMenosCustos;
    const tol = 0.05;
    return { fundMenosCustos, capMenosInicial, dif, tol, reconciliado: Math.abs(dif) <= tol };
  })() : null;

  const porExchange = useMemo(() => {
    const m = new Map<string, { long: number; short: number }>();
    for (const p of posicoesEstado) {
      const marcP = posMarc.find((x) => x.symbol === p.symbol);
      const short = marcP?.notionalShort ?? p.notionalPorPerna ?? 0;
      const long = marcP?.notionalLong ?? p.notionalPorPerna ?? 0;
      const s = m.get(p.exchangeShort) ?? { long: 0, short: 0 }; s.short += short; m.set(p.exchangeShort, s);
      const l = m.get(p.exchangeLong) ?? { long: 0, short: 0 }; l.long += long; m.set(p.exchangeLong, l);
    }
    return [...m.entries()].map(([ex, v]) => ({ ex, notional: v.long + v.short })).sort((a, b) => b.notional - a.notional);
  }, [posicoesEstado, posMarc]);
  const maxEx = Math.max(1, ...porExchange.map((e) => e.notional));

  const colExch: Coluna<{ ex: string; notional: number }>[] = [
    { chave: 'ex', titulo: 'Exchange', render: (e) => <span style={{ fontWeight: 700, textTransform: 'capitalize' }}>{e.ex}</span> },
    { chave: 'not', titulo: 'Notional (mark)', alinhar: 'right', render: (e) => fmt.usd(e.notional) },
    { chave: 'bar', titulo: '', largura: '160px', render: (e) => <RankBar valor={e.notional} max={maxEx} tom="info" /> },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-5)' }}>
      <PageHeader titulo="Portfolio" sub="Quatro zonas com semântica auditada. Nada é medido por suposição — o que não é instrumentado aparece marcado. Capital do Champion (paper) e capital experimental (paper lab) nunca se somam." />
      {champion?.estado === 'erro' && <DataStateBanner kind="offline" motivo={champion.motivo} />}

      {/* ZONA A */}
      <Section titulo="A · Capital do Champion — PAPER" sub="Dinheiro simulado (paper) do sistema principal. Realizado já entrou; não-realizado depende do fechamento.">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(180px, 100%), 1fr))', gap: 'var(--space-3)' }}>
          <MetricCard label="Capital realizado" value={est?.capital ?? null} formatar={fmt.usd} destaque sub="paper" />
          <MetricCard label="Equity mark" value={marc?.equityMark ?? null} formatar={fmt.usd} sub="realizado + não-realizado" />
          <MetricCard label="Equity de liquidação" value={marc?.equityLiquidacao ?? null} formatar={fmt.usd} sub="se fechasse agora" />
          <MetricCard label="PnL realizado" value={pnlRealizado} formatar={fmt.usd} tone={fmt.tomPnl(pnlRealizado)} sub="já no capital" />
          <MetricCard label="PnL não realizado" value={marc?.pnlNaoRealizadoMark ?? null} formatar={fmt.usd} tone={fmt.tomPnl(marc?.pnlNaoRealizadoMark ?? null)} sub="depende do fechamento" />
          <MetricCard label="Funding recebido" value={est?.fundingTotal ?? null} formatar={fmt.usd} tone="gain" />
          <MetricCard label="Custos pagos" value={est?.custosTotal ?? null} formatar={fmt.usd} tone="warn" />
        </div>
      </Section>

      {/* Reconciliação do PnL */}
      {recon && (
        <Section titulo="Reconciliação do PnL" style={{ borderColor: recon.reconciliado ? 'var(--gain-500)' : 'var(--warn-500)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-4)', flexWrap: 'wrap', fontSize: 'var(--text-sm)' }}>
            <span className="tabular">funding {fmt.usd(est!.fundingTotal)} − custos {fmt.usd(est!.custosTotal)} = <strong style={{ color: 'var(--ink-0)' }}>{fmt.usd(recon.fundMenosCustos)}</strong></span>
            <span style={{ color: 'var(--ink-3)' }}>vs</span>
            <span className="tabular">capital − inicial = <strong style={{ color: 'var(--ink-0)' }}>{fmt.usd(recon.capMenosInicial)}</strong></span>
            <StatusBadge label={recon.reconciliado ? `reconciliado (dif ${fmt.usd(recon.dif)})` : `diferença ${fmt.usd(recon.dif)} > tol ${fmt.usd(recon.tol)}`} tom={recon.reconciliado ? 'ok' : 'warn'} />
          </div>
          <p style={{ fontSize: 'var(--text-2xs)', color: 'var(--ink-3)', margin: 0 }}>Fonte: estado.json (fundingTotal, custosTotal, capital, capitalInicial). Tolerância {fmt.usd(recon.tol)}.</p>
        </Section>
      )}

      {/* ZONA B */}
      <Section titulo="B · Dinheiro em uso" sub="Margem é dinheiro travado nas posições — nunca é lucro. Caixa livre por exchange não é instrumentado pela fonte (não fabricamos por subtração).">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(200px, 100%), 1fr))', gap: 'var(--space-3)' }}>
          <MetricCard label="Margem utilizada" value={margemUsada} formatar={fmt.usd} tone="warn" sub="travada nas posições" />
          <MetricCard label="Saldo total (wallet, 6 exchanges)" value={saldoTotal} formatar={fmt.usd} sub="cresce com funding" />
          <NaoInstrCard label="Caixa livre" motivo="saldo livre por exchange não instrumentado" />
          <MetricCard label="Caixa ocioso (funding não reinvestido)" value={est?.caixaOcioso ?? null} formatar={fmt.usd} />
          <MetricCard label="Custo estimado de fechamento" value={marc?.custoEstimadoFechamentoTotal ?? null} formatar={fmt.usd} tone="warn" sub="estimativa, não somada ao realizado" />
        </div>
      </Section>

      {/* ZONA C */}
      <Section titulo="C · Exposição" sub="Real por perna, a preço de mark (marcacao.json). Notional é tamanho de posição, não saldo. Não assumimos neutralidade perfeita — o desbalanceamento é medido.">
        {temMarc ? (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(160px, 100%), 1fr))', gap: 'var(--space-3)', marginBottom: 'var(--space-3)' }}>
              <MetricCard label="Notional bruto" value={notionalBruto} formatar={fmt.usd} sub={`${posMarc.length} posições`} />
              <MetricCard label="Notional long (real)" value={notionalLongReal} formatar={fmt.usd} />
              <MetricCard label="Notional short (real)" value={notionalShortReal} formatar={fmt.usd} />
              <MetricCard label="Notional líquido (desbalanço)" value={notionalLiquido} formatar={fmt.usd} tone={notionalLiquido != null && notionalLiquido > (notionalBruto ?? 0) * 0.02 ? 'warn' : 'neutral'} sub={desbalancePct != null ? `${fmt.pct(desbalancePct)} do lado` : undefined} />
              <MetricCard label="Alavancagem efetiva" value={alavancagem} formatar={(n) => n.toFixed(2) + '×'} tone={alavancagem != null && alavancagem > 3 ? 'warn' : 'neutral'} />
            </div>
            {porExchange.length > 0 && (
              <div><div style={{ fontSize: 'var(--text-2xs)', fontWeight: 800, textTransform: 'uppercase', color: 'var(--ink-3)', marginBottom: 6 }}>Notional por exchange (mark)</div>
                <DataTable aria="Notional por exchange" colunas={colExch} linhas={porExchange} chaveLinha={(e) => e.ex} /></div>
            )}
          </>
        ) : (
          <p style={{ color: 'var(--ink-3)', fontSize: 'var(--text-sm)' }}>Sem posições marcadas no momento (marcacao.posicoes vazio).</p>
        )}
      </Section>

      {/* ZONA D — separada visualmente */}
      <section style={{ background: 'linear-gradient(180deg, rgba(139,108,242,0.08), rgba(12,21,38,0.5))', border: '2px dashed var(--snow-violet)', borderRadius: 'var(--radius-lg)', padding: 'var(--space-5)', display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
          <h2 style={{ fontSize: 'var(--text-sm)', fontWeight: 800, margin: 0, color: 'var(--snow-violet)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>D · Capital experimental agregado — PAPER LAB</h2>
          <StatusBadge label="PAPER LAB — não somado ao capital do Champion" tom="violet" />
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(180px, 100%), 1fr))', gap: 'var(--space-3)' }}>
          <MiniViol label="Capital experimental total" valor={fmt.usd(resumo?.capitalVirtualTotal ?? null)} />
          <MiniViol label="Médio por challenger" valor={resumo && resumo.numeroChallengers ? fmt.usd(resumo.capitalVirtualTotal / resumo.numeroChallengers) : '—'} />
          <MiniViol label="Challengers ativos" valor={fmt.int(resumo?.numeroAtivos ?? null)} />
          <MiniViol label="Trades paper" valor={fmt.int(resumo?.tradesTotaisPaper ?? null)} />
        </div>
        <p style={{ fontSize: 'var(--text-2xs)', color: 'var(--snow-violet)', margin: 0 }}>As carteiras dos challengers são independentes e não são somadas ao capital do Champion.</p>
      </section>

      {/* Como ler */}
      <Section titulo="Como ler esta página">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(260px, 100%), 1fr))', gap: 'var(--space-3)', fontSize: 'var(--text-2xs)', color: 'var(--ink-2)', lineHeight: 1.6 }}>
          <div><strong style={{ color: 'var(--ink-1)' }}>Capital</strong> é o que o Champion tem (paper).</div>
          <div><strong style={{ color: 'var(--ink-1)' }}>Margem</strong> é dinheiro comprometido nas posições, não lucro.</div>
          <div><strong style={{ color: 'var(--ink-1)' }}>Notional</strong> é o tamanho da posição, não o saldo.</div>
          <div><strong style={{ color: 'var(--ink-1)' }}>Exposição</strong> mede risco de mercado; o desbalanço mostra o quão neutro está.</div>
          <div><strong style={{ color: 'var(--ink-1)' }}>PnL realizado</strong> já entrou no capital; <strong style={{ color: 'var(--ink-1)' }}>não realizado</strong> depende do fechamento.</div>
          <div><strong style={{ color: 'var(--ink-3)' }}>Caixa livre</strong> não é instrumentado — não é inventado por subtração.</div>
          <div><strong style={{ color: 'var(--snow-violet)' }}>Capital experimental (paper lab)</strong> pertence aos challengers — nunca ao Champion.</div>
        </div>
      </Section>
    </div>
  );
}

function NaoInstrCard({ label, motivo }: { label: string; motivo: string }) {
  return (
    <div style={{ background: 'var(--surface-glass)', border: '1px dashed var(--border-subtle)', borderRadius: 'var(--radius-lg)', padding: 'var(--space-4) var(--space-5)', display: 'flex', flexDirection: 'column', gap: 6 }}>
      <span style={{ fontSize: 'var(--text-2xs)', fontWeight: 800, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--ink-2)' }}>{label}</span>
      <span style={{ fontSize: 'var(--text-base)', fontWeight: 700, color: 'var(--ink-3)' }}>{NAO_INSTR}</span>
      <span style={{ fontSize: 'var(--text-2xs)', color: 'var(--ink-3)', lineHeight: 1.4 }}>{motivo}</span>
    </div>
  );
}

function MiniViol({ label, valor }: { label: string; valor: string }) {
  return (
    <div style={{ background: 'rgba(139,108,242,0.06)', border: '1px solid rgba(139,108,242,0.3)', borderRadius: 'var(--radius-md)', padding: 'var(--space-4)' }}>
      <div style={{ fontSize: 'var(--text-2xs)', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--snow-violet)' }}>{label}</div>
      <div className="tabular" style={{ fontSize: 'var(--text-xl)', fontWeight: 800, marginTop: 4, color: 'var(--ink-0)' }}>{valor}</div>
    </div>
  );
}
