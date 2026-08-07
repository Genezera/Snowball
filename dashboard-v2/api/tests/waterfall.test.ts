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

test('lerTotaisAutoritativos: pnlRealizadoLifetime = capital - capitalInicial, sempre, por construção', () => {
  const root = tmpRoot();
  fs.writeFileSync(path.join(root, 'spread', 'estado.json'), JSON.stringify({ capital: 606, capitalInicial: 600, fundingTotal: 11, custosTotal: 5 }));
  const t = lerTotaisAutoritativos(root);
  assert.equal(t?.pnlRealizadoLifetime, 6);
  assert.equal(t?.reconciliado, true);
  assert.equal(t?.origemFunding, 'spread/estado.json#fundingTotal');
  fs.rmSync(root, { recursive: true, force: true });
});

test('sem estado.json: retorna null, nunca fabrica totais', () => {
  const root = tmpRoot();
  assert.equal(lerTotaisAutoritativos(root), null);
  fs.rmSync(root, { recursive: true, force: true });
});

test('decomposição classificada como complete quando o diário inteiro coube na leitura', () => {
  const root = tmpRoot();
  const linhas = [{ ts: 1, evento: 'abre', custo: 1 }, { ts: 2, evento: 'funding', ganho: 5 }];
  fs.writeFileSync(path.join(root, 'spread', 'diario.jsonl'), linhas.map((l) => JSON.stringify(l)).join('\n') + '\n');
  const d = construirDecomposicao(root, null);
  assert.equal(d?.escopo, 'complete');
  assert.equal(d?.fundingBrutoNoEscopo, 5);
  fs.rmSync(root, { recursive: true, force: true });
});

test('escopo complete + buckets não cobrindo o autoritativo: custosNaoClassificados aparece, nunca escondido', () => {
  const root = tmpRoot();
  fs.writeFileSync(path.join(root, 'spread', 'diario.jsonl'), JSON.stringify({ ts: 1, evento: 'funding', ganho: 5 }) + '\n');
  const fake: any = { fundingTotalLifetime: 8, custosTotalLifetime: 2, pnlRealizadoLifetime: 6, reconciliado: true, diferenca: 0, tolerancia: 0.01, origemFunding: 'x', origemCustos: 'x', origemPnL: 'x', atualizadoEm: 0 };
  const d = construirDecomposicao(root, fake);
  assert.equal(d?.escopo, 'complete');
  assert.equal(d?.custosNaoClassificados, 2, 'diário só tem 1 evento "funding" (sem custo) mas autoritativo diz custosTotalLifetime=2 — a diferença deveria aparecer, nunca escondida');
  assert.equal(d?.decomposicaoCompleta, false);
  fs.rmSync(root, { recursive: true, force: true });
});

test('escopo partial: diário maior que o teto de leitura nunca é chamado de vitalício', () => {
  const root = tmpRoot();
  const linhas = Array.from({ length: 4001 }, (_, i) => ({ ts: i, evento: 'leitura' }));
  fs.writeFileSync(path.join(root, 'spread', 'diario.jsonl'), linhas.map((l) => JSON.stringify(l)).join('\n') + '\n');
  const d = construirDecomposicao(root, null);
  assert.equal(d?.escopo, 'partial');
  assert.equal(d?.linhasLidas, 4000);
  assert.equal(d?.linhasTotaisNoArquivo, 4001);
  assert.equal(d?.custosNaoClassificados, null, 'partial nunca tenta calcular não-classificados — a diferença ali é esperada (fora da janela lida), não "não classificada"');
  fs.rmSync(root, { recursive: true, force: true });
});

test('slippageEntrada/slippageSaida nunca são fabricados — sempre null, com nota explícita', () => {
  const root = tmpRoot();
  fs.writeFileSync(path.join(root, 'spread', 'diario.jsonl'), JSON.stringify({ ts: 1, evento: 'abre', custo: 1 }) + '\n');
  const d = construirDecomposicao(root, null);
  assert.equal(d?.buckets.slippageEntrada, null);
  assert.equal(d?.buckets.slippageSaida, null);
  assert.ok(d?.notas.slippage.length);
  fs.rmSync(root, { recursive: true, force: true });
});

test('emergencial sempre 0 — não existe evento correspondente no motor atual, mas isso é documentado, não escondido', () => {
  const root = tmpRoot();
  fs.writeFileSync(path.join(root, 'spread', 'diario.jsonl'), JSON.stringify({ ts: 1, evento: 'abre', custo: 1 }) + '\n');
  const d = construirDecomposicao(root, null);
  assert.equal(d?.buckets.emergencial, 0);
  assert.ok(d?.notas.emergencial.includes('não existe evento'));
  fs.rmSync(root, { recursive: true, force: true });
});

test('evento "socorre" nunca é contado como custo — move dinheiro entre exchanges, não gera nem consome', () => {
  const root = tmpRoot();
  fs.writeFileSync(path.join(root, 'spread', 'diario.jsonl'), JSON.stringify({ ts: 1, evento: 'socorre', valor: 50 }) + '\n');
  const d = construirDecomposicao(root, null);
  assert.equal(d?.custoTotalNoEscopo, 0);
  fs.rmSync(root, { recursive: true, force: true });
});

test('fechamentoEstimado vem de spread/marcacao.json e nunca é somado ao custoTotalNoEscopo', () => {
  const root = tmpRoot();
  fs.writeFileSync(path.join(root, 'spread', 'diario.jsonl'), JSON.stringify({ ts: 1, evento: 'abre', custo: 1 }) + '\n');
  fs.writeFileSync(path.join(root, 'spread', 'marcacao.json'), JSON.stringify({ custoEstimadoFechamentoTotal: 99 }));
  const d = construirDecomposicao(root, null);
  assert.equal(d?.buckets.fechamentoEstimado, 99);
  assert.equal(d?.custoTotalNoEscopo, 1, 'os 99 de fechamento estimado nunca entram na soma do custo realizado');
  fs.rmSync(root, { recursive: true, force: true });
});
