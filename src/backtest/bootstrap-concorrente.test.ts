/**
 * Testes de `bootstrap-concorrente.ts`.
 *
 * O teste que mais importa aqui não é de plumbing — é provar que a
 * correlação preservada pelos blocos realmente muda o resultado. Se um
 * refactor futuro trocar block-bootstrap por reamostragem i.i.d. "por
 * engano" (regressão exata ao viés que motivou este arquivo), esse teste
 * tem que quebrar.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { construirBlocos, simularPortfolioConcorrente, replayHistoricoReal, paraRMultiplosComTempo } from './bootstrap-concorrente.ts';

const DIA_MS = 86_400_000;

test('paraRMultiplosComTempo rejeita risco não positivo', () => {
  assert.throws(() => paraRMultiplosComTempo([], 0));
});

test('construirBlocos rejeita lista vazia', () => {
  assert.throws(() => construirBlocos([], 30));
});

test('construirBlocos: todo trade cai em algum bloco pela sua entrada, nenhum offset negativo', () => {
  const trades = Array.from({ length: 200 }, (_, i) => ({
    entryTime: i * 2 * DIA_MS,
    exitTime: i * 2 * DIA_MS + 5 * DIA_MS,
    r: 0.5,
  }));
  const { blocos, blocoDias } = construirBlocos(trades, 30);
  const total = blocos.reduce((s, b) => s + b.length, 0);
  assert.ok(total > 0);
  assert.ok(total <= trades.length);
  for (const bloco of blocos) for (const t of bloco) {
    assert.ok(t.entryOffset >= 0 && t.entryOffset < blocoDias * DIA_MS);
  }
});

/** Constrói um pool sintético onde blocos são inteiramente bons OU inteiramente ruins (correlação máxima). */
function poolCorrelacionado(nBlocos: number, tradesPorBloco: number, blocoDias: number) {
  const trades: { entryTime: number; exitTime: number; r: number }[] = [];
  for (let k = 0; k < nBlocos; k++) {
    const bom = k % 3 !== 0; // 1/3 dos blocos são fortemente ruins, correlacionados
    for (let i = 0; i < tradesPorBloco; i++) {
      const entry = k * blocoDias * DIA_MS + i * DIA_MS * 0.1;
      trades.push({ entryTime: entry, exitTime: entry + 3 * DIA_MS, r: bom ? 0.3 : -0.6 });
    }
  }
  return trades;
}

test('correlação intra-bloco aumenta o risco de ruína (vs. o mesmo pool embaralhado, decorrelacionado)', () => {
  const blocoDias = 21;
  const nBlocos = 30, tradesPorBloco = 15;
  const trades = poolCorrelacionado(nBlocos, tradesPorBloco, blocoDias);
  const blocosCorrelacionados = construirBlocos(trades, blocoDias);

  // decorrelaciona: embaralha os R entre todos os trades, mantendo tempos —
  // cada bloco passa a ter uma mistura aleatória de bons/ruins em vez de ser
  // inteiramente um ou outro.
  function criarRng(semente: number) {
    let s = semente >>> 0;
    return () => { s ^= s << 13; s >>>= 0; s ^= s >> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
  }
  const rng = criarRng(99);
  const rsEmbaralhados = trades.map((t) => t.r);
  for (let i = rsEmbaralhados.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [rsEmbaralhados[i], rsEmbaralhados[j]] = [rsEmbaralhados[j], rsEmbaralhados[i]];
  }
  const tradesDecorrelacionados = trades.map((t, i) => ({ ...t, r: rsEmbaralhados[i] }));
  const blocosDecorrelacionados = construirBlocos(tradesDecorrelacionados, blocoDias);

  const opts = { capitalInicial: 200, alvo: 2234, pisoRuina: 40, riscoPorPosicao: 0.03, horizonteMeses: 24, caminhos: 3000, semente: 7 };
  const comCorrelacao = simularPortfolioConcorrente({ blocosCalendario: blocosCorrelacionados, ...opts });
  const semCorrelacao = simularPortfolioConcorrente({ blocosCalendario: blocosDecorrelacionados, ...opts });

  assert.ok(
    comCorrelacao.pRuina > semCorrelacao.pRuina,
    `blocos correlacionados (ruina ${comCorrelacao.pRuina}) deveriam quebrar mais que os mesmos trades embaralhados (ruina ${semCorrelacao.pRuina}) — mesma média, distribuída diferente no tempo`,
  );
});

test('simularPortfolioConcorrente: probabilidades formam uma partição válida', () => {
  const trades = poolCorrelacionado(20, 30, 21);
  const blocosCalendario = construirBlocos(trades, 21);
  const r = simularPortfolioConcorrente({
    blocosCalendario, capitalInicial: 200, alvo: 2234, pisoRuina: 40,
    riscoPorPosicao: 0.01, horizonteMeses: 24, caminhos: 1000, semente: 1,
  });
  const soma = r.pSucesso + r.pRuina + r.pArrastando;
  assert.ok(Math.abs(soma - 1) < 1e-9);
  assert.ok(r.pSucesso >= 0 && r.pRuina >= 0 && r.pArrastando >= 0);
});

test('mesma semente produz o mesmo resultado (determinístico)', () => {
  const trades = poolCorrelacionado(20, 30, 21);
  const blocosCalendario = construirBlocos(trades, 21);
  const opts = { blocosCalendario, capitalInicial: 200, alvo: 2234, pisoRuina: 40, riscoPorPosicao: 0.01, horizonteMeses: 24, caminhos: 500, semente: 42 };
  const a = simularPortfolioConcorrente(opts);
  const b = simularPortfolioConcorrente(opts);
  assert.deepEqual(a, b);
});

test('replayHistoricoReal: risco por posição maior nunca aumenta o capital final quando o pool tem expectativa negativa', () => {
  const trades = poolCorrelacionado(15, 30, 21).map((t) => ({ ...t, r: -0.5 })); // pool todo perdedor
  const blocosCalendario = construirBlocos(trades, 21);
  const baixo = replayHistoricoReal(blocosCalendario, 200, 1_000_000, 40, 0.001);
  const alto = replayHistoricoReal(blocosCalendario, 200, 1_000_000, 40, 0.05);
  assert.ok(baixo.capitalFinal >= alto.capitalFinal, 'com pool perdedor, arriscar mais deveria terminar com menos capital (ou igual, se ambos ruirem antes)');
});
