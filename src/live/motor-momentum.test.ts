import { test } from 'node:test';
import assert from 'node:assert/strict';
import { avaliarSaida, calcularFechamento, indiceUltimaBarraFechada } from './motor-momentum.ts';
import type { Bar } from '../core/types.ts';

const DIA = 86_400_000;
const bar = (over: Partial<Bar> = {}): Bar => ({ t: DIA * 10, o: 100, h: 101, l: 99, c: 100, v: 1000, ...over });
const barraEm = (dia: number): Bar => ({ t: DIA * dia, o: 1, h: 1, l: 1, c: 1, v: 1 });

test('indiceUltimaBarraFechada: regressão do bug real — a barra do dia corrente (incompleta) nunca é a fechada', () => {
  // exatamente o formato que fetchOHLCV devolve: a última barra é sempre a
  // que está se formando agora, mesmo que só tenha começado há segundos
  const bars = [barraEm(3), barraEm(4), barraEm(5)];
  const agora = DIA * 5 + 1000; // poucos segundos depois de a barra do dia 5 abrir
  const idx = indiceUltimaBarraFechada(bars, agora, DIA);
  assert.equal(idx, 1); // a barra do dia 4, que fechou ao virar o dia 5 — NÃO a do dia 5
  assert.equal(bars[idx].t, DIA * 4);
});

test('indiceUltimaBarraFechada: nenhuma barra fechada ainda (só a incompleta) devolve -1', () => {
  const bars = [barraEm(5)];
  const agora = DIA * 5 + 1000;
  assert.equal(indiceUltimaBarraFechada(bars, agora, DIA), -1);
});

test('indiceUltimaBarraFechada: motor ficou fora do ar por dias — anda mais pra trás até achar a fechada mais recente', () => {
  const bars = [barraEm(1), barraEm(2), barraEm(3), barraEm(4), barraEm(5)];
  const agora = DIA * 5 + 1000; // só a barra do dia 5 está incompleta
  const idx = indiceUltimaBarraFechada(bars, agora, DIA);
  assert.equal(bars[idx].t, DIA * 4); // a mais recente que já fechou, não a mais antiga
});

test('indiceUltimaBarraFechada: bem no instante exato do fechamento, a barra já conta como fechada', () => {
  const bars = [barraEm(4), barraEm(5)];
  const agora = DIA * 5; // t + step da barra do dia 4 é exatamente DIA*5
  assert.equal(bars[indiceUltimaBarraFechada(bars, agora, DIA)].t, DIA * 4);
});

test('avaliarSaida: long sai por stop quando a minima da barra toca o stop', () => {
  const pos = { side: 'long' as const, stopPrice: 95, takePrice: 120, abertaBarT: DIA * 9 };
  const r = avaliarSaida(pos, bar({ l: 94, h: 101 }), 20);
  assert.equal(r?.reason, 'stop');
  assert.equal(r?.exitPrice, 95);
});

test('avaliarSaida: long sai por take quando a maxima da barra toca o alvo', () => {
  const pos = { side: 'long' as const, stopPrice: 95, takePrice: 105, abertaBarT: DIA * 9 };
  const r = avaliarSaida(pos, bar({ l: 99, h: 106 }), 20);
  assert.equal(r?.reason, 'take');
  assert.equal(r?.exitPrice, 105);
});

test('avaliarSaida: quando a mesma barra toca stop E take, assume o STOP (o erro otimista é o que quebra conta)', () => {
  const pos = { side: 'long' as const, stopPrice: 95, takePrice: 105, abertaBarT: DIA * 9 };
  const r = avaliarSaida(pos, bar({ l: 94, h: 106 }), 20);
  assert.equal(r?.reason, 'stop');
});

test('avaliarSaida: short espelha a logica (stop acima, take abaixo)', () => {
  const pos = { side: 'short' as const, stopPrice: 105, takePrice: 90, abertaBarT: DIA * 9 };
  const rStop = avaliarSaida(pos, bar({ h: 106, l: 99 }), 20);
  assert.equal(rStop?.reason, 'stop');
  const rTake = avaliarSaida(pos, bar({ h: 101, l: 89 }), 20);
  assert.equal(rTake?.reason, 'take');
});

test('avaliarSaida: sem tocar stop nem take, e dentro do prazo, nao sai', () => {
  const pos = { side: 'long' as const, stopPrice: 90, takePrice: 120, abertaBarT: DIA * 9 };
  assert.equal(avaliarSaida(pos, bar({ l: 98, h: 102 }), 20), null);
});

test('avaliarSaida: estoura o prazo maximo sem tocar stop/take -> sai por timeout no fechamento', () => {
  const pos = { side: 'long' as const, stopPrice: 90, takePrice: 120, abertaBarT: DIA * 9 };
  const r = avaliarSaida(pos, bar({ t: DIA * 30, l: 98, h: 102, c: 100.5 }), 20);
  assert.equal(r?.reason, 'timeout');
  assert.equal(r?.exitPrice, 100.5);
});

test('avaliarSaida: barsHeld conta em dias inteiros a partir da barra de abertura', () => {
  const pos = { side: 'long' as const, stopPrice: 90, takePrice: 120, abertaBarT: DIA * 9 };
  // 19 dias depois: ainda dentro do prazo de 20
  assert.equal(avaliarSaida(pos, bar({ t: DIA * 28, l: 98, h: 102 }), 20), null);
  // 20 dias depois: estoura
  assert.equal(avaliarSaida(pos, bar({ t: DIA * 29, l: 98, h: 102, c: 100 }), 20)?.reason, 'timeout');
});

test('calcularFechamento: long lucrativo — fill abaixo do preco de referencia (slippage contra), pnl positivo se o preco subiu o bastante', () => {
  const pos = { side: 'long' as const, entryPrice: 100, qty: 10 };
  const r = calcularFechamento(pos, 110, 0.0005, 0.0002);
  assert.ok(r.fill < 110); // slippage sempre contra
  assert.ok(r.pnl > 0);
  assert.ok(r.exitFee > 0);
});

test('calcularFechamento: short lucrativo quando o preco cai', () => {
  const pos = { side: 'short' as const, entryPrice: 100, qty: 10 };
  const r = calcularFechamento(pos, 90, 0.0005, 0.0002);
  assert.ok(r.fill > 90); // slippage sempre contra (compra mais caro pra fechar o short)
  assert.ok(r.pnl > 0);
});

test('calcularFechamento: taxa de saida reduz o pnl liquido em relacao ao bruto', () => {
  const pos = { side: 'long' as const, entryPrice: 100, qty: 10 };
  const semTaxa = calcularFechamento(pos, 110, 0, 0);
  const comTaxa = calcularFechamento(pos, 110, 0.001, 0);
  assert.ok(comTaxa.pnl < semTaxa.pnl);
  assert.equal(semTaxa.exitFee, 0);
});
