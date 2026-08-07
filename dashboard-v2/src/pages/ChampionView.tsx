import { useLiveStore, idadeDoDado, LIMITE_STALE_MS } from '../stores/liveStore';
import { MetricCard } from '../components/cards/MetricCard';
import { DataStateBanner, EmptyIllustration } from '../components/feedback/DataState';
import { EquityCurve } from '../components/charts/EquityCurve';
import { DrawdownChart } from '../components/charts/DrawdownChart';
import { PnLWaterfall } from '../components/charts/PnLWaterfall';
import { PositionLegCard } from '../components/strategy/PositionLegCard';
import type { ChartDataState } from '../components/charts/ChartFrame';

function fmtUsd(n: number): string {
  const s = n < 0 ? '-' : '';
  return s + 'US$ ' + Math.abs(n).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function fmtInt(n: number): string { return n.toLocaleString('pt-BR'); }

export function ChampionView() {
  const champion = useLiveStore((s) => s.champion);
  const profitLab = useLiveStore((s) => s.profitLab);

  const idade = idadeDoDado(champion);
  const stale = idade != null && idade > LIMITE_STALE_MS;
  const chartState: ChartDataState = champion?.estado === 'sucesso' ? (stale ? 'stale' : 'success') : champion?.estado === 'corrompido' ? 'corrupted' : champion?.estado === 'erro' ? 'error' : 'loading';

  const est = champion?.estado === 'sucesso' ? champion.dado.estado : null;
  const curva = champion?.estado === 'sucesso' ? champion.dado.curva ?? null : null;
  const posicoes = champion?.estado === 'sucesso' ? champion.dado.posicoes ?? [] : [];
  const championResumo = profitLab?.estado === 'sucesso' ? profitLab.dado.resumo?.champion ?? null : null;
  const custosChampion = profitLab?.estado === 'sucesso' ? profitLab.dado.custos?.champion ?? null : null;

  const pontosEquity = curva?.map((p) => ({ ts: p.ts, valor: p.capital })) ?? null;

  const etapasWaterfall = custosChampion ? [
    { label: 'Funding bruto', valor: custosChampion.fundingBruto },
    { label: 'Taxa entrada', valor: -custosChampion.taxaEntrada },
    { label: 'Taxa saída', valor: -custosChampion.taxaSaida },
    { label: 'Escalonamento', valor: -custosChampion.custoEscalonamento },
    { label: 'Apara', valor: -custosChampion.custoApara },
    { label: 'Reinvestimento', valor: -custosChampion.custoReinvestimento },
    { label: 'Emergencial', valor: -custosChampion.custoEmergencial },
    { label: 'PnL líquido', valor: 0 },
  ] : null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-6)' }}>
      <div>
        <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 'var(--text-2xl)', margin: 0, fontWeight: 600 }}>Champion View</h1>
        <p style={{ color: 'var(--ink-2)', fontSize: 'var(--text-sm)', margin: '4px 0 0' }}>
          Funding Arbitrage — único motor com lucro paper realizado e reconciliado. Dinheiro simulado real, sistema principal.
        </p>
      </div>

      {champion?.estado === 'erro' && <DataStateBanner kind="offline" motivo={champion.motivo} />}
      {champion?.estado === 'corrompido' && <DataStateBanner kind="corrupted" motivo={champion.motivo} />}
      {stale && <DataStateBanner kind="stale" idadeMs={idade} origem="/api/stream" />}

      <section aria-label="Métricas do champion" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(170px, 100%), 1fr))', gap: 'var(--space-3)' }}>
        <MetricCard label="Capital inicial" value={est?.capitalInicial ?? null} formatar={fmtUsd} />
        <MetricCard label="Capital realizado" value={est ? est.capital : null} formatar={fmtUsd} />
        <MetricCard label="PnL realizado" value={est ? est.capital - est.capitalInicial : null} formatar={fmtUsd} tone={est && est.capital - est.capitalInicial >= 0 ? 'gain' : 'loss'} />
        <MetricCard label="PnL não realizado (mark)" value={championResumo?.pnlNaoRealizadoMark ?? null} formatar={fmtUsd} tone={championResumo && championResumo.pnlNaoRealizadoMark >= 0 ? 'gain' : 'loss'} />
        <MetricCard label="PnL não realizado (executável)" value={championResumo?.pnlNaoRealizadoExecutavel ?? null} formatar={fmtUsd} tone={championResumo && championResumo.pnlNaoRealizadoExecutavel >= 0 ? 'gain' : 'loss'} />
        <MetricCard label="Equity mark" value={championResumo?.equityMark ?? null} formatar={fmtUsd} sub={!championResumo?.marcacaoDisponivel ? 'marcação indisponível — mostrando fallback' : undefined} />
        <MetricCard label="Equity de liquidação" value={championResumo?.equityLiquidacao ?? null} formatar={fmtUsd} />
        <MetricCard label="Funding bruto" value={est?.fundingTotal ?? null} formatar={fmtUsd} />
        <MetricCard label="Custos totais" value={est?.custosTotal ?? null} formatar={fmtUsd} />
        <MetricCard label="Posições abertas" value={posicoes.length} formatar={fmtInt} />
        <MetricCard label="Settlements (pagamentos)" value={est?.pagamentos ?? null} formatar={fmtInt} />
      </section>

      <section style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(280px, 100%), 1fr))', gap: 'var(--space-4)' }}>
        <EquityCurve titulo="Curva de equity (realizado)" pontos={pontosEquity} state={chartState} cor="var(--brass-300)" />
        <DrawdownChart pontos={pontosEquity} state={chartState} />
      </section>

      <PnLWaterfall etapas={etapasWaterfall} state={etapasWaterfall ? chartState : 'empty'} />
      {custosChampion && est && (() => {
        // VALIDAÇÃO MATEMÁTICA (Parte 9) — fundingBruto - custoTotal deveria
        // bater com o PnL realizado vitalício. Achado real: NÃO bate exato,
        // porque o backend limita a leitura a 4000 linhas de diário
        // (`lerDiarioLimitado`) — é uma janela recente, não o histórico
        // inteiro. Mostrar isso explicitamente é mais correto que fingir
        // uma identidade perfeita que não existe.
        const pnlWaterfall = custosChampion.fundingBruto - custosChampion.custoTotal;
        const pnlVitalicio = est.capital - est.capitalInicial;
        const diferenca = pnlVitalicio - pnlWaterfall;
        const bateExato = Math.abs(diferenca) < 0.005;
        return (
          <p style={{ fontSize: 'var(--text-2xs)', color: bateExato ? 'var(--ink-3)' : 'var(--warn-500)', maxWidth: 640 }}>
            {bateExato
              ? `Identidade confirmada: funding bruto − custos = ${fmtUsd(pnlWaterfall)}, igual ao PnL realizado vitalício.`
              : `Este waterfall usa uma JANELA recente do diário (até 4.000 linhas), não o histórico vitalício — funding−custos aqui dá ${fmtUsd(pnlWaterfall)}, enquanto o PnL realizado vitalício (capital atual − inicial) é ${fmtUsd(pnlVitalicio)} — diferença de ${fmtUsd(diferenca)}. Os dois números legítimos, mas não são a mesma coisa.`}
          </p>
        );
      })()}

      <section aria-label="Posições abertas — as duas pernas">
        <h2 style={{ fontSize: 'var(--text-sm)', fontWeight: 700, margin: '0 0 var(--space-3)', color: 'var(--ink-1)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
          Posições abertas ({posicoes.length})
        </h2>
        {posicoes.length ? (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(320px, 100%), 1fr))', gap: 'var(--space-3)' }}>
            {posicoes.map((p) => <PositionLegCard key={p.symbol + p.abertaEm} p={p} />)}
          </div>
        ) : (
          <div style={{ background: 'var(--surface-1)', border: '1px dashed var(--border-subtle)', borderRadius: 'var(--radius-lg)' }}>
            <EmptyIllustration label="Nenhuma posição aberta no momento" />
          </div>
        )}
      </section>
    </div>
  );
}
