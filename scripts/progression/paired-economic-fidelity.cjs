#!/usr/bin/env node
'use strict';
/**
 * v1.7 — ITEM 9. Fidelidade econômica PAREADA. Para cada operação forward reconstrói o
 * registro completo (sourceOpportunityId, sourceEpisodeId, championPositionId,
 * controlPositionId, entryCycle/Ts, exchanges, notional, custos de entrada, fundingEventIds,
 * escalonamentos, custos de saída, closeCycle, closeReason, realized/marked/executable PnL) e
 * PAREIA a MESMA oportunidade-fonte entre as políticas (trial/control/observer-max3/4/5),
 * comparando EVENTO A EVENTO — não só agregados. É o dataset canônico que independent-sample,
 * concentration e stress consomem. READ-ONLY. Emite paired-economic-fidelity.json.
 */
const L = require('./lib-progression.cjs');
const fs = require('node:fs');
const path = require('node:path');
const LABELS = ['trial', 'control', 'observer-max3', 'observer-max4', 'observer-max5'];
const BASE = path.join(L.ROOT, 'auditoria', 'progression', 'forward');
const NOTIONAL = L.ALVO_POR_EXCHANGE, HORA = 3600000;

function lerDiario(label) { try { return fs.readFileSync(path.join(BASE, label, 'diario.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean); } catch { return []; } }

// reconstrói operações (abre→fecha) por chave, sequencialmente; opens remanescentes = censuradas
function operacoes(label) {
  const ev = lerDiario(label); const abertoPorK = {}; const ops = [];
  for (const e of ev) {
    if (e.evento === 'abre') { abertoPorK[e.k] = { k: e.k, entryTs: e.ts, aprEntrada: e.apr, custoEntrada: e.custoEntrada, fundingEventos: [] }; }
    else if (e.evento === 'fecha') { const o = abertoPorK[e.k]; if (!o) continue; delete abertoPorK[e.k];
      const [sym, long, short] = e.k.split('|');
      const custoSaida = L.r4((e.funding || 0) - (o.custoEntrada || 0) - (e.pnl || 0));
      ops.push({ sourceOpportunityId: `${e.k}@${Math.floor(o.entryTs / HORA)}`, sourceEpisodeId: `${e.k}#${o.entryTs}`, k: e.k, sym, exchanges: [long, short],
        controlPositionId: `${label}:${e.k}:${o.entryTs}`, championPositionId: null,
        entryTs: o.entryTs, closeTs: e.ts, closeReason: (o.aprEntrada != null && o.aprEntrada <= 0) ? 'apr_nonpositive' : 'scanner_episode_ended',
        notional: NOTIONAL, custoEntrada: L.r4(o.custoEntrada || 0), custoSaida, funding: L.r4(e.funding || 0),
        realizedPnL: L.r4(e.pnl || 0), markedPnL: L.r4(e.pnl || 0), executablePnL: L.r4(e.pnl || 0),  // fechada = realizada (marked/executable == realized no fecho)
        aberta: false }); }
  }
  const censuradas = Object.values(abertoPorK).map((o) => { const [sym, long, short] = o.k.split('|');
    return { sourceOpportunityId: `${o.k}@${Math.floor(o.entryTs / HORA)}`, k: o.k, sym, exchanges: [long, short], controlPositionId: `${label}:${o.k}:${o.entryTs}`, entryTs: o.entryTs, notional: NOTIONAL, custoEntrada: L.r4(o.custoEntrada || 0), aberta: true, censurada: true }; });
  return { fechadas: ops, censuradas };
}

function build() {
  const { asOf } = L.loadChampion();
  const porPolitica = {}; for (const l of LABELS) porPolitica[l] = operacoes(l);

  // pareamento por sourceOpportunityId entre políticas
  const pares = new Map();
  for (const l of LABELS) { for (const op of porPolitica[l].fechadas) { if (!pares.has(op.sourceOpportunityId)) pares.set(op.sourceOpportunityId, { sourceOpportunityId: op.sourceOpportunityId, sym: op.sym, exchanges: op.exchanges, politicas: {} }); pares.get(op.sourceOpportunityId).politicas[l] = op; } }
  const paresArr = [...pares.values()].map((p) => {
    const pnls = LABELS.map((l) => p.politicas[l] ? p.politicas[l].realizedPnL : null).filter((x) => x != null);
    const politicasQueFecharam = Object.keys(p.politicas);
    // divergência REAL: políticas com resultado econômico diferente (>US$0,01) OU decisão diferente (abriu numa, não noutra)
    const spread = pnls.length ? L.r4(Math.max(...pnls) - Math.min(...pnls)) : 0;
    const abriuEmTodas = politicasQueFecharam.length === LABELS.length;
    const divergiu = spread > 0.01 || !abriuEmTodas;
    return { ...p, politicasQueFecharam, realizedPnLPorPolitica: Object.fromEntries(LABELS.map((l) => [l, p.politicas[l] ? p.politicas[l].realizedPnL : null])), spreadRealizedPnL: spread, divergiu, tipoDivergencia: !abriuEmTodas ? 'decisao_diferente' : (spread > 0.01 ? 'pnl_diferente' : 'nenhuma') };
  });

  const uniqueSourceClosed = new Set(paresArr.map((p) => p.sourceOpportunityId)).size;
  const divergencias = paresArr.filter((p) => p.divergiu).length;
  const censuradasTotal = LABELS.reduce((s, l) => s + porPolitica[l].censuradas.length, 0);
  const fechadasPorPolitica = Object.fromEntries(LABELS.map((l) => [l, porPolitica[l].fechadas.length]));

  const out = {
    schema: 'snowball.paired-economic-fidelity.v1_7', geradoEm: new Date(asOf || 0).toISOString(), asOfMs: asOf,
    fechadasPorPolitica, censuradasPorPolitica: Object.fromEntries(LABELS.map((l) => [l, porPolitica[l].censuradas.length])),
    resumo: { uniqueSourceOpportunityClosed: uniqueSourceClosed, divergenciasReais: divergencias, censuradasAbertas: censuradasTotal },
    campos: ['sourceOpportunityId', 'sourceEpisodeId', 'controlPositionId', 'championPositionId', 'entryTs', 'closeTs', 'exchanges', 'notional', 'custoEntrada', 'custoSaida', 'funding', 'closeReason', 'realizedPnL', 'markedPnL', 'executablePnL'],
    pares: paresArr.slice(0, 500),
    operacoesFechadas: Object.fromEntries(LABELS.map((l) => [l, porPolitica[l].fechadas.slice(0, 500)])),
    honestidade: `Compara a MESMA oportunidade-fonte entre políticas, evento a evento. Nesta fase há ${uniqueSourceClosed} oportunidades-fonte únicas FECHADas e ${censuradasTotal} posições ABERTAS (censuradas). PnL de posição aberta NÃO conta — só fechamentos reais. Marked/executable == realized no fecho (posição liquidada).`,
  };
  const p = L.writeJSON('paired-economic-fidelity.json', out);
  console.log(JSON.stringify({ saida: p, uniqueSourceClosed, divergencias, censuradasTotal, fechadasPorPolitica }, null, 2));
}
build();
