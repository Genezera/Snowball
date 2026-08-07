import { useLiveStore, idadeDoDado, LIMITE_STALE_MS } from '../stores/liveStore';
import { PageHeader, Section, StatusBadge, fmt } from '../components/ui/kit';

/**
 * SYSTEM HEALTH — visão AGREGADA e de incidentes (diferente de Processos,
 * que lista componentes um a um). Agrupa por domínio: trading, inteligência,
 * dashboards, supervisão. Só leitura.
 */
type Sev = 'ok' | 'warn' | 'loss';
function sevBadge(s: Sev, txt: string) { return <StatusBadge label={txt} tom={s === 'ok' ? 'ok' : s === 'warn' ? 'warn' : 'loss'} />; }

export function SystemHealth() {
  const champion = useLiveStore((s) => s.champion);
  const profitLab = useLiveStore((s) => s.profitLab);
  const chStatus = useLiveStore((s) => s.championStatus);
  const plStatus = useLiveStore((s) => s.profitLabStatus);

  const tel = profitLab?.estado === 'sucesso' ? profitLab.dado.telemetria : null;
  const hb = profitLab?.estado === 'sucesso' ? profitLab.dado.heartbeat : null;
  const vig = champion?.estado === 'sucesso' ? (champion.dado as { vigilancia?: { viva?: boolean; candidatos?: number; idadeMinutos?: number } }).vigilancia : null;
  const processos = champion?.estado === 'sucesso' ? champion.dado.processos ?? [] : [];

  const chIdade = idadeDoDado(champion);
  const plIdade = idadeDoDado(profitLab);
  const chStale = chIdade != null && chIdade > LIMITE_STALE_MS;
  const plStale = plIdade != null && plIdade > LIMITE_STALE_MS;

  const dominios: { titulo: string; itens: { nome: string; sev: Sev; detalhe: string }[] }[] = [
    {
      titulo: 'Trading',
      itens: [
        { nome: 'Champion (funding arb)', sev: champion?.estado === 'sucesso' && !chStale ? 'ok' : chStale ? 'warn' : 'loss', detalhe: chStale ? `dado stale (${chIdade != null ? Math.round(chIdade / 1000) : '?'}s)` : `dado ${chStatus}` },
        { nome: 'Motor / posições', sev: processos.find((p) => p.chave === 'motor')?.vivo ? 'ok' : 'loss', detalhe: processos.find((p) => p.chave === 'motor')?.vivo ? 'processo vivo' : 'processo caído' },
      ],
    },
    {
      titulo: 'Inteligência',
      itens: [
        { nome: 'Paper Profit Lab', sev: profitLab?.estado === 'sucesso' && !plStale ? 'ok' : plStale ? 'warn' : 'loss', detalhe: plStale ? 'dado stale' : `dado ${plStatus}` },
        { nome: 'Ciclos do agregador', sev: (tel?.ciclosComErro ?? 0) > 0 ? 'warn' : 'ok', detalhe: `${fmt.int(tel?.ciclosProcessados)} ciclos · ${fmt.int(tel?.ciclosComErro)} com erro` },
        { nome: 'Erros últimas 24h', sev: (tel?.errosUltimas24h ?? 0) > 0 ? 'warn' : 'ok', detalhe: `${fmt.int(tel?.errosUltimas24h)} erros` },
        { nome: 'Reinícios do Lab', sev: (tel?.reinicios ?? 0) > 3 ? 'warn' : 'ok', detalhe: `${fmt.int(tel?.reinicios)} reinícios` },
      ],
    },
    {
      titulo: 'Coleta & Vigilância',
      itens: [
        { nome: 'Coletor', sev: processos.find((p) => p.chave === 'coletor')?.vivo ? 'ok' : 'loss', detalhe: processos.find((p) => p.chave === 'coletor')?.vivo ? 'vivo' : 'caído' },
        { nome: 'Vigilância de mercado', sev: vig?.viva ? 'ok' : 'warn', detalhe: vig ? `${vig.candidatos ?? 0} candidatos · idade ${vig.idadeMinutos != null ? vig.idadeMinutos.toFixed(1) : '?'} min` : 'sem dado' },
      ],
    },
    {
      titulo: 'Dashboards & Supervisão',
      itens: [
        { nome: 'Dashboard 2.0 (este)', sev: 'ok', detalhe: 'API V2 read-only · porta 5184' },
        { nome: 'Dashboard antigo (legacy)', sev: processos.find((p) => p.chave === 'dashboard')?.vivo ? 'ok' : 'warn', detalhe: 'server.ts · porta 8787' },
        { nome: 'Heartbeat do Lab', sev: hb ? 'ok' : 'warn', detalhe: hb ? `pid ${hb.pid} · ${fmt.int(hb.ciclosProcessados)} ciclos` : 'sem heartbeat' },
      ],
    },
  ];

  const incidentes = dominios.flatMap((d) => d.itens).filter((i) => i.sev !== 'ok');

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-5)' }}>
      <PageHeader titulo="System Health" sub="Visão agregada de saúde e incidentes por domínio. Read-only. Para o detalhe processo-a-processo, ver Processos." />

      <Section titulo={incidentes.length ? `${incidentes.length} ponto(s) de atenção` : 'Todos os domínios saudáveis'} style={incidentes.length ? { borderColor: 'var(--warn-500)' } : { borderColor: 'var(--gain-500)' }}>
        {incidentes.length === 0
          ? <p style={{ color: 'var(--gain-500)', fontSize: 'var(--text-sm)', fontWeight: 700 }}>Nenhum incidente aberto — trading, inteligência, coleta e dashboards operando.</p>
          : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {incidentes.map((i) => (
                <div key={i.nome} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '8px 12px', background: 'var(--surface-1)', borderRadius: 'var(--radius-sm)', borderLeft: `2px solid ${i.sev === 'warn' ? 'var(--warn-500)' : 'var(--loss-500)'}` }}>
                  <span style={{ fontWeight: 700, fontSize: 'var(--text-sm)' }}>{i.nome}</span>
                  <span style={{ fontSize: 'var(--text-2xs)', color: 'var(--ink-2)' }}>{i.detalhe}</span>
                  {sevBadge(i.sev, i.sev)}
                </div>
              ))}
            </div>
          )}
      </Section>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(300px, 100%), 1fr))', gap: 'var(--space-4)' }}>
        {dominios.map((d) => (
          <Section key={d.titulo} titulo={d.titulo}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {d.itens.map((i) => (
                <div key={i.nome} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, padding: '7px 0', borderBottom: '1px solid var(--border-hairline)' }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontWeight: 700, fontSize: 'var(--text-sm)', color: 'var(--ink-0)' }}>{i.nome}</div>
                    <div style={{ fontSize: 'var(--text-2xs)', color: 'var(--ink-3)' }}>{i.detalhe}</div>
                  </div>
                  {sevBadge(i.sev, i.sev === 'ok' ? 'ok' : i.sev)}
                </div>
              ))}
            </div>
          </Section>
        ))}
      </div>
    </div>
  );
}
