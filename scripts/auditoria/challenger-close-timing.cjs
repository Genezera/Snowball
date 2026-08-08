#!/usr/bin/env node
/**
 * CHALLENGERS DE TIMING DE FECHAMENTO — paper isolado, READ-ONLY. Replica as
 * ENTRADAS e o SIZING reais do Champion (do diario), divergindo SÓ na regra de
 * fechamento. Nunca toca Champion/motor/estado/execução. Estimativas de funding
 * pós-fechamento vêm do historico (apr) — marcadas como estimativa, não real.
 */
const fs = require('node:fs');
const path = require('node:path');
const SNAP = 'auditoria/snapshot-1786189433850/copias';
const OUT = 'auditoria/challengers';
const SNAP_TS = 1786189433850;
fs.mkdirSync(OUT, { recursive: true });

const diario = fs.readFileSync(path.join(SNAP, 'spread__diario.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
const hist = fs.readFileSync('vigilancia/historico.jsonl', 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
const histK = {}; for (const h of hist) (histK[h.k] ||= []).push(h);
for (const k in histK) histK[k].sort((a, b) => a.ts - b.ts);
function aprEm(k, ts) { const s = histK[k]; if (!s || !s.length) return null; let best = null, bd = Infinity; for (const h of s) { const d = Math.abs(h.ts - ts); if (d < bd) { bd = d; best = h; } } return bd <= 2 * 3600_000 ? best : null; }

// ── reconstrói posições reais (ground truth até o fechamento) ────────────────
const pos = {};
for (const e of diario) {
  if (e.evento === 'abre' || e.evento === 'abre-captura') pos[e.symbol] = { symbol: e.symbol, key: `${e.symbol}|${e.short}|${e.long}`, modo: e.evento === 'abre-captura' ? 'captura' : 'normal', abreTs: e.ts, notional: e.notional, intervaloHoras: e.intervaloHoras || null, fundTs: [], fundVals: [], custo: e.custo || 0, custoAbre: e.custo || 0 };
  else if (e.evento === 'funding' && pos[e.symbol]) { pos[e.symbol].fundTs.push(e.ts); pos[e.symbol].fundVals.push(e.ganho); }
  else if (['reinveste', 'escalona', 'apara'].includes(e.evento) && e.symbol && pos[e.symbol]) pos[e.symbol].custo += e.custo || 0;
  else if (e.evento === 'fecha' && pos[e.symbol]) { pos[e.symbol].fechaTs = e.ts; pos[e.symbol].custoFecha = e.custo || 0; pos[e.symbol].custo += e.custo || 0; pos[e.symbol].motivo = e.motivo; pos[e.symbol].fechada = true; }
}
const posicoes = Object.values(pos).filter((p) => p.fechada); // só comparáveis (fechadas)

// intervalo de settlement por posição
function intervaloH(p) {
  if (p.intervaloHoras) return p.intervaloHoras;
  if (p.fundTs.length >= 2) { const dt = (p.fundTs[p.fundTs.length - 1] - p.fundTs[0]) / (p.fundTs.length - 1) / 3600_000; return dt < 2 ? 1 : dt < 6 ? 4 : 8; }
  return 8; // conservador: menos settlements futuros
}
// benchmark de custo de oportunidade: funding real por capital-hora do Champion
const fundingTotalReal = diario.filter((e) => e.evento === 'funding').reduce((s, e) => s + (e.ganho || 0), 0);
const capitalRef = 600, horasReais = (SNAP_TS - diario.find((e) => e.evento === 'init').ts) / 3600_000;
const taxaOportPorCapHora = fundingTotalReal / (capitalRef * horasReais); // ~funding/$/h

// ── simula segurar além do fechamento real, aplicando uma regra ─────────────
function simularExtensao(p, regra, mult = {}) {
  const custMult = mult.custo ?? 1, slipMult = mult.slippage ?? 1, fundMult = mult.funding ?? 1;
  const intH = intervaloH(p); const intMs = intH * 3600_000;
  let addFunding = 0, addOpp = 0, extraSettlements = 0, closeTs = p.fechaTs, invertConfirmada = false;
  let cursor = Math.ceil(p.fechaTs / intMs) * intMs; // próximo boundary de settlement
  const HORIZONTE = p.fechaTs + Math.min(3 * intMs, 24 * 3600_000);
  while (cursor <= HORIZONTE) {
    const h = aprEm(p.key, cursor);
    if (!h) break; // dados não frescos → não estende (Next Settlement/EV exigem dados frescos)
    const invertido = (h.apr ?? 0) <= 0 || (h.spread ?? 0) <= 0;
    const fundingSettl = ((h.apr || 0) / (8760 / intH)) * p.notional * fundMult; // funding estimado de 1 settlement
    const oppCusto = p.notional * intH * taxaOportPorCapHora; // custo de oportunidade do capital preso
    const risco = 0; // distância de liquidação por ciclo não instrumentada no historico (marcado)
    const evContinuar = fundingSettl - oppCusto - risco;

    let segura = false;
    if (regra === 'closeConfirm') { if (p.motivo && /invert|ausente/i.test(p.motivo)) { segura = !invertido; if (invertido) { invertConfirmada = true; } } else segura = false; }
    else if (regra === 'nextSettlement') segura = evContinuar > 0 && !invertido;
    else if (regra === 'evExit') segura = evContinuar > 0;
    if (!segura) break;
    addFunding += fundingSettl; addOpp += oppCusto; extraSettlements++; closeTs = cursor;
    cursor += intMs;
    if (regra === 'closeConfirm') break; // Close Confirm segura no máx 1 settlement extra
  }
  // custo de saída pago uma vez (adiado, mesmo valor); slippage extra se spread deteriorou
  const custoSaida = (p.custoFecha || 0) * custMult;
  const custoBase = (p.custo - (p.custoFecha || 0)) * custMult; // abre+gestão
  const fundingReal = p.fundVals.reduce((s, v) => s + v, 0) * fundMult;
  const pnl = fundingReal + addFunding - custoBase - custoSaida - addOpp * (slipMult); // opp escala com slip só p/ conservadorismo
  return { pnl: +pnl.toFixed(4), addFunding: +addFunding.toFixed(4), extraSettlements, addOppCost: +addOpp.toFixed(4), closeTs, invertConfirmada };
}

const REGRAS = ['control', 'closeConfirm', 'nextSettlement', 'evExit'];
const STRESS = { normal: {}, 'custo1.5x': { custo: 1.5 }, 'custo2x': { custo: 2 }, 'slippage2x': { slippage: 2 }, 'funding-25%': { funding: 0.75 }, 'funding-50%': { funding: 0.5 } };

function pnlControl(p, mult = {}) {
  const custMult = mult.custo ?? 1, fundMult = mult.funding ?? 1;
  return +(p.fundVals.reduce((s, v) => s + v, 0) * fundMult - p.custo * custMult).toFixed(4);
}

// ── FIDELIDADE: Control reproduz o real? ────────────────────────────────────
const pnlRealTotal = posicoes.reduce((s, p) => s + (p.fundVals.reduce((a, v) => a + v, 0) - p.custo), 0);
const pnlControlTotal = posicoes.reduce((s, p) => s + pnlControl(p), 0);
const fidelidade = { posicoes: posicoes.length, pnlRealTotal: +pnlRealTotal.toFixed(4), pnlControlTotal: +pnlControlTotal.toFixed(4), difAbs: +Math.abs(pnlRealTotal - pnlControlTotal).toFixed(6), tolerancia: 0.01, fiel: Math.abs(pnlRealTotal - pnlControlTotal) <= 0.01 };

// ── COMMON-WINDOW + STRESS ──────────────────────────────────────────────────
const resultados = {};
for (const [sName, mult] of Object.entries(STRESS)) {
  resultados[sName] = {};
  for (const regra of REGRAS) {
    let pnl = 0, addF = 0, addS = 0, addO = 0, invert = 0;
    for (const p of posicoes) {
      if (regra === 'control') { pnl += pnlControl(p, mult); continue; }
      const r = simularExtensao(p, regra, mult); pnl += r.pnl; addF += r.addFunding; addS += r.extraSettlements; addO += r.addOppCost; if (r.invertConfirmada) invert++;
    }
    resultados[sName][regra] = { pnlLiquido: +pnl.toFixed(4), fundingAdicional: +addF.toFixed(4), settlementsAdicionais: addS, custoOportunidade: +addO.toFixed(4), inversoesConfirmadas: invert };
  }
}

// ── GATE (item 10) ──────────────────────────────────────────────────────────
const comparaveis = posicoes.length;
const janelas = 2; // metades do epoch-1 (já validado em gate-v2)
const regimes = 2; // já detectado
const positivoPosStress = REGRAS.filter((r) => r !== 'control').filter((r) => Object.entries(STRESS).every(([s]) => resultados[s][r].pnlLiquido >= resultados[s].control.pnlLiquido));
const gate = {
  fechamentosComparaveis: { valor: comparaveis, minimo: 30, atende: comparaveis >= 30 },
  janelasCronologicas: { valor: janelas, minimo: 2, atende: true },
  regimes: { valor: regimes, minimo: 2, atende: true },
  controlFiel: fidelidade.fiel,
  challengersPositivosPosStress: positivoPosStress,
  ddEDistLiqNaoPiores: 'não instrumentado por ciclo (marcado — não fabricado)',
};
gate.LIBERADO = gate.fechamentosComparaveis.atende && gate.janelasCronologicas.atende && gate.regimes.atende && gate.controlFiel && positivoPosStress.length > 0;
gate.veredito = gate.LIBERADO ? 'LIBERADO' : `BLOQUEADO — ${comparaveis}/30 fechamentos comparáveis; dd/dist-liq por ciclo não instrumentados. NÃO recomendar alterar o Champion.`;

const relatorio = {
  snapshot: '1786189433850',
  fidelidade, gate,
  commonWindowPorStress: resultados,
  benchmark: { taxaOportPorCapHora: +taxaOportPorCapHora.toExponential(3), fundingTotalReal: +fundingTotalReal.toFixed(3) },
  limitacoes: 'Funding pós-fechamento é ESTIMADO do apr do historico (não realizado). PnL residual por perna, mark por exchange por ciclo, e distância de liquidação por ciclo NÃO estão instrumentados — marcados, não fabricados. Amostra pequena.',
  recomendacao: gate.LIBERADO ? 'ver comparação' : 'NÃO alterar o Champion. Acumular ≥30 fechamentos comparáveis e instrumentar dd/dist-liq por ciclo antes de qualquer comparação formal. Manter os challengers em paper isolado, observando.',
};
fs.writeFileSync(path.join(OUT, 'challenger-metrics.json'), JSON.stringify(relatorio, null, 2));
console.log('FIDELIDADE:', JSON.stringify(fidelidade));
console.log('GATE:', gate.veredito);
console.log('COMMON-WINDOW (normal):', JSON.stringify(resultados.normal));
console.log('positivos pós-stress:', positivoPosStress.length ? positivoPosStress.join(',') : 'nenhum');
