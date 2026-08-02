/**
 * Testes da diluição por exchange.
 *
 * A pergunta que isto responde: "três posições" reduz a concentração de fato,
 * ou só parece que reduz? A resposta depende inteiramente do teto — sem ele,
 * três posições nas mesmas duas exchanges deixam a concentração exatamente onde
 * estava.
 *
 * Rodar: node --test src/funding/concentracao.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';

/** Réplica da regra do motor, para testá-la sem subir exchange nenhuma. */
function simularAlocacao(
  capital: number, maxPosicoes: number, teto: number,
  candidatos: { symbol: string; short: string; long: string }[],
): { montadas: string[]; exposicao: Record<string, number>; concentracao: number } {
  const alocacao = capital / maxPosicoes;
  const margemPorPerna = alocacao / 2;
  const limite = capital * teto;
  const exposicao: Record<string, number> = {};
  const montadas: string[] = [];

  for (const c of candidatos) {
    if (montadas.length >= maxPosicoes) break;
    const estoura = [c.short, c.long].some((id) => (exposicao[id] ?? 0) + margemPorPerna > limite);
    if (estoura) continue;
    exposicao[c.short] = (exposicao[c.short] ?? 0) + margemPorPerna;
    exposicao[c.long] = (exposicao[c.long] ?? 0) + margemPorPerna;
    montadas.push(c.symbol);
  }

  const concentracao = Math.max(0, ...Object.values(exposicao)) / capital;
  return { montadas, exposicao, concentracao };
}

test('uma posição só deixa 50% em cada exchange — o ponto de partida', () => {
  const r = simularAlocacao(100, 1, 1.0, [{ symbol: 'A', short: 'binance', long: 'bybit' }]);
  assert.equal(r.concentracao, 0.5);
});

test('três posições em pares distintos derrubam a concentração para 33%', () => {
  const r = simularAlocacao(100, 3, 0.40, [
    { symbol: 'A', short: 'binance', long: 'bybit' },
    { symbol: 'B', short: 'okx', long: 'gate' },
    { symbol: 'C', short: 'binance', long: 'bitget' },
  ]);
  assert.equal(r.montadas.length, 3);
  assert.ok(Math.abs(r.concentracao - 1 / 3) < 1e-9, `deu ${r.concentracao}`);
});

test('SEM teto, três posições nas mesmas exchanges não diluem NADA', () => {
  // este é o teste que justifica o teto existir
  const mesmasDuas = [
    { symbol: 'A', short: 'binance', long: 'bybit' },
    { symbol: 'B', short: 'binance', long: 'bybit' },
    { symbol: 'C', short: 'binance', long: 'bybit' },
  ];
  const semTeto = simularAlocacao(100, 3, 1.0, mesmasDuas);
  assert.equal(semTeto.montadas.length, 3);
  assert.equal(semTeto.concentracao, 0.5, 'sem teto continua 50% — nenhuma diluição');

  const comTeto = simularAlocacao(100, 3, 0.40, mesmasDuas);
  assert.ok(comTeto.concentracao <= 0.40, `com teto ficou ${comTeto.concentracao}`);
});

test('o teto barra a terceira quando ela repetiria a exchange carregada', () => {
  const r = simularAlocacao(100, 3, 0.40, [
    { symbol: 'A', short: 'binance', long: 'bybit' },
    { symbol: 'B', short: 'binance', long: 'okx' },
    { symbol: 'C', short: 'binance', long: 'gate' },   // binance já com 2/6 + 2/6 = 33%
  ]);
  // a terceira levaria binance a 50%, acima do teto de 40%
  assert.deepEqual(r.montadas, ['A', 'B']);
  assert.ok(r.concentracao <= 0.40);
});

test('o teto nunca é ultrapassado, em nenhuma combinação', () => {
  const exchanges = ['binance', 'bybit', 'okx', 'gate', 'bitget'];
  const candidatos: { symbol: string; short: string; long: string }[] = [];
  let n = 0;
  for (const a of exchanges) {
    for (const b of exchanges) {
      if (a !== b) candidatos.push({ symbol: 'S' + n++, short: a, long: b });
    }
  }
  for (const max of [1, 2, 3, 4, 5]) {
    for (const teto of [0.30, 0.40, 0.50, 0.60]) {
      const r = simularAlocacao(100, max, teto, candidatos);
      assert.ok(r.concentracao <= teto + 1e-9, `max=${max} teto=${teto} deu ${r.concentracao}`);
    }
  }
});

test('um teto apertado demais impede montar qualquer posição', () => {
  // com 3 posições, cada perna leva 1/6 do capital = 16,7%. Um teto abaixo
  // disso torna tudo inviável — e o motor deve ficar sem posição, não montar
  // algo que viola o próprio limite.
  const r = simularAlocacao(100, 3, 0.10, [
    { symbol: 'A', short: 'binance', long: 'bybit' },
    { symbol: 'B', short: 'okx', long: 'gate' },
  ]);
  assert.equal(r.montadas.length, 0);
});

test('mais posições continuam diluindo, com o teto acompanhando', () => {
  const candidatos = [
    { symbol: 'A', short: 'binance', long: 'bybit' },
    { symbol: 'B', short: 'okx', long: 'gate' },
    { symbol: 'C', short: 'bitget', long: 'binance' },
    { symbol: 'D', short: 'bybit', long: 'okx' },
  ];
  const tres = simularAlocacao(100, 3, 0.40, candidatos);
  const quatro = simularAlocacao(100, 4, 0.40, candidatos);
  assert.ok(quatro.concentracao <= tres.concentracao + 1e-9);
});
