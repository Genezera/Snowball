/**
 * Testes de pares cointegrados.
 *
 * Rodar: node --test src/pairs/cointegracao.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { correlacao, meiaVida, avaliarPar, varrerPares } from './cointegracao.ts';
import type { Bar } from '../core/types.ts';

function barra(c: number, t = 0): Bar { return { t, o: c, h: c, l: c, c, v: 1000 }; }

/**
 * Gerador determinístico, mesmo padrão de bootstrap.ts. Um "choque" senoidal
 * puro é autocorrelacionado e vicia a estimativa de φ (a regressão AR(1)
 * assume choque i.i.d.) — foi o que quebrou a primeira versão deste teste.
 */
function criarRng(semente: number) {
  let s = semente >>> 0;
  return () => {
    s ^= s << 13; s >>>= 0;
    s ^= s >> 17;
    s ^= s << 5; s >>>= 0;
    return s / 4294967296;
  };
}

test('correlação perfeita positiva é 1', () => {
  const x = [1, 2, 3, 4, 5], y = [2, 4, 6, 8, 10];
  assert.ok(Math.abs(correlacao(x, y) - 1) < 1e-9);
});

test('correlação perfeita negativa é -1', () => {
  const x = [1, 2, 3, 4, 5], y = [10, 8, 6, 4, 2];
  assert.ok(Math.abs(correlacao(x, y) - (-1)) < 1e-9);
});

test('correlação de sinais com frequências incomensuráveis fica perto de zero', () => {
  // sem Math.random: duas senoides de frequência e fase bem diferentes não
  // têm relação linear nenhuma numa janela curta
  const x = Array.from({ length: 60 }, (_, i) => Math.sin(i * 0.31));
  const y = Array.from({ length: 60 }, (_, i) => Math.sin(i * 1.7 + 2.3));
  assert.ok(Math.abs(correlacao(x, y)) < 0.2);
});

test('meia-vida de uma série que reverte rápido é curta e positiva', () => {
  // AR(1) sintético com phi=-0.5: reverte pela metade a cada passo
  const residuo: number[] = [10];
  for (let i = 1; i < 100; i++) residuo.push(residuo[i - 1] * 0.5);
  const hl = meiaVida(residuo);
  assert.ok(hl > 0 && hl < 3, `esperava meia-vida curta, veio ${hl}`);
});

test('série que não reverte (passeio aleatório determinístico crescente) dá Infinity', () => {
  const residuo = Array.from({ length: 50 }, (_, i) => i); // tendência pura, sem reversão
  assert.equal(meiaVida(residuo), Infinity);
});

test('série curta demais não calcula meia-vida', () => {
  assert.equal(meiaVida([1, 2, 3]), Infinity);
});

test('oscilação instável (phi <= -1, 1+phi <= 0) devolve Infinity, nunca NaN', () => {
  // regressão: um resíduo com reset periódico produz phi ≈ -1,6, e
  // log(1+phi) é log de número negativo — NaN, se não for barrado antes.
  const residuo = Array.from({ length: 200 }, (_, i) => 0.01 * Math.pow(-0.5, i % 6));
  const hl = meiaVida(residuo);
  assert.equal(hl, Infinity);
  assert.ok(!Number.isNaN(hl));
});

test('dois ativos quase idênticos, com um resíduo AR(1) contínuo que reverte, formam par com hedge ratio ~1', () => {
  // resíduo perfeitamente zero é degenerado (nada para reverter, nada pra
  // negociar). Um choque único que decai também é irrealista — vira ruído de
  // ponto flutuante antes do fim da janela. O caso real é um processo AR(1)
  // com choque NOVO a cada passo (aqui, choque periódico determinístico),
  // que é o que a estratégia de pares existe para capturar.
  // ρ POSITIVO em (0,1): decaimento suave sem trocar de sinal a cada barra —
  // é o regime que a meia-vida de reversão clássica mede. ρ negativo
  // (oscilar de sinal a cada passo) é instável e fica fora do domínio da
  // fórmula de propósito (ver o teste de regressão logo acima).
  const n = 150;
  const rng = criarRng(7);
  const tendencia = Array.from({ length: n }, (_, i) => 100 * Math.exp(Math.sin(i / 20) * 0.1));
  const residuoAR1: number[] = [0];
  for (let i = 1; i < n; i++) {
    const choque = 0.01 * (rng() - 0.5); // ruído i.i.d. — senoidal vicia a estimativa de φ
    residuoAR1.push(residuoAR1[i - 1] * 0.5 + choque);
  }
  const barsA: Bar[] = tendencia.map((c, i) => barra(c, i));
  const barsB: Bar[] = tendencia.map((c, i) => barra(c * Math.exp(-residuoAR1[i]), i));
  const par = avaliarPar('A', barsA, 'B', barsB);
  assert.ok(par !== null);
  assert.ok(Math.abs(par!.hedgeRatio - 1) < 0.1, `hedge ratio esperado ~1, veio ${par?.hedgeRatio}`);
  assert.ok(par!.meiaVidaBarras > 0 && par!.meiaVidaBarras < 10);
});

