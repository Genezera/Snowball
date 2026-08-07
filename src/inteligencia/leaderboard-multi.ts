/**
 * LEADERBOARD MULTI-STRATEGY (Parte 1 + Parte 9 da etapa de auditoria) —
 * junta champion, control+challengers do Lab, baselines e os motores já
 * existentes (momentum/pares, via adaptador read-only) numa única
 * comparação, com uma JANELA COMUM explícita, separada do histórico total
 * de cada motor.
 *
 * "Não compare PnL absoluto de períodos diferentes" — cada motor começou a
 * rodar num instante diferente (champion desde 03/08, momentum/pares desde
 * antes disso, Lab desde 07/08, baselines a partir de agora). Recalcular
 * PnL EXATO dentro de uma janela comum exigiria reconstruir a série de
 * capital de cada motor no instante `desde` — para o champion e os
 * challengers isso é possível (o diário tem `capital` por evento); para
 * momentum/pares/baselines ainda não há essa reconstrução aqui (ver
 * `janelaComumDisponivel` por linha). Onde não é possível, a linha some com
 * `comparavelNaJanela:false` do PnL absoluto, mas nunca finge um número.
 */
import fs from 'node:fs';
import path from 'node:path';
import type { Leaderboard } from './leaderboard.ts';
import type { ResumoMotorAdaptado } from './adaptador-motores-existentes.ts';
import type { ResumoBaseline } from './baselines.ts';

export interface JanelaComparacao {
  desde: number;
  ate: number;
  descricao: string;
}

export interface LinhaMultiStrategy {
  strategyId: string;
  familia: 'funding-champion' | 'funding-challenger' | 'baseline' | 'momentum' | 'pairs';
  disponivel: boolean;
  capitalVirtual: number;
  pnlDesdeOInicio: number;
  pnlPct: number;
  drawdownMaxPct: number;
  iniciadoEm: number | null;
  diasRodando: number | null;
  dentroDaJanelaComumDesdeOInicio: boolean;
  comparavelNaJanela: boolean;
  nota: string;
}

export interface LeaderboardMultiStrategy {
  geradoEm: number;
  janelaComum: JanelaComparacao;
  historicoTotalChampion: JanelaComparacao;
  linhas: LinhaMultiStrategy[];
  aviso: string;
}

function diasDesde(ts: number | null, agora: number): number | null {
  return ts ? (agora - ts) / 86_400_000 : null;
}

