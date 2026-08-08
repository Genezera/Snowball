#!/usr/bin/env node
'use strict';
/**
 * v1.3 — PARTES 9,10. Common-window FORWARD (Trial vs Control) + gate de seleção de
 * exchanges. Lê o runtime dos dois processos forward. READ-ONLY. Como os processos
 * FORWARD começam do zero, os números são mínimos no início (honesto).
 * Emite auditoria/progression/forward-status.json.
 */
const L = require('./lib-progression.cjs');
const path = require('node:path');

function leForward(modo) {
  const dir = path.join(L.ROOT, 'auditoria', 'progression', 'forward', modo);
  const est = L.rd(path.join(dir, 'estado.json'), null);
  const hb = L.rd(path.join(dir, 'heartbeat.json'), null);
  if (!est) return null;
  const capitalAtual = (est.capitalInicial || 0) + (est.fundingAcum || 0) - (est.custosAcum || 0);
  const vivo = hb && hb.ultimoCiclo && (Date.now() - hb.ultimoCiclo) < 720_000;
  return {
    modo, vivo, iniciadoEm: est.iniciadoEm ? new Date(est.iniciadoEm).toISOString() : null,
    capitalInicial: est.capitalInicial, capitalAtual: L.r4(capitalAtual),
    funding: L.r4(est.fundingAcum || 0), custos: L.r4(est.custosAcum || 0), pnlLiquido: L.r4((est.fundingAcum || 0) - (est.custosAcum || 0)),
    abertas: Object.keys(est.virtuais || {}).length, avaliadas: est.contadores ? est.contadores.avaliadas : 0,
    abertasTotal: est.contadores ? est.contadores.abertas : 0, fechadas: est.contadores ? est.contadores.fechadas : 0,
    bloqueios: est.bloqueios || {}, saldosPorExchange: est.saldosPorExchange || {},
    retornoPct: est.capitalInicial ? L.r2((((est.fundingAcum || 0) - (est.custosAcum || 0)) / est.capitalInicial) * 100) : 0,
  };
}

function build() {
  const { asOf } = L.loadChampion();
  const trial = leForward('trial'), control = leForward('control');
  const controlRecon = L.rd(L.P.outDir + '/control-reconciliation.json', null);
  const controlFiel = controlRecon ? controlRecon.todasDimensoesDentro001 : false;

  // item 9: common-window forward
  const commonWindow = trial && control ? {
    pnlAbsolutoUSD: { trial: trial.pnlLiquido, control: control.pnlLiquido },
    retornoPct: { trial: trial.retornoPct, control: control.retornoPct },
    funding: { trial: trial.funding, control: control.funding },
    custos: { trial: trial.custos, control: control.custos },
    oportunidadesAvaliadas: { trial: trial.avaliadas, control: control.avaliadas },
    posicoesAbertas: { trial: trial.abertasTotal, control: control.abertasTotal },
    posicoesFechadas: { trial: trial.fechadas, control: control.fechadas },
    bloqueiosPorSaldoLocal: { trial: trial.bloqueios, control: control.bloqueios },
    saldosPorExchange: { trial: trial.saldosPorExchange, control: control.saldosPorExchange },
  } : null;

  // item 10: gate de seleção de exchanges
  const fechadasForward = trial ? trial.fechadas : 0;
  const gate = {
    posicoesFechadasForward: { valor: fechadasForward, minimo: 30, atende: fechadasForward >= 30 },
    duasJanelas: false, doisRegimes: false, controlFielAoChampion: controlFiel,
    custos2x: 'a medir sobre a amostra forward', nenhumaPosicaoAcima25pctDoGanho: 'a medir (sem fechados forward ainda)',
    nenhumSimboloAcima35pct: 'a medir', zeroFalhaCriticaExchange: true, resultadoForwardNaoApenasReplay: fechadasForward > 0,
    LIBERADO: false,
    veredito: `BLOQUEADO — ${fechadasForward}/30 posições FECHADAS forward, 0/2 janelas, 0/2 regimes. Os processos forward começaram agora; NÃO recomendar Bitget+Bybit até acumular resultado FORWARD real (não replay). Control fiel ao Champion: ${controlFiel}.`,
  };

  const out = {
    schema: 'snowball.forward-status.v1_3', geradoEm: new Date(asOf || 0).toISOString(), asOfMs: asOf,
    processos: { trial, control },
    item9_commonWindowForward: commonWindow,
    item10_gateSelecaoExchanges: gate,
    nota: 'Os processos FORWARD (Trial/Control) começaram do zero e acumulam com o tempo (funding ao longo de horas). No corte da entrega os números forward são mínimos — por design. A decisão de exchanges espera resultado forward + 2 janelas/2 regimes.',
    honestidade: 'live-paper (forward, shadow). Nenhuma ordem; nenhum saldo real. Trial enviesa nada — parte do zero e só vê oportunidades novas.',
  };
  const p = L.writeJSON('forward-status.json', out);
  console.log(JSON.stringify({ saida: p, trial: trial ? `vivo=${trial.vivo} cap=${trial.capitalAtual} aval=${trial.avaliadas} abertas=${trial.abertasTotal} fechadas=${trial.fechadas}` : 'ausente',
    control: control ? `vivo=${control.vivo} cap=${control.capitalAtual} aval=${control.avaliadas}` : 'ausente', controlFiel, gate: gate.veredito }, null, 2));
}
build();
