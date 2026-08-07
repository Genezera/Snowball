import { EmptyIllustration } from '../components/feedback/DataState';

/**
 * Toda página ainda não construída usa isto — deliberadamente, em vez de
 * inventar dado ou um esqueleto de página vazia sem explicação. "Não
 * fabricar dado" se aplica também à própria completude da UI: melhor
 * dizer claramente "não construída ainda" do que fingir uma página pronta
 * sem conteúdo real por trás.
 */
export function PaginaPendente({ titulo }: { titulo: string }) {
  return (
    <div>
      <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 'var(--text-2xl)', margin: '0 0 var(--space-4)', fontWeight: 600 }}>{titulo}</h1>
      <div style={{ background: 'var(--surface-1)', border: '1px dashed var(--border-subtle)', borderRadius: 'var(--radius-lg)' }}>
        <EmptyIllustration label={`${titulo} ainda não foi construída nesta fase do Dashboard 2.0 — ver pendências reais na entrega.`} />
      </div>
    </div>
  );
}