export function montarLeaderboardMulti(
  championEstado: { iniciadoEm?: number; capital?: number; capitalInicial?: number } | null,
  labLeaderboard: Leaderboard | null,
  baselines: ResumoBaseline[],
  momentum: ResumoMotorAdaptado,
  pares: ResumoMotorAdaptado,
): LeaderboardMultiStrategy {
  const agora = Date.now();
  const linhas: LinhaMultiStrategy[] = [];

  // ── janela comum: desde que o motor mais NOVO começou (senão a "janela
  // comum" incluiria tempo em que nem todos os motores existiam) ──
  const iniciosConhecidos: number[] = [];
  if (championEstado?.iniciadoEm) iniciosConhecidos.push(championEstado.iniciadoEm);
  if (momentum.iniciadoEm) iniciosConhecidos.push(momentum.iniciadoEm);
  if (pares.iniciadoEm) iniciosConhecidos.push(pares.iniciadoEm);
  for (const b of baselines) if (b.comprado) iniciosConhecidos.push(agora); // baselines nascem agora, nesta etapa
  const desdeJanelaComum = iniciosConhecidos.length ? Math.max(...iniciosConhecidos) : agora;

  const janelaComum: JanelaComparacao = {
    desde: desdeJanelaComum, ate: agora,
    descricao: 'desde que o motor mais recente (baselines, criados nesta etapa) começou a existir — só esta janela é diretamente comparável entre TODOS os motores',
  };
  const historicoTotalChampion: JanelaComparacao = {
    desde: championEstado?.iniciadoEm ?? agora, ate: agora,
    descricao: 'histórico completo do champion — maior que a janela comum, NUNCA comparar PnL absoluto desta janela com o de outro motor',
  };

  if (championEstado?.capital != null && championEstado.capitalInicial != null) {
    const dias = diasDesde(championEstado.iniciadoEm ?? null, agora);
    linhas.push({
      strategyId: 'funding-arbitrage-champion', familia: 'funding-champion', disponivel: true,
      capitalVirtual: championEstado.capital, pnlDesdeOInicio: championEstado.capital - championEstado.capitalInicial,
      pnlPct: championEstado.capitalInicial > 0 ? ((championEstado.capital - championEstado.capitalInicial) / championEstado.capitalInicial) * 100 : 0,
      drawdownMaxPct: 0, // não recalculado aqui — já exposto em detalhe no dashboard do champion
      iniciadoEm: championEstado.iniciadoEm ?? null, diasRodando: dias,
      dentroDaJanelaComumDesdeOInicio: (championEstado.iniciadoEm ?? agora) >= desdeJanelaComum,
      comparavelNaJanela: false,
      nota: 'PnL é do HISTÓRICO TOTAL do champion, não recortado pela janela comum — dinheiro real do sistema principal, não recalculado aqui',
    });
  }

  if (labLeaderboard) {
    for (const l of labLeaderboard.linhas) {
      linhas.push({
        strategyId: l.challengerId, familia: 'funding-challenger', disponivel: true,
        capitalVirtual: l.equity, pnlDesdeOInicio: l.pnlPaperBase, pnlPct: l.retornoPct,
        drawdownMaxPct: l.drawdownMaxPct, iniciadoEm: null, diasRodando: null,
        dentroDaJanelaComumDesdeOInicio: true, // Lab inteiro é mais novo que o champion, mas todos os challengers começaram juntos
        comparavelNaJanela: false,
        nota: 'PnL desde que o Lab começou (não o champion) — comparável ENTRE challengers, não contra o champion sem ajuste de janela',
      });
    }
  }

  for (const b of baselines) {
    linhas.push({
      strategyId: b.id, familia: 'baseline', disponivel: b.comprado || b.tipo === 'cash',
      capitalVirtual: b.equityAtual, pnlDesdeOInicio: b.pnl, pnlPct: b.pnlPct,
      drawdownMaxPct: b.drawdownMaxPct, iniciadoEm: agora, diasRodando: 0,
      dentroDaJanelaComumDesdeOInicio: true, comparavelNaJanela: true,
      nota: 'criado nesta etapa — é o próprio motor mais novo que define o início da janela comum',
    });
  }

  for (const r of [momentum, pares]) {
    linhas.push({
      strategyId: r.strategyId, familia: r.origem === 'momentum-live.ts' ? 'momentum' : 'pairs', disponivel: r.disponivel,
      capitalVirtual: r.capitalVirtual, pnlDesdeOInicio: r.pnlRealizado,
      pnlPct: r.capitalInicial > 0 ? (r.pnlRealizado / r.capitalInicial) * 100 : 0,
      drawdownMaxPct: r.drawdownMaxPct, iniciadoEm: r.iniciadoEm, diasRodando: diasDesde(r.iniciadoEm, agora),
      dentroDaJanelaComumDesdeOInicio: (r.iniciadoEm ?? agora) >= desdeJanelaComum,
      comparavelNaJanela: false,
      nota: 'PnL desde que este motor começou a rodar (antes desta sessão) — não recortado pela janela comum',
    });
  }

  return {
    geradoEm: agora, janelaComum, historicoTotalChampion, linhas,
    aviso: 'Nenhuma linha desta tabela com comparavelNaJanela=false deve ser usada pra declarar um motor "melhor" que outro por PnL absoluto — os períodos não são os mesmos. Comparável hoje: challengers entre si (mesmo início) e baselines entre si (mesmo início). Champion/momentum/pares/challengers/baselines juntos só ficam comparáveis depois que todos acumularem histórico dentro da mesma janelaComum.',
  };
}

export function salvarLeaderboardMulti(root: string, lb: LeaderboardMultiStrategy): void {
  const p = path.join(root, 'inteligencia', 'dashboard', 'leaderboard-multi.json');
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const tmp = p + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(lb, null, 2));
  fs.renameSync(tmp, p);
}
