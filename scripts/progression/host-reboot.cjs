#!/usr/bin/env node
'use strict';
/**
 * v1.7 — ITEM 7. Reinício do host em ambiente isolado. Este ambiente é a MÁQUINA
 * PRINCIPAL (onde roda o Champion e os challengers) — NÃO há container descartável
 * para simular reboot abrupto do host com segurança, e reiniciar o host aqui derrubaria
 * a produção. Portanto registramos honestamente HOST_REBOOT_TESTED = false e NÃO
 * extrapolamos o crash de PROCESSO (provado) para reinício de HOST.
 * READ-ONLY quanto ao Champion. Emite auditoria/progression/host-reboot-result.json.
 */
const L = require('./lib-progression.cjs');

function build() {
  const { asOf } = L.loadChampion();
  const out = {
    schema: 'snowball.host-reboot.v1_7', geradoEm: new Date(asOf || 0).toISOString(), asOfMs: asOf,
    executado: false,
    HOST_REBOOT_TESTED: false,
    recuperouIdentico: null,
    motivo: 'Ambiente principal (produção). Sem container/VM descartável disponível para reboot abrupto seguro; reiniciar o host derrubaria Champion + challengers.',
    oQueEstaProvado: 'PROCESS_CRASH_SAFE — kill do processo em 7 pontos recupera idêntico (crash-injection 7/7, wal-durability 10/10, recovery-matrix 8/8).',
    oQueNaoEstaProvado: 'HOST_REBOOT_TESTED, POWER_LOSS_DURABLE, STORAGE_FAILURE_TOLERANT.',
    condicaoNecessariaPresente: 'fsync do arquivo + rename atômico + fsync do diretório (quando o SO suporta) — condição necessária para durabilidade de reboot, mas não suficiente sem o teste real.',
    comoTestarNoFuturo: 'Rodar os 5 processos num container descartável, `kill -9` no PID 1 / power-off da VM no meio de um ciclo, reiniciar e comparar stateHash/saldos/posições/eventCount com o esperado. Preencher executado=true e recuperouIdentico.',
    honestidade: 'Não declarar durabilidade de host/power/storage sem teste real. Ver assurance-level.json.',
  };
  const p = L.writeJSON('host-reboot-result.json', out);
  console.log(JSON.stringify({ saida: p, HOST_REBOOT_TESTED: false, executado: false }, null, 2));
}
build();
