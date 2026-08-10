import { useSystemHealth } from '../hooks/useSystemHealth';
import { PageHeader, Section, StatusBadge, Grid } from '../components/ui/kit';
import { DataStateBanner } from '../components/feedback/DataState';

/**
 * SYSTEM HEALTH — recriada pro motor 2-ex (snowball-2ex) depois do arquivamento
 * do bloco "6 exchanges" (a versão anterior, pro Champion, ficou em
 * arquivo-6-exchanges/dashboard-v2-src/pages/SystemHealth.tsx). Agrupa por
 * domínio: motor, scanner (infra compartilhada de que o motor depende),
 * spot-perp, utilização de capital, dashboard. Só leitura — tudo vem de
 * `/api/v2/system-health`, que lê heartbeat/timestamp já escritos por cada
 * componente (sem listar processos do SO).
 */
type Sev = 'ok' | 'warn' | 'loss' | 'info';
interface Item { nome: string; sev: Sev; detalhe: string }
interface Dominio { titulo: string; itens: Item[] }

function sevBadge(s: Sev) {
  const tom = s === 'ok' ? 'ok' : s === 'warn' ? 'warn' : s === 'loss' ? 'loss' : 'info';
  const label = s === 'ok' ? 'ok' : s === 'warn' ? 'atenção' : s === 'loss' ? 'crítico' : 'info';
  return <StatusBadge label={label} tom={tom} />;
}

export function SystemHealth() {
  const resultado = useSystemHealth();

  if (!resultado) return <DataStateBanner kind="loading" />;
  if (resultado.estado === 'erro') return <DataStateBanner kind="offline" motivo={resultado.motivo} />;
  if (resultado.estado === 'corrompido') return <DataStateBanner kind="corrupted" motivo={resultado.motivo} />;
  const dados = resultado.dado;
  if (!dados) return <DataStateBanner kind="empty" />;

  const dominios = dados.dominios as Dominio[];
  const incidentes = dominios.flatMap((d) => d.itens).filter((i) => i.sev === 'warn' || i.sev === 'loss');
  const critico = incidentes.some((i) => i.sev === 'loss');

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-5)' }}>
      <PageHeader
        titulo="System Health"
        sub="Saúde do motor snowball-2ex e da infraestrutura de que ele depende (scanner, spot-perp). Read-only, atualiza a cada 10s."
      />

      <Section
        titulo={incidentes.length ? `${incidentes.length} ponto(s) de atenção` : 'Todos os domínios saudáveis'}
        style={{ borderColor: incidentes.length ? (critico ? 'var(--loss-500)' : 'var(--warn-500)') : 'var(--gain-500)' }}
      >
        {incidentes.length === 0 ? (
          <p style={{ color: 'var(--gain-500)', fontSize: 'var(--text-sm)', fontWeight: 700 }}>
            Motor, scanner e spot-perp operando normalmente. Reconciliação ao centavo sem quebra.
          </p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {incidentes.map((i) => (
              <div key={i.nome} style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
                padding: '8px 12px', background: 'var(--surface-1)', borderRadius: 'var(--radius-sm)',
                borderLeft: `2px solid ${i.sev === 'loss' ? 'var(--loss-500)' : 'var(--warn-500)'}`,
              }}>
                <span style={{ fontWeight: 700, fontSize: 'var(--text-sm)' }}>{i.nome}</span>
                <span style={{ fontSize: 'var(--text-2xs)', color: 'var(--ink-2)' }}>{i.detalhe}</span>
                {sevBadge(i.sev)}
              </div>
            ))}
          </div>
        )}
      </Section>

      <Grid min={300}>
        {dominios.map((d) => (
          <Section key={d.titulo} titulo={d.titulo}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {d.itens.length === 0 && <span style={{ fontSize: 'var(--text-2xs)', color: 'var(--ink-3)' }}>sem dado ainda</span>}
              {d.itens.map((i) => (
                <div key={i.nome} style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10,
                  padding: '7px 0', borderBottom: '1px solid var(--border-hairline)',
                }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontWeight: 700, fontSize: 'var(--text-sm)', color: 'var(--ink-0)' }}>{i.nome}</div>
                    <div style={{ fontSize: 'var(--text-2xs)', color: 'var(--ink-3)' }}>{i.detalhe}</div>
                  </div>
                  {sevBadge(i.sev)}
                </div>
              ))}
            </div>
          </Section>
        ))}
      </Grid>

      <p style={{ fontSize: 'var(--text-2xs)', color: 'var(--ink-3)' }}>
        Atualizado em {new Date(dados.geradoEm).toLocaleTimeString('pt-BR')}. Paper trading — nenhuma ordem real.
      </p>
    </div>
  );
}
