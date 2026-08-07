/**
 * PROVA READ-ONLY (Parte 5) — não confia no comentário "SOMENTE LEITURA".
 * Instrumenta as funções de escrita do módulo `node:fs` DURANTE a execução
 * real do código de produção (contra o repositório de verdade, só leitura)
 * e falha o teste se qualquer escrita acontecer fora de
 * `dashboard-v2/api/logs/` — o único diretório que esta API tem permissão
 * de escrever (log próprio, heartbeat próprio, diagnóstico de queda próprio).
 *
 * Roda contra dados REAIS (root = raiz do repositório), não um fixture —
 * de propósito: fixtures sintéticos não pegariam um bug de path incorreto
 * apontando pra fora do sandbox de teste.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..', '..'); // raiz do repositório Snowball
const DIR_LOGS_PERMITIDO = path.resolve(__dirname, '..', 'logs');

interface Chamada { fn: string; args: unknown[] }

function instrumentar(): { chamadas: Chamada[]; restaurar: () => void } {
  const chamadas: Chamada[] = [];
  const FUNCOES_DE_ESCRITA = [
    'writeFileSync', 'appendFileSync', 'renameSync', 'unlinkSync', 'rmSync', 'rmdirSync',
    'truncateSync', 'chmodSync', 'chownSync', 'symlinkSync', 'linkSync', 'copyFileSync', 'createWriteStream',
  ] as const;
  const originais: Record<string, any> = {};

  for (const nome of FUNCOES_DE_ESCRITA) {
    originais[nome] = (fs as any)[nome];
    (fs as any)[nome] = (...args: unknown[]) => {
      chamadas.push({ fn: nome, args });
      return originais[nome](...args);
    };
  }
  // mkdirSync é permitido SÓ dentro de dashboard-v2/api/logs (o próprio
  // server.ts faz isso no boot) — registra separado, valida path abaixo
  originais.mkdirSync = fs.mkdirSync;
  (fs as any).mkdirSync = (...args: unknown[]) => {
    chamadas.push({ fn: 'mkdirSync', args });
    return originais.mkdirSync(...args);
  };

  return {
    chamadas,
    restaurar: () => { for (const nome of [...FUNCOES_DE_ESCRITA, 'mkdirSync']) (fs as any)[nome] = originais[nome]; },
  };
}

function chamadasForaDoPermitido(chamadas: Chamada[]): Chamada[] {
  return chamadas.filter((c) => {
    const alvo = typeof c.args[0] === 'string' ? c.args[0] : (c.args[0] as any)?.toString?.() ?? '';
    const alvoAbsoluto = path.isAbsolute(alvo) ? alvo : path.resolve(process.cwd(), alvo);
    return !alvoAbsoluto.startsWith(DIR_LOGS_PERMITIDO);
  });
}

test('read-only: montarChampionCompleto nunca escreve fora de dashboard-v2/api/logs', async () => {
  const { chamadas, restaurar } = instrumentar();
  try {
    const { montarChampionCompleto } = await import('../services/champion.ts');
    await montarChampionCompleto(ROOT);
  } finally { restaurar(); }
  const fora = chamadasForaDoPermitido(chamadas);
  assert.deepEqual(fora, [], `escritas fora do permitido: ${JSON.stringify(fora)}`);
});

test('read-only: buscarEventosIncremental nunca escreve nada', async () => {
  const { chamadas, restaurar } = instrumentar();
  try {
    const { buscarEventosIncremental } = await import('../services/eventos.ts');
    const { CHALLENGERS_APROVADOS } = await import('../../../src/inteligencia/challengers.ts');
    const fontes = [{ fonte: 'champion', ehChampion: true }, ...CHALLENGERS_APROVADOS.slice(0, 5).map((c: any) => ({ fonte: c.challengerId, ehChampion: false }))];
    buscarEventosIncremental(ROOT, fontes, null, 100);
  } finally { restaurar(); }
  assert.equal(chamadas.length, 0, `eventos.ts nunca deveria chamar nenhuma função de escrita: ${JSON.stringify(chamadas)}`);
});

test('read-only: montarManifestoCobertura nunca escreve nada', async () => {
  const { chamadas, restaurar } = instrumentar();
  try {
    const { montarManifestoCobertura } = await import('../services/cobertura.ts');
    const { CHALLENGERS_APROVADOS } = await import('../../../src/inteligencia/challengers.ts');
    montarManifestoCobertura(ROOT, CHALLENGERS_APROVADOS as any, {}, {}, 6 * 3_600_000);
  } finally { restaurar(); }
  assert.equal(chamadas.length, 0, `cobertura.ts nunca deveria chamar nenhuma função de escrita: ${JSON.stringify(chamadas)}`);
});

test('read-only: waterfall (totais + decomposição) nunca escreve nada', async () => {
  const { chamadas, restaurar } = instrumentar();
  try {
    const { lerTotaisAutoritativos, construirDecomposicao } = await import('../services/waterfall.ts');
    const t = lerTotaisAutoritativos(ROOT);
    construirDecomposicao(ROOT, t);
  } finally { restaurar(); }
  assert.equal(chamadas.length, 0, `waterfall.ts nunca deveria chamar nenhuma função de escrita: ${JSON.stringify(chamadas)}`);
});

test('read-only: montarCapturaStatus nunca escreve nada', async () => {
  const { chamadas, restaurar } = instrumentar();
  try {
    const { montarCapturaStatus } = await import('../services/captura.ts');
    montarCapturaStatus(ROOT);
  } finally { restaurar(); }
  assert.equal(chamadas.length, 0, `captura.ts nunca deveria chamar nenhuma função de escrita: ${JSON.stringify(chamadas)}`);
});

test('read-only: tentativa artificial de escrita num arquivo real do Snowball — nunca é o próprio código de produção que faz isso (só o teste, deliberadamente, pra provar que FALHARIA se acontecesse)', () => {
  // Este teste não chama nenhuma função do dashboard-v2/api — ele prova que
  // a INSTRUMENTAÇÃO acima pegaria uma escrita de verdade, testando o
  // detector com uma escrita FORJADA num arquivo temporário (nunca no
  // estado real do Snowball) fora do diretório de logs permitido.
  const { chamadas, restaurar } = instrumentar();
  const alvoForjado = path.join(os.tmpdir(), 'prova-readonly-nao-deveria-existir.tmp');
  try {
    fs.writeFileSync(alvoForjado, 'isto prova que o detector pega escrita fora do permitido');
  } finally {
    restaurar();
    try { fs.unlinkSync(alvoForjado); } catch { /* limpeza best-effort do próprio teste */ }
  }
  const fora = chamadasForaDoPermitido(chamadas);
  assert.equal(fora.length, 1, 'a instrumentação deveria ter capturado exatamente esta escrita forjada');
});
