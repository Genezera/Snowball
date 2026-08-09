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
