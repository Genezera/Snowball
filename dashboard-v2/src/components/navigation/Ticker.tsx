import { useCompetidores } from '../../hooks/useCompetidores';

/**
 * TICKER (item 7 da reconstrução desktop) — barra horizontal de ativos.
 * Movimento contínuo e suave (marquee), nunca pisca nem muda largura
 * bruscamente. Dados REAIS: cada posição aberta do motor real (snowball-2ex)
 * vira um item, com o par de exchanges e o APR/funding acumulado — o motor
 * não rastreia preço ao vivo por posição (só funding/economia), então o
 * ticker mostra o que ele de fato mede, não um preço fabricado. Retargetado
 * pro motor atual depois do arquivamento do Champion (6 exchanges) — ver
 * arquivo-6-exchanges/README.md. Nada é fabricado — se não há posição, o
 * ticker mostra um estado honesto de "sem posições".
 */
interface ItemTicker { sym: string; par: string; apr: number | null; funding: number | null }

function fmtApr(n: number): string {
  return (n >= 0 ? '+' : '') + n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + '% a.a.';
}
function fmtFunding(n: number): string {
  return 'US$ ' + n.toLocaleString('pt-BR', { minimumFractionDigits: 4, maximumFractionDigits: 4 });
}

export function Ticker() {
  const competidores = useCompetidores();
  const abertas = competidores?.estado === 'sucesso' ? (competidores.dado?.competidores ?? []).flatMap((c: any) => c.abertas ?? []) : [];

  const itens: ItemTicker[] = abertas.map((p: any) => ({
    sym: p.symbol, par: p.tipo === 'spot-perp' ? `${p.long} spot+perp` : `${p.long}/${p.short}`,
    apr: p.aprEntrada ?? null, funding: p.fundingAcum ?? null,
  }));

  const vazio = itens.length === 0;
  // duplicar a lista dá o loop contínuo sem "salto" ao reiniciar o marquee
  const linha = vazio ? [] : [...itens, ...itens];

  return (
    <div
      role="marquee" aria-label="Cotações das posições abertas"
      style={{
        flex: 'none', height: 34, display: 'flex', alignItems: 'center', overflow: 'hidden',
        borderBottom: '1px solid var(--border-hairline)', background: 'rgba(5,11,24,0.6)',
        maskImage: 'linear-gradient(90deg, transparent, #000 3%, #000 97%, transparent)',
        WebkitMaskImage: 'linear-gradient(90deg, transparent, #000 3%, #000 97%, transparent)',
      }}
    >
      {vazio ? (
        <span style={{ padding: '0 var(--space-6)', fontSize: 'var(--text-2xs)', color: 'var(--ink-3)', letterSpacing: '0.04em' }}>
          Sem posições abertas — o ticker acompanha as pernas das posições ativas.
        </span>
      ) : (
        <div className="ticker-track" style={{ display: 'inline-flex', alignItems: 'center', whiteSpace: 'nowrap', willChange: 'transform' }}>
          {linha.map((it, i) => {
            const cor = it.apr == null ? 'var(--ink-3)' : it.apr >= 0 ? 'var(--gain-500)' : 'var(--loss-500)';
            return (
              <span key={i} style={{ display: 'inline-flex', alignItems: 'center', gap: 7, padding: '0 var(--space-5)', fontSize: 'var(--text-2xs)' }}>
                <span style={{ fontWeight: 800, color: 'var(--ink-0)', letterSpacing: '0.02em' }}>{it.sym}</span>
                <span style={{ color: 'var(--ink-3)' }}>· {it.par}</span>
                {it.apr != null && <span className="tabular" style={{ color: cor, fontWeight: 700 }}>{fmtApr(it.apr)}</span>}
                <span className="tabular" style={{ color: 'var(--ink-1)' }}>{it.funding != null ? fmtFunding(it.funding) : '—'}</span>
              </span>
            );
          })}
        </div>
      )}
    </div>
  );
}
