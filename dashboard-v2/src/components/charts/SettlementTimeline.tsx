import { motion, useReducedMotion } from 'framer-motion';
import { useEffect, useState } from 'react';
import { EmptyIllustration } from '../feedback/DataState';

export type StatusCaptura =
  | 'observando' | 'elegivel' | 'posicao_aberta' | 'funding_pendente'
  | 'settlement_recebido' | 'fechando' | 'concluida' | 'invertida' | 'erro';

const STATUS_LABEL: Record<StatusCaptura, string> = {
  observando: 'observando', elegivel: 'elegível', posicao_aberta: 'posição aberta',
  funding_pendente: 'funding pendente', settlement_recebido: 'settlement recebido',
  fechando: 'fechando', concluida: 'concluída', invertida: 'invertida', erro: 'erro',
};
const STATUS_COLOR: Record<StatusCaptura, string> = {
  observando: 'var(--ink-3)', elegivel: 'var(--slate-500)', posicao_aberta: 'var(--brass-300)',
  funding_pendente: 'var(--warn-500)', settlement_recebido: 'var(--gain-500)', fechando: 'var(--warn-500)',
  concluida: 'var(--gain-500)', invertida: 'var(--loss-500)', erro: 'var(--loss-500)',
};

export interface JanelaCaptura {
  challengerId: string;
  janelaMin: number;
  status: StatusCaptura;
  symbol: string | null;
  exchangeShort: string | null;
  exchangeLong: string | null;
  timestampEntrada: number | null;
  timestampSettlement: number | null;
  fundingEsperado: number | null;
  fundingRecebido: number | null;
  custos: number | null;
  /** true = ainda em aberto, sem PnL concluído — a UI NUNCA trata isto como perda final */
  pnlConcluido: boolean;
}

function fmtUsd(n: number): string {
  const s = n < 0 ? '-' : '';
  return s + 'US$ ' + Math.abs(n).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function Countdown({ ateTs }: { ateTs: number }) {
  const [restanteMs, setRestanteMs] = useState(ateTs - Date.now());
  useEffect(() => {
    const id = setInterval(() => setRestanteMs(ateTs - Date.now()), 1000);
    return () => clearInterval(id);
  }, [ateTs]);
  if (restanteMs <= 0) return <span style={{ color: 'var(--gain-500)' }}>settlement atingido</span>;
  const min = Math.floor(restanteMs / 60_000);
  const seg = Math.floor((restanteMs % 60_000) / 1000);
  return <span className="tabular">{min}min {seg}s</span>;
}

/** Uma linha = uma janela de captura (5m/10m/20m/30m/60m). Countdown nunca substitui o timestamp absoluto — os dois aparecem sempre juntos. */
export function SettlementTimelineRow({ j }: { j: JanelaCaptura }) {
  const reduceMotion = useReducedMotion();
  return (
    <motion.div
      layout={!reduceMotion}
      style={{
        display: 'grid', gridTemplateColumns: '90px 110px 1fr 140px 140px', alignItems: 'center', gap: 14,
        padding: '12px 16px', borderRadius: 'var(--radius-md)', background: 'var(--surface-1)', border: '1px solid var(--border-hairline)',
      }}
    >
      <span style={{ fontWeight: 700, fontSize: 'var(--text-sm)' }}>{j.janelaMin}min</span>
      <span style={{ fontSize: 'var(--text-2xs)', fontWeight: 700, textTransform: 'uppercase', color: STATUS_COLOR[j.status] }}>{STATUS_LABEL[j.status]}</span>

      <div style={{ fontSize: 'var(--text-xs)', color: 'var(--ink-2)' }}>
        {j.symbol ? (
          <>
            <strong style={{ color: 'var(--ink-0)' }}>{j.symbol}</strong> · {j.exchangeShort} → {j.exchangeLong}
            {j.timestampSettlement && !j.pnlConcluido && (
              <div style={{ marginTop: 2 }}>
                <Countdown ateTs={j.timestampSettlement} /> · absoluto: {new Date(j.timestampSettlement).toLocaleTimeString('pt-BR')}
              </div>
            )}
          </>
        ) : <span style={{ color: 'var(--ink-3)' }}>nenhuma posição no momento</span>}
      </div>

      <div className="tabular" style={{ fontSize: 'var(--text-xs)', color: 'var(--ink-2)' }}>
        <div>esperado: {j.fundingEsperado != null ? fmtUsd(j.fundingEsperado) : '—'}</div>
        <div>recebido: {j.fundingRecebido != null ? fmtUsd(j.fundingRecebido) : '—'}</div>
      </div>

      <div>
        {j.pnlConcluido
          ? <span className="tabular" style={{ fontWeight: 700, color: (j.fundingRecebido ?? 0) - (j.custos ?? 0) >= 0 ? 'var(--gain-500)' : 'var(--loss-500)' }}>
              {fmtUsd((j.fundingRecebido ?? 0) - (j.custos ?? 0))}
            </span>
          : j.status === 'posicao_aberta' || j.status === 'funding_pendente'
            ? <span style={{ fontSize: 'var(--text-2xs)', fontWeight: 700, color: 'var(--warn-500)' }}>PnL ainda não concluído</span>
            : <span style={{ color: 'var(--ink-3)' }}>—</span>}
      </div>
    </motion.div>
  );
}

export function SettlementTimeline({ janelas }: { janelas: JanelaCaptura[] | null }) {
  if (!janelas?.length) return <EmptyIllustration label="Nenhuma janela de captura configurada" />;
  // ACHADO REAL (axe em viewport mobile, chromium-mobile): as linhas usam um
  // grid de colunas fixas (90/110/1fr/140/140) que não cabe em ~410px de
  // largura. Sem um container próprio de scroll, o overflow vazava pro
  // `<main>` do AppShell (que ganha overflowX:auto por causa do overflowY:
  // auto), e o axe marcava `scrollable-region-focusable` (serious) num
  // elemento sem foco de teclado. Correção: a linha do tempo tem seu PRÓPRIO
  // container rolável, focável por teclado (tabIndex+role+aria-label) — mesmo
  // padrão já usado nas tabelas de Live Operations/Cost/Risk. `minWidth`
  // mantém as colunas alinhadas e contém o scroll aqui dentro, sem vazar.
  return (
    <div role="region" aria-label="Linha do tempo de settlements — rolável horizontalmente" tabIndex={0} style={{ overflowX: 'auto' }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, minWidth: 560 }}>
        {janelas.map((j) => <SettlementTimelineRow key={j.challengerId} j={j} />)}
      </div>
    </div>
  );
}
