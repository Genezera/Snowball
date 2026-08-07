import { useLiveStore } from '../stores/liveStore';
import { PnLWaterfall } from '../components/charts/PnLWaterfall';
import { DataStateBanner, EmptyIllustration } from '../components/feedback/DataState';

function fmtUsd(n: number): string {
  const s = n < 0 ? '-' : '';
  return s + 'US$ ' + Math.abs(n).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function fmtPctNaoAplicavel(n: number | null): string {
  return n == null || !isFinite(n) ? 'não aplicável' : (n * 100).toFixed(1) + '%';
}

export function CostIntelligence() {
  const profitLab = useLiveStore((s) => s.profitLab);
  const custos = profitLab?.estado === 'sucesso' ? profitLab.dado.custos : null;
  const champion = custos?.champion ?? null;
  const janela = profitLab?.estado === 'sucesso' ? profitLab.dado.janelaComum : null;

  const etapas = champion ? [
    { label: 'Funding bruto', valor: champion.fundingBruto },
    { label: 'Taxa entrada', valor: -champion.taxaEntrada },
    { label: 'Taxa saída', valor: -champion.taxaSaida },
    { label: 'Escalonamento', valor: -champion.custoEscalonamento },
    { label: 'Apara', valor: -champion.custoApara },
    { label: 'Reinvestimento', valor: -champion.custoReinvestimento },
    { label: 'Emergencial', valor: -champion.custoEmergencial },
    { label: 'PnL líquido', valor: 0 },
  ] : null;

  const porChallenger = custos?.porChallenger ?? [];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-6)' }}>
      <div>
        <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 'var(--text-2xl)', margin: 0, fontWeight: 600 }}>Cost Intelligence</h1>
        <p style={{ color: 'var(--ink-2)', fontSize: 'var(--text-sm)', margin: '4px 0 0' }}>
          {champion && champion.fundingBruto > 0 && (champion.custoTotal / champion.fundingBruto) > 0.4
            ? `Aproximadamente ${((champion.custoTotal / champion.fundingBruto) * 100).toFixed(0)}% do funding bruto observado foi consumido por custos.`
            : 'Decomposição de custos do champion e de cada challenger.'}
        </p>
      </div>

      {!profitLab && <DataStateBanner kind="loading" />}
      {profitLab?.estado === 'erro' && <DataStateBanner kind="offline" motivo={profitLab.motivo} />}

      <PnLWaterfall etapas={etapas} state={etapas ? 'success' : 'empty'} />

      {janela?.champion && (
        <section style={{ background: 'var(--surface-1)', border: '1px solid var(--border-hairline)', borderRadius: 'var(--radius-lg)', padding: 'var(--space-4)' }}>
          <h2 style={{ fontSize: 'var(--text-2xs)', fontWeight: 700, margin: '0 0 10px', color: 'var(--ink-2)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            Delta da janela comum ({janela.duracaoJanelaMinutos.toFixed(0)}min) — nunca confundir com o total acumulado acima
          </h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(160px, 100%), 1fr))', gap: 12, fontSize: 'var(--text-xs)' }}>
            <div><div style={{ color: 'var(--ink-3)' }}>Funding (delta)</div><div className="tabular" style={{ fontWeight: 700 }}>{fmtUsd(janela.champion.fundingTotal.deltaNaJanela)}</div></div>
            <div><div style={{ color: 'var(--ink-3)' }}>Custos (delta)</div><div className="tabular" style={{ fontWeight: 700 }}>{fmtUsd(janela.champion.custosTotal.deltaNaJanela)}</div></div>
            <div><div style={{ color: 'var(--ink-3)' }}>PnL econômico (delta)</div><div className="tabular" style={{ fontWeight: 700 }}>{janela.champion.pnlEconomicoNaJanela != null ? fmtUsd(janela.champion.pnlEconomicoNaJanela) : 'não disponível'}</div></div>
          </div>
        </section>
      )}

      {champion && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 'var(--text-2xs)', color: 'var(--ink-3)', maxWidth: 680 }}>
          <p style={{ margin: 0 }}>
            <strong style={{ color: 'var(--warn-500)' }}>Totais acumulados numa JANELA</strong>, não o histórico vitalício inteiro
            (o backend lê até 4.000 linhas recentes do diário) — pode divergir um pouco do PnL vitalício mostrado no Champion View.
          </p>
          <p style={{ margin: 0 }}>
            <strong>Tendência temporal: indisponível.</strong> Não existe série de custo por dia — mostrar este total como se fosse
            "custo médio diário" seria construir uma tendência a partir de um número que não é periódico. Ver Champion View para funding por dia (esse sim é uma série real).
          </p>
        </div>
      )}

      <section aria-label="Custo por challenger">
        <h2 style={{ fontSize: 'var(--text-sm)', fontWeight: 700, margin: '0 0 var(--space-3)', color: 'var(--ink-1)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
          Custo por challenger
        </h2>
        {!porChallenger.length ? (
          <div style={{ background: 'var(--surface-1)', border: '1px dashed var(--border-subtle)', borderRadius: 'var(--radius-lg)' }}>
            <EmptyIllustration label="Sem dados suficientes" />
          </div>
        ) : (
          <div tabIndex={0} role="region" aria-label="Tabela de custo por challenger, role horizontal" style={{ overflowX: 'auto', border: '1px solid var(--border-hairline)', borderRadius: 'var(--radius-lg)' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 'var(--text-xs)' }}>
              <thead>
                <tr style={{ background: 'var(--surface-2)' }}>
                  {['Challenger', 'Trading puro', 'Gerenciamento', 'Total', 'Fee/gross trading', 'Fee/gross total'].map((h) => (
                    <th key={h} style={{ textAlign: h === 'Challenger' ? 'left' : 'right', padding: '8px 12px', color: 'var(--ink-2)', fontWeight: 700, textTransform: 'uppercase', fontSize: 'var(--text-2xs)' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {porChallenger.map((c) => (
                  <tr key={c.challengerId} style={{ borderTop: '1px solid var(--border-hairline)' }}>
                    <td style={{ padding: '7px 12px', fontWeight: 600 }}>{c.challengerId}</td>
                    <td className="tabular" style={{ padding: '7px 12px', textAlign: 'right' }}>{fmtUsd(c.custoTradingPuro)}</td>
                    <td className="tabular" style={{ padding: '7px 12px', textAlign: 'right' }}>{fmtUsd(c.custoGerenciamento)}</td>
                    <td className="tabular" style={{ padding: '7px 12px', textAlign: 'right', fontWeight: 700 }}>{fmtUsd(c.custoTotal)}</td>
                    <td className="tabular" style={{ padding: '7px 12px', textAlign: 'right', color: c.feeToGrossTrading == null ? 'var(--ink-3)' : undefined }}>{fmtPctNaoAplicavel(c.feeToGrossTrading)}</td>
                    <td className="tabular" style={{ padding: '7px 12px', textAlign: 'right', color: c.feeToGrossTotal == null ? 'var(--ink-3)' : undefined }}>{fmtPctNaoAplicavel(c.feeToGrossTotal)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
