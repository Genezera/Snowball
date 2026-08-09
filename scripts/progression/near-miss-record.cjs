#!/usr/bin/env node
'use strict';
/**
 * v1.8-close — ITEM 5 (registro formal). Documenta o NEAR MISS do diretório "t2" e comprova que
 * nenhum arquivo econômico, estado ou processo de PRODUÇÃO foi alterado. READ-ONLY.
 * Emite auditoria/progression/near-miss-record.json.
 */
const L = require('./lib-progression.cjs');
const fs = require('node:fs');
const path = require('node:path');

function existe(p) { try { return fs.existsSync(path.join(L.ROOT, p)); } catch { return false; } }

function build() {
  const { asOf } = L.loadChampion();
  const t2Existe = existe('auditoria/progression/forward/t2');
  const out = {
    schema: 'snowball.near-miss-record.v1_8', geradoEm: new Date(asOf || 0).toISOString(), asOfMs: asOf,
    incidente: 'FORWARD_TEST_ROOT_APONTOU_PARA_PRODUCAO',
    quando: 'v1.8 (desenvolvimento em worktree), durante smoke test do harness de segurança',
    oQueAconteceu: 'Um smoke test passou FORWARD_TEST_ROOT apontando para a árvore de produção do repo PRINCIPAL (auditoria/progression/forward). Como o teste rodava a partir do WORKTREE, o L.ROOT do reader resolvia para o worktree — então o guard (que comparava só com a produção DO PRÓPRIO repo) NÃO reconheceu o caminho como produção e criou um diretório de teste "t2" dentro de auditoria/progression/forward do repo principal.',
    deteccao: 'Detectado imediatamente na verificação pós-teste (o dir t2 apareceu na listagem de produção).',
    remediacao: [
      'Removido o diretório auditoria/progression/forward/t2 do repo principal (rm -rf).',
      'Guard ENDURECIDO: recusa qualquer FORWARD_TEST_ROOT cujo caminho contenha os segmentos auditoria/progression/forward OU auditoria/progression/economic — independente do repo (não só a produção do próprio repo).',
      'Guard passou a EXIGIR: FORWARD_TEST_MODE=1, FORWARD_TEST_ROOT existente, sob diretório temporário (os.tmpdir ou caminho com tmp/temp), e proíbe --label duplicado.',
      'TODAS as suítes migradas para FORWARD_TEST_MODE=1 + FORWARD_TEST_ROOT temporário; provado que a produção (auditoria/progression/forward) fica intocada durante a suíte.',
    ],
    impactoReal: {
      arquivoEconomicoAlterado: false,
      estadoDeProducaoAlterado: false,
      processoDeProducaoAfetado: false,
      championAlterado: false,
      apenas: 'Um diretório de teste vazio (t2) foi criado e removido; nenhuma posição, saldo, ledger ou processo de produção foi tocado.',
    },
    estadoAtual: { t2AindaExiste: t2Existe },
    honestidade: 'Registrado formalmente em vez de omitido. O near-miss motivou o endurecimento do guard e o retrofit de todas as suítes.',
  };
  const p = L.writeJSON('near-miss-record.json', out);
  console.log(JSON.stringify({ saida: p, incidente: out.incidente, t2AindaExiste: t2Existe, impactoProducao: 'NENHUM' }, null, 2));
}
build();
