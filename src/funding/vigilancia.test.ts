/**
 * Testes do ajuste de consistência por tamanho de amostra.
 *
 * Rodar: node --test src/funding/vigilancia.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { consistenciaAjustada, TOLERANCIA_FALTAS } from './vigilancia.ts';

test('uma única observação perfeita quase não vale nada', () => {
  assert.ok(consistenciaAjustada(1, 1) < 0.25);
});

test('o ajuste cresce monotonicamente com o número de observações', () => {
  let anterior = 0;
  for (const n of [1, 3, 6, 12, 30, 100]) {
    const v = consistenciaAjustada(1, n);
    assert.ok(v > anterior, `n=${n} não subiu`);
    anterior = v;
  }
});

test('converge para a proporção observada com amostra grande', () => {
  assert.ok(Math.abs(consistenciaAjustada(0.86, 5000) - 0.86) < 0.02);
});

test('nunca ultrapassa a proporção observada', () => {
  for (const n of [1, 3, 10, 50, 500]) {
    for (const p of [0.3, 0.5, 0.86, 1]) {
      assert.ok(consistenciaAjustada(p, n) <= p + 1e-9, `p=${p} n=${n}`);
    }
  }
});

test('nunca é negativo', () => {
  for (const n of [1, 2, 5]) assert.ok(consistenciaAjustada(0, n) >= 0);
});

test('o caso MU × KAITO: amostra pequena perfeita perde para amostra maior boa', () => {
  // Os números são os reais de 02/08/2026. Com a regra antiga MU venceu, o
  // motor montou, e o par sumiu doze minutos depois.
  const mu = 0.000313 * consistenciaAjustada(1.00, 3) ** 2;
  const kaito = 0.000331 * consistenciaAjustada(0.86, 6) ** 2;
  assert.ok(kaito > mu, 'KAITO deve vencer com o ajuste');

  // e a regra antiga de fato escolhia MU — o teste guarda a regressão
  assert.ok(0.000313 * 1.00 ** 2 > 0.000331 * 0.86 ** 2);
});

test('com observações iguais, a maior consistência ainda vence', () => {
  // o ajuste não pode inverter a ordem quando a amostra é a mesma
  assert.ok(consistenciaAjustada(0.9, 10) > consistenciaAjustada(0.7, 10));
});

test('não reordena nada quando as amostras já são grandes', () => {
  const a = 0.0003 * consistenciaAjustada(0.95, 200) ** 2;
  const b = 0.0003 * consistenciaAjustada(0.80, 200) ** 2;
  assert.ok(a > b, 'com amostra grande, quem é melhor continua melhor');
});

// ── tolerância a piscar ────────────────────────────────────────────────────

/** Réplica da regra de fechamento, para testá-la sem varrer exchange nenhuma. */
function simularPresenca(padrao: string, tolerancia: number): { fechouNa: number | null } {
  let faltas = 0;
  for (let i = 0; i < padrao.length; i++) {
    if (padrao[i] === '#') { faltas = 0; continue; }
    faltas++;
    if (faltas >= tolerancia) return { fechouNa: i };
  }
  return { fechouNa: null };
}

test('sem tolerância, um único buraco mata o par', () => {
  assert.equal(simularPresenca('####-####', 1).fechouNa, 4);
});

test('o padrão real do KAITO sobrevive com tolerância 3', () => {
  // 38 de 44 varreduras, com os buracos exatamente onde foram observados
  const kaito = '###################-###---#--###############';
  assert.equal(simularPresenca(kaito, 3).fechouNa, 25, 'o buraco triplo fecha, e deve fechar');
  // mas os buracos de 1 e 2 antes dele não fecham
  assert.equal(simularPresenca('###################-###', 3).fechouNa, null);
  assert.equal(simularPresenca('###############--#####', 3).fechouNa, null);
});

test('o padrão do XAUT — buracos de um — sobrevive inteiro', () => {
  const xaut = '-##-####-#-#################-##############-#####';
  assert.equal(simularPresenca(xaut, 3).fechouNa, null);
});

test('um spread que morreu de verdade ainda é detectado', () => {
  // ausência contínua a partir da metade
  assert.equal(simularPresenca('##########----------', 3).fechouNa, 12);
});

test('a tolerância é menor que o ciclo do motor', () => {
  // 3 varreduras × 5 min = 15 min, contra 20 min de ciclo do motor.
  // Se fosse maior, o motor decidiria com um par já morto no ranking.
  const minutosParaDetectar = TOLERANCIA_FALTAS * 5;
  assert.ok(minutosParaDetectar < 20, `${minutosParaDetectar} min não cabe no ciclo de 20`);
});
