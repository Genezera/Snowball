#!/usr/bin/env node
'use strict';
/**
 * PARTE 13 — Progression status (agregador read-only). Reúne ledger + levels + bosses +
 * registry + exchange-selector + growth em um único status pronto para futura EXIBIÇÃO
 * no Dashboard V2 canônico (NENHUM dashboard é criado aqui). Emite progression-status.json.
 */
const L = require('./lib-progression.cjs');

function build() {
  const { estado, asOf } = L.loadChampion();
  const g = (n) => L.rd(L.P.outDir + '/' + n, null);
  const ledger = g('capital-ledger.json'), levels = g('levels.json'), bosses = g('bosses.json'),
    registry = g('engine-registry.json'), selector = g('exchange-selector.json'), growth = g('growth-scenarios.json');
  const motores = registry ? registry.motores : [];
  const chefes = bosses ? bosses.chefes : {};

  const nivelAtual = levels ? levels.nivelAtual : 0;
  const nx = levels && levels.proximoNivel ? levels.proximoNivel : null;
  const capital = estado.capital || 0;
  const proxCap = ledger ? ledger.capitalNecessarioProximoNivel : null;
  // gap de capital do PRÓXIMO nível por EVIDÊNCIA (N2) — normalmente 0 (bloqueio é evidência).
  const nxDef = levels && nx ? (levels.niveis || []).find((l) => l.levelId === nx.levelId) : null;
  const gapEvidencia = nxDef ? Math.max(0, L.r2(nxDef.capitalMinimo - capital)) : null;

  const status = {
    schema: 'snowball.progression-status.v1', geradoEm: new Date(asOf || 0).toISOString(), asOfMs: asOf,
    nivelAtual, nivelAtualNome: levels ? levels.nivelAtualNome : null,
    progressoNivel: nx ? { proximo: nx.levelId, nome: nx.nome, unlockStatus: nx.unlockStatus, bloqueios: nx.blockedReasons } : null,
    proximoDesbloqueio: nx ? `N${nx.levelId} ${nx.nome} — ${nx.unlockStatus}` : 'máximo',
    capitalAtual: L.r4(capital),
    capitalNecessarioProximoNivelEvidencia: gapEvidencia,
    capitalNecessarioNota: gapEvidencia === 0 ? 'Capital do próximo nível JÁ atingido — o bloqueio é EVIDÊNCIA (gate/amostra), não dinheiro.' : 'faltam US$ para o próximo nível por evidência.',
    fronteiraCapital: proxCap ? { proximoNivelPorCapital: proxCap.proximoNivel, gapUSD: proxCap.valor, nota: proxCap.nota } : null,
    chefesAtivos: bosses ? bosses.resumo.ativos : [], chefesDerrotados: bosses ? bosses.resumo.derrotados : [],
    motoresPorEstado: registry ? registry.porEstado : {},
    motoresBloqueados: motores.filter((m) => ['LOCKED', 'ARCHITECTURE_ONLY'].includes(m.estado)).map((m) => m.engineId),
    motoresEmPesquisa: motores.filter((m) => ['RESEARCH', 'DATA_COLLECTION', 'SHADOW'].includes(m.estado)).map((m) => m.engineId),
    motoresElegiveis: motores.filter((m) => ['ELIGIBLE', 'LIVE'].includes(m.estado)).map((m) => m.engineId),
    contribuicaoPnL: { 'champion-funding': ledger ? ledger.lucroAcumulado.value : null, outros: 0, nota: '100% do lucro vem do funding; nenhum 2º motor comprovado.' },
    progressoAmostra: {
      challengersTimingRealExtensions: '0/30', settlementCaptura: (g('engine-diagnostics.json') && g('engine-diagnostics.json').captura ? g('engine-diagnostics.json').captura.concluidas : 0) + '/30',
      exchangeSelectorEVpositivo: selector ? selector.respostas && (selector.ranking || []).reduce((s, r) => s + r.landscape.oportunidadesEVpositivo, 0) + '/30' : null,
    },
    progressoGates: {
      reconciliacao: ledger ? ledger.reconciliacao.reconcilia : null,
      chefeCustos: chefes.custos ? chefes.custos.status : null,
      chefeSobrevivencia: chefes.sobrevivencia ? chefes.sobrevivencia.status : null,
      chefeConcentracao: chefes.concentracao ? chefes.concentracao.status : null,
      chefeCapacidade: chefes.capacidade ? chefes.capacidade.status : null,
      chefeDiversificacao: chefes.diversificacao ? chefes.diversificacao.status : null,
    },
    exchangeSelector: selector ? { melhorParRealizado: selector.respostas.maiorPnlLiquidoRealizado, suficienteParaEscolher2: selector.veredito.suficienteParaEscolher2, lucroPerdidoAoRestringir: selector.respostas.lucroPerdidoAoRestringirA2Exchanges } : null,
    crescimento: growth ? { retornoDiarioObsPct: growth.baseObservada.epoch1.retornoDiarioPct, avisoAmostra: growth.avisoAmostra } : null,
    // schema para futura exibição (NÃO cria dashboard)
    displaySchemaDashboardV2: {
      destino: 'Dashboard V2 canônico (futuro; nenhuma interface criada nesta fase)',
      campos: ['nivelAtual', 'progressoNivel', 'proximoDesbloqueio', 'capitalAtual', 'capitalNecessario', 'chefesAtivos', 'motoresBloqueados', 'motoresEmPesquisa', 'motoresElegiveis', 'contribuicaoPnL', 'progressoAmostra', 'progressoGates'],
      fonte: 'auditoria/progression/*.json (read-only, append-only)',
    },
    honestidade: 'Nível por EVIDÊNCIA = 1 (capital suporta 3). Nada promovido. Nenhuma alteração real. Distingue observed/replayed/simulated/shadow/hypothetical.',
  };
  const p = L.writeJSON('progression-status.json', status);
  console.log(JSON.stringify({ saida: p, nivelAtual, proximoDesbloqueio: status.proximoDesbloqueio, capitalAtual: status.capitalAtual, capitalNecessario: status.capitalNecessario, chefesAtivos: status.chefesAtivos, elegiveis: status.motoresElegiveis }, null, 2));
}
build();
