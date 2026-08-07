import { useLiveStore } from '../../stores/liveStore';

/**
 * TICKER (item 7 da reconstrução desktop) — barra horizontal de ativos,
 * herdada do dashboard antigo. Movimento contínuo e suave (marquee), nunca
 * pisca nem muda largura bruscamente. Dados REAIS: cada posição aberta do
 * champion vira dois itens (uma perna por exchange), com preço ao vivo e a
 * variação desde a entrada. Nada é fabricado — se não há posição, o ticker
 * mostra um estado honesto de "sem posições".
 */
interface ItemTicker { sym: string; exchange: string; preco: number | null; variacao: number | null }

function nomeCurto(symbol: string): string {
  return symbol.replace('/USDT:USDT', '').replace('/USDT', '');
}
function fmtPreco(n: number): string {
  const casas = n < 1 ? 5 : n < 100 ? 3 : 2;
  return 'US$ ' + n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: casas });
}
function fmtVar(n: number): string {
  return (n >= 0 ? '+' : '') + (n * 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + '%';
}

export function Ticker() {
  const champion = useLiveStore((s) => s.champion);
  const posicoes = champion?.estado === 'sucesso' ? champion.dado.posicoes ?? [] : [];

  const itens: ItemTicker[] = [];
  for (const p of posicoes) {
    const sym = nomeCurto(p.symbol);
    const entrada = p.precoEntrada;
    const precoS = p.precoAoVivoShort ?? p.precoUltimo ?? null;
    const precoL = p.precoAoVivoLong ?? p.precoUltimo ?? null;
    const varS = p.variacaoShort ?? (precoS != null && entrada ? (precoS - entrada) / entrada : null);
    const varL = p.variacaoLong ?? (precoL != null && entrada ? (precoL - entrada) / entrada : null);
    itens.push({ sym, exchange: p.exchangeShort, preco: precoS, variacao: varS });
    itens.push({ sym, exchange: p.exchangeLong, preco: precoL, variacao: varL });
  }

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
            const cor = it.variacao == null ? 'var(--ink-3)' : it.variacao >= 0 ? 'var(--gain-500)' : 'var(--loss-500)';
            return (
              <span key={i} style={{ display: 'inline-flex', alignItems: 'center', gap: 7, padding: '0 var(--space-5)', fontSize: 'var(--text-2xs)' }}>
                <span style={{ fontWeight: 800, color: 'var(--ink-0)', letterSpacing: '0.02em' }}>{it.sym}</span>
                <span style={{ color: 'var(--ink-3)' }}>· {it.exchange}</span>
                <span className="tabular" style={{ color: 'var(--ink-1)' }}>{it.preco != null ? fmtPreco(it.preco) : '—'}</span>
                {it.variacao != null && <span className="tabular" style={{ color: cor, fontWeight: 700 }}>{fmtVar(it.variacao)}</span>}
              </span>
            );
          })}
        </div>
      )}
    </div>
  );
}
