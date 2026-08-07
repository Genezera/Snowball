import { useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useLiveStore } from '../stores/liveStore';
import { PageHeader, Section, DataTable, StatusBadge, RankBar, fmt, type Coluna } from '../components/ui/kit';
import { DataStateBanner } from '../components/feedback/DataState';

/**
 * CHALLENGER ARENA — central dos 47 challengers. Tabela densa + painel de
 * detalhe ao selecionar (master-detail em telas largas). Junta
 * leaderboardMulti + riscos + custos por challengerId. Capital sempre
 * marcado como virtual.
 */
interface LinhaArena {
  id: string; familia: string; capitalVirtual: number; pnl: number; pnlPct: number;
  drawdown: number; dias: number | null; comparavel: boolean; nota: string;
  concentracao: number | null; altoRisco: boolean; posicoes: number | null; ocioso: number | null;
  custoTotal: number | null; feeToGross: number | null;
}

export function ChallengerArena() {
  const profitLab = useLiveStore((s) => s.profitLab);
  const dado = profitLab?.estado === 'sucesso' ? profitLab.dado : null;
  const [sel, setSel] = useState<string | null>(null);
  const [busca, setBusca] = useState('');
  const [soRisco, setSoRisco] = useState(false);

  const linhas = useMemo<LinhaArena[]>(() => {
    if (!dado) return [];
    const risco = new Map((dado.riscos?.porChallenger ?? []).map((r) => [r.challengerId, r]));
    const custo = new Map((dado.custos?.porChallenger ?? []).map((c) => [c.challengerId, c]));
    return (dado.leaderboardMulti?.linhas ?? [])
      .filter((l) => l.familia === 'funding-challenger')
      .map((l) => {
        const r = risco.get(l.strategyId); const c = custo.get(l.strategyId);
        return {
          id: l.strategyId, familia: l.familia, capitalVirtual: l.capitalVirtual, pnl: l.pnlDesdeOInicio, pnlPct: l.pnlPct,
          drawdown: l.drawdownMaxPct, dias: l.diasRodando, comparavel: l.comparavelNaJanela, nota: l.nota,
          concentracao: r?.concentracaoMaxima ?? null, altoRisco: r?.altoRiscoAlavancagem ?? false,
          posicoes: r?.posicoesAbertas ?? null, ocioso: r?.capitalOcioso ?? null,
          custoTotal: c?.custoTotal ?? null, feeToGross: c?.feeToGrossTotal ?? null,
        };
      });
  }, [dado]);

  const filtradas = useMemo(() => linhas
    .filter((l) => !busca || l.id.toLowerCase().includes(busca.toLowerCase()))
    .filter((l) => !soRisco || l.altoRisco)
    .sort((a, b) => b.pnl - a.pnl), [linhas, busca, soRisco]);

  const detalhe = filtradas.find((l) => l.id === sel) ?? null;
  const maxPnl = Math.max(1, ...linhas.map((l) => Math.abs(l.pnl)));

  const colunas: Coluna<LinhaArena>[] = [
    { chave: 'id', titulo: 'Challenger', render: (l) => <span style={{ fontWeight: 700, color: 'var(--ink-0)' }}>{l.id.replace('challenger-', '')}</span> },
    { chave: 'pnl', titulo: 'PnL virtual', alinhar: 'right', render: (l) => <span style={{ color: fmt.corPnl(l.pnl), fontWeight: 700 }}>{fmt.usd(l.pnl)}</span> },
    { chave: 'bar', titulo: '', largura: '90px', render: (l) => <RankBar valor={l.pnl} max={maxPnl} tom={l.pnl >= 0 ? 'gain' : 'loss'} /> },
    { chave: 'dd', titulo: 'DD', alinhar: 'right', render: (l) => fmt.pct(-Math.abs(l.drawdown)) },
    { chave: 'pos', titulo: 'Pos', alinhar: 'right', render: (l) => fmt.int(l.posicoes) },
    { chave: 'risco', titulo: 'Risco', alinhar: 'center', render: (l) => l.altoRisco ? <StatusBadge label="alto" tom="loss" /> : <StatusBadge label="ok" tom="ok" /> },
    { chave: 'jan', titulo: 'Janela', alinhar: 'center', render: (l) => l.comparavel ? <StatusBadge label="comp." tom="info" /> : <StatusBadge label="fora" tom="neutral" /> },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-5)' }}>
      <PageHeader titulo="Challenger Arena" sub="Os 47 challengers do Paper Profit Lab — capital 100% virtual. Selecione um para ver a tese, o risco, os custos e a janela de comparabilidade." />
      {profitLab?.estado === 'erro' && <DataStateBanner kind="offline" motivo={profitLab.motivo} />}
      {profitLab?.estado === 'corrompido' && <DataStateBanner kind="corrupted" motivo={profitLab.motivo} />}

      <div style={{ display: 'grid', gridTemplateColumns: detalhe ? 'minmax(0, 1.6fr) minmax(320px, 1fr)' : '1fr', gap: 'var(--space-4)', alignItems: 'start' }}>
        <Section
          titulo={`Challengers · ${filtradas.length}`}
          acao={
            <div style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center' }}>
              <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar…" aria-label="Buscar challenger"
                style={{ background: 'var(--surface-2)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-sm)', color: 'var(--ink-0)', fontSize: 'var(--text-xs)', padding: '6px 10px', width: 160 }} />
              <button onClick={() => setSoRisco((v) => !v)} aria-pressed={soRisco}
                style={{ background: soRisco ? 'rgba(255,92,122,0.14)' : 'var(--surface-2)', border: `1px solid ${soRisco ? 'var(--loss-500)' : 'var(--border-subtle)'}`, borderRadius: 'var(--radius-sm)', color: soRisco ? 'var(--loss-500)' : 'var(--ink-2)', fontSize: 'var(--text-2xs)', fontWeight: 700, padding: '6px 10px', cursor: 'pointer' }}>
                só alto risco
              </button>
            </div>
          }
        >
          <DataTable aria="Challengers" colunas={colunas} linhas={filtradas} chaveLinha={(l) => l.id} onSelecionar={(l) => setSel(l.id)} selecionada={sel ?? undefined} />
        </Section>

        <AnimatePresence>
          {detalhe && (
            <motion.div initial={{ opacity: 0, x: 12 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 12 }} transition={{ duration: 0.24, ease: [0.2, 0.7, 0.2, 1] }}
              style={{ position: 'sticky', top: 0, background: 'linear-gradient(180deg, var(--surface-glass), rgba(12,21,38,0.45))', border: '1px solid var(--border-strong)', borderRadius: 'var(--radius-lg)', padding: 'var(--space-5)', display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 }}>
                <div>
                  <div style={{ fontSize: 'var(--text-base)', fontWeight: 800, color: 'var(--ink-0)' }}>{detalhe.id.replace('challenger-', '')}</div>
                  <div style={{ fontSize: 'var(--text-2xs)', color: 'var(--ink-3)', marginTop: 2 }}>{detalhe.id}</div>
                </div>
                <button onClick={() => setSel(null)} aria-label="Fechar detalhe" style={{ background: 'transparent', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-sm)', color: 'var(--ink-2)', cursor: 'pointer', padding: '2px 8px' }}>✕</button>
              </div>
              <StatusBadge label="PAPER · capital virtual" tom="violet" />
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-3)', marginTop: 4 }}>
                {[
                  ['Capital virtual', fmt.usd(detalhe.capitalVirtual), 'var(--ink-0)'],
                  ['PnL', fmt.usd(detalhe.pnl), fmt.corPnl(detalhe.pnl)],
                  ['Retorno', fmt.pct(detalhe.pnlPct), fmt.corPnl(detalhe.pnlPct)],
                  ['Drawdown', fmt.pct(-Math.abs(detalhe.drawdown)), 'var(--ink-1)'],
                  ['Posições', fmt.int(detalhe.posicoes), 'var(--ink-1)'],
                  ['Concentração', detalhe.concentracao != null ? fmt.pct(detalhe.concentracao * 100) : '—', 'var(--ink-1)'],
                  ['Custo total', fmt.usd(detalhe.custoTotal), 'var(--ink-1)'],
                  ['Fee-to-gross', detalhe.feeToGross != null ? fmt.pct(detalhe.feeToGross * 100) : '—', 'var(--ink-1)'],
                  ['Capital ocioso', fmt.usd(detalhe.ocioso), 'var(--ink-2)'],
                  ['Rodando', fmt.dias(detalhe.dias), 'var(--ink-2)'],
                ].map(([lbl, val, cor]) => (
                  <div key={lbl} style={{ background: 'var(--surface-1)', borderRadius: 'var(--radius-sm)', padding: '8px 10px' }}>
                    <div style={{ fontSize: '0.6rem', textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--ink-3)', fontWeight: 700 }}>{lbl}</div>
                    <div className="tabular" style={{ fontSize: 'var(--text-sm)', fontWeight: 700, color: cor as string, marginTop: 2 }}>{val}</div>
                  </div>
                ))}
              </div>
              <div style={{ marginTop: 4 }}>
                {detalhe.altoRisco && <StatusBadge label="PAPER EXPERIMENT — HIGH RISK" tom="loss" />}
              </div>
              <div style={{ fontSize: 'var(--text-2xs)', color: 'var(--ink-3)', lineHeight: 1.5, borderTop: '1px solid var(--border-hairline)', paddingTop: 'var(--space-3)' }}>
                <strong style={{ color: 'var(--ink-2)' }}>Janela:</strong> {detalhe.comparavel ? 'dentro da janela comum — comparável.' : 'fora da janela comum.'} {detalhe.nota}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
