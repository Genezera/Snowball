/**
 * Testes do escorregamento medido no livro.
 *
 * Rodar: node --test src/funding/livro.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  escorregamentoDoLivro, escorregamentoDaPerna, escorregamentoDoPar,
  escorregamentoLimitado, ESCORREGAMENTO_TETO, type NivelLivro,
} from './livro.ts';

test('livro fundo no primeiro nível não escorrega nada', () => {
  const niveis: NivelLivro[] = [[100, 1000]]; // US$ 100k no topo
  assert.equal(escorregamentoDoLivro(niveis, 250), 0);
});

test('escorregamento é a distância do preço médio até o topo', () => {
  // 250 dólares: 100 dólares a 100, depois 150 a 110
  const niveis: NivelLivro[] = [[100, 1], [110, 100]];
  const s = escorregamentoDoLivro(niveis, 250);
  const qtd = 100 / 100 + 150 / 110;
  const medio = 250 / qtd;
  assert.ok(Math.abs(s - (medio - 100) / 100) < 1e-12);
  assert.ok(s > 0 && s < 0.1);
});

test('livro raso devolve Infinity — não cabe não é o mesmo que caro', () => {
  const niveis: NivelLivro[] = [[100, 1], [101, 1]]; // só ~201 dólares
  assert.equal(escorregamentoDoLivro(niveis, 250), Infinity);
});

test('livro vazio ou ausente devolve Infinity', () => {
  assert.equal(escorregamentoDoLivro([], 250), Infinity);
  assert.equal(escorregamentoDoLivro(undefined, 250), Infinity);
});

test('notional maior escorrega mais no mesmo livro', () => {
  const niveis: NivelLivro[] = [[100, 1], [101, 1], [102, 1], [103, 10]];
  const pequeno = escorregamentoDoLivro(niveis, 100);
  const grande = escorregamentoDoLivro(niveis, 500);
  assert.ok(grande > pequeno, 'ordem maior come mais fundo o livro');
});

test('níveis com preço ou tamanho inválido são ignorados sem quebrar', () => {
  const niveis: NivelLivro[] = [[100, 1000], [0, 5], [101, 0]];
  const s = escorregamentoDoLivro(niveis, 250);
  assert.ok(isFinite(s) && s >= 0);
});

test('a perna usa o pior lado do livro, não a média', () => {
  const livro = {
    asks: [[100, 1000]] as NivelLivro[],      // fundo, ~0
    bids: [[100, 1], [90, 1000]] as NivelLivro[], // raso no topo, escorrega
  };
  const s = escorregamentoDaPerna(livro, 250);
  const so_ask = escorregamentoDoLivro(livro.asks, 250);
  const so_bid = escorregamentoDoLivro(livro.bids, 250);
  assert.equal(s, Math.max(so_ask, so_bid));
  assert.ok(s > so_ask, 'não pode diluir o lado ruim');
});

test('o par usa a pior das duas pernas — perna barata não salva perna cara', () => {
  const bom = { asks: [[100, 1000]] as NivelLivro[], bids: [[100, 1000]] as NivelLivro[] };
  const ruim = { asks: [[100, 1], [120, 1000]] as NivelLivro[], bids: [[100, 1000]] as NivelLivro[] };
  const s = escorregamentoDoPar(bom, ruim, 250);
  assert.equal(s, escorregamentoDaPerna(ruim, 250));
  assert.ok(s > escorregamentoDaPerna(bom, 250));
});

test('uma perna sem livro torna o par inviável, não médio', () => {
  const bom = { asks: [[100, 1000]] as NivelLivro[], bids: [[100, 1000]] as NivelLivro[] };
  assert.equal(escorregamentoDoPar(bom, undefined, 250), Infinity);
});

test('o teto mantém a conta bem-comportada sem ramo especial', () => {
  assert.equal(escorregamentoLimitado(Infinity), ESCORREGAMENTO_TETO);
  assert.equal(escorregamentoLimitado(NaN), ESCORREGAMENTO_TETO);
  assert.equal(escorregamentoLimitado(0.5), ESCORREGAMENTO_TETO);
  assert.equal(escorregamentoLimitado(-1), 0);
  assert.equal(escorregamentoLimitado(0.0005), 0.0005);
});

test('o caso HFT: a constante única subestimava o par mais avaliado pelo motor', () => {
  // Medido no livro real em 04/08/2026: HFT escorregou 0,0808% contra a
  // constante de 0,0700%. O motor avaliava HFT como "quase passando" dezenas
  // de vezes usando um custo menor que o real.
  const medidoHFT = 0.000808;
  const constante = 0.0007;
  assert.ok(medidoHFT > constante, 'HFT custa mais que a constante');

  // e o efeito no payback é direto: payback = 32 × taxaEfetiva / spread
  const taxa = 0.000525, spread = 0.00209;
  const paybackConstante = 32 * (taxa + constante) / spread;
  const paybackReal = 32 * (taxa + medidoHFT) / spread;
  assert.ok(paybackReal > paybackConstante, 'com o custo real, HFT fica MAIS exigente');
});

test('o caso SAMSUNG: a constante barrava um par que quase não escorrega', () => {
  // Medido: 0,0021% contra a constante de 0,0700% — 33× mais caro do que é.
  const medido = 0.000021, constante = 0.0007, taxa = 0.000525, spread = 0.00055;
  const paybackConstante = 32 * (taxa + constante) / spread;
  const paybackReal = 32 * (taxa + medido) / spread;
  assert.ok(paybackReal < paybackConstante / 2, 'o payback real é menos da metade');
});
