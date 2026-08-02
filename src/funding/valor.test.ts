/**
 * Testes do valor esperado e do modelo de execução.
 *
 * Rodar: node --test src/funding/valor.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { avaliarValor, valorPorHora, vidaEsperada } from './valor.ts';
import { custoTaker, custoMaker, preenchimentoMinimo, TAXA_TAKER, TAXA_MAKER } from './execucao.ts';

const base = { notional: 250, taxa: 0.0005 };

// ── valor esperado ─────────────────────────────────────────────────────────

test('um par recém-visto tem vida esperada quase nula', () => {
  assert.ok(vidaEsperada(0.2, 1) < 0.3);
});

test('consistência baixa encurta a vida esperada', () => {
  assert.ok(vidaEsperada(10, 0.5) < vidaEsperada(10, 1));
});

test('o payback não depende de notional nem de alavancagem', () => {
  const a = avaliarValor({ ...base, notional: 250, spread: 0.0003, consistencia: 1, duracaoHoras: 50 });
  const b = avaliarValor({ ...base, notional: 5000, spread: 0.0003, consistencia: 1, duracaoHoras: 50 });
  assert.ok(Math.abs(a.paybackHoras - b.paybackHoras) < 1e-9,
    'custo e receita escalam juntos — o notional se cancela');
});

test('o VALOR em dólares escala com o notional, mesmo o payback não escalando', () => {
  const a = avaliarValor({ ...base, notional: 250, spread: 0.0003, consistencia: 1, duracaoHoras: 100 });
  const b = avaliarValor({ ...base, notional: 500, spread: 0.0003, consistencia: 1, duracaoHoras: 100 });
  assert.ok(Math.abs(b.valorEsperado - a.valorEsperado * 2) < 1e-9);
});

test('o caso MU: par novo com spread bom dá valor NEGATIVO', () => {
  // MU tinha 0,0313% de spread, 3 observações, ~10 minutos de vida
  const v = avaliarValor({ ...base, spread: 0.000313, consistencia: 1, duracaoHoras: 0.17 });
  assert.ok(v.valorEsperado < 0, `deu ${v.valorEsperado}`);
  assert.ok(v.folga < 1, 'nem chega perto de empatar');
});

test('o mesmo par, depois de provar que dura, passa a valer', () => {
  const v = avaliarValor({ ...base, spread: 0.000313, consistencia: 1, duracaoHoras: 120 });
  assert.ok(v.valorEsperado > 0);
  assert.ok(v.folga > 1.5, 'com folga suficiente para o portão');
});

test('spread maior encurta o payback proporcionalmente', () => {
  const a = avaliarValor({ ...base, spread: 0.0002, consistencia: 1, duracaoHoras: 100 });
  const b = avaliarValor({ ...base, spread: 0.0004, consistencia: 1, duracaoHoras: 100 });
  assert.ok(Math.abs(a.paybackHoras / b.paybackHoras - 2) < 1e-9);
});

test('taxa menor encurta o payback proporcionalmente', () => {
  const a = avaliarValor({ ...base, taxa: 0.0005, spread: 0.0003, consistencia: 1, duracaoHoras: 100 });
  const b = avaliarValor({ ...base, taxa: 0.0002, spread: 0.0003, consistencia: 1, duracaoHoras: 100 });
  assert.ok(Math.abs(a.paybackHoras / b.paybackHoras - 2.5) < 1e-9);
});

test('ordenar por valor POR HORA prefere quem libera o capital antes', () => {
  // mesmo lucro total, tempos diferentes
  const rapido = { ...base, spread: 0.0006, consistencia: 1, duracaoHoras: 50 };
  const lento = { ...base, spread: 0.0003, consistencia: 1, duracaoHoras: 100 };
  assert.ok(valorPorHora(rapido) > valorPorHora(lento));
});

test('valor negativo devolve valor por hora negativo — portão e ordem concordam', () => {
  const ruim = { ...base, spread: 0.0001, consistencia: 0.5, duracaoHoras: 1 };
  assert.ok(avaliarValor(ruim).valorEsperado < 0);
  assert.ok(valorPorHora(ruim) < 0);
});

// ── execução ───────────────────────────────────────────────────────────────

test('taker custa duas pernas a mercado, sem incerteza', () => {
  const t = custoTaker(250);
  assert.equal(t.esperado, 250 * TAXA_TAKER * 2);
  assert.equal(t.probAmbas, 1);
});

test('maker com preenchimento perfeito custa exatamente a razão das taxas', () => {
  const m = custoMaker({ probPreenchimento: 1, derivaJanela: 0.002, notional: 250 });
  assert.ok(Math.abs(m.esperado - 250 * TAXA_MAKER * 2) < 1e-9);
  assert.ok(Math.abs(m.esperado / custoTaker(250).esperado - TAXA_MAKER / TAXA_TAKER) < 1e-9);
});

test('preenchimento baixo torna maker MAIS caro que taker', () => {
  // este é o resultado que derrubou a promessa de "2,5× mais barato"
  const m = custoMaker({ probPreenchimento: 0.7, derivaJanela: 0.002, notional: 250 });
  assert.ok(m.esperado > custoTaker(250).esperado, 'a perna solta custa mais que a taxa economizada');
});

test('a probabilidade de perna solta é máxima em 50% de preenchimento', () => {
  const p50 = custoMaker({ probPreenchimento: 0.5, derivaJanela: 0.002, notional: 250 });
  for (const p of [0.3, 0.4, 0.6, 0.8]) {
    const c = custoMaker({ probPreenchimento: p, derivaJanela: 0.002, notional: 250 });
    assert.ok(c.probDesfazer <= p50.probDesfazer + 1e-9);
  }
});

test('deriva maior exige preenchimento maior para maker compensar', () => {
  assert.ok(preenchimentoMinimo(0.005) > preenchimentoMinimo(0.0005));
});

test('com deriva típica de 0,2%, maker só compensa acima de 90%', () => {
  const pm = preenchimentoMinimo(0.002, 250);
  assert.ok(pm > 0.85 && pm < 0.95, `deu ${pm}`);
});
