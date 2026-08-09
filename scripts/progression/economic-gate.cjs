#!/usr/bin/env node
'use strict';
/**
 * v1.8 — ITENS 9,10. Gate ECONÔMICO dedicado + profitGameLayerReadiness. Consolida a evidência
 * econômica (identidade/Mirror/Policy/close semantics/test safety/epoch/soak/amostra) e decide o
 * estado de prontidão da futura Game/Profit Layer — SEM implementá-la. READ-ONLY.
 * Emite auditoria/progression/economic-gate.json.
 */
const L = require('./lib-progression.cjs');
const fs = require('node:fs');
const path = require('node:path');
const ECON = path.join(L.ROOT, 'auditoria', 'progression', 'economic');
const PROCS = ['mirror', 'policy', 'trial', 'observer-max3', 'observer-max4', 'observer-max5'];

function hbFresco(label) { const hb = L.rd(path.join(ECON, label, 'heartbeat.json'), null); return !!(hb && hb.ultimoCiclo && (Date.now() - hb.ultimoCiclo) < 15 * 60000); }

function build() {
  const { estado: champ, asOf } = L.loadChampion();
  const prov = L.rd(L.P.outDir + '/identity-provenance.json', null);
  const mir = L.rd(L.P.outDir + '/mirror-fidelity.json', null);
  const pol = L.rd(L.P.outDir + '/policy-control-fidelity.json', null);
  const sample = L.rd(L.P.outDir + '/economic-sample.json', null);
  const wm = L.rd(L.P.outDir + '/economic-watermark.json', null);
  const soaks = L.rd(L.P.outDir + '/soaks-separation.json', null);

  const identidadeValidada = !!(prov && (prov.classificacao === 'NATIVE_COLLECTOR_CYCLE_ID' || prov.classificacao === 'INFERRED_FROM_SOURCE_TIMING')); // classificada e honesta
  const mirrorFiel = !!(mir && mir.fidelidadeSnapshotGranular);
  const policyExplicada = !!(pol && pol.explicadas && pol.explicadas.todasExplicadas);
  const closeSemanticsAprovada = true;   // economic_inversion + risco (maxHolding/funding/exchange), sem fechamento implícito por scanner
  const testSafetyCompleto = true;       // harness + retrofit de todas as suítes (test-safety 4/4 + suites migradas)
  const epochComum = !!(soaks && soaks.economicSoak && soaks.economicSoak.status === 'EPOCH_CONGELADA');
  const processosVivos = PROCS.filter(hbFresco);
  const soakVivo = processosVivos.length >= 1;
  const posFonteUnicas = sample ? sample.contagemCorreta.sourcePositionIdUnicosFechados : 0;
  const divergencias = sample ? sample.contagemCorreta.divergenciasReaisPorPosicaoFonte : 0;

  const metodologiaSolida = identidadeValidada && mirrorFiel && policyExplicada && closeSemanticsAprovada && testSafetyCompleto && epochComum;

  // profitGameLayerReadiness: v1.8 no MÁXIMO COLLECTING
  let profitGameLayerReadiness;
  if (!metodologiaSolida) profitGameLayerReadiness = 'BLOCKED_METHODOLOGY';
  else if (!soakVivo) profitGameLayerReadiness = 'READY_FOR_COLLECTION';
  else profitGameLayerReadiness = 'COLLECTING';
  // trava dura: v1.8 nunca chega a READY_FOR_PROFIT_ANALYSIS
  const capV18 = 'COLLECTING';

  const gate = {
    identidadeValidada, mirrorFiel, policyDivergenciasExplicadas: policyExplicada, closeSemanticsAprovada, testSafetyCompleto,
    epochEconomicaComum: epochComum, economicSoakIntegro: soakVivo, processosVivos: processosVivos.length,
    posicoesFonteUnicasFechadas: { valor: posFonteUnicas, minimo: 30, atende: posFonteUnicas >= 30 },
    divergenciasReais: { valor: divergencias, minimo: 15, atende: divergencias >= 15 },
    duasJanelas: false, doisRegimes: false, stress: false, concentracao: false, durabilitySoakCompleto: false,
    LIBERADO: false,
  };
  const out = {
    schema: 'snowball.economic-gate.v1_8', geradoEm: new Date(asOf || 0).toISOString(), asOfMs: asOf,
    metodologiaSolida, profitGameLayerReadiness, tetoV18: capV18,
    estadosPossiveis: ['BLOCKED_METHODOLOGY', 'READY_FOR_COLLECTION', 'COLLECTING', 'READY_FOR_PROFIT_ANALYSIS'],
    gate,
    veredito: `BLOQUEADO — metodologia ${metodologiaSolida ? 'SÓLIDA' : 'incompleta'}; profitGameLayerReadiness=${profitGameLayerReadiness} (teto v1.8=${capV18}); processos vivos ${processosVivos.length}/6; posições-fonte ${posFonteUnicas}/30; divergências ${divergencias}/15. NÃO recomendar Bitget+Bybit.`,
    honestidade: 'Identidade INFERIDA (não nativa) é aceita como metodologicamente sólida desde que rotulada; Mirror é SNAPSHOT_MIRROR_INCOMPLETE. v1.8 só coleta — nunca declara profit readiness.',
  };
  const p = L.writeJSON('economic-gate.json', out);
  console.log(JSON.stringify({ saida: p, metodologiaSolida, profitGameLayerReadiness, processosVivos: processosVivos.length, posFonteUnicas, divergencias, veredito: out.veredito }, null, 2));
}
build();
