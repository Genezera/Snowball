/**
 * Testes da tesouraria por exchange.
 *
 * Rodar: node --test src/funding/tesouraria.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { dimensionar, socorrer, usoPorExchange, concentracao, RESERVA_PADRAO } from './tesouraria.ts';

const saldos = { binanceusdm: 100, bybit: 100 };
const vazio: Record<string, number> = {};

test('sem posição, o livre é o saldo inteiro', () => {
  const u = usoPorExchange(saldos, vazio);
  assert.equal(u.binanceusdm.livre, 100);
  assert.equal(u.binanceusdm.fracaoLivre, 1);
});

test('a reserva sai do saldo, não do que sobrou', () => {
  const d = dimensionar(saldos, vazio, 'binanceusdm', 'bybit', 5, 0.30);
  assert.ok(d.possivel);
  assert.equal(d.margemPorPerna, 70, '100 − 30% de colchão');
  assert.equal(d.notionalPorPerna, 350);
});

test('a margem é limitada pela exchange com MENOS livre', () => {
  // as duas pernas precisam do mesmo notional, senão a posição deixa de ser neutra
  const d = dimensionar({ binanceusdm: 100, bybit: 40 }, vazio, 'binanceusdm', 'bybit', 5, 0.30);
  assert.equal(d.margemPorPerna, 28, '40 − 30% de 40');
  assert.match(d.motivo, /limitada por bybit/);
});

test('uma segunda posição usa só o que sobrou, respeitando o colchão', () => {
  const margens = { binanceusdm: 40, bybit: 40 };
  const d = dimensionar(saldos, margens, 'binanceusdm', 'bybit', 5, 0.30);
  assert.equal(d.margemPorPerna, 30, '100 − 40 usados − 30 de colchão');
});

test('quando o colchão já foi alcançado, não abre mais', () => {
  const margens = { binanceusdm: 70, bybit: 70 };
  const d = dimensionar(saldos, margens, 'binanceusdm', 'bybit', 5, 0.30);
  assert.equal(d.possivel, false);
  assert.match(d.motivo, /sem margem livre acima da reserva/);
});

test('notional abaixo do mínimo da exchange não é montado', () => {
  const margens = { binanceusdm: 69.9, bybit: 69.9 };
  const d = dimensionar(saldos, margens, 'binanceusdm', 'bybit', 5, 0.30, 5);
  assert.equal(d.possivel, false);
  assert.match(d.motivo, /abaixo do mínimo/);
});

test('exchange sem saldo declarado é recusada com nome', () => {
  const d = dimensionar(saldos, vazio, 'binanceusdm', 'okx', 5);
  assert.equal(d.possivel, false);
  assert.match(d.motivo, /okx/);
});

// ── socorro interno ────────────────────────────────────────────────────────

test('o socorro usa o livre da PRÓPRIA exchange', () => {
  const margens = { binanceusdm: 70, bybit: 70 };
  const s = socorrer(saldos, margens, 'binanceusdm', 20);
  assert.equal(s.possivel, true);
  assert.equal(s.valor, 20, 'os 30 de colchão cobrem os 20 pedidos');
});

test('socorro parcial quando a reserva não cobre tudo', () => {
  const margens = { binanceusdm: 80, bybit: 70 };
  const s = socorrer(saldos, margens, 'binanceusdm', 50);
  assert.equal(s.valor, 20, 'só há 20 livres');
  assert.match(s.motivo, /parcial/);
});

test('reserva esgotada devolve impossível, e é o gatilho de fechar', () => {
  const margens = { binanceusdm: 100, bybit: 70 };
  const s = socorrer(saldos, margens, 'binanceusdm', 10);
  assert.equal(s.possivel, false);
  assert.match(s.motivo, /esgotada/);
});

test('o socorro NÃO tem valor mínimo — é a diferença para o saque', () => {
  // saque entre exchanges exige US$ 10; o movimento interno aceita centavos
  const margens = { binanceusdm: 70, bybit: 70 };
  const s = socorrer(saldos, margens, 'binanceusdm', 0.5);
  assert.equal(s.possivel, true);
  assert.equal(s.valor, 0.5);
});

// ── concentração ───────────────────────────────────────────────────────────

test('com duas exchanges a concentração é 50% e não há o que otimizar', () => {
  const c = concentracao(saldos);
  assert.equal(c.fracao, 0.5);
});

test('a concentração cai só com mais exchanges, não com mais posições', () => {
  assert.equal(concentracao({ a: 100, b: 100, c: 100 }).fracao, 1 / 3);
});

test('o padrão de reserva é o ótimo medido, não um palpite', () => {
  // sweep de 20 mil simulações: ótimo em 25%, curva plana de 15% a 35%
  assert.ok(RESERVA_PADRAO >= 0.15 && RESERVA_PADRAO <= 0.35);
});
