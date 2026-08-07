import { useMemo } from 'react';
import { useLiveStore } from '../stores/liveStore';
import { PageHeader, Section, DataTable, StatusBadge, RankBar, fmt, type Coluna } from '../components/ui/kit';
import { MetricCard } from '../components/cards/MetricCard';
import { DataStateBanner } from '../components/feedback/DataState';

/**
 * PORTFOLIO — quatro ZONAS financeiras estritamente separadas (itens 9–12):
 *   A. Patrimônio real do Champion
 *   B. Dinheiro em uso
 *   C. Exposição
 *   D. Laboratório virtual (NUNCA somado a A/B/C)
 * Cada zona responde a uma pergunta. Capital virtual dos challengers jamais
 * entra no patrimônio real. Notional nunca é chamado de saldo; margem nunca
 * de lucro; realizado e não-realizado ficam separados.
 */
export function Portfolio() {
  const champion = useLiveStore((s) => s.champion);
  const profitLab = useLiveStore((s) => s.profitLab);
  const dado = champion?.estado === 'sucesso' ? champion.dado : null;
  const est = dado?.estado as (null | { capital: number; capitalInicial: number; fundingTotal: number; custosTotal: number; saldos?: Record<string, number>; caixaOcioso?: number });
  const marc = dado?.marcacao as { equityMark?: number; equityLiquidacao?: number; pnlNaoRealizadoMark?: number; custoEstimadoFechamentoTotal?: number } | null;
  const posicoes = dado?.posicoes ?? [];
  const resumo = profitLab?.estado === 'sucesso' ? profitLab.dado.resumo : null;

  const margemUsada = posicoes.reduce((s, p) => s + (p.margemShort ?? 0) + (p.margemLong ?? 0), 0);
  const saldoTotal = est?.saldos ? Object.values(est.saldos).reduce((s, v) => s + v, 0) : (est?.capital ?? 0);
  const caixaDisponivel = Math.max(0, saldoTotal - margemUsada);
  const notionalBruto = posicoes.reduce((s, p) => s + (p.notionalPorPerna ?? 0) * 2, 0);
  const notionalLiquido = 0; // delta-neutro por construção — long ≈ short em cada posição
  const exposLong = posicoes.reduce((s, p) => s + (p.notionalPorPerna ?? 0), 0);
  const exposShort = exposLong; // par balanceado
  const alavancagem = saldoTotal > 0 ? notionalBruto / saldoTotal : 0;
  const pnlRealizado = est ? est.capital - est.capitalInicial : null;

  const porExchange = useMemo(() => {
    const m = new Map<string, number>();
    for (const p of posicoes) {
      m.set(p.exchangeShort, (m.get(p.exchangeShort) ?? 0) + (p.notionalPorPerna ?? 0));
      m.set(p.exchangeLong, (m.get(p.exchangeLong) ?? 0) + (p.notionalPorPerna ?? 0));
    }
    return [...m.entries()].map(([ex, notional]) => ({ ex, notional })).sort((a, b) => b.notional - a.notional);
  }, [posicoes]);
  const maxEx = Math.max(1, ...porExchange.map((e) => e.notional));

  const colExch: Coluna<{ ex: string; notional: number }>[] = [
    { chave: 'ex', titulo: 'Exchange', render: (e) => <span style={{ fontWeight: 700, textTransform: 'capitalize' }}>{e.ex}</span> },
    { chave: 'not', titulo: 'Notional', alinhar: 'right', render: (e) => fmt.usd(e.notional) },
    { chave: 'bar', titulo: '', largura: '160px', render: (e) => <RankBar valor={e.notional} max={maxEx} tom="info" /> },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-5)' }}>
      <PageHeader titulo="Portfolio" sub="Exposição agregada em quatro zonas. Patrimônio real do Champion e capital virtual dos challengers nunca se misturam." />
      {champion?.estado === 'erro' && <DataStateBanner kind="offline" motivo={champion.motivo} />}

      {/* ZONA A — Patrimônio real */}
      <Section titulo="A · Patrimônio real do Champion" sub="Dinheiro simulado real do sistema principal. Realizado já entrou no patrimônio; não-realizado depende do fechamento.">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(180px, 100%), 1fr))', gap: 'var(--space-3)' }}>
          <MetricCard label="Capital realizado" value={est?.capital ?? null} formatar={fmt.usd} destaque sub="patrimônio" />
          <MetricCard label="Equity mark" value={marc?.equityMark ?? null} formatar={fmt.usd} sub="realizado + não-realizado marcado" />
          <MetricCard label="Equity de liquidação" value={marc?.equityLiquidacao ?? null} formatar={fmt.usd} sub="se fechasse agora" />
          <MetricCard label="PnL realizado" value={pnlRealizado} formatar={fmt.usd} tone={fmt.tomPnl(pnlRealizado)} sub="já no patrimônio" />
          <MetricCard label="PnL não realizado" value={marc?.pnlNaoRealizadoMark ?? null} formatar={fmt.usd} tone={fmt.tomPnl(marc?.pnlNaoRealizadoMark ?? null)} sub="depende do fechamento" />
          <MetricCard label="Funding recebido" value={est?.fundingTotal ?? null} formatar={fmt.usd} tone="gain" />
          <MetricCard label="Custos pagos" value={est?.custosTotal ?? null} formatar={fmt.usd} tone="warn" />
        </div>
      </Section>

      {/* ZONA B — Dinheiro em uso */}
      <Section titulo="B · Dinheiro em uso" sub="Quanto do patrimônio está comprometido agora. Margem é dinheiro travado nas posições — nunca é lucro.">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(180px, 100%), 1fr))', gap: 'var(--space-3)' }}>
          <MetricCard label="Caixa disponível" value={caixaDisponivel} formatar={fmt.usd} sub="saldo − margem usada" />
          <MetricCard label="Margem utilizada" value={margemUsada} formatar={fmt.usd} tone="warn" sub="travada nas posições" />
          <MetricCard label="Saldo total (6 exchanges)" value={saldoTotal} formatar={fmt.usd} />
          <MetricCard label="Custo estimado de fechamento" value={marc?.custoEstimadoFechamentoTotal ?? null} formatar={fmt.usd} tone="warn" sub="estimativa, não somada ao realizado" />
        </div>
      </Section>

      {/* ZONA C — Exposição */}
      <Section titulo="C · Exposição" sub="Tamanho e risco de mercado. Notional é o tamanho da posição, não saldo. O motor é delta-neutro (long ≈ short).">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(160px, 100%), 1fr))', gap: 'var(--space-3)', marginBottom: 'var(--space-3)' }}>
          <MetricCard label="Notional bruto" value={notionalBruto} formatar={fmt.usd} sub={`${posicoes.length} posições`} />
          <MetricCard label="Notional líquido" value={notionalLiquido} formatar={fmt.usd} sub="delta-neutro" />
          <MetricCard label="Exposição long" value={exposLong} formatar={fmt.usd} />
          <MetricCard label="Exposição short" value={exposShort} formatar={fmt.usd} />
          <MetricCard label="Alavancagem efetiva" value={alavancagem} formatar={(n) => n.toFixed(2) + '×'} tone={alavancagem > 3 ? 'warn' : 'neutral'} />
        </div>
        {porExchange.length > 0 && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(280px, 100%), 1fr))', gap: 'var(--space-3)' }}>
            <div><div style={{ fontSize: 'var(--text-2xs)', fontWeight: 800, textTransform: 'uppercase', color: 'var(--ink-3)', marginBottom: 6 }}>Notional por exchange</div>
              <DataTable aria="Notional por exchange" colunas={colExch} linhas={porExchange} chaveLinha={(e) => e.ex} /></div>
          </div>
        )}
      </Section>

      {/* ZONA D — Laboratório virtual (SEPARADO, cor e fundo diferentes) */}
      <section style={{ background: 'linear-gradient(180deg, rgba(139,108,242,0.08), rgba(12,21,38,0.5))', border: '2px dashed var(--snow-violet)', borderRadius: 'var(--radius-lg)', padding: 'var(--space-5)', display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
          <h2 style={{ fontSize: 'var(--text-sm)', fontWeight: 800, margin: 0, color: 'var(--snow-violet)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>D · Laboratório virtual</h2>
          <StatusBadge label="PAPER LAB CAPITAL — NÃO FAZ PARTE DO PATRIMÔNIO DO CHAMPION" tom="violet" />
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(180px, 100%), 1fr))', gap: 'var(--space-3)' }}>
          <MiniViol label="Capital virtual total" valor={fmt.usd(resumo?.capitalVirtualTotal ?? null)} />
          <MiniViol label="Capital virtual médio" valor={resumo && resumo.numeroChallengers ? fmt.usd(resumo.capitalVirtualTotal / resumo.numeroChallengers) : '—'} />
          <MiniViol label="Challengers ativos" valor={fmt.int(resumo?.numeroAtivos ?? null)} />
          <MiniViol label="Trades paper" valor={fmt.int(resumo?.tradesTotaisPaper ?? null)} />
        </div>
        <p style={{ fontSize: 'var(--text-2xs)', color: 'var(--snow-violet)', margin: 0 }}>Esta zona nunca é somada às zonas A, B ou C. É capital de experimentos paper independentes.</p>
      </section>

      {/* Como ler esta página */}
      <Section titulo="Como ler esta página">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(260px, 100%), 1fr))', gap: 'var(--space-3)', fontSize: 'var(--text-2xs)', color: 'var(--ink-2)', lineHeight: 1.6 }}>
          <div><strong style={{ color: 'var(--ink-1)' }}>Capital</strong> é patrimônio — o que você tem.</div>
          <div><strong style={{ color: 'var(--ink-1)' }}>Margem</strong> é dinheiro comprometido nas posições, não lucro.</div>
          <div><strong style={{ color: 'var(--ink-1)' }}>Notional</strong> é o tamanho da posição, não o saldo.</div>
          <div><strong style={{ color: 'var(--ink-1)' }}>Exposição</strong> mede risco de mercado.</div>
          <div><strong style={{ color: 'var(--ink-1)' }}>PnL realizado</strong> já entrou no patrimônio; <strong style={{ color: 'var(--ink-1)' }}>não realizado</strong> ainda depende do fechamento.</div>
          <div><strong style={{ color: 'var(--snow-violet)' }}>Capital virtual</strong> pertence aos experimentos paper — nunca ao Champion.</div>
        </div>
      </Section>
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
