#!/usr/bin/env node
/**
 * MONITOR PROLONGADO dos challengers live-paper (item 5). READ-ONLY: só lê o
 * runtime isolado (heartbeat/estado/fidelidade/divergencia). Nada do Champion,
 * nada de ordem, nenhuma escrita fora de challengers-timing/.
 *
 * Uso: node monitor-24h.cjs [--min 1440] [--intervalo 60]
 * Grava uma linha por minuto em challengers-timing/monitor-24h.jsonl com:
 *   supervisor vivo, challengers vivos, idade de heartbeat, PIDs, restarts,
 *   cursor, fidelidade do Control, extensões abertas, divergências, e os
 *   contadores de eventos perdidos/duplicados (derivados da monotonicidade do
 *   cursor e de eventosConsumidos).
 */
const fs = require('node:fs');
const path = require('node:path');
const ROOT = path.resolve(__dirname, '..', '..');
const BASE = path.join(ROOT, 'challengers-timing');
const POLS = ['control', 'closeConfirm', 'nextSettlement', 'evExit'];
const OUT = path.join(BASE, 'monitor-24h.jsonl');
const SUM = path.join(ROOT, 'auditoria', 'challengers', 'monitor-24h-resumo.json');

const arg = (k, d) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : d; };
const MIN = Number(arg('--min', 1440));            // default 24h
const INT_S = Number(arg('--intervalo', 60));      // default 1 min
const rd = (p, d) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return d; } };
const nLinhas = (p) => { try { return fs.readFileSync(p, 'utf8').split('\n').filter(Boolean).length; } catch { return 0; } };
const HB_MAX_MS = (300 * 2 + 60) * 1000;           // = supervisor HEARTBEAT_MAX_S

// estado acumulado entre amostras (restarts, monotonicidade)
const prev = {}; for (const p of POLS) prev[p] = { pid: null, cursor: null, eventos: null, div: 0 };
const acc = { restarts: {}, eventosPerdidos: {}, eventosDuplicados: {}, divergenciasNovas: {} };
for (const p of POLS) { acc.restarts[p] = 0; acc.eventosPerdidos[p] = 0; acc.eventosDuplicados[p] = 0; acc.divergenciasNovas[p] = 0; }
let amostras = 0;

