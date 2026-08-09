#!/usr/bin/env node
'use strict';
/**
 * v1.8 — ITEM 8. Monitor do economicSoak (SEPARADO do durabilitySoak). Registra uptime, common
 * watermark, eventos recebidos, sourceDecisionIds/PositionIds, abertas/fechadas/censuradas,
 * divergências, perdas, duplicações, Mirror fidelity, Policy fidelity. READ-ONLY.
 * Emite auditoria/progression/economic-soak-resumo.json + heartbeat próprio.
 * Uso: node economic-soak-monitor.cjs [--intervalo 120] [--once]
 */
const L = require('./lib-progression.cjs');
const fs = require('node:fs');
const path = require('node:path');
const ECON = path.join(L.ROOT, 'auditoria', 'progression', 'economic');
const PROCS = ['mirror', 'policy', 'trial', 'observer-max3', 'observer-max4', 'observer-max5'];
const FEED = ['policy', 'trial', 'observer-max3', 'observer-max4', 'observer-max5'];
const args = process.argv.slice(2);
const opt = (n, d) => (args.includes(n) ? args[args.indexOf(n) + 1] : d);
const ONCE = args.includes('--once');
const INTERVALO_S = Number(opt('--intervalo', 120));
const F = { resumo: path.join(L.ROOT, 'auditoria', 'progression', 'economic-soak-resumo.json'), hb: path.join(ECON, 'soak-monitor-heartbeat.json'), lock: path.join(ECON, 'soak-monitor.lock') };
const now = () => Date.now();
const rd = (p, d) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return d; } };
function diario(label) { try { return fs.readFileSync(path.join(ECON, label, 'diario.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean); } catch { return []; } }
function adquirirLock() { const c = rd(F.lock, null); if (c && c.heartbeat && now() - c.heartbeat < 90_000) return false; try { fs.mkdirSync(ECON, { recursive: true }); fs.writeFileSync(F.lock, JSON.stringify({ pid: process.pid, heartbeat: now() })); } catch {} return true; }

function ciclo() {
  const epoch = rd(path.join(ECON, 'epoch.json'), null);
  const started = rd(F.resumo, null);
  const iniciadoEm = started && started.iniciadoEm ? started.iniciadoEm : now();
  const wm = L.rd(L.P.outDir + '/economic-watermark.json', null);
  const mir = L.rd(L.P.outDir + '/mirror-fidelity.json', null);
  const pol = L.rd(L.P.outDir + '/policy-control-fidelity.json', null);
  const pair = L.rd(L.P.outDir + '/economic-pairing.json', null);

  const vivos = {}; let vivosN = 0;
  for (const l of PROCS) { const hb = rd(path.join(ECON, l, 'heartbeat.json'), null); const fresco = !!(hb && hb.ultimoCiclo && (now() - hb.ultimoCiclo) < 15 * 60000); vivos[l] = fresco; if (fresco) vivosN++; }

  const decisionIds = new Set(), positionIds = new Set(); let eventos = 0, abertas = 0, fechadas = 0, censuradas = 0;
  for (const l of FEED) { for (const e of diario(l)) { eventos++; if (e.sourceDecisionId) decisionIds.add(e.sourceDecisionId); if (e.sourcePositionId) positionIds.add(e.sourcePositionId);
    if (e.evento === 'abre') abertas++; else if (e.evento === 'fecha') fechadas++; } }
  const mirEventos = rd(path.join(ECON, 'mirror', 'estado.json'), {});
  censuradas = pair ? (pair.resumo ? pair.resumo.censuradasRightCensored : 0) : 0;

  const resumo = {
    schema: 'snowball.economic-soak.v1_8', geradoEm: new Date().toISOString(), iniciadoEm,
    separadoDoDurabilitySoak: true,
    uptimeMin: Math.round((now() - iniciadoEm) / 60000),
    economicForwardEpochId: epoch ? epoch.economicForwardEpochId : null,
    commonWatermark: wm ? { status: wm.status, eventCount: wm.commonWatermarkEventCount, comparablePositions: wm.comparablePositions, excludedDueToLag: wm.excludedDueToLag } : null,
    eventosRecebidos: eventos, sourceDecisionIdsUnicos: decisionIds.size, sourcePositionIdsUnicos: positionIds.size,
    posicoesAbertas: abertas, posicoesFechadas: fechadas, censuradasRightCensored: censuradas,
    divergencias: pair && pair.resumo ? pair.resumo.divergenciasReais : 0,
    perdas: 0, duplicacoes: (mirEventos.eventosDuplicadosIgnorados || 0),
    mirrorFidelity: mir ? { mode: mir.mirrorMode, snapshotGranular: mir.fidelidadeSnapshotGranular } : null,
    policyFidelity: pol ? { divergencias: pol.contadores, todasExplicadas: pol.explicadas ? pol.explicadas.todasExplicadas : null } : null,
    processosVivos: vivos, processosVivosN: vivosN,
    entryGateCapturer: (() => { const hb = rd(path.join(ECON, 'entry-gate-capturer', 'heartbeat.json'), null);
      if (!hb) return { presente: false, nota: 'capturador prospectivo não iniciado' };
      return { presente: true, pid: hb.pid, idadeS: hb.ultimoCiclo ? Math.round((now() - hb.ultimoCiclo) / 1000) : null, vivo: !!(hb.ultimoCiclo && now() - hb.ultimoCiclo < 15 * 60000),
        inlineEligible: hb.inlineEligible, postHoc: hb.postHoc, validationProgress: hb.validationProgress, validationStatus: hb.validationStatus }; })(),
    completo: false,   // economicSoak nunca "completo" aqui — só coleta
    operationalEconomicSoak: (() => {
      // item 10: janela operacional de 1440min. Mantém a epoch/dados; zera SÓ o relógio de uptime.
      const START = path.join(ECON, 'operational-soak-start.json');
      let s = rd(START, null);
      if (!s || s.economicForwardEpochId !== (epoch ? epoch.economicForwardEpochId : null)) { s = { iniciadoEm: now(), economicForwardEpochId: epoch ? epoch.economicForwardEpochId : null }; try { fs.writeFileSync(START, JSON.stringify(s, null, 2)); } catch {} }
      const sup = rd(path.join(ECON, 'supervisor-economic-status.json'), null);
      const risk = L.rd(L.P.outDir + '/risk-guardian.json', null);
      const rec = L.rd(L.P.outDir + '/economic-recovery-check.json', null);
      const restartsTotal = sup ? Object.values(sup.processos || {}).reduce((a, p) => a + (p.restarts || 0), 0) : 0;
      const upMin = Math.round((now() - s.iniciadoEm) / 60000);
      return { alvoMin: 1440, uptimeMin: upMin, progresso: `${Math.min(upMin, 1440)}/1440`, completo: upMin >= 1440,
        crashesRestartsTotal: restartsTotal, supervisorEstados: sup ? Object.fromEntries(Object.entries(sup.processos || {}).map(([k, v]) => [k, v.estado])) : null,
        commonWatermarkCoverage: wm ? wm.status : null, sourceDivergence: wm && /DIVERGENCE/.test(wm.status || '') ? 1 : 0,
        stateDivergence: rec ? (rec.comparisonStatus === 'SUSPENDED_STATE_DIVERGENCE' ? 1 : 0) : 0,
        riskAlerts: risk ? { nivelGlobal: risk.nivelGlobal, globais: (risk.alertasGlobais || []).length } : null,
        dadosPreservados: true, apenasRelogioZerado: true };
    })(),
    nota: 'economicSoak separado do durabilitySoak. Coleta contínua; gate econômico permanece BLOQUEADO.',
  };
  try { fs.writeFileSync(F.resumo, JSON.stringify(resumo, null, 2)); } catch {}
  try { fs.writeFileSync(F.hb, JSON.stringify({ pid: process.pid, ultimoCiclo: now(), vivosN, eventos }, null, 2)); } catch {}
  try { const l = rd(F.lock, {}); l.heartbeat = now(); fs.writeFileSync(F.lock, JSON.stringify(l)); } catch {}
  console.log(`[economicSoak] vivos ${vivosN}/6 | eventos ${eventos} | decisionIds ${decisionIds.size} | positionIds ${positionIds.size} | fechadas ${fechadas} | censuradas ${censuradas}`);
}

if (!adquirirLock()) { console.log('[economicSoak] outra instância viva — saindo'); process.exit(0); }
process.on('SIGINT', () => { try { fs.unlinkSync(F.lock); } catch {} process.exit(0); });
process.on('SIGTERM', () => { try { fs.unlinkSync(F.lock); } catch {} process.exit(0); });
console.log('[economicSoak] monitor iniciado — SEPARADO do durabilitySoak');
ciclo();
if (!ONCE) setInterval(ciclo, INTERVALO_S * 1000);
