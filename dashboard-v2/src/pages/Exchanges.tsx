import { useMemo } from 'react';
import { useLiveStore } from '../stores/liveStore';
import { PageHeader, Section, DataTable, StatusBadge, RankBar, fmt, type Coluna } from '../components/ui/kit';
import { DataStateBanner } from '../components/feedback/DataState';

/**
 * EXCHANGES — comparação operacional por exchange do Champion. Saldo,
 * capital alocado, PnL desde o início (saldo - inicial), posições abertas
 * naquela exchange. Sem concluir causalidade com amostra insuficiente — o
 * PnL por exchange é observação de ~4 dias, marcado como tal.
 */
interface LinhaEx {
  nome: string; saldo: number; inicial: number; pnl: number; pnlPct: number;
  posicoesShort: number; posicoesLong: number;
}

export function Exchanges() {
  const champion = useLiveStore((s) => s.champion);
  const dado = champion?.estado === 'sucesso' ? champion.dado : null;

  const linhas = useMemo<LinhaEx[]>(() => {
    if (!dado?.estado) return [];
    const saldos = (dado.estado as { saldos?: Record<string, number>; saldosIniciais?: Record<string, number> }).saldos ?? {};
    const iniciais = (dado.estado as { saldosIniciais?: Record<string, number> }).saldosIniciais ?? {};
    const posicoes = dado.posicoes ?? [];
    return Object.entries(saldos).map(([nome, saldo]) => {
      const inicial = iniciais[nome] ?? 0;
      return {
        nome, saldo, inicial, pnl: saldo - inicial, pnlPct: inicial ? (saldo - inicial) / inicial * 100 : 0,
        posicoesShort: posicoes.filter((p) => p.exchangeShort === nome).length,
        posicoesLong: posicoes.filter((p) => p.exchangeLong === nome).length,
      };
    }).sort((a, b) => b.pnl - a.pnl);
  }, [dado]);

  const maxAbs = Math.max(1, ...linhas.map((l) => Math.abs(l.pnl)));
  const totalSaldo = linhas.reduce((s, l) => s + l.saldo, 0);

  const colunas: Coluna<LinhaEx>[] = [
    { chave: 'nome', titulo: 'Exchange', render: (l) => <span style={{ fontWeight: 700, color: 'var(--ink-0)', textTransform: 'capitalize' }}>{l.nome}</span> },
    { chave: 'saldo', titulo: 'Saldo', alinhar: 'right', render: (l) => fmt.usd(l.saldo) },
    { chave: 'ini', titulo: 'Inicial', alinhar: 'right', render: (l) => <span style={{ color: 'var(--ink-3)' }}>{fmt.usd(l.inicial)}</span> },
    { chave: 'pnl', titulo: 'PnL', alinhar: 'right', render: (l) => <span style={{ color: fmt.corPnl(l.pnl), fontWeight: 700 }}>{fmt.usd(l.pnl)}</span> },
    { chave: 'pct', titulo: '%', alinhar: 'right', render: (l) => <span style={{ color: fmt.corPnl(l.pnlPct) }}>{fmt.pct(l.pnlPct)}</span> },
    { chave: 'bar', titulo: '', largura: '120px', render: (l) => <RankBar valor={l.pnl} max={maxAbs} tom={l.pnl >= 0 ? 'gain' : 'loss'} /> },
    { chave: 'pos', titulo: 'Pernas (S/L)', alinhar: 'center', render: (l) => <span className="tabular">{l.posicoesShort} / {l.posicoesLong}</span> },
    { chave: 'st', titulo: 'Status', alinhar: 'center', render: (l) => <StatusBadge label={l.pnl >= 0 ? 'no verde' : 'no vermelho'} tom={l.pnl >= 0 ? 'ok' : 'loss'} /> },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-5)' }}>
      <PageHeader titulo="Exchanges" sub="Comparação operacional por exchange do Champion (6 exchanges financiadas, US$ 100 declarados em cada). O PnL por exchange é observação de poucos dias — não conclui causalidade." />
      {champion?.estado === 'erro' && <DataStateBanner kind="offline" motivo={champion.motivo} />}
      {champion?.estado === 'corrompido' && <DataStateBanner kind="corrupted" motivo={champion.motivo} />}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(150px, 100%), 1fr))', gap: 'var(--space-3)' }}>
        {linhas.map((l) => (
          <div key={l.nome} style={{ position: 'relative', overflow: 'hidden', background: 'var(--surface-glass)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-md)', padding: 'var(--space-4)' }}>
            <span aria-hidden style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 2, background: `linear-gradient(90deg, ${l.pnl >= 0 ? 'var(--gain-500)' : 'var(--loss-500)'}, transparent 70%)` }} />
            <div style={{ fontSize: 'var(--text-2xs)', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--ink-2)' }}>{l.nome}</div>
            <div className="tabular" style={{ fontSize: 'var(--text-lg)', fontWeight: 800, marginTop: 4 }}>{fmt.usd(l.saldo)}</div>
            <div className="tabular" style={{ fontSize: 'var(--text-xs)', color: fmt.corPnl(l.pnl), marginTop: 2 }}>{fmt.usd(l.pnl)} · {fmt.pct(l.pnlPct)}</div>
          </div>
        ))}
      </div>

      <Section titulo="Ranking por exchange" sub={`Saldo agregado: ${fmt.usd(totalSaldo)}. Short/Long = quantas pernas de posições abertas usam a exchange em cada lado.`}>
        <DataTable aria="Exchanges" colunas={colunas} linhas={linhas} chaveLinha={(l) => l.nome} />
      </Section>
    </div>
  );
}
