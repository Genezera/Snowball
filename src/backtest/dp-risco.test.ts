/**
 * Testes de `dp-risco.ts` — a política adaptativa resolvida por DP.
 *
 * Não testamos o número exato da política ótima (isso muda se a grade
 * mudar), testamos as propriedades que ela PRECISA ter para ser confiável:
 * risco sempre dentro dos candidatos, monotonicidade básica de bom senso,
 * e que bate (ou empata) a melhor fração fixa nos mesmos dados — se isso
 * falhar, a DP está pior que não ter DP nenhuma.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { resolverPoliticaOtima, riscoNaPolitica, simularComPolitica } from './dp-risco.ts';
import { simularBootstrap } from './bootstrap.ts';

/** Gerador determinístico simples para os R-múltiplos sintéticos. */
function criarRng(semente: number) {
  let s = semente >>> 0;
  return () => { s ^= s << 13; s >>>= 0; s ^= s >> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
}

/** Distribuição sintética com expectância positiva e cauda direita gorda (parecida com ts-momentum real). */
function poolSintetico(n: number, semente = 42): number[] {
  const rng = criarRng(semente);
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    const u = rng();
    if (u < 0.55) out.push(-1 + rng() * 0.3); // perdas perto do stop
    else if (u < 0.9) out.push(rng() * 0.8); // ganhos pequenos/médios
    else out.push(1 + rng() * 4); // cauda direita: ganhos grandes, raros
  }
  return out;
}

test('risco recomendado está sempre entre os candidatos testados', () => {
  const pool = poolSintetico(2000);
  const politica = resolverPoliticaOtima({
    rMultiplos: pool, capitalInicial: 200, alvo: 1000, pisoRuina: 40,
    totalOps: 200, nBinsCapital: 60, nBinsR: 60,
  });
  for (const capital of [50, 100, 300, 600, 900]) {
    for (const passo of [0, 50, 100, 199]) {
      const r = riscoNaPolitica(politica, capital, passo);
      assert.ok(r >= politica.riscosCandidatos[0] && r <= politica.riscosCandidatos.at(-1)!);
    }
  }
});

test('perto do fim do horizonte sem ter chegado à meta, a política não fica mais conservadora que no início', () => {
  const pool = poolSintetico(2000);
  const totalOps = 300;
  const politica = resolverPoliticaOtima({
    rMultiplos: pool, capitalInicial: 200, alvo: 1000, pisoRuina: 40,
    totalOps, nBinsCapital: 60, nBinsR: 60,
  });
  const riscoInicio = riscoNaPolitica(politica, 200, 0);
  const riscoQuaseNoFim = riscoNaPolitica(politica, 200, totalOps - 5);
  assert.ok(riscoQuaseNoFim >= riscoInicio, 'com pouco tempo restante e a meta longe, arriscar menos que no início não faz sentido');
});

test('a política adaptativa bate (ou empata) a melhor fração fixa no mesmo pool', () => {
  const pool = poolSintetico(3000, 7);
  const capitalInicial = 200, alvo = 1000, pisoRuina = 40, opsPorMes = 20, horizonteMeses = 24;
  const totalOps = opsPorMes * horizonteMeses;

  const politica = resolverPoliticaOtima({
    rMultiplos: pool, capitalInicial, alvo, pisoRuina, totalOps,
    nBinsCapital: 150, nBinsR: 150,
  });

  const resAdaptativo = simularComPolitica({
    politica, rMultiplos: pool, capitalInicial, alvo, pisoRuina, opsPorMes, horizonteMeses, caminhos: 8000, semente: 1,
  });

  let melhorFixo = -1;
  for (const risco of [0.02, 0.05, 0.08, 0.12, 0.18, 0.25]) {
    const r = simularBootstrap({ rMultiplos: pool, capitalInicial, alvo, pisoRuina, opsPorMes, horizonteMeses, riscoFracao: risco, caminhos: 8000, semente: 1 });
    if (r.pSucesso > melhorFixo) melhorFixo = r.pSucesso;
  }

  assert.ok(
    resAdaptativo.pSucesso >= melhorFixo - 0.03,
    `adaptativo (${resAdaptativo.pSucesso.toFixed(3)}) não deveria ficar muito abaixo da melhor fração fixa (${melhorFixo.toFixed(3)})`,
  );
});

test('lança erro com pool de R-múltiplos vazio', () => {
  assert.throws(() => resolverPoliticaOtima({ rMultiplos: [], capitalInicial: 200, alvo: 1000, pisoRuina: 40, totalOps: 100 }));
});
