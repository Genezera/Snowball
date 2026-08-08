import { Link } from 'react-router-dom';
import { PageHeader, Section, StatusBadge } from '../components/ui/kit';

/**
 * PESQUISA — a função de "pesquisa" do dashboard antigo (catálogo de
 * estratégias, hipóteses, comparações) foi ABSORVIDA por páginas dedicadas
 * no novo dashboard. Em vez de manter uma rota vazia (proibido), esta página
 * documenta a fusão e redireciona para onde cada função vive agora.
 */
const DESTINOS = [
  { to: '/strategies', titulo: 'Strategy Universe', desc: 'Catálogo de todas as estratégias por categoria — antes espalhado na Pesquisa.' },
  { to: '/experiments', titulo: 'Experiment Lab', desc: 'Experimentos paper, hipóteses (momentum, pares, captura) e resultados.' },
  { to: '/champion-vs-control', titulo: 'Champion vs. Control', desc: 'Comparação direta e honesta pela janela comum.' },
  { to: '/arena', titulo: 'Challenger Arena', desc: 'Os 47 challengers com tese, risco, custos e comparabilidade.' },
];

export function Pesquisa() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-5)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', flexWrap: 'wrap' }}>
        <PageHeader titulo="Pesquisa" sub="A antiga área de pesquisa foi fundida em páginas dedicadas — esta rota documenta a fusão e leva a cada uma." />
        <StatusBadge label="fundida" tom="info" />
      </div>

      <Section titulo="Para onde a pesquisa foi">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(280px, 100%), 1fr))', gap: 'var(--space-3)' }}>
          {DESTINOS.map((d) => (
            <Link key={d.to} to={d.to} style={{ textDecoration: 'none' }}>
              <div style={{ background: 'var(--surface-1)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-md)', padding: 'var(--space-4)', height: '100%', transition: 'border-color var(--dur-fast) var(--ease-out)' }}
                onMouseEnter={(e) => { e.currentTarget.style.borderColor = 'var(--border-strong)'; }}
                onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'var(--border-subtle)'; }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <span style={{ fontWeight: 800, color: 'var(--snow-primary)', fontSize: 'var(--text-sm)' }}>{d.titulo}</span>
                  <span style={{ color: 'var(--snow-primary)' }}>→</span>
                </div>
                <p style={{ fontSize: 'var(--text-2xs)', color: 'var(--ink-2)', margin: '6px 0 0', lineHeight: 1.5 }}>{d.desc}</p>
              </div>
            </Link>
          ))}
        </div>
      </Section>
    </div>
  );
}
