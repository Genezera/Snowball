/**
 * Testes do backtest de pares.
 *
 * Rodar: node --test src/pairs/backtest.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { backtestPar, PARAMETROS_PADRAO } from './backtest.ts';
import type { Bar } from '../core/types.ts';

function criarRng(semente: number) {
  let s = semente >>> 0;
  return () => { s ^= s << 13; s >>>= 0; s ^= s >> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
}
function barra(c: number, t = 0): Bar { return { t, o: c, h: c, l: c, c, v: 1000 }; }

/** Constrói duas séries com resíduo (log A − log B) AR(1) de ρ conhecido. */
function seriesComResiduo(n: number, rho: number, amplitude: number, semente: number) {
  const rng = criarRng(semente);
  const tendencia = Array.from({ length: n }, (_, i) => Math.sin(i / 15) * 0.05);
  const residuo: number[] = [0];
  for (let i = 1; i < n; i++) residuo.push(residuo[i - 1] * rho + amplitude * (rng() - 0.5));
  const barsA = tendencia.map((s, i) => barra(100 * Math.exp(s + residuo[i]), i));
  const barsB = tendencia.map((s, i) => barra(100 * Math.exp(s), i));
  return { barsA, barsB, residuo };
}

test('sem cruzar zEntrada, nunca abre posição', () => {
  const { barsA, barsB } = seriesComResiduo(100, 0.3, 0.001, 1); // resíduo minúsculo, nunca cruza z=2
  const trades = backtestPar(barsA, barsB, 1, 0, { ...PARAMETROS_PADRAO, zEntrada: 100 });
  assert.equal(trades.length, 0);
});

test('resíduo que diverge e reverte de verdade produz ao menos um trade lucrativo', () => {
  const n = 200;
  const tendencia = Array.from({ length: n }, (_, i) => Math.sin(i / 15) * 0.05);
  const residuo = Array.from({ length: n }, () => 0);
  // injeta um afastamento claro e uma reversão logo depois, dentro de ruído pequeno
  for (let i = 40; i < 50; i++) residuo[i] = 0.05; // A fica caro
  for (let i = 50; i < n; i++) residuo[i] = 0.001; // reverte e fica perto de zero
  const barsA = tendencia.map((s, i) => barra(100 * Math.exp(s + residuo[i]), i));
  const barsB = tendencia.map((s, i) => barra(100 * Math.exp(s), i));

  const trades = backtestPar(barsA, barsB, 1, 0, { ...PARAMETROS_PADRAO, janelaZ: 20, zEntrada: 1.5, zSaida: 0.3 });
  assert.ok(trades.length >= 1, 'deveria ter detectado o afastamento e a reversão');
  const primeiro = trades[0];
  assert.equal(primeiro.direcao, 'curtoA', 'A ficou caro (resíduo positivo) — deveria vender A');
});

test('cada trade cobra o custo de 2 pernas × entrada e saída', () => {
  const n = 200;
  const tendencia = Array.from({ length: n }, () => 0);
  const residuo = Array.from({ length: n }, (_, i) => (i >= 40 && i < 50) ? 0.05 : 0.001);
  const barsA = tendencia.map((s, i) => barra(100 * Math.exp(s + residuo[i]), i));
  const barsB = tendencia.map((s, i) => barra(100 * Math.exp(s), i));
  const semCusto = { ...PARAMETROS_PADRAO, janelaZ: 20, zEntrada: 1.5, zSaida: 0.3, taxaTaker: 0, slippage: 0 };
  const comCusto = { ...semCusto, taxaTaker: 0.001, slippage: 0.001 };
  const tSem = backtestPar(barsA, barsB, 1, 0, semCusto);
  const tCom = backtestPar(barsA, barsB, 1, 0, comCusto);
  assert.ok(tSem.length >= 1 && tCom.length >= 1);
  assert.ok(tCom[0].retorno < tSem[0].retorno, 'com custo, retorno deve ser menor');
  assert.ok(Math.abs((tSem[0].retorno - tCom[0].retorno) - 0.008) < 1e-9); // (0.001+0.001)*4 diferença
});

