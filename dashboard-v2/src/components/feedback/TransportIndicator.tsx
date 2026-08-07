interface Props {
  modo: 'cursor-incremental';
  status: 'ativo' | 'pausado' | 'erro';
  ultimoEvento: number | null;
  ultimaAtualizacao: number | null;
  intervaloMs: number;
  tentativas: number;
  eventosDescartadosComoDuplicados: number;
  eventosRecebidos?: number;
  eventosNoBuffer?: number;
}

function fmtIdade(ms: number | null): string {
  if (ms == null) return '—';
  const s = Math.round((Date.now() - ms) / 1000);
  return s < 60 ? `${s}s atrás` : `${Math.round(s / 60)}min atrás`;
}

/**
 * Indicador técnico de transporte — pedido explícito da auditoria. Live
 * Operations usa CURSOR INCREMENTAL (`GET /api/v2/events?after=<cursor>`),
 * a alternativa explicitamente aceita no lugar de SSE: cada chamada só
 * traz o que é NOVO desde o cursor anterior, nunca a janela inteira.
 * Deduplicação por `eventId`. Enquanto "pausado" (congelado pelo usuário),
 * a busca continua rodando e o cursor continua avançando — os eventos
 * novos vão pro buffer (`eventosNoBuffer`) em vez de aparecer na tela, pra
 * nenhum evento se perder e retomar nunca precisar rebuscar a janela.
 */
export function TransportIndicator({ status, ultimoEvento, ultimaAtualizacao, intervaloMs, tentativas, eventosDescartadosComoDuplicados, eventosRecebidos, eventosNoBuffer }: Props) {
  const cor = status === 'ativo' ? 'var(--gain-500)' : status === 'pausado' ? 'var(--warn-500)' : 'var(--loss-500)';
  return (
    <div style={{
      display: 'flex', flexWrap: 'wrap', gap: 14, alignItems: 'center', padding: '8px 12px',
      background: 'var(--surface-1)', border: '1px solid var(--border-hairline)', borderRadius: 'var(--radius-sm)',
      fontSize: 'var(--text-2xs)', color: 'var(--ink-2)',
    }}>
      <span style={{ display: 'flex', alignItems: 'center', gap: 5, fontWeight: 700 }}>
        <span style={{ width: 6, height: 6, borderRadius: '50%', background: cor }} />
        cursor incremental · {status}
      </span>
      <span>intervalo: {(intervaloMs / 1000).toFixed(0)}s</span>
      <span>último evento: {fmtIdade(ultimoEvento)}</span>
      <span>última atualização: {fmtIdade(ultimaAtualizacao)}</span>
      <span>tentativas: {tentativas}</span>
      <span>duplicados descartados: {eventosDescartadosComoDuplicados}</span>
      {eventosRecebidos != null && <span>recebidos: {eventosRecebidos}</span>}
      {eventosNoBuffer != null && eventosNoBuffer > 0 && <span style={{ color: 'var(--warn-500)', fontWeight: 700 }}>{eventosNoBuffer} no buffer</span>}
    </div>
  );
}
