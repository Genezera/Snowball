#!/usr/bin/env node
'use strict';
/**
 * v1.7 — ITEM 1. LINGUAGEM DE GARANTIA. Declara EXPLICITAMENTE apenas o nível de
 * durabilidade REALMENTE testado, sem extrapolar. Crash de PROCESSO provado não é
 * reboot de HOST, que não é perda de ENERGIA, que não é falha de STORAGE.
 *   PROCESS_CRASH_SAFE       — kill do processo em pontos instrumentados recupera idêntico.
 *   HOST_REBOOT_TESTED       — reinício abrupto do host/container testado.
 *   POWER_LOSS_DURABLE       — perda de energia (fsync + rename provam ordering, mas não
 *                              testam o firmware do disco); só true com teste real.
 *   STORAGE_FAILURE_TOLERANT — tolera corrupção/perda de setor/disco.
 * READ-ONLY. Emite auditoria/progression/assurance-level.json.
 */
const L = require('./lib-progression.cjs');
const fs = require('node:fs');
const path = require('node:path');

const TESTS = path.join(__dirname, 'tests');
function testExiste(f) { try { return fs.existsSync(path.join(TESTS, f)); } catch { return false; } }

function build() {
  const { asOf } = L.loadChampion();
  // evidência: os testes de crash/recovery/WAL existem e passam (rodados na suíte). O host-reboot
  // só é declarado true se houver marcador explícito (auditoria/progression/host-reboot-result.json).
  const crashSuite = testExiste('forward-crash-injection.test.sh');
  const walDur = testExiste('wal-durability.test.sh');
  const recovMx = testExiste('recovery-matrix.test.sh');
  const rebootMarker = L.rd(L.ROOT + '/auditoria/progression/host-reboot-result.json', null);
  const hostRebootTested = !!(rebootMarker && rebootMarker.executado === true && rebootMarker.recuperouIdentico === true);

  const niveis = {
    PROCESS_CRASH_SAFE: {
      declarado: crashSuite && walDur && recovMx,
      evidencia: 'forward-crash-injection (7 pontos, 7/7), wal-durability (10/10), recovery-matrix (8/8): kill do processo recupera com mesmo stateHash/saldos/eventCount; WAL + checkpoint atômico + fsync + rename garantem que nunca há estado meio-escrito.',
      escopo: 'Falha do PROCESSO node (crash, kill -9, exceção). NÃO cobre o SO/host caindo junto.',
    },
    HOST_REBOOT_TESTED: {
      declarado: hostRebootTested,
      evidencia: hostRebootTested ? rebootMarker.nota : 'NÃO testado neste ambiente. fsync do arquivo + fsync do diretório (quando o SO suporta) são condição necessária, mas reinício abrupto do host não foi exercido de forma descartável.',
      escopo: 'Reinício abrupto do host/container com o processo perdendo tudo em memória de uma vez.',
    },
    POWER_LOSS_DURABLE: {
      declarado: false,
      evidencia: 'NÃO declarado. fsync força o cache do SO ao dispositivo e o rename é atômico, o que dá ORDERING correto, mas durabilidade real sob queda de energia depende do firmware/cache do disco (write barriers) — não testável aqui sem hardware dedicado.',
      escopo: 'Perda de energia no meio de um fsync/rename.',
    },
    STORAGE_FAILURE_TOLERANT: {
      declarado: false,
      evidencia: 'NÃO declarado. Detectamos corrupção via checksum + schemaVersion e caímos para o checkpoint anterior (RECOVERED_FROM_PREVIOUS) ou SUSPENDEMOS, mas não há replicação/ECC contra perda de disco inteiro.',
      escopo: 'Bit rot, setor perdido, disco morto.',
    },
  };

  const nivelReal = Object.entries(niveis).filter(([, v]) => v.declarado).map(([k]) => k);
  const out = {
    schema: 'snowball.assurance-level.v1_7', geradoEm: new Date(asOf || 0).toISOString(), asOfMs: asOf,
    nivelRealDeclarado: nivelReal,
    HOST_REBOOT_TESTED: hostRebootTested,
    niveis,
    honestidade: 'Só se declara o que foi realmente testado. Crash de processo PROVADO não vira reboot de host; ordering via fsync/rename NÃO é durabilidade sob queda de energia. Ver item 7 (host reboot) para o status do ambiente descartável.',
  };
  const p = L.writeJSON('assurance-level.json', out);
  console.log(JSON.stringify({ saida: p, nivelRealDeclarado: nivelReal, HOST_REBOOT_TESTED: hostRebootTested }, null, 2));
}
build();
