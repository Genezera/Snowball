import { useCompetidores } from '../hooks/useCompetidores';
import { PageHeader, Section, StatusBadge, fmt } from '../components/ui/kit';
import { EquityCurve } from '../components/charts/EquityCurve';
import { DataStateBanner } from '../components/feedback/DataState';

/**
 * COMPETIDORES — a dupla de 2 exchanges (bybit+bitget vs gate+okx), cada um mostrado
 * separado e completo, no estilo do dashboard do Champion: dinheiro, gráfico, ordens
 * abertas, o que o robô está pensando, e histórico de operações. Tudo paper, read-only.
 */
function Money({ c }: { c: any }) {
  const m = c.dinheiro;
  const stats: [string, string, string][] = [
    ['Capital', fmt.usd(m.capital), 'var(--ink-1)'],
    ['Lucro', (m.net >= 0 ? '+' : '') + fmt.usd(m.net), fmt.corPnl(m.net)],
    ['%/dia', `${m.pctDia}%`, fmt.corPnl(m.pctDia)],
    ['Funding', '+' + fmt.usd(m.funding), 'var(--engine-funding)'],
    ['Custos', '−' + fmt.usd(m.custos), 'var(--loss-500)'],
  ];
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(90px, 1fr))', gap: 8 }}>
      {stats.map(([lbl, val, cor]) => (
        <div key={lbl} style={{ padding: '6px 8px', background: 'var(--surface-2)', borderRadius: 8 }}>
          <div style={{ fontSize: '0.55rem', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--ink-3)', fontWeight: 800 }}>{lbl}</div>
          <div className="tabular" style={{ fontSize: 'var(--text-base)', fontWeight: 800, color: cor }}>{val}</div>
        </div>
      ))}
    </div>
  );
}

function Competidor({ c }: { c: any }) {
  if (!c.disponivel) return <Section titulo={c.par}><p style={{ color: 'var(--ink-3)' }}>Competidor ainda não iniciou.</p></Section>;
  const pontos = (c.curva ?? []).map((p: any) => ({ ts: p.ts, valor: p.capital }));
  const p = c.pensando;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
      {/* header + dinheiro */}
      <Section style={{ borderColor: c.vivo ? 'var(--engine-funding)' : 'var(--border-hairline)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
          <span style={{ fontWeight: 800, fontSize: 'var(--text-lg)' }}>{c.par}</span>
          <StatusBadge label={c.vivo ? '🟢 rodando' : '⏸ parado'} tom={c.vivo ? 'info' : 'neutral'} />
        </div>
        <Money c={c} />
        <div style={{ fontSize: 'var(--text-2xs)', color: 'var(--ink-3)', marginTop: 6 }}>US$ {c.dinheiro.capitalInicial} inicial · {c.dinheiro.dias} dias · paper</div>
      </Section>

      {/* gráfico */}
      <Section titulo="📈 Curva de capital">
        <EquityCurve titulo="" pontos={pontos.length ? pontos : null} state={pontos.length >= 2 ? 'success' : 'empty'} cor="var(--snow-primary)" height={150} />
      </Section>

      {/* o que está pensando */}
      <Section titulo="🧠 O que o robô está pensando" sub="Decisões em tempo real — por que entra ou espera.">
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, fontSize: 'var(--text-2xs)' }}>
          <div>🔎 Avaliadas: <b>{p.avaliadas}</b></div>
          <div>✅ Abertas: <b>{p.abertas}</b></div>
          <div>⏳ Aguardando persistência: <b>{p.aguardandoPersistencia}</b></div>
          <div>➖ Sem lucro (rejeitadas): <b>{p.rejeitadasSemEV}</b></div>
          <div>🔒 Fechadas: <b>{p.fechadas}</b></div>
          <div>🚧 Sem capacidade: <b>{p.semCapacidade}</b></div>
        </div>
        {p.candidatosObservados?.length > 0 && (
          <div style={{ marginTop: 8, fontSize: 'var(--text-2xs)', color: 'var(--ink-3)' }}>
            👀 <b>Observando</b> (esperando 30min de sinal): {p.candidatosObservados.join(', ')}
          </div>
        )}
      </Section>

      {/* ordens abertas */}
      <Section titulo={`🔓 Ordens abertas · ${c.abertas.length}`}>
        {c.abertas.length === 0 ? (
          <p style={{ color: 'var(--ink-3)', fontSize: 'var(--text-2xs)', margin: 0 }}>Nenhuma posição aberta agora.</p>
        ) : c.abertas.map((a: any, i: number) => (
          <div key={i} style={{ display: 'grid', gridTemplateColumns: '1fr auto auto', gap: 8, alignItems: 'center', padding: '5px 0', borderBottom: '1px solid var(--border-hairline)', fontSize: 'var(--text-2xs)' }}>
            <span><b>{a.symbol}</b> · {a.long}/{a.short}</span>
            <span className="tabular" style={{ color: 'var(--engine-funding)' }}>+{fmt.usd(a.fundingAcum)}</span>
            <span className="tabular" style={{ color: 'var(--ink-3)' }}>{a.holdH}h</span>
          </div>
        ))}
      </Section>

      {/* histórico de operações */}
      <Section titulo="📜 Histórico de operações">
        {c.operacoes.length === 0 ? (
          <p style={{ color: 'var(--ink-3)', fontSize: 'var(--text-2xs)', margin: 0 }}>Ainda sem operações — o robô entra só após 30min de sinal persistente.</p>
        ) : c.operacoes.map((o: any, i: number) => (
          <div key={i} style={{ display: 'grid', gridTemplateColumns: 'auto 1fr auto', gap: 8, alignItems: 'center', padding: '5px 0', borderBottom: '1px solid var(--border-hairline)', fontSize: 'var(--text-2xs)' }}>
            <span>{o.tipo === 'abre' ? '🟢' : (o.pnl >= 0 ? '✅' : '⚠️')}</span>
            <span><b>{o.symbol}</b> {o.tipo === 'fecha' && o.motivo ? <span style={{ color: 'var(--ink-3)' }}>· {o.motivo}</span> : ''}</span>
            <span className="tabular" style={{ color: o.tipo === 'fecha' ? fmt.corPnl(o.pnl) : 'var(--ink-3)' }}>
              {o.tipo === 'abre' ? `apr ${o.apr}` : `${o.pnl >= 0 ? '+' : ''}${fmt.usd(o.pnl)}`}
            </span>
          </div>
        ))}
      </Section>
    </div>
  );
}

export function Competidores() {
  const res = useCompetidores();
  const lista = res?.estado === 'sucesso' ? (res.dado?.competidores ?? []) : [];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-5)' }}>
      <PageHeader titulo="Competidores 2-Exchange" sub="A dupla que decide as 2 melhores exchanges para o dinheiro real. Cada um separado, completo: dinheiro, gráfico, ordens, o que pensa, histórico. Tudo paper." />
      {res?.estado === 'erro' && <DataStateBanner kind="offline" motivo={res.motivo} />}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: 'var(--space-5)', alignItems: 'start' }}>
        {lista.map((c: any) => <Competidor key={c.label} c={c} />)}
      </div>
      {lista.length === 0 && <Section><p style={{ color: 'var(--ink-3)' }}>Carregando competidores…</p></Section>}
    </div>
  );
}