function amostra() {
  const t = Date.now();
  const supLock = rd(path.join(BASE, 'supervisor.lock'), null);
  const supVivo = !!(supLock && supLock.heartbeat && (t - supLock.heartbeat) < 90_000);
  const fid = rd(path.join(BASE, 'control', 'fidelidade.json'), null);

  const linha = {
    ts: new Date(t).toISOString(), epochMs: t, amostra: ++amostras,
    supervisor: { vivo: supVivo, pid: supLock ? supLock.pid : null, hbAgeS: supLock && supLock.heartbeat ? Math.round((t - supLock.heartbeat) / 1000) : null },
    controlFidelity: fid ? { status: fid.comparisonStatus, pnl: fid.vetor && fid.vetor.pnl, cursor: fid.vetor && fid.vetor.cursorByteOffset } : { status: 'DESCONHECIDO' },
    challengers: {},
  };

  for (const pol of POLS) {
    const D = path.join(BASE, pol);
    const hb = rd(path.join(D, 'heartbeat.json'), null);
    const est = rd(path.join(D, 'estado.json'), null);
    const hbAgeMs = hb && hb.ultimoCiclo ? (t - hb.ultimoCiclo) : null;
    const vivo = hbAgeMs != null && hbAgeMs < HB_MAX_MS;
    const pid = hb ? hb.pid : null;
    const cursor = est ? (est.cursorDiario || 0) : null;
    const eventos = est ? (est.eventosConsumidos || 0) : null;
    const diarioPath = process.env.CH_DIARIO || path.join(ROOT, 'spread', 'diario.jsonl');
    const diarioSize = (() => { try { return fs.statSync(diarioPath).size; } catch { return null; } })();
    // extensões abertas: virtuais mantidas além do fechamento do Champion
    let extAbertas = 0;
    if (est && est.virtuais) for (const k of Object.keys(est.virtuais)) { const v = est.virtuais[k]; if (v && v.championAberta === false && (v.decisionDivergence || v.realExtension)) extAbertas++; }
    const divTotal = nLinhas(path.join(D, 'divergencia.jsonl'));

    // restart: pid mudou (e ambos definidos)
    const pv = prev[pol];
    if (pv.pid != null && pid != null && pid !== pv.pid) acc.restarts[pol]++;
    // eventos perdidos/duplicados: cursor deve ser monotônico (salvo rotação: diario encolheu)
    if (pv.cursor != null && cursor != null) {
      if (cursor < pv.cursor && diarioSize != null && diarioSize >= pv.cursor) acc.eventosPerdidos[pol]++; // recuou sem rotação = leitura pulada/reset suspeito
    }
    if (pv.eventos != null && eventos != null && eventos < pv.eventos) acc.eventosDuplicados[pol]++; // contador de consumo recuou = reprocessamento
    if (divTotal > pv.div) acc.divergenciasNovas[pol] += (divTotal - pv.div);

    linha.challengers[pol] = {
      vivo, pid, hbAgeS: hbAgeMs != null ? Math.round(hbAgeMs / 1000) : null,
      cursor, eventosConsumidos: eventos, fechados: est ? est.fechados.length : null,
      extensoesAbertas: extAbertas, divergenciasTotal: divTotal,
      restartsAcum: acc.restarts[pol], eventosPerdidosAcum: acc.eventosPerdidos[pol], eventosDuplicadosAcum: acc.eventosDuplicados[pol],
    };
    prev[pol] = { pid, cursor, eventos, div: divTotal };
  }

  try { fs.appendFileSync(OUT, JSON.stringify(linha) + '\n'); } catch {}
  const vivos = POLS.filter((p) => linha.challengers[p].vivo).length;
  const perdidos = POLS.reduce((s, p) => s + acc.eventosPerdidos[p], 0);
  const dups = POLS.reduce((s, p) => s + acc.eventosDuplicados[p], 0);
  const restarts = POLS.reduce((s, p) => s + acc.restarts[p], 0);
  console.log(`[${linha.ts}] sup=${supVivo ? 'ok' : 'DOWN'} vivos=${vivos}/4 fid=${linha.controlFidelity.status} restarts=${restarts} perdidos=${perdidos} dups=${dups}`);

  const resumo = {
    geradoEm: linha.ts, amostras, duracaoMin: MIN, intervaloS: INT_S,
    supervisorVivoUltima: supVivo, challengersVivosUltima: vivos,
    controlFidelityUltima: linha.controlFidelity.status,
    restartsPorPolitica: acc.restarts, eventosPerdidosPorPolitica: acc.eventosPerdidos,
    eventosDuplicadosPorPolitica: acc.eventosDuplicados, divergenciasNovasPorPolitica: acc.divergenciasNovas,
    integridade: (perdidos === 0 && dups === 0) ? 'SEM PERDA/DUPLICAÇÃO' : `ANOMALIAS: ${perdidos} perdas, ${dups} duplicações`,
  };
  try { fs.mkdirSync(path.dirname(SUM), { recursive: true }); fs.writeFileSync(SUM, JSON.stringify(resumo, null, 2)); } catch {}
}

const totalAmostras = Math.max(1, Math.round((MIN * 60) / INT_S));
console.log(`monitor-24h iniciado — ${MIN}min, amostra a cada ${INT_S}s (${totalAmostras} amostras). READ-ONLY. Saída: ${OUT}`);
amostra();
const timer = setInterval(() => { amostra(); if (amostras >= totalAmostras) { clearInterval(timer); console.log('monitor-24h concluído.'); process.exit(0); } }, INT_S * 1000);
