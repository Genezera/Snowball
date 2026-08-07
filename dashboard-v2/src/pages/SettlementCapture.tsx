import { useCaptureWindows } from '../hooks/useCaptureWindows';
import { SettlementTimeline } from '../components/charts/SettlementTimeline';
import { DataStateBanner } from '../components/feedback/DataState';

export function SettlementCapture() {
  const { janelas, erro } = useCaptureWindows();

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-5)' }}>
      <div>
        <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 'var(--text-2xl)', margin: 0, fontWeight: 600 }}>Settlement Capture</h1>
        <p style={{ color: 'var(--ink-2)', fontSize: 'var(--text-sm)', margin: '4px 0 0' }}>
          Cinco janelas experimentais (5m/10m/20m/30m/60m antes do settlement) — capital isolado, nunca soma com o control.
        </p>
      </div>

      {erro && <DataStateBanner kind="error" motivo={erro} />}

      <div style={{
        display: 'inline-flex', gap: 8, fontSize: 'var(--text-2xs)', color: 'var(--warn-500)',
        fontWeight: 700, border: '1px solid var(--warn-500)', borderRadius: 'var(--radius-sm)', width: 'fit-content', padding: '5px 10px',
      }}>
        EXPERIMENTAL · SEM OPERAÇÃO CONCLUÍDA SUFICIENTE PARA VALIDAÇÃO ESTATÍSTICA
      </div>

      <SettlementTimeline janelas={janelas} />

      <p style={{ fontSize: 'var(--text-2xs)', color: 'var(--ink-3)', maxWidth: 620 }}>
        "PnL ainda não concluído" aparece enquanto a posição está aberta ou aguardando o funding do settlement —
        o custo de entrada, sozinho, nunca é mostrado como perda final. Um número fechado só aparece depois do
        fechamento real da posição.
      </p>
    </div>
  );
}
