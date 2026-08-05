/**
 * Testes do risco de liquidação por perna.
 *
 * Rodar: node --test src/pairs/liquidacao.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { excursoesAdversas, distanciaLiquidacaoPorPerna, fracaoQueLiquidaria, maiorAlavancagemSegura } from './liquidacao.ts';
import type { Bar } from '../core/types.ts';
import type { TradePar } from './backtest.ts';

function barra(o: number, h: number, l: number, c: number, t = 0): Bar { return { t, o, h, l, c, v: 1000 }; }
function trade(entradaIdx: number, saidaIdx: number, direcao: 'longA' | 'curtoA'): TradePar {
  return { entradaIdx, saidaIdx, direcao, zEntrada: 2, zSaida: 0.3, retorno: 0, motivo: 'reversao' };
}

test('curtoA: pior movimento é A subindo ou B descendo', () => {
  const barsA: Bar[] = [barra(100, 100, 100, 100, 0), barra(100, 150, 100, 140, 1)]; // A sobe até 150 (+50%)
  const barsB: Bar[] = [barra(100, 100, 100, 100, 0), barra(100, 100, 90, 95, 1)]; // B desce até 90 (-10%)
  const [exc] = excursoesAdversas([trade(0, 1, 'curtoA')], barsA, barsB);
  assert.ok(Math.abs(exc.piorMovimento - 0.5) < 1e-9, 'A subir 50% é o pior movimento (vs B cair 10%)');
});

test('longA: pior movimento é A descendo ou B subindo', () => {
  const barsA: Bar[] = [barra(100, 100, 100, 100, 0), barra(100, 100, 70, 80, 1)]; // A desce até 70 (-30%)
  const barsB: Bar[] = [barra(100, 100, 100, 100, 0), barra(100, 120, 100, 115, 1)]; // B sobe até 120 (+20%)
  const [exc] = excursoesAdversas([trade(0, 1, 'longA')], barsA, barsB);
  assert.ok(Math.abs(exc.piorMovimento - 0.3) < 1e-9, 'A cair 30% é o pior movimento (vs B subir 20%)');
});

test('movimento a favor não conta — só o adverso', () => {
  const barsA: Bar[] = [barra(100, 100, 100, 100, 0), barra(100, 100, 50, 60, 1)]; // A CAI — a favor de curtoA
  const barsB: Bar[] = [barra(100, 100, 100, 100, 0), barra(100, 100, 100, 100, 1)];
  const [exc] = excursoesAdversas([trade(0, 1, 'curtoA')], barsA, barsB);
  assert.equal(exc.piorMovimento, 0, 'preço caindo é bom para curtoA, não deveria contar como adverso');
});

test('distância até liquidação NÃO depende de quantos pares dividem o capital — só da alavancagem', () => {
  // margem e notional por perna escalam JUNTOS por 1/N sob margem isolada;
  // a razão entre eles (o que decide liquidação) cancela N. Uma versão
  // anterior deste arquivo tratava isso como dependente de N — bug real,
  // corrigido, e este teste é a regressão.
  const d2 = distanciaLiquidacaoPorPerna(2, 5);
  const d10 = distanciaLiquidacaoPorPerna(10, 5);
  assert.equal(d2, d10);
});

test('distância até liquidação é exatamente 1/alavancagem − mmr', () => {
  assert.ok(Math.abs(distanciaLiquidacaoPorPerna(7, 5, 0.01) - (1 / 5 - 0.01)) < 1e-9);
  assert.ok(Math.abs(distanciaLiquidacaoPorPerna(1, 10, 0.01) - (1 / 10 - 0.01)) < 1e-9);
});

test('distância até liquidação cai com mais alavancagem', () => {
  const d3x = distanciaLiquidacaoPorPerna(5, 3);
  const d10x = distanciaLiquidacaoPorPerna(5, 10);
  assert.ok(d3x > d10x);
});

test('fração que liquidaria é 0 se nenhuma excursão ultrapassa a distância', () => {
  const exc = [{ piorMovimento: 0.05 }, { piorMovimento: 0.08 }];
  assert.equal(fracaoQueLiquidaria(exc, 2, 5), 0); // distância a N=2,5x é bem maior que 8%
});

test('fração que liquidaria é 1 se todas ultrapassam', () => {
  const exc = [{ piorMovimento: 5 }, { piorMovimento: 10 }];
  assert.equal(fracaoQueLiquidaria(exc, 20, 5), 1); // N=20 dá margem mínima por perna
});

test('lista vazia de excursões não quebra e devolve 0', () => {
  assert.equal(fracaoQueLiquidaria([], 5, 5), 0);
});

test('maiorAlavancagemSegura encontra uma alavancagem sob a tolerância', () => {
  const exc = [
    { piorMovimento: 1.2 }, { piorMovimento: 0.05 }, { piorMovimento: 0.06 },
    { piorMovimento: 0.5 }, { piorMovimento: 0.04 },
  ];
  const alav = maiorAlavancagemSegura(exc, 0.05);
  const fracaoNaAlav = fracaoQueLiquidaria(exc, 1, alav);
  assert.ok(fracaoNaAlav <= 0.05);
});

test('maiorAlavancagemSegura cai conforme a excursão dos dados piora', () => {
  const excCalmo = Array.from({ length: 20 }, () => ({ piorMovimento: 0.03 }));
  const excVolatil = Array.from({ length: 20 }, () => ({ piorMovimento: 0.5 }));
  assert.ok(maiorAlavancagemSegura(excCalmo, 0.05) > maiorAlavancagemSegura(excVolatil, 0.05));
});

test('excursões extremas (500%) empurram a alavancagem segura abaixo de 1x — comportamento correto, não um piso artificial', () => {
  // 500% de movimento adverso é maior que o que QUALQUER alavancagem >=1x
  // aguenta com folga (1x só cobre até ~99%). A função não deve fingir que
  // 1x é seguro quando não é — deve devolver a fração real, mesmo <1.
  const exc = Array.from({ length: 20 }, () => ({ piorMovimento: 5 }));
  const alav = maiorAlavancagemSegura(exc, 0.01);
  assert.ok(alav > 0, 'sempre positivo');
  assert.ok(alav < 1, 'com excursões de 500%, nem 1x é seguro — o resultado precisa refletir isso');
});
