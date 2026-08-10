import { useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useOportunidades } from '../hooks/useOportunidades';
import { PageHeader, Section, DataTable, StatusBadge, RankBar, fmt, type Coluna } from '../components/ui/kit';
import { DataStateBanner } from '../components/feedback/DataState';
import type { Oportunidade } from '../schemas/opportunities';

/**
 * OPPORTUNITY MAP — OBSERVATION ONLY. Lê o endpoint read-only
 * `/api/v2/opportunities`, que agrega a fonte PERSISTENTE do motor
 * (inteligencia/oportunidades). A coleta é do motor, não do dashboard:
 * fechar a página, navegar, reiniciar o frontend/API não zera nada —
 * firstSeenAt é preservado, lastSeenAt avança, observationCount cresce.
 * Nenhuma execução de ordem. Campos não medidos vêm marcados, nunca zero.
 */
function idadeTxt(ms: number | null): string {
  if (ms == null) return '—';
  const m = ms / 60_000;
  if (m < 1) return 'agora';
  if (m < 60) return `${Math.round(m)} min atrás`;
  return `${(m / 60).toFixed(1)} h atrás`;
}
function hora(ts: number): string { return new Date(ts).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }); }

const COLLECTOR_TOM = { live: 'ok', stale: 'warn', offline: 'loss', empty: 'neutral' } as const;

