import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { lerTotaisAutoritativos, construirDecomposicao } from '../services/waterfall.ts';

function tmpRoot(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'snowball-v2wf-'));
  fs.mkdirSync(path.join(dir, 'spread'), { recursive: true });
  return dir;
}

test('lerTotaisAutoritativos: pnlRealizado = capital - capitalInicial, sempre, por construção', () => {
  const root = tmpRoot();
  fs.writeFileSync(path.join(root, 'spread', 'estado.json'), JSON.stringify({ capital: 606, capitalInicial: 600, fundingTotal: 11, custosTotal: 5 }));
  const t = lerTotaisAutoritativos(root);
  assert.equal(t?.pnlRealizado, 6);
  assert.equal(t?.identidadeReconciliada, true);
  fs.rmSync(root, { recursive: true, force: true });
});

test('sem estado.json: retorna null, nunca fabrica totais', () => {
  const root = tmpRoot();
  assert.equal(lerTotaisAutoritativos(root), null);
  fs.rmSync(root, { recursive: true, force: true });
});

test('decomposição classificada como completa quando o diário inteiro coube na leitura', () => {
  const root = tmpRoot();
  const linhas = [{ ts: 1, evento: 'abre', custo: 1 }, { ts: 2, evento: 'funding', ganho: 5 }];
  fs.writeFileSync(path.join(root, 'spread', 'diario.jsonl'), linhas.map((l) => JSON.stringify(l)).join('\n') + '\n');
  const d = construirDecomposicao(root, null);
  assert.equal(d?.classificacao, 'decomposicao_completa');
  assert.equal(d?.fundingBrutoNaJanela, 5);
  fs.rmSync(root, { recursive: true, force: true });
});

test('decomposição da janela: mostra a diferença explícita contra o autoritativo, nunca esconde', () => {
  const root = tmpRoot();
  fs.writeFileSync(path.join(root, 'spread', 'diario.jsonl'), JSON.stringify({ ts: 1, evento: 'funding', ganho: 5 }) + '\n');
  const autoritativo = lerTotaisAutoritativos(root); // null aqui, sem estado.json — simula divergência via objeto manual
  const fake = { origem: 'spread/estado.json' as const, fundingTotal: 8, custosTotal: 2, capital: 606, capitalInicial: 600, pnlRealizado: 6, identidadeReconciliada: true, diferencaDeArredondamento: 0 };
  const d = construirDecomposicao(root, fake);
  assert.equal(d?.diferencaParaAutoritativo?.funding, 3, 'deveria mostrar a diferença real entre autoritativo (8) e o que foi reconstruído (5)');
  fs.rmSync(root, { recursive: true, force: true });
});

test('evento "socorre" nunca é contado como custo — move dinheiro entre exchanges, não gera nem consome', () => {
  const root = tmpRoot();
  fs.writeFileSync(path.join(root, 'spread', 'diario.jsonl'), JSON.stringify({ ts: 1, evento: 'socorre', valor: 50 }) + '\n');
  const d = construirDecomposicao(root, null);
  assert.equal(d?.custoTotalNaJanela, 0);
  fs.rmSync(root, { recursive: true, force: true });
});
