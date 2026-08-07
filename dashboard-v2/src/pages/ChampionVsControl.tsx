import { useLiveStore } from '../stores/liveStore';
import { PageHeader, Section, StatusBadge, fmt } from '../components/ui/kit';
import { DataStateBanner } from '../components/feedback/DataState';

/**
 * CHAMPION vs. CONTROL — comparação direta e honesta. O Champion é dinheiro
 * simulado real; o Control é um challenger de referência (capital virtual).
 * A comparação principal é pela JANELA COMUM; lifetime fica separado e
 * marcado, porque os dois têm históricos de tamanhos diferentes.
 */
function LinhaComparativa({ rotulo, a, b, corA, corB, melhor }: { rotulo: string; a: string; b: string; corA?: string; corB?: string; melhor?: 'a' | 'b' | null }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr auto 1fr', alignItems: 'center', gap: 'var(--space-4)', padding: '10px 0', borderBottom: '1px solid var(--border-hairline)' }}>
      <div className="tabular" style={{ textAlign: 'right', fontWeight: melhor === 'a' ? 800 : 600, color: corA ?? 'var(--ink-1)', fontSize: 'var(--text-base)' }}>
        {a}{melhor === 'a' && <span style={{ color: 'var(--snow-primary)', marginLeft: 6 }}>◂</span>}
      </div>
      <div style={{ fontSize: '0.6rem', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--ink-3)', fontWeight: 800, textAlign: 'center', minWidth: 120 }}>{rotulo}</div>
      <div className="tabular" style={{ textAlign: 'left', fontWeight: melhor === 'b' ? 800 : 600, color: corB ?? 'var(--ink-1)', fontSize: 'var(--text-base)' }}>
        {melhor === 'b' && <span style={{ color: 'var(--snow-violet)', marginRight: 6 }}>▸</span>}{b}
      </div>
    </div>
  );
}

export function ChampionVsControl() {
  const profitLab = useLiveStore((s) => s.profitLab);
  const resumo = profitLab?.estado === 'sucesso' ? profitLab.dado.resumo : null;
  const ch = resumo?.champion ?? null;
  const ct = resumo?.control ?? null;

  const semControl = !ct;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-5)' }}>
      <PageHeader titulo="Champion vs. Control" sub="Comparação espelhada. Champion = dinheiro simulado real (funding arb). Control = challenger de referência (capital virtual). Comparação principal pela janela comum; lifetime separado." />
      {profitLab?.estado === 'erro' && <DataStateBanner kind="offline" motivo={profitLab.motivo} />}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-4)' }}>
        <Section style={{ borderColor: 'var(--engine-funding)' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontWeight: 800, color: 'var(--snow-primary)', fontSize: 'var(--text-base)' }}>Champion</span>
            <StatusBadge label="real simulado" tom="info" />
          </div>
          <div className="tabular" style={{ fontSize: 'var(--text-2xl)', fontWeight: 800, color: fmt.corPnl(ch?.pnlRealizado ?? null) }}>{fmt.usd(ch?.pnlRealizado ?? null)}</div>
          <div style={{ fontSize: 'var(--text-2xs)', color: 'var(--ink-3)' }}>PnL realizado · {fmt.pct(ch?.pnlPct ?? null)}</div>
        </Section>
        <Section style={{ borderColor: 'var(--engine-pairs)' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontWeight: 800, color: 'var(--snow-violet)', fontSize: 'var(--text-base)' }}>Control</span>
            <StatusBadge label="paper · virtual" tom="violet" />
          </div>
          <div className="tabular" style={{ fontSize: 'var(--text-2xl)', fontWeight: 800, color: fmt.corPnl(ct?.pnlAjustado ?? null) }}>{fmt.usd(ct?.pnlAjustado ?? null)}</div>
          <div style={{ fontSize: 'var(--text-2xs)', color: 'var(--ink-3)' }}>PnL ajustado · {fmt.pct(ct?.retornoPct ?? null)}</div>
        </Section>
      </div>

      {semControl ? (
        <Section><p style={{ color: 'var(--ink-3)', fontSize: 'var(--text-sm)' }}>Control indisponível no resumo atual — sem comparação a mostrar.</p></Section>
      ) : (
        <Section titulo="Comparação lado a lado" sub="Valores absolutos. A seta aponta o lado mais favorável em cada métrica.">
          <div>
            <LinhaComparativa rotulo="PnL" a={fmt.usd(ch?.pnlRealizado ?? null)} b={fmt.usd(ct?.pnlAjustado ?? null)} corA={fmt.corPnl(ch?.pnlRealizado ?? null)} corB={fmt.corPnl(ct?.pnlAjustado ?? null)} melhor={(ch?.pnlRealizado ?? 0) >= (ct?.pnlAjustado ?? 0) ? 'a' : 'b'} />
            <LinhaComparativa rotulo="Retorno %" a={fmt.pct(ch?.pnlPct ?? null)} b={fmt.pct(ct?.retornoPct ?? null)} corA={fmt.corPnl(ch?.pnlPct ?? null)} corB={fmt.corPnl(ct?.retornoPct ?? null)} melhor={(ch?.pnlPct ?? 0) >= (ct?.retornoPct ?? 0) ? 'a' : 'b'} />
            <LinhaComparativa rotulo="Funding bruto" a={fmt.usd(ch?.fundingBruto ?? null)} b="—" melhor="a" />
            <LinhaComparativa rotulo="Custos totais" a={fmt.usd(ch?.custosTotais ?? null)} b="—" />
            <LinhaComparativa rotulo="Trades" a="—" b={fmt.int(ct?.trades ?? null)} />
            <LinhaComparativa rotulo="Capital atual" a={fmt.usd(ch?.capitalAtual ?? null)} b="—" />
          </div>
          <p style={{ fontSize: 'var(--text-2xs)', color: 'var(--ink-3)', margin: 0 }}>
            Alguns campos do Control não são expostos pelo resumo atual (mostrados como "—", nunca fabricados). O funding bruto e os custos são específicos do motor de funding do Champion.
          </p>
        </Section>
      )}
    </div>
  );
}
