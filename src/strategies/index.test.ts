/**
 * Testes focados no `tsMomentum` — cobertura mínima para a opção `useTrail`
 * adicionada depois da validação original (não muda o comportamento padrão,
 * só acrescenta um modo opcional).
 *
 * Rodar: node --test src/strategies/index.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { tsMomentum } from './index.ts';
import type { Bar } from '../core/types.ts';

function barra(c: number, t: number): Bar { return { t, o: c, h: c, l: c, c, v: 1000 }; }

/** Série com um salto claro de +20% no fim, o bastante pra cruzar minRet. */
function serieComSalto(n: number, lookback: number) {
  const bars: Bar[] = [];
  for (let i = 0; i < n; i++) bars.push(barra(100, i * 86_400_000));
  bars[n - 1] = barra(120, (n - 1) * 86_400_000); // +20% nos últimos `lookback` dias
  return bars;
}

test('sem useTrail (padrão), o sinal não carrega trailPct/trailArmPct', () => {
  const bars = serieComSalto(40, 30);
  const strat = tsMomentum({ lookback: 30, minRet: 0.05, stopPct: 0.12, takePct: 5.0 });
  const sig = strat.onBar(bars, 39);
  assert.ok(sig);
  assert.equal(sig!.trailPct, undefined);
  assert.equal(sig!.trailArmPct, undefined);
  assert.equal(sig!.takePct, 5.0, 'sem trail, o takePct configurado é respeitado como está');
});

test('com useTrail=true, o sinal carrega trailPct/trailArmPct e takePct vira efetivamente infinito', () => {
  const bars = serieComSalto(40, 30);
  const strat = tsMomentum({ lookback: 30, minRet: 0.05, stopPct: 0.12, useTrail: true, trailPct: 0.10, trailArmPct: 0.40 });
  const sig = strat.onBar(bars, 39);
  assert.ok(sig);
  assert.equal(sig!.trailPct, 0.10);
  assert.equal(sig!.trailArmPct, 0.40);
  assert.ok(sig!.takePct >= 10, 'com trailing, o take fixo precisa estar fora do alcance — quem fecha é o trail');
});

test('com useTrail=true mas sem trailPct/trailArmPct explícitos, cai para o próprio stopPct', () => {
  const bars = serieComSalto(40, 30);
  const strat = tsMomentum({ lookback: 30, minRet: 0.05, stopPct: 0.12, useTrail: true });
  const sig = strat.onBar(bars, 39);
  assert.ok(sig);
  assert.equal(sig!.trailPct, 0.12);
  assert.equal(sig!.trailArmPct, 0.12);
});

test('o nome da estratégia sinaliza quando o trailing está ativo', () => {
  const semTrail = tsMomentum({ lookback: 30 });
  const comTrail = tsMomentum({ lookback: 30, useTrail: true });
  assert.ok(!semTrail.name.includes('trail'));
  assert.ok(comTrail.name.includes('trail'));
});

test('sem retorno suficiente (abaixo de minRet), não emite sinal em nenhum dos dois modos', () => {
  const bars: Bar[] = [];
  for (let i = 0; i < 40; i++) bars.push(barra(100, i * 86_400_000)); // sem movimento nenhum
  const semTrail = tsMomentum({ lookback: 30, minRet: 0.05 });
  const comTrail = tsMomentum({ lookback: 30, minRet: 0.05, useTrail: true });
  assert.equal(semTrail.onBar(bars, 39), null);
  assert.equal(comTrail.onBar(bars, 39), null);
});
