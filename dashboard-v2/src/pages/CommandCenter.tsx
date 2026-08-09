import { useCompetidores } from '../hooks/useCompetidores';
import { useSpotperp } from '../hooks/useSpotperp';
import { PageHeader, Section, StatusBadge, fmt } from '../components/ui/kit';
import { EquityCurve } from '../components/charts/EquityCurve';
import { DataStateBanner } from '../components/feedback/DataState';

/**
 * COMMAND CENTER — refeito do zero para a ideia ATUAL: o Motor Real 2-Exchange
 * (`snowball-2ex`), combinando funding cross-exchange + spot-perp, num único
 * contador de capital. Mostra, de forma organizada e para leigo: o dinheiro do
 * motor, a curva, o que ele está pensando, as posições e o histórico, e o RADAR
 * spot-perp (oportunidades reais do coletor). Tudo paper, só leitura.
 */

function BandaDinheiro({ m, posicoes }: { m: any; posicoes: number }) {
  const cards: [string, string, string, boolean?][] = [
    ['Capital · PAPER', fmt.usd(m?.capital ?? null), 'var(--snow-primary)', true],
    ['Lucro total', (m?.net >= 0 ? '+' : '') + fmt.usd(m?.net ?? null), fmt.corPnl(m?.net ?? 0)],
    ['%/dia', `${m?.pctDia ?? 0}%`, fmt.corPnl(m?.pctDia ?? 0)],
    ['Funding recebido', '+' + fmt.usd(m?.funding ?? null), 'var(--engine-funding)'],
    ['Rendimento reserva', '+' + fmt.usd(m?.rendimento ?? 0), 'var(--gain-500)'],
    ['Custos (taxas)', '−' + fmt.usd(m?.custos ?? null), 'var(--loss-500)'],
    ['Posições abertas', String(posicoes), posicoes > 0 ? 'var(--ink-0)' : 'var(--ink-3)'],
  ];
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', background: 'linear-gradient(180deg, var(--surface-glass), rgba(12,21,38,0.5))', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-lg)', overflow: 'hidden' }}>
      {cards.map(([lbl, val, cor, hero], i) => (
        <div key={lbl} style={{ flex: '1 1 150px', minWidth: 140, padding: 'var(--space-4) var(--space-5)', borderLeft: i > 0 ? '1px solid var(--border-hairline)' : 'none' }}>
          <div style={{ fontSize: '0.6rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--ink-3)' }}>{lbl}</div>
          <div className="tabular" style={{ fontSize: hero ? 'var(--text-2xl)' : 'var(--text-xl)', fontWeight: 800, marginTop: 4, color: cor as string }}>{val}</div>
        </div>
      ))}
    </div>
  );
}

