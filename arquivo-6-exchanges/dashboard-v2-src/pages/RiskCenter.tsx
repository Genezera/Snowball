import { useLiveStore } from '../stores/liveStore';
import { DataStateBanner, EmptyIllustration } from '../components/feedback/DataState';

function fmtPct(n: number): string { return n.toFixed(1) + '%'; }
function fmtUsd(n: number): string { return 'US$ ' + n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }

export function RiskCenter() {
  const profitLab = useLiveStore((s) => s.profitLab);
  const riscos = profitLab?.estado === 'sucesso' ? profitLab.dado.riscos?.porChallenger ?? [] : [];
  const leaderboard = profitLab?.estado === 'sucesso' ? profitLab.dado.leaderboard?.linhas ?? [] : [];
  const cenariosPorId = new Map(leaderboard.map((l) => [l.challengerId, l.cenarios]));

  const altoRisco = riscos.filter((r) => r.altoRiscoAlavancagem);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-6)' }}>
      <div>
        <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 'var(--text-2xl)', margin: 0, fontWeight: 600 }}>Risk Center</h1>
        <p style={{ color: 'var(--ink-2)', fontSize: 'var(--text-sm)', margin: '4px 0 0' }}>
          Drawdown, concentração e cenários de stress — PnL bruto maior nunca esconde risco maior.
        </p>
      </div>

      {!profitLab && <DataStateBanner kind="loading" />}
      {profitLab?.estado === 'erro' && <DataStateBanner kind="offline" motivo={profitLab.motivo} />}

      {/* achado real (axe): --loss-glow (25% opacidade) contra --loss-500 dava
          4.46:1, abaixo do 4.5:1 exigido — fundo local mais escuro (15%) só
          nesta seção crítica, sem alterar o token global usado em outros
          lugares (ex.: DrawdownChart) */}
      {altoRisco.length > 0 && (
        <section style={{ background: 'rgba(224, 102, 122, 0.15)', border: '1px solid var(--loss-500)', borderRadius: 'var(--radius-lg)', padding: 'var(--space-4)' }}>
          <h2 style={{ margin: '0 0 10px', fontSize: 'var(--text-xs)', fontWeight: 800, letterSpacing: '0.05em', color: 'var(--loss-500)' }}>
            ⚠ PAPER EXPERIMENT — HIGH RISK ({altoRisco.length} challenger{altoRisco.length > 1 ? 's' : ''} acima de 5× alavancagem)
          </h2>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {altoRisco.map((r) => (
              <span key={r.challengerId} style={{ fontSize: 'var(--text-2xs)', fontWeight: 700, padding: '4px 10px', borderRadius: 'var(--radius-full)', background: 'var(--surface-1)', color: 'var(--loss-500)', border: '1px solid var(--loss-500)' }}>
                {r.challengerId}
              </span>
            ))}
          </div>
        </section>
      )}

      <section aria-label="Risco por challenger">
        <h2 style={{ fontSize: 'var(--text-sm)', fontWeight: 700, margin: '0 0 var(--space-3)', color: 'var(--ink-1)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
          Drawdown &amp; concentração
        </h2>
        {!riscos.length ? (
          <div style={{ background: 'var(--surface-1)', border: '1px dashed var(--border-subtle)', borderRadius: 'var(--radius-lg)' }}><EmptyIllustration label="Sem dados suficientes" /></div>
        ) : (
          <div tabIndex={0} role="region" aria-label="Tabela de drawdown e concentração, role horizontal" style={{ overflowX: 'auto', border: '1px solid var(--border-hairline)', borderRadius: 'var(--radius-lg)' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 'var(--text-xs)' }}>
              <thead>
                <tr style={{ background: 'var(--surface-2)' }}>
                  {['Challenger', 'Drawdown', 'Concentração', 'Posições', 'Capital ocioso', 'Alavancagem'].map((h) => (
                    <th key={h} style={{ textAlign: h === 'Challenger' ? 'left' : 'right', padding: '8px 12px', color: 'var(--ink-2)', fontWeight: 700, textTransform: 'uppercase', fontSize: 'var(--text-2xs)' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {riscos.map((r) => (
                  <tr key={r.challengerId} style={{ borderTop: '1px solid var(--border-hairline)' }}>
                    <td style={{ padding: '7px 12px', fontWeight: 600 }}>{r.challengerId}</td>
                    <td className="tabular" style={{ padding: '7px 12px', textAlign: 'right', color: r.drawdownMaxPct > 10 ? 'var(--loss-500)' : undefined }}>{fmtPct(r.drawdownMaxPct)}</td>
                    <td className="tabular" style={{ padding: '7px 12px', textAlign: 'right' }}>{fmtPct(r.concentracaoMaxima * 100)}</td>
                    <td className="tabular" style={{ padding: '7px 12px', textAlign: 'right' }}>{r.posicoesAbertas}</td>
                    <td className="tabular" style={{ padding: '7px 12px', textAlign: 'right' }}>{fmtUsd(r.capitalOcioso)}</td>
                    <td style={{ padding: '7px 12px', textAlign: 'right' }}>
                      {r.altoRiscoAlavancagem
                        ? <span style={{ fontSize: 'var(--text-2xs)', fontWeight: 800, color: 'var(--loss-500)' }}>ALTO RISCO</span>
                        : <span style={{ color: 'var(--ink-3)' }}>padrão</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section aria-label="Cenários de realismo">
        <h2 style={{ fontSize: 'var(--text-sm)', fontWeight: 700, margin: '0 0 var(--space-3)', color: 'var(--ink-1)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
          Cenários — ideal · base · conservador · stress
        </h2>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(260px, 100%), 1fr))', gap: 'var(--space-3)' }}>
          {leaderboard.slice(0, 12).map((l) => {
            const c = cenariosPorId.get(l.challengerId);
            if (!c) return null;
            return (
              <div key={l.challengerId} style={{ background: 'var(--surface-1)', border: '1px solid var(--border-hairline)', borderRadius: 'var(--radius-md)', padding: 'var(--space-3)' }}>
                <div style={{ fontWeight: 700, fontSize: 'var(--text-xs)', marginBottom: 8 }}>{l.challengerId} {l.altoRiscoAlavancagem && <span style={{ color: 'var(--loss-500)' }}>⚠</span>}</div>
                {(['ideal', 'base', 'conservador', 'stress'] as const).map((nome) => (
                  <div key={nome} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 'var(--text-2xs)', padding: '2px 0' }}>
                    <span style={{ color: 'var(--ink-3)', textTransform: 'capitalize' }}>{nome}</span>
                    <span className="tabular" style={{ color: (c[nome] ?? 0) >= 0 ? 'var(--gain-500)' : 'var(--loss-500)' }}>{c[nome] != null ? fmtUsd(c[nome]!) : '—'}</span>
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}
