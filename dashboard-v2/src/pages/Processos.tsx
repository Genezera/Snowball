import { useLiveStore } from '../stores/liveStore';
import { PageHeader, Section, StatusBadge, fmt } from '../components/ui/kit';
import { DataStateBanner } from '../components/feedback/DataState';

/**
 * PROCESSOS — topologia operacional (read-only). Cada nó é um processo real
 * do sistema (motor, coletor, vigilância, custódia, pares, momentum,
 * preenchimento, dashboard). Mostra vivo/morto, memória e há quanto tempo
 * está de pé. A página NÃO controla processos — só observa.
 */
function idade(desdeMs: number): string {
  const h = (Date.now() - desdeMs) / 3_600_000;
  if (h < 1) return Math.round(h * 60) + ' min';
  if (h < 48) return h.toFixed(1) + ' h';
  return (h / 24).toFixed(1) + ' d';
}

export function Processos() {
  const champion = useLiveStore((s) => s.champion);
  const profitLab = useLiveStore((s) => s.profitLab);
  const processos = champion?.estado === 'sucesso' ? champion.dado.processos ?? [] : [];
  const tel = profitLab?.estado === 'sucesso' ? profitLab.dado.telemetria : null;

  const vivos = processos.filter((p) => p.vivo).length;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-5)' }}>
      <PageHeader titulo="Processos" sub="Topologia operacional read-only — os processos reais do Snowball. Esta página observa; nunca inicia, para ou reinicia nada." />
      {champion?.estado === 'erro' && <DataStateBanner kind="offline" motivo={champion.motivo} />}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(160px, 100%), 1fr))', gap: 'var(--space-3)' }}>
        <MiniStat label="Processos vivos" valor={`${vivos} / ${processos.length}`} tom={vivos === processos.length ? 'ok' : 'warn'} />
        <MiniStat label="Memória total" valor={`${processos.reduce((s, p) => s + (p.memoriaMB ?? 0), 0)} MB`} />
        <MiniStat label="Ciclos (Profit Lab)" valor={fmt.int(tel?.ciclosProcessados)} />
        <MiniStat label="Reinícios (Lab)" valor={fmt.int(tel?.reinicios)} tom={(tel?.reinicios ?? 0) > 3 ? 'warn' : 'neutral'} />
      </div>

      <Section titulo="Nós do sistema" sub="Cada card é um processo. A cor da faixa indica vivo (ciano) ou caído (vermelho).">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(230px, 100%), 1fr))', gap: 'var(--space-3)' }}>
          {processos.map((p) => (
            <div key={p.chave} style={{ position: 'relative', overflow: 'hidden', background: 'var(--surface-1)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-md)', padding: 'var(--space-4)', display: 'flex', flexDirection: 'column', gap: 6 }}>
              <span aria-hidden style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 2, background: p.vivo ? 'var(--snow-primary)' : 'var(--loss-500)' }} />
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                <span style={{ fontWeight: 800, color: 'var(--ink-0)', fontSize: 'var(--text-sm)' }}>{p.nome}</span>
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: p.vivo ? 'var(--gain-500)' : 'var(--loss-500)', animation: p.vivo ? 'snow-pulse 1.8s infinite' : 'none', flex: 'none' }} />
              </div>
              <code style={{ fontSize: 'var(--text-2xs)', color: 'var(--ink-3)' }}>{(p as { padrao?: string }).padrao ?? p.chave}</code>
              <div style={{ display: 'flex', gap: 'var(--space-4)', marginTop: 4 }}>
                <div><div style={{ fontSize: '0.58rem', textTransform: 'uppercase', color: 'var(--ink-3)', fontWeight: 700 }}>Memória</div><div className="tabular" style={{ fontSize: 'var(--text-sm)', fontWeight: 700 }}>{p.memoriaMB} MB</div></div>
                <div><div style={{ fontSize: '0.58rem', textTransform: 'uppercase', color: 'var(--ink-3)', fontWeight: 700 }}>Uptime</div><div className="tabular" style={{ fontSize: 'var(--text-sm)', fontWeight: 700 }}>{idade(p.desde)}</div></div>
              </div>
              <div style={{ marginTop: 2 }}><StatusBadge label={p.vivo ? 'vivo' : 'caído'} tom={p.vivo ? 'ok' : 'loss'} /></div>
            </div>
          ))}
        </div>
      </Section>

      {tel && (
        <Section titulo="Latência do Profit Lab" sub="Percentis do tempo de ciclo do agregador (ms).">
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(120px, 100%), 1fr))', gap: 'var(--space-3)' }}>
            {(['p50', 'p95', 'p99', 'max'] as const).map((k) => (
              <MiniStat key={k} label={k} valor={`${tel.latencia[k]} ms`} tom={tel.latencia[k] > 5000 ? 'warn' : 'neutral'} />
            ))}
          </div>
        </Section>
      )}
    </div>
  );
}

function MiniStat({ label, valor, tom = 'neutral' }: { label: string; valor: string; tom?: 'ok' | 'warn' | 'neutral' | 'loss' }) {
  const cor = tom === 'ok' ? 'var(--gain-500)' : tom === 'warn' ? 'var(--warn-500)' : tom === 'loss' ? 'var(--loss-500)' : 'var(--ink-0)';
  return (
    <div style={{ background: 'var(--surface-glass)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-md)', padding: 'var(--space-4)' }}>
      <div style={{ fontSize: 'var(--text-2xs)', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--ink-2)' }}>{label}</div>
      <div className="tabular" style={{ fontSize: 'var(--text-xl)', fontWeight: 800, marginTop: 4, color: cor }}>{valor}</div>
    </div>
  );
}
