/**
 * Testes de `portfolio-misto.ts`.
 *
 * O mais importante aqui: provar que misturar uma estratégia de baixa
 * correlação reduz ruína de verdade (não é plumbing — é a tese central do
 * arquivo), e que a correção de liquidação de pares dispara quando deveria.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { construirBlocosMistos, simularPortfolioMisto } from './portfolio-misto.ts';

const DIA_MS = 86_400_000;

test('construirBlocosMistos rejeita lista vazia', () => {
  assert.throws(() => construirBlocosMistos([], 30));
});

test('construirBlocosMistos preserva a estrategia e o piorMovimento de cada trade', () => {
  const trades = [
    { entryTime: 0, exitTime: 3 * DIA_MS, r: 0.5, estrategia: 'momentum' },
    { entryTime: DIA_MS, exitTime: 5 * DIA_MS, r: 0.1, estrategia: 'pares', piorMovimento: 0.3 },
  ];
  const { blocos } = construirBlocosMistos(trades, 2);
  const todos = blocos.flat();
  assert.ok(todos.some((t) => t.estrategia === 'momentum'));
  const dePares = todos.find((t) => t.estrategia === 'pares');
  assert.equal(dePares?.piorMovimento, 0.3);
});

/** Pool de "momentum": blocos inteiramente bons OU ruins (alta correlação intra-estratégia). */
function poolMomentum(nBlocos: number, tradesPorBloco: number, blocoDias: number) {
  const trades: { entryTime: number; exitTime: number; r: number; estrategia: string }[] = [];
  for (let k = 0; k < nBlocos; k++) {
    const bom = k % 3 !== 0;
    for (let i = 0; i < tradesPorBloco; i++) {
      const entry = k * blocoDias * DIA_MS + i * DIA_MS * 0.1;
      trades.push({ entryTime: entry, exitTime: entry + 3 * DIA_MS, r: bom ? 0.3 : -0.6, estrategia: 'momentum' });
    }
  }
  return trades;
}

/** Pool de "pares": expectância pequena mas positiva, e SEM relação com o padrão bom/ruim do momentum. */
function poolParesDescorrelacionado(nBlocos: number, tradesPorBloco: number, blocoDias: number) {
  const trades: { entryTime: number; exitTime: number; r: number; estrategia: string; piorMovimento: number }[] = [];
  for (let k = 0; k < nBlocos; k++) {
    for (let i = 0; i < tradesPorBloco; i++) {
      const entry = k * blocoDias * DIA_MS + i * DIA_MS * 0.13;
      // alterna independente do padrao bom/ruim do momentum (k%3), usa i%2
      const ganhou = i % 2 === 0;
      trades.push({ entryTime: entry, exitTime: entry + 4 * DIA_MS, r: ganhou ? 0.05 : -0.03, estrategia: 'pares', piorMovimento: 0.05 });
    }
  }
  return trades;
}

test('misturar uma estratégia de baixa correlação reduz ruína vs. só a estratégia concentrada', () => {
  const blocoDias = 21;
  const momentum = poolMomentum(30, 15, blocoDias);
  const pares = poolParesDescorrelacionado(30, 15, blocoDias);
  const blocosSoMomentum = construirBlocosMistos(momentum, blocoDias);
  const blocosMisto = construirBlocosMistos([...momentum, ...pares], blocoDias);

  const base = { capitalInicial: 200, alvo: 2234, pisoRuina: 40, horizonteMeses: 24, caminhos: 3000, semente: 7 };
  const soMomentum = simularPortfolioMisto({ blocosCalendario: blocosSoMomentum, riscoPorEstrategia: { momentum: 0.03 }, ...base });
  const misto = simularPortfolioMisto({ blocosCalendario: blocosMisto, riscoPorEstrategia: { momentum: 0.03, pares: 0.05 }, ...base });

  assert.ok(
    misto.pRuina < soMomentum.pRuina,
    `misturar pares (ruina ${misto.pRuina}) deveria quebrar menos que só momentum (ruina ${soMomentum.pRuina})`,
  );
});

test('correção de liquidação de pares dispara e substitui o retorno por -1/alavancagem quando a excursão excede a distância', () => {
  const blocoDias = 1;
  // um unico trade de pares com excursao severa (80%) -- a qualquer alavancagem >1.25x (dist=1/alav-mmr<0.8) ja liquida
  const trades = [{ entryTime: 0, exitTime: DIA_MS, r: 0.5, estrategia: 'pares', piorMovimento: 0.8 }];
  const blocosCalendario = construirBlocosMistos(trades, blocoDias);
  // sem correcao: capital 200 + 200*0.2*0.5 = 240 (fica acima do piso). com correcao
  // (alavancagem implicita 0.2*10=2x, dist=1/2-0.01=0.49 < 0.8 -> liquida a -1/2):
  // capital 200 + 200*0.2*(-0.5) = 180 (fica ABAIXO do piso, 190) -- so a versao
  // corrigida deveria acusar ruina.
  const base = { capitalInicial: 200, alvo: 100_000_000, pisoRuina: 190, horizonteMeses: 1, caminhos: 1, semente: 1 };

  const comLiquidacao = simularPortfolioMisto({
    blocosCalendario, riscoPorEstrategia: { pares: 0.2 },
    correcaoLiquidacaoPares: { paresSimultaneosMedio: 10 }, ...base,
  });
  const semLiquidacao = simularPortfolioMisto({
    blocosCalendario, riscoPorEstrategia: { pares: 0.2 }, ...base,
  });
  assert.equal(comLiquidacao.pRuina, 1, 'com a correcao, o trade deveria liquidar');
  assert.equal(semLiquidacao.pRuina, 0, 'sem a correcao, o retorno cru positivo nao deveria acusar ruina');
});

test('simularPortfolioMisto: probabilidades formam uma partição válida', () => {
  const momentum = poolMomentum(20, 15, 21);
  const blocosCalendario = construirBlocosMistos(momentum, 21);
  const r = simularPortfolioMisto({
    blocosCalendario, capitalInicial: 200, alvo: 2234, pisoRuina: 40,
    riscoPorEstrategia: { momentum: 0.01 }, horizonteMeses: 24, caminhos: 1000, semente: 1,
  });
  assert.ok(Math.abs(r.pSucesso + r.pRuina + r.pArrastando - 1) < 1e-9);
});

test('estratégia sem entrada em riscoPorEstrategia é ignorada (risco 0, nunca opera)', () => {
  const momentum = poolMomentum(20, 15, 21);
  const pares = poolParesDescorrelacionado(20, 15, 21);
  const blocosCalendario = construirBlocosMistos([...momentum, ...pares], 21);
  const a = simularPortfolioMisto({
    blocosCalendario, capitalInicial: 200, alvo: 2234, pisoRuina: 40,
    riscoPorEstrategia: { momentum: 0.01 }, horizonteMeses: 24, caminhos: 1500, semente: 3,
  });
  const b = simularPortfolioMisto({
    blocosCalendario, capitalInicial: 200, alvo: 2234, pisoRuina: 40,
    riscoPorEstrategia: { momentum: 0.01, pares: 0 }, horizonteMeses: 24, caminhos: 1500, semente: 3,
  });
  assert.deepEqual(a, b);
});