function RadarSpotPerp() {
  const sp = useSpotperp();
  const d = sp?.estado === 'sucesso' ? sp.dado : null;
  const top = d?.top ?? [];
  return (
    <Section titulo="📡 Radar spot-perp (oportunidades reais)" sub={d ? `${d.total} oportunidades agora · atualiza a cada 10min` : 'carregando coletor…'}
      acao={d?.porExchange ? <span style={{ fontSize: 'var(--text-2xs)', color: 'var(--ink-3)' }}>{Object.entries(d.porExchange).map(([e, n]) => `${e}: ${n}`).join(' · ')}</span> : undefined}>
      {top.length === 0 ? (
        <p style={{ color: 'var(--ink-3)', fontSize: 'var(--text-xs)' }}>Sem oportunidades no último ciclo (ou coletor iniciando).</p>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 'var(--text-2xs)' }}>
            <thead>
              <tr style={{ color: 'var(--ink-3)', textAlign: 'left' }}>
                <th style={{ padding: '4px 6px', fontWeight: 700 }}>Moeda</th>
                <th style={{ padding: '4px 6px', fontWeight: 700 }}>Exchange</th>
                <th style={{ padding: '4px 6px', fontWeight: 700, textAlign: 'right' }}>Ganho/dia</th>
                <th style={{ padding: '4px 6px', fontWeight: 700, textAlign: 'right' }}>Paga em</th>
                <th style={{ padding: '4px 6px', fontWeight: 700, textAlign: 'right' }}>Liquidez</th>
              </tr>
            </thead>
            <tbody>
              {top.slice(0, 10).map((o: any, i: number) => (
                <tr key={o.sym + o.exchange + i} style={{ borderTop: '1px solid var(--border-hairline)' }}>
                  <td style={{ padding: '5px 6px', fontWeight: 700 }}>{o.sym}</td>
                  <td style={{ padding: '5px 6px', color: 'var(--ink-2)' }}>{o.exchange}</td>
                  <td className="tabular" style={{ padding: '5px 6px', textAlign: 'right', color: 'var(--gain-500)', fontWeight: 700 }}>{o.pctDia}%</td>
                  <td className="tabular" style={{ padding: '5px 6px', textAlign: 'right', color: 'var(--ink-3)' }}>{o.paybackDias}d</td>
                  <td className="tabular" style={{ padding: '5px 6px', textAlign: 'right', color: 'var(--ink-3)' }}>${(o.vol / 1e6).toFixed(1)}M</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p style={{ marginTop: 8, fontSize: '0.6rem', color: 'var(--ink-3)' }}>
        ℹ️ Spot-perp = comprar spot + shortar perp na MESMA exchange. Captura o funding <b>absoluto</b> (neutro, sem aposta em preço). "Ganho/dia" já é líquido das taxas do spot.
      </p>
    </Section>
  );
}

export function CommandCenter() {
  const res = useCompetidores();
  const motor = res?.estado === 'sucesso' ? (res.dado?.competidores ?? [])[0] : null;
  const m = motor?.dinheiro;
  const abertas = motor?.abertas ?? [];
  const operacoes = motor?.operacoes ?? [];
  const p = motor?.pensando;
  const pontos = (motor?.curva ?? []).map((c: any) => ({ ts: c.ts, valor: c.capital }));
  const vivo = !!motor?.vivo;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-5)' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--space-4)', flexWrap: 'wrap' }}>
        <PageHeader titulo="Command Center" sub="O Motor Real 2-Exchange (bybit + bitget) — funding cross-exchange + spot-perp, um capital só. Tudo paper por enquanto." />
        <StatusBadge label={vivo ? '🟢 rodando' : '⏸ iniciando'} tom={vivo ? 'info' : 'neutral'} />
      </div>

      {res?.estado === 'erro' && <DataStateBanner kind="offline" motivo={res.motivo} />}
      {!motor && res?.estado !== 'erro' && <Section><p style={{ color: 'var(--ink-3)' }}>Carregando o motor…</p></Section>}

      {motor && (
        <>
          <BandaDinheiro m={m} posicoes={abertas.length} />

          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1.6fr) minmax(300px, 1fr)', gap: 'var(--space-4)', alignItems: 'start' }}>
            {/* coluna principal */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
              <Section titulo="📈 Curva de capital" sub={`Início ${fmt.usd(m?.capitalInicial ?? 200)} · ${m?.dias ?? 0} dias · paper`}>
                <EquityCurve titulo="" pontos={pontos.length >= 2 ? pontos : null} state={pontos.length >= 2 ? 'success' : 'empty'} cor="var(--snow-primary)" height={230} />
              </Section>

              <Section titulo="🧠 O que o robô está pensando" sub="Decisões em tempo real — por que entra ou espera.">
                {p ? (
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, fontSize: 'var(--text-2xs)' }}>
                    <div>🔎 Avaliadas: <b>{p.avaliadas}</b></div>
                    <div>✅ Abertas: <b>{p.abertas}</b></div>
                    <div>⏳ Aguardando (30min): <b>{p.aguardandoPersistencia}</b></div>
                    <div>➖ Sem lucro: <b>{p.rejeitadasSemEV}</b></div>
                    <div>🔒 Fechadas: <b>{p.fechadas}</b></div>
                    <div>🚧 Sem capacidade: <b>{p.semCapacidade}</b></div>
                  </div>
                ) : <p style={{ color: 'var(--ink-3)', fontSize: 'var(--text-xs)' }}>—</p>}
              </Section>

              <RadarSpotPerp />
            </div>

            {/* coluna lateral */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
              <Section titulo={`🔓 Posições abertas · ${abertas.length}`}>
                {abertas.length === 0 ? (
                  <p style={{ color: 'var(--ink-3)', fontSize: 'var(--text-2xs)', margin: 0 }}>Nenhuma posição aberta agora.</p>
                ) : abertas.map((a: any, i: number) => (
                  <div key={i} style={{ display: 'grid', gridTemplateColumns: '1fr auto auto', gap: 8, alignItems: 'center', padding: '6px 0', borderBottom: '1px solid var(--border-hairline)', fontSize: 'var(--text-2xs)' }}>
                    <span>
                      <span title={a.tipo === 'spot-perp' ? 'spot-perp (mesma exchange)' : 'cross-exchange'}>{a.tipo === 'spot-perp' ? '📡' : '🔀'}</span> <b>{a.symbol}</b>
                      <span style={{ color: 'var(--ink-3)' }}> · {a.long}{a.short ? '/' + a.short : ''}</span>
                    </span>
                    <span className="tabular" style={{ color: 'var(--engine-funding)' }}>+{fmt.usd(a.fundingAcum)}</span>
                    <span className="tabular" style={{ color: 'var(--ink-3)' }}>{a.holdH}h</span>
                  </div>
                ))}
              </Section>

              <Section titulo="📜 Operações recentes">
                {operacoes.length === 0 ? (
                  <p style={{ color: 'var(--ink-3)', fontSize: 'var(--text-2xs)', margin: 0 }}>Ainda sem operações — entra após 30min de sinal persistente.</p>
                ) : operacoes.slice(0, 10).map((o: any, i: number) => (
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
          </div>
        </>
      )}
    </div>
  );
}
