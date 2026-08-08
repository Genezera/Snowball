#!/usr/bin/env node
'use strict';
/**
 * v1.8 — ITEM 1. Separa durabilitySoak (v1.7, continua validando reader/WAL/checkpoint/watermark/
 * supervisor) do economicSoak (novo). Marca os resultados econômicos ATUAIS como
 * ECONOMIC_WARMUP_NOT_GATE_ELIGIBLE — SEM apagar dados. O economicSoak parte de nova epoch.
 * READ-ONLY. Emite auditoria/progression/soaks-separation.json.
 */
const L = require('./lib-progression.cjs');
const fs = require('node:fs');
const path = require('node:path');
const FWD = path.join(L.ROOT, 'auditoria', 'progression', 'forward');
const ECON = path.join(L.ROOT, 'auditoria', 'progression', 'economic');
const LABELS = ['trial', 'control', 'observer-max3', 'observer-max4', 'observer-max5'];

function fechadas(dir) { try { const est = JSON.parse(fs.readFileSync(path.join(dir, 'estado.json'), 'utf8')); return est.contadores ? est.contadores.fechadas : 0; } catch { return 0; } }

function build() {
  const { asOf } = L.loadChampion();
  const durEpoch = L.rd(path.join(FWD, 'epoch.json'), null);
  const econEpoch = L.rd(path.join(ECON, 'epoch.json'), null);
  // warmup econômico = fechamentos do durabilitySoak v1.7 (NÃO elegíveis ao gate econômico)
  const warmupPorLabel = {}; let warmupTotal = 0;
  for (const l of LABELS) { const f = fechadas(path.join(FWD, l)); warmupPorLabel[l] = f; warmupTotal += f; }

  const out = {
    schema: 'snowball.soaks-separation.v1_8', geradoEm: new Date(asOf || 0).toISOString(), asOfMs: asOf,
    durabilitySoak: {
      arvore: 'auditoria/progression/forward', epoch: durEpoch ? durEpoch.forwardEpochId : null,
      valida: ['reader', 'WAL', 'checkpoint', 'watermark', 'supervisor'],
      status: 'CONTINUA', nota: 'Segue rodando (v1.7) — não interrompido pela v1.8. Valida durabilidade, não economia.',
    },
    economicSoak: {
      arvore: 'auditoria/progression/economic', epoch: econEpoch ? econEpoch.economicForwardEpochId : null,
      processos: ['mirror', 'policy', 'trial', 'observer-max3', 'observer-max4', 'observer-max5'],
      status: econEpoch ? 'EPOCH_CONGELADA' : 'PENDENTE', identidade: 'causal (sourceDecisionId/sourcePositionId)', closePolicy: 'economic_inversion (não fecha por scanner stale)',
      nota: 'Nova epoch; não reutiliza fechamentos do warmup no gate econômico.',
    },
    warmupEconomico: {
      marcador: 'ECONOMIC_WARMUP_NOT_GATE_ELIGIBLE',
      fechamentosWarmupPorLabel: warmupPorLabel, fechamentosWarmupTotal: warmupTotal,
      dadosPreservados: true, localArquivado: 'auditoria/progression/forward/<label>/archive-v1_6 + estado corrente do durabilitySoak',
      nota: 'Fechamentos do durabilitySoak (identidade por símbolo+hora / close por scanner-stale) NÃO entram no gate econômico. Dados preservados, não apagados.',
    },
    honestidade: 'Dois soaks separados: durabilidade (contínua) e economia (nova epoch, identidade causal, close por inversão). Warmup preservado mas não elegível ao gate.',
  };
  const p = L.writeJSON('soaks-separation.json', out);
  console.log(JSON.stringify({ saida: p, durEpoch: durEpoch ? durEpoch.forwardEpochId : null, econEpoch: econEpoch ? econEpoch.economicForwardEpochId : null, warmupTotal, marcador: 'ECONOMIC_WARMUP_NOT_GATE_ELIGIBLE' }, null, 2));
}
build();
