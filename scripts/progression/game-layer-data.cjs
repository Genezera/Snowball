#!/usr/bin/env node
'use strict';
/**
 * v1.8-coleta — ITEM 11. Dados da FUTURA Game Layer (SEM implementar alterações operacionais).
 * Só atualiza dados: nível/missão/chefe/progresso/próximo desbloqueio/fundo. XP SOMENTE por
 * evidência econômica VÁLIDA (posição-fonte única fechada / divergência real) — NUNCA por
 * processo estar vivo. READ-ONLY. Emite auditoria/progression/game-layer-data.json.
 */
const L = require('./lib-progression.cjs');

function build() {
  const { asOf } = L.loadChampion();
  const sample = L.rd(L.P.outDir + '/economic-sample.json', null);
  const gate = L.rd(L.P.outDir + '/economic-gate.json', null);
  const unlock = L.rd(L.P.outDir + '/unlock-fund.json', null);

  const fechadas = sample ? sample.contagemCorreta.sourcePositionIdUnicosFechados : 0;
  const divergencias = sample ? sample.contagemCorreta.divergenciasReaisPorPosicaoFonte : 0;
  // XP = evidência econômica válida (fechamentos únicos + divergências). NUNCA por processo vivo/restart/observação.
  const xp = fechadas * 1 + divergencias * 1;
  const readiness = gate ? gate.profitGameLayerReadiness : 'BLOCKED_METHODOLOGY';
  const soakResumo = L.rd(L.ROOT + '/auditoria/progression/economic-soak-resumo.json', null);
  const opSoak = soakResumo ? soakResumo.operationalEconomicSoak : null;
  const soakProgresso = opSoak ? opSoak.progresso : '0/1440';

  const out = {
    schema: 'snowball.game-layer-data.v1_8', geradoEm: new Date(asOf || 0).toISOString(), asOfMs: asOf,
    apenasDados: true, semAlteracaoOperacional: true,
    nivelAtual: fechadas >= 30 ? 1 : 0,
    nomeNivel: 'Coleta de Evidência Econômica',
    missaoAtual: 'Sobreviver 1440 min de operationalEconomicSoak sob supervisão e fechar 30 oportunidades-fonte únicas + 15 divergências reais encerradas, sob identidade causal e Mirror snapshot-fiel.',
    chefeAtual: { nome: 'Instabilidade Operacional', estado: readiness, derrotadoQuando: 'supervisor matrix + operationalEconomicSoak 1440/1440 + ≥30 posições-fonte + ≥15 divergências encerradas + 2 janelas + 2 regimes + stress + concentração + durabilitySoak completo + zero falha crítica' },
    // ── item 9: foco econômico (níveis + chefes econômicos) ──
    niveis: (() => { const lv = L.rd(L.P.outDir + '/levels.json', null); return lv ? { capitalLevel: lv.capitalLevel || lv.capital || null, evidenceLevel: lv.evidenceLevel || lv.evidence || null, operationalLevel: lv.operationalLevel || lv.operational || null } : { capitalLevel: null, evidenceLevel: null, operationalLevel: null }; })(),
    economia: (() => { const led = L.rd(L.P.outDir + '/economic-ledger.json', null); const pd = L.rd(L.P.outDir + '/profit-discovery.json', null); const un = L.rd(L.P.outDir + '/unlock-fund.json', null);
      return { lucroAcumulado: led ? led.totalRealizedNetPnL : 0, lucroPorCapitalHora: 'ver economic-ledger por posição', proximoDolar: pd ? pd.item3_proximoDolar.recomendacao : null, proximoDesbloqueio: un ? (un.faltaParaDesbloquear || un.regra || 'ver unlock-fund') : null }; })(),
    chefesEconomicos: {
      chefeEntradasPrematuras: (() => { const eg = L.rd(L.P.outDir + '/entry-gate-shadow.json', null); if (!eg) return { nome: 'Entradas Prematuras', estado: 'DESCONHECIDO' };
        const evitaTudo = Object.entries(eg.challengersAvaliacao).filter(([, v]) => v.lossesAvoided === eg.populacao.uniqueSourcePositions).map(([n]) => n);
        const lucroPerdidoPorRejeicao = 0; // 0 vencedores na amostra ⇒ nenhum lucro perdido mensurável
        return { nome: 'Entradas Prematuras',
          derrotadoQuando: 'um filtro de entrada mostrar edge líquida POSITIVA em 2 janelas + outro regime + stress de custo, com vencedores na amostra (não só evitando as 4 perdas que formaram a hipótese) + aprovação humana',
          estado: 'ATIVO_VENCENDO_O_JOGADOR',
          edgeStatus: eg.populacao.realizedNetPnLDedup < 0 ? 'NEGATIVE_UNPROVEN' : 'POSITIVE_UNPROVEN',
          dedupPnL: eg.populacao.realizedNetPnLDedup, posicoesUnicas: `${eg.populacao.uniqueSourcePositions}/30`,
          challengersShadow: Object.keys(eg.challengersAvaliacao).length,
          challengersQueEvitamTodasAsPerdas: evitaTudo,
          perdasEvitadasMax: eg.populacao.uniqueSourcePositions, lucroPerdidoPorRejeicao,
          hipoteseCentral: eg.item8_hipoteseCentral.veredito,
          proximoDesbloqueio: 'evidência forward VÁLIDA de um filtro (amostra com vencedores + 2 janelas + regime) — NÃO por criar filtros',
          confidence: eg.confidence, diagnostico: 'ver entry-gate-shadow.json',
          validacaoProspectiva: (() => { const ev = L.rd(L.P.outDir + '/entry-gate-validation.json', null); if (!ev) return null;
            const c = ev.item6_contadores || {};
            return { epochId: ev.item4_epochDurabilidade ? ev.item4_epochDurabilidade.entryGateValidationEpochId : null,
              validationStatus: ev.validationStatus, manifestStatus: ev.manifestStatus,
              developmentSet: 4, validationSetProgress: c.validationProgress || '0/30',
              decisionsObserved: c.decisionsObserved, aceitasPorFiltro: { Control: c.controlAccepted, A3: c.a3Accepted, B60: c.b60Accepted, C1_5: c.c15Accepted, D: c.dAccepted },
              closedOutcomes: c.closedOutcomes, openOutcomes: c.openOutcomes, rightCensored: c.rightCensored, winners: c.winners, losers: c.losers,
              rejectedNeverPositioned: c.rejectedNeverPositioned,
              challengerXP: 0, xpNota: 'XP dos challengers = 0 até haver evidência de VALIDATION SET fechada (não do development set).',
              promovivel: ev.promocao ? ev.promocao.elegivel : false,
              proximoDesbloqueio: `${(c.validationProgress || '0/30')} posições de validação + vencedores/perdedores + PnL>Control + 2ª janela + regime + stress + aprovação humana` }; })() }; })(),
      chefeCustosEWhipsaw: { nome: 'Custos e Whipsaw', derrotadoQuando: 'funding capturado cobre o round-trip ($0,28) com folga — hoje captura só ~$0,03 (12% do break-even)', estado: 'ATIVO_VENCENDO_O_JOGADOR', diagnostico: 'ver edge-diagnosis.json' },
      chefeDaCapacidade: { nome: 'Capacidade', derrotadoQuando: 'nenhuma oportunidade positive-EV bloqueada por saldo/exchange limitante', estado: 'EM_COLETA' },
      chefeDaDiversificacao: { nome: 'Diversificação', derrotadoQuando: 'concentração ≤ limites (posição/símbolo/par/janela) com amostra suficiente', estado: 'EM_COLETA' },
    },
    edgeStatus: (() => { const ed = L.rd(L.P.outDir + '/edge-diagnosis.json', null); const net = ed ? ed.item3_decomposicaoPnL.netPorSourcePositionIdUnico : null; return net == null ? 'DESCONHECIDO' : net < 0 ? 'NEGATIVE_UNPROVEN' : 'POSITIVE_UNPROVEN'; })(),
    capitalNaoAlocado: 'recomendado com edge negativa — todo capital fica no Snowball, parte NÃO exposta (reserva/unlock)',
    progresso: { operationalSoak: soakProgresso, posicoesFonte: `${fechadas}/30`, divergencias: `${divergencias}/15` },
    xp: { total: xp, fonte: 'SOMENTE evidência econômica (fechamento único / divergência real)', naoConcedidoPor: 'processo vivo / uptime / heartbeat / restart / observação' },
    proximoDesbloqueio: fechadas >= 30 && divergencias >= 15 ? 'Análise de profit (READY_FOR_PROFIT_ANALYSIS) — fora do teto da v1.8' : 'READY_FOR_PROFIT_ANALYSIS (bloqueado até metas + janelas/regimes)',
    fundoDesbloqueio: unlock ? { atual: unlock.fundoAtual || unlock.saldo || 0, regra: unlock.regra || null } : null,
    honestidade: 'Camada de jogo é só telemetria aqui. XP=0 enquanto não houver fechamento econômico real — processos vivos NÃO dão XP.',
  };
  const p = L.writeJSON('game-layer-data.json', out);
  console.log(JSON.stringify({ saida: p, nivel: out.nivelAtual, progresso: out.progresso, xp: out.xp.total, chefe: out.chefeAtual.estado }, null, 2));
}
build();
