import { useMemo } from 'react';
import { useLiveStore } from '../stores/liveStore';
import type { JanelaCaptura, StatusCaptura } from '../components/charts/SettlementTimeline';

/**
 * Antes este hook fazia 5 requisições individuais contra
 * `/api/profit-lab/challenger?id=capture-isolated-Xm` no servidor antigo.
 * Migrado: `capturaStatus` já vem pronto dentro de `/api/v2/profit-lab`
 * (classificado server-side em `dashboard-v2/api/services/captura.ts`,
 * lendo os 5 `estado.json` direto) — este hook só deriva o formato que o
 * componente de timeline espera, nunca recalcula nada financeiro.
 */
export function useCaptureWindows(): { janelas: JanelaCaptura[] | null; erro: string | null } {
  const profitLab = useLiveStore((s) => s.profitLab);

  return useMemo(() => {
    if (!profitLab) return { janelas: null, erro: null };
    if (profitLab.estado === 'erro') return { janelas: null, erro: profitLab.motivo };
    if (profitLab.estado === 'corrompido') return { janelas: null, erro: profitLab.motivo };
    const status = profitLab.dado.capturaStatus;
    if (!status) return { janelas: null, erro: 'capturaStatus ausente na resposta — API V2 desatualizada?' };

    const janelas: JanelaCaptura[] = status.map((s) => {
      const fundingEsperado = s.notionalPorPerna != null && s.spread8hEntrada != null
        ? s.notionalPorPerna * s.spread8hEntrada * ((s.intervaloHorasLiquidacao ?? 8) / 8)
        : null;
      const statusCaptura = s.status as StatusCaptura;
      return {
        challengerId: s.challengerId, janelaMin: s.janelaMin, status: statusCaptura,
        symbol: s.symbol, exchangeShort: s.exchangeShort, exchangeLong: s.exchangeLong,
        timestampEntrada: null, timestampSettlement: s.proximaLiquidacaoEm,
        fundingEsperado,
        fundingRecebido: s.fundingJaRecebido ? fundingEsperado : (statusCaptura === 'concluida' && s.pnlRealizado != null && s.custosTotais != null ? s.pnlRealizado + s.custosTotais : null),
        custos: s.custosTotais,
        pnlConcluido: statusCaptura === 'concluida',
      };
    });
    return { janelas, erro: null };
  }, [profitLab]);
}
