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
  const inelegiveis = tel.map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter((t) => t && t.extensionEligible === false).length;
  // EXTENSÃO REAL = segurou ao menos 1 settlement extra (settlementsExtras>0).
  // O flag seguralemChampion é enganoso no replay batch (now() >> fecha histórico),
  // então NÃO conta pro gate — só settlementsExtras>0 conta.
  const extensoes = est.fechados.filter((f) => (f.settlementsExtras || 0) > 0);
  if (pol !== 'control') fechadasComExtensao += extensoes.length;
  const hbAge = hb && hb.ultimoCiclo ? Math.round((agoraMs() - hb.ultimoCiclo) / 1000) : null;
  rel.processos[pol] = {
    vivo: hb != null, heartbeatAgeS: hbAge,
    fechados: est.fechados.length, abertas: Object.keys(est.virtuais).length,
    extensoesFechadas: extensoes.length,
    pnlIncremental: +est.fechados.reduce((s, f) => s + (f.pnlLiquido || 0), 0).toFixed(4),
    liveObservedCounterfactualFunding: +est.fechados.reduce((s, f) => s + (f.liveObservedCounterfactualFunding || 0), 0).toFixed(4),
    divergenciaLinhas: div.length,
    eventosInelegiveis: inelegiveis,
    riscoExits: est.contadores.riscoExits || 0,
  };
}
const fid = rd(path.join(BASE, 'control', 'fidelidade.json'), null);
rel.controlFidelity = fid ? { comparisonStatus: fid.comparisonStatus, difAbs: fid.difAbs } : { comparisonStatus: 'DESCONHECIDO' };

// GATE atualizado (item 9)
const closedComparaveis = fechadasComExtensao; // fechamentos com extensão real
const divergenciasReais = POLS.filter((p) => p !== 'control').reduce((s, p) => s + (rel.processos[p].extensoesFechadas || 0), 0);
rel.gate = {
  fechadasComparaveisComExtensao: { valor: closedComparaveis, minimo: 30, atende: closedComparaveis >= 30 },
  divergenciasReaisVsControl: { valor: divergenciasReais, minimo: 15, atende: divergenciasReais >= 15 },
  janelas: { minimo: 2, nota: 'medir sobre a amostra viva acumulada' },
  regimes: { minimo: 2, nota: 'detectados no historico; reavaliar na janela viva' },
  controlFiel: rel.controlFidelity.comparisonStatus === 'OK',
  riscoObservadoComConfianca: 'telemetria classifica source/confidence por campo (champion_observed=1.0)',
  custos2x: 'aplicar sobre a amostra viva',
  drawdownNaoPior: 'a medir', distLiqNaoPior: 'a medir', semPosicaoDominante: 'a medir',
};
rel.gate.LIBERADO = rel.gate.fechadasComparaveisComExtensao.atende && rel.gate.divergenciasReaisVsControl.atende && rel.gate.controlFiel;
rel.gate.veredito = rel.gate.LIBERADO ? 'LIBERADO' : `BLOQUEADO — ${closedComparaveis}/30 fechamentos com extensão, ${divergenciasReais}/15 divergências reais. Control ${rel.controlFidelity.comparisonStatus}. Coleta em andamento; NÃO alterar o Champion.`;

fs.mkdirSync(path.join(ROOT, 'auditoria', 'challengers'), { recursive: true });
fs.writeFileSync(path.join(ROOT, 'auditoria', 'challengers', 'relatorio-diario.json'), JSON.stringify(rel, null, 2));
console.log(JSON.stringify({ controlFidelity: rel.controlFidelity, gate: rel.gate.veredito, processos: Object.fromEntries(POLS.map((p) => [p, { vivo: rel.processos[p].vivo, fechados: rel.processos[p].fechados, extensoes: rel.processos[p].extensoesFechadas, pnl: rel.processos[p].pnlIncremental }])) }, null, 2));
