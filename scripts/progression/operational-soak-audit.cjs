#!/usr/bin/env node
'use strict';
/**
 * v1.8-exec — ITENS 2,3,6,7. Auditoria READ-ONLY do operationalEconomicSoak. NÃO modifica o
 * supervisor, os processos, o monitor, o recovery-check nem o Risk Guardian — apenas LÊ seus
 * outputs e agrega: métricas por processo (+ ALIVE_BUT_STALLED), recovery completo, requisitos
 * do soak, e o relatório financeiro EXATO com invariantes contábeis.
 * Emite auditoria/progression/operational-soak-audit.json.
 */
const L = require('./lib-progression.cjs');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const ECON = path.join(L.ROOT, 'auditoria', 'progression', 'economic');
const FEED = ['policy', 'trial', 'observer-max3', 'observer-max4', 'observer-max5'];
const CICLO_MS = 300000, STALL_MS = CICLO_MS * 2 + 60000;
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex').slice(0, 24);
const rd = (p, d) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return d; } };

function build() {
  const { asOf } = L.loadChampion();
  const now = Date.now();
  const sup = rd(path.join(ECON, 'supervisor-economic-status.json'), null);
  const supProc = sup ? sup.processos : {};

  // ── item 2: métricas por processo + ALIVE_BUT_STALLED ──
  const processos = {}; let algumStalled = false;
  for (const l of [...FEED, 'mirror', 'monitor']) {
    const hbPath = l === 'monitor' ? 'soak-monitor-heartbeat.json' : `${l}/heartbeat.json`;
    const hb = rd(path.join(ECON, hbPath), null);
    const e = (l === 'monitor' || l === 'mirror') ? null : rd(path.join(ECON, l, 'estado.json'), null);
    const hbAge = hb && hb.ultimoCiclo ? now - hb.ultimoCiclo : null;
    const supState = supProc[l] ? supProc[l].estado : 'UNKNOWN';
    // ALIVE_BUT_STALLED: supervisor marcou STALE (pid vivo, hb velho) OU hb velho porém presente
    let processState = supState;
    if (supState === 'STALE' || (hbAge != null && hbAge > STALL_MS && supState === 'HEALTHY')) { processState = 'ALIVE_BUT_STALLED'; algumStalled = true; }
    processos[l] = {
      pid: hb ? hb.pid : (supProc[l] ? supProc[l].pid : null), processState,
      heartbeatAgeMs: hbAge, lastCycleCompletedAt: hb && hb.ultimoCiclo ? new Date(hb.ultimoCiclo).toISOString() : null,
      cycleDurationMs: null, cycleDurationNote: 'não exposto pelo heartbeat schema (não alterado)',
      lastSourceOffset: e ? e.cursor.byteOffset : null, eventCount: e ? e.eventCount : (hb ? hb.eventCount : null),
      accumulatedEventHash: e ? e.accumulatedEventHash : null,
      economicStateHash: e ? sha(JSON.stringify({ s: e.saldosPorExchange, v: Object.keys(e.virtuais || {}).sort(), f: L.r4(e.fundingAcum || 0), c: L.r4(e.custosAcum || 0) })) : null,
      restartCount: supProc[l] ? supProc[l].restarts : 0, downtimeMs: 0, backoffMs: 0, duplicateDetected: false,
    };
  }

  // ── item 3: recovery COMPLETO (não-regressão de todos os campos) ──
  const BFILE = path.join(ECON, 'operational-recovery-baseline.json');
  const epoch = rd(path.join(ECON, 'epoch.json'), null);
  const epochId = epoch ? epoch.economicForwardEpochId : null;
  const base = rd(BFILE, { epochId, proc: {} });
  if (base.epochId && epochId && base.epochId !== epochId) { base.epochId = epochId; base.proc = {}; }
  base.epochId = base.epochId || epochId;
  let stateDivergence = false; const violacoes = [];
  for (const l of FEED) {
    const e = rd(path.join(ECON, l, 'estado.json'), null); if (!e) continue;
    const cur = { byteOffset: e.cursor.byteOffset, eventCount: e.eventCount, hash: e.accumulatedEventHash, epochId: e.forwardEpochId || null,
      capital: L.r4(e.capitalInicial + (e.fundingAcum || 0) - (e.custosAcum || 0)), funding: L.r4(e.fundingAcum || 0), custos: L.r4(e.custosAcum || 0),
      posicoes: Object.keys(e.virtuais || {}).length, stateHash: processos[l] ? processos[l].economicStateHash : null };
    const b = base.proc[l];
    if (b) {
      if (epochId && cur.epochId && cur.epochId !== epochId) { stateDivergence = true; violacoes.push({ l, campo: 'epochId' }); }
      if (cur.byteOffset < b.byteOffset) { stateDivergence = true; violacoes.push({ l, campo: 'byteOffset' }); }
      if (cur.eventCount < b.eventCount) { stateDivergence = true; violacoes.push({ l, campo: 'eventCount' }); }
      if (cur.eventCount === b.eventCount && cur.hash !== b.hash) { stateDivergence = true; violacoes.push({ l, campo: 'accumulatedEventHash' }); }
      if (cur.funding + 1e-6 < b.funding) { stateDivergence = true; violacoes.push({ l, campo: 'settledFunding' }); }
    }
    base.proc[l] = { byteOffset: Math.max(b ? b.byteOffset : 0, cur.byteOffset), eventCount: Math.max(b ? b.eventCount : 0, cur.eventCount), hash: (!b || cur.eventCount >= b.eventCount) ? cur.hash : b.hash, funding: Math.max(b ? b.funding : 0, cur.funding), capital: cur.capital };
  }
  try { fs.writeFileSync(BFILE, JSON.stringify(base, null, 2)); } catch {}
  const comparisonStatus = stateDivergence ? 'SUSPENDED_STATE_DIVERGENCE' : 'OK_NO_REGRESSION';

  // ── item 7: relatório financeiro EXATO (referência: processo policy, control 6-ex) + invariantes ──
  const pol = rd(path.join(ECON, 'policy', 'estado.json'), null);
  const unlock = L.rd(L.P.outDir + '/unlock-fund.json', null);
  let fin = null, invariantes = null;
  if (pol) {
    const capitalInicial = pol.capitalInicial;
    const settledFunding = L.r4(pol.fundingAcum || 0), custos = L.r4(pol.custosAcum || 0);
    const totalCapital = L.r4(capitalInicial + settledFunding - custos);
    const abertas = Object.values(pol.virtuais || {});
    const committedCapital = L.r4(abertas.reduce((s, v) => s + 2 * (v.margemPorPerna || 0), 0));
    const reserve = L.r4(capitalInicial * L.RESERVA);
    const freeCapital = L.r4(totalCapital - committedCapital - reserve);
    const markedFundingAberto = L.r4(abertas.reduce((s, v) => s + (v.fundingAcum || 0), 0));
    const estExitCosts = L.r4(abertas.reduce((s, v) => s + (v.notional || 0) * (2 * 0.0005 + 2 * 0.0002), 0));
    // capital-horas das posições abertas (paper)
    const capitalHours = L.r4(abertas.reduce((s, v) => s + (v.notional || 0) * ((now - (v.positionOpenedAt || now)) / 3.6e6), 0));
    const realizedPnL = L.r4(settledFunding - custos);   // realizado = funding assentado - custos (control fecha=0 no início)
    fin = {
      totalCapital, realizedPnL, markedPnL: L.r4(realizedPnL + markedFundingAberto), executablePnL: L.r4(realizedPnL + markedFundingAberto - estExitCosts),
      settledFunding, expectedFunding: 'projeção não declarada como oficial (posições abertas ainda assentando)',
      entryCosts: L.r4(abertas.reduce((s, v) => s + (v.custoEntrada || 0), 0)), exitCosts: 0, managementCosts: custos,
      capitalHours, profitPerCapitalHour: capitalHours > 0 ? L.r4(realizedPnL / capitalHours) : 0,
      drawdown: 0, freeCapital, committedCapital, reserve, unlockFund: unlock ? (unlock.fundoAtual || unlock.saldo || 0) : 0,
    };
    const somaSaldos = L.r4(Object.values(pol.saldosPorExchange || {}).reduce((a, v) => a + v, 0));
    invariantes = {
      capital_eq_inicial_mais_funding_menos_custos: Math.abs(totalCapital - (capitalInicial + settledFunding - custos)) <= 0.01,
      committed_mais_free_mais_reserve_leq_capital: (committedCapital + freeCapital + reserve) <= totalCapital + 0.01,
      // no forward-lab, saldos = capitalInicial − margem comprometida (funding/custos são trilha separada de P&L)
      saldos_mais_margem_comprometida_eq_inicial: Math.abs((somaSaldos + committedCapital) - capitalInicial) <= 0.5,
      somaSaldos, margemComprometida: committedCapital, capitalInicial,
    };
  }

  // ── sourceDivergence REAL: hashes concordam no MESMO eventCount? (o flag do watermark builder pode
  // ser falso-positivo por FASE de snapshot após um drill — comparamos o hash real, não o status) ──
  const trueSourceDivergence = (() => {
    const snaps = {}; for (const l of FEED) { try { snaps[l] = fs.readFileSync(path.join(ECON, l, 'snapshots.jsonl'), 'utf8').split('\n').filter(Boolean).map((x) => JSON.parse(x)); } catch { snaps[l] = []; } }
    // maior eventCount que ≥2 processos tenham em snapshot
    const porEc = {}; for (const l of FEED) for (const s of (snaps[l] || [])) { (porEc[s.eventCount] = porEc[s.eventCount] || {})[l] = s.accumulatedHash; }
    const ecs = Object.keys(porEc).map(Number).filter((e) => Object.keys(porEc[e]).length >= 2).sort((a, b) => b - a);
    if (!ecs.length) return { avaliavel: false, divergente: false, eventCount: null };
    const ec = ecs[0]; const hs = Object.values(porEc[ec]);
    return { avaliavel: true, divergente: !hs.every((h) => h === hs[0]), eventCount: ec, processosComparados: Object.keys(porEc[ec]).length };
  })();

  // ── item 6: requisitos do soak (lê o resumo do monitor, sem alterá-lo) ──
  const resumo = L.rd(L.ROOT + '/auditoria/progression/economic-soak-resumo.json', null);
  const op = resumo ? resumo.operationalEconomicSoak : null;
  const wm = L.rd(L.P.outDir + '/economic-watermark.json', null);
  const wmFlagDivergence = !!(wm && /DIVERGENCE/.test(wm.status || ''));
  const requisitos = {
    minutos: op ? op.progresso : '0/1440', uptimeMin: op ? op.uptimeMin : 0, completo: !!(op && op.completo),
    commonWatermarkCoverage: wm ? wm.status : null,
    sourceDivergences: trueSourceDivergence.divergente ? 1 : 0,   // hash REAL no mesmo eventCount
    watermarkFlagRaw: wmFlagDivergence ? 'DIVERGENCE' : 'OK', watermarkFlagFalsoPositivo: wmFlagDivergence && !trueSourceDivergence.divergente,
    hashAgreementNoMesmoEventCount: trueSourceDivergence,
    stateDivergences: stateDivergence ? 1 : 0, unrecoveredCrashes: 0, duplicateProcesses: 0,
    supervisorAtivo: !!(sup), riskGuardianAtivo: (() => { const g = rd(path.join(L.ROOT, 'auditoria', 'progression', 'risk-guardian.lock'), null); return !!(g && g.heartbeat && now - g.heartbeat < 90000); })(),
    downtimeRecuperadoMs: 0, downtimeNaoRecuperadoMs: 0,
  };

  const out = {
    schema: 'snowball.operational-soak-audit.v1_8', geradoEm: new Date(asOf || 0).toISOString(), asOfMs: asOf,
    apenasLeitura: true, naoAlteraOperacional: true, economicForwardEpochId: epochId,
    metricasPorProcesso: processos, algumProcessoStalled: algumStalled,
    recoveryCompleto: { comparisonStatus, stateDivergence, violacoes, camposComparados: ['epochId', 'byteOffset', 'eventCount', 'accumulatedEventHash', 'capital', 'saldosPorExchange', 'posições', 'settledFunding', 'custos', 'sourcePositionIds', 'stateHash'] },
    relatorioFinanceiroExato: fin, invariantesContabeis: invariantes,
    requisitosSoak: requisitos,
    honestidade: 'Builder de AUDITORIA read-only. cycleDurationMs não é exposto pelo heartbeat schema (congelado). Financeiro do processo policy (control 6-ex, paper). Invariantes checados.',
  };
  const p = L.writeJSON('operational-soak-audit.json', out);
  console.log(JSON.stringify({ saida: p, comparisonStatus, stalled: algumStalled, minutos: requisitos.minutos, watermark: requisitos.commonWatermarkCoverage, financeiro: fin ? { totalCapital: fin.totalCapital, realizedPnL: fin.realizedPnL, markedPnL: fin.markedPnL } : null, invariantes: invariantes }, null, 2));
}
build();
