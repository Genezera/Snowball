/**
 * Testes de funding extremo como sinal contrário.
 *
 * Rodar: node --test src/funding/contrario.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { backtestContrario, PARAMETROS_PADRAO } from './contrario.ts';
import type { Bar } from '../core/types.ts';
import type { RegistroFunding } from '../data/funding-history.ts';

const DIA = 86_400_000;
function barra(c: number, t: number): Bar { return { t, o: c, h: c, l: c, c, v: 1000 }; }
function fund(t: number, r: number): RegistroFunding { return { t, fundingRate: r }; }

/**
 * Constrói N dias de barras a preço constante, com funding baixo e ALTERNANDO
 * sinal (±0,0001) — realista (funding calmo de verdade oscila de sinal) e
 * necessário para o teste: o desenho exige `limiarBaixo < 0` para o lado
 * "long" fazer sentido econômico (não é "extremo negativo" um limiar que já
 * é positivo), então uma base só-positiva nunca teria threshold negativo pra
 * cruzar.
 */
function baseCalma(n: number, precoBase = 100) {
  const bars: Bar[] = [], funding: RegistroFunding[] = [];
  for (let d = 0; d < n; d++) {
    const t = d * DIA;
    bars.push(barra(precoBase, t));
    funding.push(fund(t, d % 2 === 0 ? 0.0001 : -0.0001));
  }
  return { bars, funding };
}

test('sem funding extremo nunca abre posição', () => {
  const { bars, funding } = baseCalma(100);
  const trades = backtestContrario(bars, funding, PARAMETROS_PADRAO);
  assert.equal(trades.length, 0);
});

test('funding subitamente muito positivo abre SHORT (aposta contrária)', () => {
  const { bars, funding } = baseCalma(100);
  // no dia 70, funding dispara muito acima da janela causal (que só viu ~0,0001)
  funding[70].fundingRate = 0.01;
  const trades = backtestContrario(bars, funding, PARAMETROS_PADRAO);
  assert.equal(trades.length, 1);
  assert.equal(trades[0].direcao, 'short');
  assert.equal(trades[0].entradaIdx, 70);
});

test('funding subitamente muito negativo abre LONG (aposta contrária)', () => {
  const { bars, funding } = baseCalma(100);
  funding[70].fundingRate = -0.01;
  const trades = backtestContrario(bars, funding, PARAMETROS_PADRAO);
  assert.equal(trades.length, 1);
  assert.equal(trades[0].direcao, 'long');
});

test('a posição segura exatamente diasSegurar dias', () => {
  const { bars, funding } = baseCalma(100);
  funding[70].fundingRate = 0.01;
  const trades = backtestContrario(bars, funding, { ...PARAMETROS_PADRAO, diasSegurar: 5 });
  assert.equal(trades[0].saidaIdx - trades[0].entradaIdx, 5);
});

test('short lucra quando o preço cai depois da entrada', () => {
  const { bars, funding } = baseCalma(100);
  funding[70].fundingRate = 0.01; // abre short no dia 70
  for (let d = 71; d < 76; d++) bars[d].c = 100 * (1 - 0.01 * (d - 70)); // cai 1%/dia
  const trades = backtestContrario(bars, funding, { ...PARAMETROS_PADRAO, diasSegurar: 5, taxaTaker: 0, slippage: 0 });
  assert.equal(trades.length, 1);
  assert.ok(trades[0].retorno > 0, 'short deveria lucrar com queda de preço');
});

test('long perde quando o preço cai depois da entrada', () => {
  const { bars, funding } = baseCalma(100);
  funding[70].fundingRate = -0.01; // abre long no dia 70
  for (let d = 71; d < 76; d++) bars[d].c = 100 * (1 - 0.01 * (d - 70));
  const trades = backtestContrario(bars, funding, { ...PARAMETROS_PADRAO, diasSegurar: 5, taxaTaker: 0, slippage: 0 });
  assert.ok(trades[0].retorno < 0, 'long deveria perder com queda de preço');
});

test('custo entra duas vezes (entrada + saída, uma perna só)', () => {
  const { bars, funding } = baseCalma(100);
  funding[70].fundingRate = 0.01;
  const semCusto = backtestContrario(bars, funding, { ...PARAMETROS_PADRAO, taxaTaker: 0, slippage: 0 });
  const comCusto = backtestContrario(bars, funding, { ...PARAMETROS_PADRAO, taxaTaker: 0.001, slippage: 0.001 });
  assert.ok(Math.abs((semCusto[0].retorno - comCusto[0].retorno) - 0.004) < 1e-9);
});

test('regressão: janela quase constante não reabre posição todo dia depois de um único extremo', () => {
  // bug real encontrado testando: com funding "calmo" (quase idêntico todo
  // dia), o p90 de uma janela de 60 dias quase iguais é o PRÓPRIO valor
  // típico. Com desigualdade não-estrita (>=), o dia seguinte (que repete o
  // valor típico) cruzava o próprio limiar e reabria posição — todo dia,
  // indefinidamente. Corrigido com desigualdade estrita (>).
  const { bars, funding } = baseCalma(100);
  funding[70].fundingRate = 0.01; // único extremo isolado
  const trades = backtestContrario(bars, funding, PARAMETROS_PADRAO);
  assert.equal(trades.length, 1, 'um único extremo isolado não deveria reabrir posição repetidamente depois');
});

test('nunca abre duas posições simultâneas', () => {
  const { bars, funding } = baseCalma(200);
  for (let d = 70; d < 150; d += 3) funding[d].fundingRate = 0.01 * (d % 2 === 0 ? 1 : -1);
  const trades = backtestContrario(bars, funding, { ...PARAMETROS_PADRAO, diasSegurar: 5 });
  for (let i = 1; i < trades.length; i++) {
    assert.ok(trades[i].entradaIdx >= trades[i - 1].saidaIdx);
  }
});

test('dado esparso demais (poucos dias de funding na janela) não abre posição', () => {
  const bars: Bar[] = []; const funding: RegistroFunding[] = [];
  for (let d = 0; d < 100; d++) bars.push(barra(100, d * DIA));
  // só 5 dias de funding em 100 -- muito esparso pra confiar no percentil
  for (let d = 65; d < 70; d++) funding.push(fund(d * DIA, 0.0001));
  funding.push(fund(70 * DIA, 0.01));
  const trades = backtestContrario(bars, funding, PARAMETROS_PADRAO);
  assert.equal(trades.length, 0);
});
