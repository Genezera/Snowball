#!/usr/bin/env node
/**
 * RELATÓRIO DIÁRIO dos challengers live-paper (itens 9,10). READ-ONLY — só lê o
 * runtime isolado dos challengers. Não toca Champion/motor/estado.
 */
const fs = require('node:fs');
const path = require('node:path');
const ROOT = path.resolve(__dirname, '..', '..');
const BASE = path.join(ROOT, 'challengers-timing');
const POLS = ['control', 'closeConfirm', 'nextSettlement', 'evExit'];
const rd = (p, d) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return d; } };
const linhas = (p) => { try { return fs.readFileSync(p, 'utf8').split('\n').filter(Boolean); } catch { return []; } };
const now = Number(process.env.NOW_MS) || undefined; // sem Date.now em runtime? aqui é CLI, ok usar mtime
const agoraMs = () => { try { return fs.statSync(path.join(BASE, 'control', 'heartbeat.json')).mtimeMs; } catch { return 0; } };

const rel = { geradoEm: new Date(agoraMs() || 0).toISOString(), processos: {} };
let fechadasComExtensao = 0;
for (const pol of POLS) {
  const D = path.join(BASE, pol);
  const hb = rd(path.join(D, 'heartbeat.json'), null);
  const est = rd(path.join(D, 'estado.json'), { fechados: [], virtuais: {}, contadores: {} });
  const div = linhas(path.join(D, 'divergencia.jsonl'));
  const tel = linhas(path.join(D, 'telemetria.jsonl'));
  const telObj = tel.map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  const inelegiveis = telObj.filter((t) => t && t.extensionEligible === false).length;
  const inelegiveisPorMotivo = {}; for (const t of telObj) { if (t.eligibility && !t.eligibility.eligible && t.eligibility.ineligibleReason) inelegiveisPorMotivo[t.eligibility.ineligibleReason] = (inelegiveisPorMotivo[t.eligibility.ineligibleReason] || 0) + 1; }
  // DEFINIÇÕES SEPARADAS (item 1): decisão divergente vs extensão real vs settlement extra
  const decisionDiv = est.fechados.filter((f) => f.decisionDivergence).length;
  const realExt = est.fechados.filter((f) => f.realExtension).length;
  const settlExt = est.fechados.filter((f) => f.settlementExtension).length;
  if (pol !== 'control') fechadasComExtensao += realExt;
  const hbAge = hb && hb.ultimoCiclo ? Math.round((agoraMs() - hb.ultimoCiclo) / 1000) : null;
  rel.processos[pol] = {
    vivo: hb != null, heartbeatAgeS: hbAge, pid: hb ? hb.pid : null,
    cursorDiario: est.cursorDiario || 0, eventosConsumidos: est.eventosConsumidos || 0, lastEventId: est.lastEventId || null,
    fechados: est.fechados.length, abertas: Object.keys(est.virtuais).length,
    decisionDivergences: decisionDiv, realExtensions: realExt, settlementExtensions: settlExt,
    pnlIncremental: +est.fechados.reduce((s, f) => s + (f.pnlLiquido || 0), 0).toFixed(4),
    expectedCounterfactualFunding: +est.fechados.reduce((s, f) => s + (f.expectedCounterfactualFunding || 0), 0).toFixed(4),
    settledCounterfactualFunding: +est.fechados.reduce((s, f) => s + (f.settledCounterfactualFunding || 0), 0).toFixed(4),
    divergenciaLinhas: div.length, eventosInelegiveis: inelegiveis, inelegiveisPorMotivo,
    riscoExits: est.contadores.riscoExits || 0,
  };
}
const fid = rd(path.join(BASE, 'control', 'fidelidade.json'), null);
rel.controlFidelity = fid ? { comparisonStatus: fid.comparisonStatus, divergenciasMateriais: fid.divergenciasMateriais || [], vetor: fid.vetor } : { comparisonStatus: 'DESCONHECIDO' };

// GATE atualizado (item 7): realExtensions vs decisionDivergences separados
const realExtensionsFechadas = fechadasComExtensao;
const decisionDivergences = POLS.filter((p) => p !== 'control').reduce((s, p) => s + (rel.processos[p].decisionDivergences || 0), 0);
const settlementExtensions = POLS.filter((p) => p !== 'control').reduce((s, p) => s + (rel.processos[p].settlementExtensions || 0), 0);
rel.gate = {
  realExtensionsFechadas: { valor: realExtensionsFechadas, minimo: 30, atende: realExtensionsFechadas >= 30 },
  decisionDivergences: { valor: decisionDivergences, minimo: 15, atende: decisionDivergences >= 15 },
  extensoesQueCapturaramSettlement: settlementExtensions, // mostrado separadamente (item 7)
  janelas: { minimo: 2, nota: 'medir sobre a amostra viva acumulada' },
  regimes: { minimo: 2, nota: 'detectados no historico; reavaliar na janela viva' },
  controlFielVetorial: rel.controlFidelity.comparisonStatus === 'OK',
  telemetriaElegivelDuranteExtensao: 'checada por ciclo (eligibility.bothLegs + confidenceMin)',
  custos2x: 'aplicar sobre a amostra viva', drawdownNaoPior: 'a medir', distLiqNaoPior: 'a medir', semPosicaoDominante: 'a medir',
};
rel.gate.LIBERADO = rel.gate.realExtensionsFechadas.atende && rel.gate.decisionDivergences.atende && rel.gate.controlFielVetorial;
rel.gate.veredito = rel.gate.LIBERADO ? 'LIBERADO' : `BLOQUEADO — ${realExtensionsFechadas}/30 realExtensions, ${decisionDivergences}/15 decisionDivergences (${settlementExtensions} capturaram settlement). Control vetorial ${rel.controlFidelity.comparisonStatus}. NÃO alterar o Champion.`;

fs.mkdirSync(path.join(ROOT, 'auditoria', 'challengers'), { recursive: true });
fs.writeFileSync(path.join(ROOT, 'auditoria', 'challengers', 'relatorio-diario.json'), JSON.stringify(rel, null, 2));
console.log(JSON.stringify({ controlFidelity: rel.controlFidelity, gate: rel.gate.veredito, processos: Object.fromEntries(POLS.map((p) => [p, { vivo: rel.processos[p].vivo, fechados: rel.processos[p].fechados, extensoes: rel.processos[p].extensoesFechadas, pnl: rel.processos[p].pnlIncremental }])) }, null, 2));