export function OpportunityMap() {
  const resultado = useOportunidades();
  const [sel, setSel] = useState<string | null>(null);
  const [busca, setBusca] = useState('');
  const [filtro, setFiltro] = useState<'todas' | 'eligible' | 'blocked'>('todas');

  const dado = resultado?.estado === 'sucesso' ? resultado.dado : null;
  const items = dado?.items ?? [];

  const filtradas = useMemo(() => items
    .filter((o) => filtro === 'todas' || (filtro === 'eligible' ? o.eligible : o.blocked))
    .filter((o) => !busca || o.symbol.toLowerCase().includes(busca.toLowerCase()) || o.exchangeLong.includes(busca) || o.exchangeShort.includes(busca)),
    [items, filtro, busca]);

  const detalhe = filtradas.find((o) => o.observationId === sel) ?? filtradas[0] ?? null;

  const maxScore = Math.max(0.01, ...items.map((o) => Math.abs(o.qualityScore)));
  const maxPersist = Math.max(1, ...items.map((o) => o.persistenceCycles));

  const nomeCurto = (s: string) => s.replace('/USDT:USDT', '');

  const colunas: Coluna<Oportunidade>[] = [
    { chave: 'sym', titulo: 'Symbol', render: (o) => <span style={{ fontWeight: 700, color: 'var(--ink-0)' }}>{nomeCurto(o.symbol)}</span> },
    { chave: 'rota', titulo: 'Long → Short', render: (o) => <span style={{ color: 'var(--ink-2)' }}>{o.exchangeLong} → {o.exchangeShort}</span> },
    { chave: 'spread', titulo: 'Spread', alinhar: 'right', render: (o) => fmt.pct(o.spread * 100) },
    { chave: 'folga', titulo: 'Folga', alinhar: 'right', render: (o) => <span style={{ color: o.paybackSlack >= 0 ? 'var(--gain-500)' : 'var(--loss-500)' }}>{o.paybackSlack.toFixed(3)}</span> },
    { chave: 'persist', titulo: 'Persist.', alinhar: 'right', render: (o) => <span className="tabular">{o.persistenceCycles}c</span> },
    { chave: 'bar', titulo: 'Qualidade', largura: '110px', render: (o) => <RankBar valor={Math.max(0, o.qualityScore)} max={maxScore} tom={o.eligible ? 'gain' : 'neutral'} /> },
    { chave: 'st', titulo: 'Status', alinhar: 'center', render: (o) => o.eligible ? <StatusBadge label="elegível" tom="ok" /> : <StatusBadge label="bloqueada" tom="neutral" /> },
  ];

  const cs = dado?.collectorStatus;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-5)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', flexWrap: 'wrap' }}>
        <PageHeader titulo="Opportunity Map" sub="Oportunidades observadas pelo motor — a coleta é persistente (roda no motor, não no dashboard). Fechar a página não zera nada." />
        <StatusBadge label="OBSERVATION ONLY" tom="info" />
      </div>

      {resultado?.estado === 'erro' && <DataStateBanner kind="offline" motivo={resultado.motivo} />}
      {resultado?.estado === 'corrompido' && <DataStateBanner kind="corrupted" motivo={resultado.motivo} />}

      {/* saúde do coletor — honesto, nunca "0 oportunidades" quando offline */}
      {cs && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', flexWrap: 'wrap', padding: '10px 14px', background: 'var(--surface-glass)', border: `1px solid ${cs.estado === 'live' ? 'var(--gain-500)' : cs.estado === 'stale' ? 'var(--warn-500)' : 'var(--loss-500)'}`, borderRadius: 'var(--radius-md)' }}>
          <StatusBadge label={`coletor ${cs.estado}`} tom={COLLECTOR_TOM[cs.estado]} />
          <span style={{ fontSize: 'var(--text-2xs)', color: 'var(--ink-2)' }}>
            último ciclo {cs.ultimoCicloTs ? hora(cs.ultimoCicloTs) : '—'} · {idadeTxt(cs.idadeMs)} · {dado?.coverage.ciclosLidos} ciclos · {dado?.coverage.registrosLidos ?? '?'} registros de {dado?.coverage.arquivosProcessados?.length ?? 0} arquivo(s) · janela {dado?.coverage.janelaHoras}h {dado?.coverage.primeiroTs ? `(${hora(dado.coverage.primeiroTs)} → ${dado.coverage.ultimoTs ? hora(dado.coverage.ultimoTs) : '—'})` : ''}
          </span>
          {cs.estado !== 'live' && <span style={{ fontSize: 'var(--text-2xs)', color: 'var(--warn-500)' }}>mostrando último snapshot conhecido</span>}
        </div>
      )}

      {/* faixa superior de stats */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(150px, 100%), 1fr))', gap: 'var(--space-3)' }}>
        <MiniOp label="Observadas" valor={fmt.int(dado?.summary.total)} tom="info" />
        <MiniOp label="Elegíveis" valor={fmt.int(dado?.summary.eligible)} tom="ok" />
        <MiniOp label="Bloqueadas" valor={fmt.int(dado?.summary.blocked)} tom="warn" />
        <MiniOp label="Novas (1h)" valor={fmt.int(dado?.summary.novasUltimaHora)} />
        <MiniOp label="Persist. média" valor={dado ? `${dado.summary.persistenciaMediaCiclos}c` : '—'} />
        <MiniOp label="Melhor qualidade" valor={dado?.summary.melhorQualidade != null ? dado.summary.melhorQualidade.toFixed(2) : '—'} tom="ok" />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: detalhe ? 'minmax(0, 1.7fr) minmax(320px, 1fr)' : '1fr', gap: 'var(--space-4)', alignItems: 'start' }}>
        <Section
          titulo={`Oportunidades · ${filtradas.length}`}
          acao={
            <div style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center' }}>
              <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar…" aria-label="Buscar oportunidade"
                style={{ background: 'var(--surface-2)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-sm)', color: 'var(--ink-0)', fontSize: 'var(--text-xs)', padding: '6px 10px', width: 140 }} />
              <select value={filtro} onChange={(e) => setFiltro(e.target.value as typeof filtro)} aria-label="Filtrar por status"
                style={{ background: 'var(--surface-2)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-sm)', color: 'var(--ink-0)', fontSize: 'var(--text-xs)', padding: '6px 10px' }}>
                <option value="todas">todas</option><option value="eligible">elegíveis</option><option value="blocked">bloqueadas</option>
              </select>
            </div>
          }
        >
          {filtradas.length
            ? <DataTable aria="Oportunidades" colunas={colunas} linhas={filtradas.slice(0, 300)} chaveLinha={(o) => o.observationId} onSelecionar={(o) => setSel(o.observationId)} selecionada={detalhe?.observationId} />
            : <p style={{ color: 'var(--ink-3)', fontSize: 'var(--text-sm)' }}>{cs?.estado === 'empty' ? 'Nenhuma observação na janela.' : 'Nada no filtro atual.'}</p>}
        </Section>

        <AnimatePresence>
          {detalhe && (
            <motion.div key={detalhe.observationId} initial={{ opacity: 0, x: 12 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 12 }} transition={{ duration: 0.24, ease: [0.2, 0.7, 0.2, 1] }}
              style={{ position: 'sticky', top: 0, background: 'linear-gradient(180deg, var(--surface-glass), rgba(12,21,38,0.45))', border: '1px solid var(--border-strong)', borderRadius: 'var(--radius-lg)', padding: 'var(--space-5)', display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
              <div>
                <div style={{ fontSize: 'var(--text-lg)', fontWeight: 800, color: 'var(--ink-0)' }}>{nomeCurto(detalhe.symbol)}</div>
                <div style={{ fontSize: 'var(--text-2xs)', color: 'var(--ink-3)' }}>long {detalhe.exchangeLong} · short {detalhe.exchangeShort}</div>
              </div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {detalhe.eligible ? <StatusBadge label="ELEGÍVEL" tom="ok" /> : <StatusBadge label={`BLOQUEADA · ${detalhe.blockReasons.join(', ') || 'sem motivo'}`} tom="warn" />}
                <StatusBadge label={detalhe.active ? 'episódio ativo' : 'episódio encerrado'} tom={detalhe.active ? 'ok' : 'neutral'} />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-2)' }}>
                {([
                  ['Spread', fmt.pct(detalhe.spread * 100)],
                  ['Folga (payback)', detalhe.paybackSlack.toFixed(3)],
                  ['Qualidade (score)', detalhe.qualityScore.toFixed(2)],
                  ['Valor esperado', fmt.usd(detalhe.valorEsperado)],
                  ['Valor/hora', fmt.usd(detalhe.valorPorHora)],
                  ['Custo', fmt.usd(detalhe.custo)],
                  ['Capital necessário', fmt.usd(detalhe.capitalNecessario)],
                  ['APR', detalhe.apr.tracked ? String(detalhe.apr.valor) : 'não instrumentado'],
                  ['Liquidez', detalhe.liquidity.tracked ? String(detalhe.liquidity.valor) : 'não instrumentado'],
                  ['Settlement', detalhe.settlementAt.tracked ? hora(detalhe.settlementAt.valor!) : 'não instrumentado'],
                ] as [string, string][]).map(([lbl, val]) => (
                  <div key={lbl} style={{ background: 'var(--surface-1)', borderRadius: 'var(--radius-sm)', padding: '7px 9px' }}>
                    <div style={{ fontSize: '0.58rem', textTransform: 'uppercase', color: 'var(--ink-3)', fontWeight: 700 }}>{lbl}</div>
                    <div className="tabular" style={{ fontSize: 'var(--text-xs)', fontWeight: 700, color: val === 'não instrumentado' ? 'var(--ink-3)' : 'var(--ink-1)', marginTop: 2 }}>{val}</div>
                  </div>
                ))}
              </div>
              <div style={{ borderTop: '1px solid var(--border-hairline)', paddingTop: 'var(--space-3)', fontSize: 'var(--text-2xs)', color: 'var(--ink-3)', lineHeight: 1.7 }}>
                <div><strong style={{ color: 'var(--ink-2)' }}>Primeira observação (chave):</strong> {hora(detalhe.firstSeenAt)}</div>
                <div><strong style={{ color: 'var(--ink-2)' }}>Episódio atual desde:</strong> {hora(detalhe.episodeStartedAt)}{detalhe.episodeEndedAt ? ` · encerrado ${hora(detalhe.episodeEndedAt)}` : ' · em curso'}</div>
                <div><strong style={{ color: 'var(--ink-2)' }}>Última observação:</strong> {hora(detalhe.lastSeenAt)}</div>
                <div><strong style={{ color: 'var(--ink-2)' }}>Observações (chave):</strong> {detalhe.observationCount} · <strong style={{ color: 'var(--ink-2)' }}>persistência (episódio):</strong> {detalhe.persistenceCycles} ciclos</div>
                <div style={{ marginTop: 6 }}>Persistência <RankBar valor={detalhe.persistenceCycles} max={maxPersist} tom="info" /></div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

function MiniOp({ label, valor, tom = 'neutral' }: { label: string; valor: string; tom?: 'ok' | 'warn' | 'info' | 'neutral' }) {
  const cor = tom === 'ok' ? 'var(--gain-500)' : tom === 'warn' ? 'var(--warn-500)' : tom === 'info' ? 'var(--snow-accent)' : 'var(--ink-0)';
  return (
    <div style={{ background: 'var(--surface-glass)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-md)', padding: 'var(--space-4)' }}>
      <div style={{ fontSize: 'var(--text-2xs)', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--ink-2)' }}>{label}</div>
      <div className="tabular" style={{ fontSize: 'var(--text-xl)', fontWeight: 800, marginTop: 4, color: cor }}>{valor}</div>
    </div>
  );
}
