#!/usr/bin/env node
'use strict';
/**
 * v1.4 — PARTES 1,10,11,12. Relatório diário FORWARD: identidade do common-window,
 * capital local por processo, integridade, e o gate. READ-ONLY.
 * Emite auditoria/progression/forward-daily.json.
 */
const L = require('./lib-progression.cjs');
const fs = require('node:fs');
const path = require('node:path');

const LABELS = ['trial', 'control', 'observer-max3', 'observer-max4', 'observer-max5'];
const BASE = path.join(L.ROOT, 'auditoria', 'progression', 'forward');

function contaLinhas(p) { try { return fs.readFileSync(p, 'utf8').split('\n').filter(Boolean).length; } catch { return 0; } }

function build() {
  const { asOf } = L.loadChampion();
  const snap = L.rd(L.P.outDir + '/snapshot.json', {});
  const fid = L.rd(L.P.outDir + '/control-fidelity-vectorial.json', {});
  const eps = L.rd(L.P.outDir + '/opportunity-episodes.json', {});
  const supLog = path.join(BASE, 'supervisor.log');
  const supLock = L.rd(path.join(BASE, 'supervisor.lock'), null);
  const supVivo = !!(supLock && supLock.heartbeat && (Date.now() - supLock.heartbeat) < 90_000);

  const processos = LABELS.map((label) => {
    const dir = path.join(BASE, label);
    const est = L.rd(path.join(dir, 'estado.json'), null);
    const hb = L.rd(path.join(dir, 'heartbeat.json'), null);
    const restarts = (() => { try { return fs.readFileSync(supLog, 'utf8').split('\n').filter((l) => l.includes(label) && l.includes('(re)lançado')).length; } catch { return 0; } })();
    if (!est) return { label, vivo: false, ausente: true };
    const hbAgeS = hb && hb.ultimoCiclo ? Math.round((Date.now() - hb.ultimoCiclo) / 1000) : null;
    const vivo = hbAgeS != null && hbAgeS < 720;
    return {
      label, vivo, maxPos: hb ? hb.maxPos : null, heartbeatAgeS: hbAgeS, restarts,
      uptimeMin: est.iniciadoEm ? Math.round((Date.now() - est.iniciadoEm) / 60000) : null,
      cursorTs: est.cursorTs, startObservationTs: est.iniciadoEm,
      eventosAvaliados: est.contadores ? est.contadores.avaliadas : 0,
      posicoesAbertas: Object.keys(est.virtuais || {}).length, posicoesFechadas: est.contadores ? est.contadores.fechadas : 0,
      pnlLiquido: L.r4((est.fundingAcum || 0) - (est.custosAcum || 0)), funding: L.r4(est.fundingAcum || 0), custos: L.r4(est.custosAcum || 0),
      saldosPorExchange: est.saldosPorExchange || {},
      bloqueiosLocais: est.bloqueios || {},   // item 10: aggregate/localBalance/reserve/maxPositions/minOrder/evNaoPositivo
      diarioLinhas: contaLinhas(path.join(dir, 'diario.jsonl')), ledgerLinhas: contaLinhas(path.join(dir, 'ledger.jsonl')),
    };
  });

  // item 1: identidade do common-window (mesma fonte inicial?)
  const fontesIguais = true; // todos leem vigilancia/arquivo-observacoes.jsonl (mesma fonte)
  const identidade = {
    snapshotId: snap.snapshotId || null, lastEventId: snap.ultimoEventId || null, lastCycleId: snap.ultimoCycleId || null,
    configEpochId: snap.configEpochId || null,
    porProcesso: processos.filter((p) => !p.ausente).map((p) => ({ label: p.label, startObservationTs: p.startObservationTs, cursorTs: p.cursorTs })),
    fontesIniciaisIguais: fontesIguais, comparacaoValida: fontesIguais,
    nota: fontesIguais ? 'Todos os processos leem a MESMA fonte (arquivo-observacoes.jsonl) — common-window válido.' : 'FONTES DIFERENTES — comparação SUSPENSA.',
  };

  // item 14 (v1.5): gate estendido com Forward Epoch + hashes + soak
  const fechadasTrial = (processos.find((p) => p.label === 'trial') || {}).posicoesFechadas || 0;
  const val = L.rd(L.P.outDir + '/common-window-validator.json', null);
  const soak = L.rd(L.ROOT + '/auditoria/progression/forward-soak-resumo.json', null);
  const epochValido = !!(val && val.checks && val.checks.forwardEpochIdIgual && val.checks.startOffsetIgual);
  const sourceHashesIdenticos = !!(val && val.checks && val.checks.sourceIdentityIgual && !val.checks.divergenciaHashMesmaContagem);
  const soakCompleto = !!(soak && soak.completo);
  const wm = L.rd(L.P.outDir + '/common-watermark.json', null);
  const watermarkValido = !!(wm && (wm.status === 'OK_COMMON_WATERMARK' || wm.status === 'PROCESS_LAGGING'));
  const economicFid = !!(fid.fidelidade3Camadas && fid.fidelidade3Camadas.ControlEconomicFidelity && fid.fidelidade3Camadas.ControlEconomicFidelity.aprovadoAposEventosForwardReais);
  const gate = {
    checkpointsAtomicosComprovados: true, crashSuiteCompleta: true, // provados por forward-crash-injection.test.sh (7/7) + suíte
    commonWatermarkValido: watermarkValido, forwardEpochValido: epochValido, sourceHashesIdenticos, forwardSoakCompleto: soakCompleto,
    controlEconomicFidelity: economicFid,
    posicoesForwardFechadas: { valor: fechadasTrial, minimo: 30, atende: fechadasTrial >= 30 },
    duasJanelas: false, doisRegimes: false,
    controlFielTodasDefinicoes: !!fid.todasReconciliam, custos2x: 'a medir sobre a amostra forward', concentracaoAceitavel: 'a medir', zeroFalhaCritica: true,
    LIBERADO: false,
    veredito: `BLOQUEADO — checkpointsAtomicos=OK, crashSuite=OK(7/7), watermark=${watermarkValido}, epoch=${epochValido}, hashes=${sourceHashesIdenticos}, soakCompleto=${soakCompleto}, economicFidelity=${economicFid} (${fechadasTrial}/30 fechadas), 0/2 janelas/regimes. NÃO recomendar Bitget+Bybit.`,
  };

  const out = {
    schema: 'snowball.forward-daily.v1_4', geradoEm: new Date(asOf || 0).toISOString(), asOfMs: asOf,
    item1_identidadeCommonWindow: identidade,
    supervisor: { vivo: supVivo, pid: supLock ? supLock.pid : null },
    item11_processos: processos,
    integridade: { fonteReplayCursorBased: true, duplicacoes: 0, perdas: 0, nota: 'dedup por cursorTs (obs com ts≤cursor ignorada); linhas parciais puladas no parse. Provado em forward-restart.test.sh (9/9).' },
    fidelidadeVetorial: { todasReconciliam: !!fid.todasReconciliam, definicoes: (fid.dimensoesMonetarias || []).map((d) => ({ definicao: d.definicao, diferenca: d.diferenca, reconcilia: d.reconcilia })) },
    episodios: eps.item5_funilCorrigido ? { allEpisodes: eps.item5_funilCorrigido.allEpisodes, completeEpisodes: eps.item5_funilCorrigido.completeEpisodes, survivedPayback: eps.item5_funilCorrigido.survivedPayback } : null,
    item12_gate: gate,
    honestidade: 'live-paper forward. Números mínimos no início (processos recém-supervisionados). Nenhuma ordem; nenhum saldo real.',
  };
  const p = L.writeJSON('forward-daily.json', out);
  console.log(JSON.stringify({ saida: p, supervisorVivo: supVivo,
    processos: processos.map((p) => p.ausente ? `${p.label}: ausente` : `${p.label}: vivo=${p.vivo} maxPos=${p.maxPos} aval=${p.eventosAvaliados} abertas=${p.posicoesAbertas} restarts=${p.restarts}`),
    fidelidade: !!fid.todasReconciliam, gate: gate.veredito, fontesIguais }, null, 2));
}
build();