test('dois ativos sem relação nenhuma (correlação baixa) não formam par', () => {
  const a: Bar[] = Array.from({ length: 100 }, (_, i) => barra(100 + Math.sin(i / 3) * 20, i));
  const b: Bar[] = Array.from({ length: 100 }, (_, i) => barra(50 + Math.cos(i / 11) * 5, i));
  const par = avaliarPar('A', a, 'B', b);
  assert.equal(par, null);
});

test('série curta demais (menos de 60 barras) não forma par', () => {
  const bars: Bar[] = Array.from({ length: 30 }, (_, i) => barra(100 + i, i));
  assert.equal(avaliarPar('A', bars, 'B', bars), null);
});

test('dois ativos com o mesmo movimento subjacente mas alavancado formam par com hedge ratio proporcional', () => {
  // B se move o dobro de A, em log, mais um resíduo AR(1) que reverte por
  // cima — hedge ratio deve capturar a proporção 2:1 apesar do ruído
  const n = 200;
  const rng = criarRng(99);
  const tendencia = Array.from({ length: n }, (_, i) => Math.sin(i / 8) * 0.1);
  const residuoAR1: number[] = [0];
  for (let i = 1; i < n; i++) {
    const choque = 0.01 * (rng() - 0.5); // ruído i.i.d. de verdade, não senoidal
    residuoAR1.push(residuoAR1[i - 1] * 0.4 + choque);
  }
  const a: Bar[] = tendencia.map((s, i) => barra(100 * Math.exp(s + residuoAR1[i]), i));
  const b: Bar[] = tendencia.map((s, i) => barra(50 * Math.exp(s * 2), i));
  const par = avaliarPar('A', a, 'B', b);
  assert.ok(par !== null);
  assert.ok(Math.abs(par!.hedgeRatio - 0.5) < 0.15, `hedge ratio esperado ~0.5, veio ${par?.hedgeRatio}`);
});

test('varrerPares ordena por meia-vida crescente (reverte mais rápido primeiro)', () => {
  const base = Array.from({ length: 150 }, (_, i) => 100 * Math.exp(Math.sin(i / 10) * 0.05));
  const series: Record<string, Bar[]> = {
    ancora: base.map((c, i) => barra(c, i)),
    // reverte rápido: soma um resíduo AR(1) de meia-vida curta ao redor da âncora
    rapido: base.map((c, i) => barra(c * (1 + 0.02 * Math.pow(-0.6, i % 20)), i)),
    // segue quase igual (resíduo quase nulo, meia-vida indefinida ou longa)
    lento: base.map((c, i) => barra(c * 1.0001, i)),
  };
  const pares = varrerPares(series);
  if (pares.length >= 2) {
    for (let i = 1; i < pares.length; i++) {
      assert.ok(pares[i - 1].meiaVidaBarras <= pares[i].meiaVidaBarras);
    }
  }
});

test('varrerPares não repete pares (A,B) e (B,A)', () => {
  const bars: Bar[] = Array.from({ length: 100 }, (_, i) => barra(100 + Math.sin(i / 5) * 10, i));
  const series = { A: bars, B: bars, C: bars };
  const pares = varrerPares(series);
  const chaves = new Set(pares.map((p) => [p.a, p.b].sort().join('|')));
  assert.equal(chaves.size, pares.length, 'não deve haver par duplicado em ordem invertida');
});
