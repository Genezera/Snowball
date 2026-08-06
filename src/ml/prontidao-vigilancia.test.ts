import { test } from 'node:test';
import assert from 'node:assert/strict';
import { construirDataset, dividirPorTempo, avaliarProntidao, treinarEavaliar, MINIMO_POSITIVOS_TREINO } from './prontidao-vigilancia.ts';
import type { CicloArquivado } from './rotulo-ciclo.ts';

const HORA = 3_600_000;

function ciclo(over: Partial<CicloArquivado> = {}): CicloArquivado {
  return {
    chave: 'X/USDT:USDT|a|b', symbol: 'X/USDT:USDT', exchangeShort: 'a', exchangeLong: 'b',
    abertoEm: 0, fechadoEm: 10 * HORA, observacoes: 120, spreadMedio: 0.01, consistencia: 0.95,
    ...over,
  };
}

test('construirDataset: acha a observação de abertura dentro da janela e monta as features certas', () => {
  const c = ciclo();
  const obs = [
    { ts: -2 * 60_000, k: c.chave, spread: 0.005, apr: 0.1, vol: 1_000_000 }, // dentro da janela, mais cedo
    { ts: 5 * HORA, k: c.chave, spread: 0.02, apr: 0.3, vol: 2_000_000 },
  ];
  const ds = construirDataset([c], obs);
  assert.equal(ds.length, 1);
  assert.equal(ds[0].chave, c.chave);
  assert.equal(ds[0].features[0], 0.005);
  assert.equal(ds[0].rotulo, 1); // spread alto, consistência alta -> positivo
});

test('construirDataset: ignora ciclo sem observação nenhuma dentro da janela', () => {
  const c = ciclo();
  const obs = [{ ts: 20 * HORA, k: c.chave, spread: 0.01, apr: 0.2, vol: 500_000 }]; // depois de fechar
  assert.equal(construirDataset([c], obs).length, 0);
});

test('construirDataset: ignora ciclo não confiável (poucas observações pra duração)', () => {
  const c = ciclo({ observacoes: 1, fechadoEm: 30 * HORA });
  const obs = [{ ts: 0, k: c.chave, spread: 0.01, apr: 0.2, vol: 500_000 }];
  assert.equal(construirDataset([c], obs).length, 0);
});

test('construirDataset: não confunde observações de chaves diferentes', () => {
  const c = ciclo();
  const obs = [
    { ts: 0, k: 'OUTRO/USDT:USDT|a|b', spread: 0.5, apr: 5, vol: 1 },
    { ts: 100, k: c.chave, spread: 0.007, apr: 0.15, vol: 800_000 },
  ];
  const ds = construirDataset([c], obs);
  assert.equal(ds.length, 1);
  assert.equal(ds[0].features[0], 0.007);
});

test('construirDataset: entre duas candidatas na janela, pega a MAIS ANTIGA', () => {
  const c = ciclo();
  const obs = [
    { ts: 300, k: c.chave, spread: 0.009, apr: 0.2, vol: 1 },
    { ts: 50, k: c.chave, spread: 0.003, apr: 0.05, vol: 1 },
  ];
  const ds = construirDataset([c], obs);
  assert.equal(ds[0].features[0], 0.003);
});

test('dividirPorTempo: treino é sempre mais antigo que teste', () => {
  const exemplos = Array.from({ length: 20 }, (_, i) => ({ chave: 'k', ts: i * 1000, features: [i, i, i], rotulo: (i % 3 === 0 ? 1 : 0) as 0 | 1 }));
  const { treino, teste } = dividirPorTempo(exemplos, 0.7);
  assert.equal(treino.length, 14);
  assert.equal(teste.length, 6);
  assert.ok(Math.max(...treino.map((e) => e.ts)) <= Math.min(...teste.map((e) => e.ts)));
});

test('avaliarProntidao: conta confiáveis e positivos corretamente, devolve pronto=false abaixo do mínimo', () => {
  const ciclos = [ciclo(), ciclo({ spreadMedio: 0.00001 }), ciclo({ observacoes: 1 })];
  const r = avaliarProntidao(ciclos);
  assert.equal(r.minimo, MINIMO_POSITIVOS_TREINO);
  assert.equal(r.pronto, false);
  assert.ok(r.positivos < r.minimo);
});

test('treinarEavaliar: amostra pequena demais não tenta treinar, devolve motivo em vez de número fabricado', () => {
  const exemplos = Array.from({ length: 10 }, (_, i) => ({ chave: 'k', ts: i, features: [i, i, i], rotulo: 0 as 0 | 1 }));
  const r = treinarEavaliar(exemplos);
  assert.equal(r.auc, null);
  assert.ok(r.motivo);
});

test('treinarEavaliar: teste sem os dois rótulos devolve auc null com motivo, não um número inventado', () => {
  // 30 exemplos, corte de 70% cai em 21 -> treino=[0..20] (rótulos mistos),
  // teste=[21..29] (só rótulo 0, de propósito)
  const exemplos = Array.from({ length: 30 }, (_, i) => ({
    chave: 'k', ts: i, features: [i % 5, (i * 2) % 7, i],
    rotulo: (i < 21 && i % 3 === 0 ? 1 : 0) as 0 | 1,
  }));
  const r = treinarEavaliar(exemplos);
  assert.equal(r.auc, null);
  assert.match(r.motivo || '', /indefinido/);
});

test('treinarEavaliar: com sinal real separável, AUC fica bem acima de 0.5 (sanity check, não threshold rígido)', () => {
  // feature[0] correlaciona quase perfeitamente com o rótulo, tempo crescente
  const exemplos = Array.from({ length: 80 }, (_, i) => {
    const positivo = i % 2 === 0;
    return { chave: 'k', ts: i * 1000, features: [positivo ? 10 + (i % 3) : 0 + (i % 3), i, i], rotulo: (positivo ? 1 : 0) as 0 | 1 };
  });
  const r = treinarEavaliar(exemplos);
  assert.ok(r.auc != null, 'deveria ter conseguido treinar e avaliar com esse dataset');
  assert.ok(r.auc! > 0.7, 'com sinal separável limpo, AUC deveria ficar bem acima de acaso — veio ' + r.auc);
});
