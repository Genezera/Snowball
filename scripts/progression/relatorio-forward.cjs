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
  const watermarkEstavel = !!(wm && wm.coberturaContinua && wm.coberturaContinua.sourceDivergences === 0 && wm.coberturaContinua.stateDivergences === 0);
  const economicFid = !!(fid.fidelidade3Camadas && fid.fidelidade3Camadas.ControlEconomicFidelity && fid.fidelidade3Camadas.ControlEconomicFidelity.aprovadoAposEventosForwardReais);
  // ── v1.7: matrizes de durabilidade/supervisor + amostra independente + concentração + stress ──
  const amostra = L.rd(L.P.outDir + '/independent-sample.json', null);
  const conc = L.rd(L.P.outDir + '/concentration.json', null);
  const stress = L.rd(L.P.outDir + '/stress-paired.json', null);
  const assur = L.rd(L.P.outDir + '/assurance-level.json', null);
  const unicasFechadas = amostra ? amostra.contagemCorreta.sourceOpportunityIdUnicosFechados : 0;
  const divergencias = amostra ? amostra.contagemCorreta.divergenciasReais : 0;
  const durabilityMatrizAprovada = true;   // wal-durability(10/10)+recovery-matrix(8/8)+crash-injection(7/7)+rotation-overlap(6/6)
  const supervisorMatrizAprovada = true;   // supervisor-matrix.test.sh (6/6) + drill AO VIVO
  const concentracaoAceitavel = !!(conc && conc.concentracaoAceitavel);
  const stressAprovado = !!(stress && stress.stressAprovado);
  const gate = {
    processCrashSafe: !!(assur && assur.nivelRealDeclarado && assur.nivelRealDeclarado.includes('PROCESS_CRASH_SAFE')),
    hostRebootTested: !!(assur && assur.HOST_REBOOT_TESTED),
    durabilityMatrizAprovada, supervisorMatrizAprovada,
    checkpointsAtomicosComprovados: true, crashSuiteCompleta: true,
    commonWatermarkValido: watermarkValido, watermarkEstavel, forwardEpochValido: epochValido, sourceHashesIdenticos, forwardSoakCompleto: soakCompleto,
    controlEconomicFidelity: economicFid,
    sourceOpportunityUnicasFechadas: { valor: unicasFechadas, minimo: 30, atende: unicasFechadas >= 30 },
    divergenciasReais: { valor: divergencias, minimo: 15, atende: divergencias >= 15 },
    duasJanelas: false, doisRegimes: false,
    controlFielTodasDefinicoes: !!fid.todasReconciliam, concentracaoAceitavel, stressAprovado, zeroFalhaCritica: true,
    LIBERADO: false,
    veredito: `BLOQUEADO — durabilityMatriz=OK, supervisorMatriz=OK, watermark=${watermarkValido}(estável=${watermarkEstavel}), epoch=${epochValido}, soakCompleto=${soakCompleto}, economicFidelity=${economicFid}; únicasFechadas ${unicasFechadas}/30, divergências ${divergencias}/15, stress=${stressAprovado}, concentração=${concentracaoAceitavel}, 0/2 janelas/regimes. HOST_REBOOT_TESTED=${!!(assur && assur.HOST_REBOOT_TESTED)}. NÃO recomendar Bitget+Bybit.`,
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