test('posição fecha por timeout se o spread nunca reverte', () => {
  const n = 100;
  const tendencia = Array.from({ length: n }, () => 0);
  // diverge e NUNCA volta perto de zero
  const residuo = Array.from({ length: n }, (_, i) => i >= 40 ? 0.05 + (i - 40) * 0.001 : 0.001);
  const barsA = tendencia.map((s, i) => barra(100 * Math.exp(s + residuo[i]), i));
  const barsB = tendencia.map((s, i) => barra(100 * Math.exp(s), i));
  const trades = backtestPar(barsA, barsB, 1, 0, { ...PARAMETROS_PADRAO, janelaZ: 20, zEntrada: 1.5, zSaida: 0.3, maxBarras: 10 });
  assert.ok(trades.length >= 1);
  assert.equal(trades[0].motivo, 'timeout');
  assert.equal(trades[0].saidaIdx - trades[0].entradaIdx, 10);
});

test('nunca abre duas posições simultâneas no mesmo par', () => {
  const { barsA, barsB } = seriesComResiduo(300, 0.5, 0.03, 2);
  const trades = backtestPar(barsA, barsB, 1, 0, { ...PARAMETROS_PADRAO, janelaZ: 20 });
  for (let i = 1; i < trades.length; i++) {
    assert.ok(trades[i].entradaIdx >= trades[i - 1].saidaIdx, 'trades não podem se sobrepor');
  }
});

test('stop de divergência sai antes do timeout quando o spread piora na mesma direção', () => {
  // valores pequenos e verificados à mão: base plana, depois diverge em
  // degraus crescentes na MESMA direção, sem nunca reverter — o caso que o
  // stop existe para cortar cedo
  const n = 60;
  const residuo: number[] = [];
  for (let i = 0; i < 20; i++) residuo.push(0);
  for (let i = 20; i < n; i++) residuo.push(0.10 + (i - 20) * 0.02); // diverge sem nunca parar
  const barsA: Bar[] = residuo.map((v, i) => barra(Math.exp(v), i));
  const barsB: Bar[] = residuo.map((_v, i) => barra(1, i));

  const p = { zEntrada: 1.0, zSaida: 0.3, maxBarras: 30, janelaZ: 10, taxaTaker: 0, slippage: 0 };
  const semStop = backtestPar(barsA, barsB, 1, 0, { ...p, zStop: Infinity });
  const comStop = backtestPar(barsA, barsB, 1, 0, { ...p, zStop: 2.0 });
  assert.ok(semStop.length >= 1 && comStop.length >= 1);
  assert.equal(comStop[0].motivo, 'stop-divergencia');
  assert.ok(comStop[0].saidaIdx < semStop[0].saidaIdx, 'com stop, sai mais cedo');
  assert.ok(comStop[0].retorno > semStop[0].retorno, 'sair mais cedo limita a perda');
});

test('regressão: posição não fica presa para sempre se o resíduo travar num platô', () => {
  // bug real: quando a janela rolante fica com variância zero (resíduo
  // constante), o loop original pulava a barra INTEIRA — inclusive a
  // checagem de fim-de-dado — e uma posição aberta nunca gerava trade de
  // saída, sumindo silenciosamente da lista.
  const n = 60;
  const residuo: number[] = [];
  for (let i = 0; i < 20; i++) residuo.push(0);
  residuo.push(0.10); residuo.push(0.20); residuo.push(0.30);
  for (let i = 23; i < n; i++) residuo.push(0.30); // trava exatamente aqui
  const barsA: Bar[] = residuo.map((v, i) => barra(Math.exp(v), i));
  const barsB: Bar[] = residuo.map((_v, i) => barra(1, i));
  const trades = backtestPar(barsA, barsB, 1, 0, {
    zEntrada: 1.0, zSaida: 0.3, maxBarras: 30, janelaZ: 10, taxaTaker: 0, slippage: 0, zStop: Infinity,
  });
  assert.ok(trades.length >= 1, 'a posição precisa gerar um trade de saída, mesmo com o resíduo travado');
  assert.equal(trades[0].motivo, 'timeout', 'sem reversão nem stop, só o tempo pode fechar');
});

test('direção é sempre coerente com o sinal do z na entrada', () => {
  const { barsA, barsB } = seriesComResiduo(300, 0.5, 0.03, 3);
  const trades = backtestPar(barsA, barsB, 1, 0, { ...PARAMETROS_PADRAO, janelaZ: 20 });
  for (const t of trades) {
    if (t.direcao === 'curtoA') assert.ok(t.zEntrada > 0, 'curtoA deveria vir de z positivo');
    else assert.ok(t.zEntrada < 0, 'longA deveria vir de z negativo');
  }
});
