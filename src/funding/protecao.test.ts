/**
 * Testes da proteção contra ruína.
 *
 * Um módulo cuja única função é evitar perda total não pode ser verificado
 * olhando o log em produção — se ele estiver errado, a evidência chega junto
 * com o prejuízo. Por isso os casos aqui são os cenários que ele existe para
 * cobrir, não o caminho feliz.
 *
 * Rodar: node --test src/funding/protecao.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  distanciaLiquidacao, avaliarRisco, quantoTransferir, mmrDe,
  pisoAtual, atualizarPico, verificarPiso, alavancagemMaxima,
  LIMIARES_PADRAO, MMR_ALT, MMR_MAJOR,
} from './protecao.ts';

// ── distância de liquidação ────────────────────────────────────────────────

test('a 5x a distância inicial é 1/L menos o mmr', () => {
  // capital 100 → margem 50/perna, notional 250/perna
  const d = distanciaLiquidacao(50, 250, MMR_ALT);
  assert.equal(Number(d.toFixed(4)), 0.19);   // 20% − 1%
});

test('a 3x sobra muito mais fôlego que a 5x', () => {
  const d3 = distanciaLiquidacao(50, 150, MMR_ALT);
  const d5 = distanciaLiquidacao(50, 250, MMR_ALT);
  assert.ok(d3 > d5);
  assert.equal(Number(d3.toFixed(4)), 0.3233);
});

test('ignorar o mmr superestima o fôlego — o erro perigoso', () => {
  const comMmr = distanciaLiquidacao(50, 250, MMR_ALT);
  const semMmr = distanciaLiquidacao(50, 250, 0);
  assert.ok(semMmr > comMmr, 'sem mmr a conta mente para melhor');
});

test('majors têm mmr menor que alts', () => {
  assert.equal(mmrDe('BTC/USDT:USDT'), MMR_MAJOR);
  assert.equal(mmrDe('KAITO/USDT:USDT'), MMR_ALT);
});

// ── avaliação de risco ─────────────────────────────────────────────────────

test('sem movimento de preço as duas pernas estão iguais e OK', () => {
  const r = avaliarRisco(50, 50, 250, 0, MMR_ALT);
  assert.equal(r.nivel, 'ok');
  assert.equal(r.margemShort, 50);
  assert.equal(r.margemLong, 50);
});

test('preço subindo aperta a perna VENDIDA, não a comprada', () => {
  const r = avaliarRisco(50, 50, 250, 0.05, MMR_ALT);   // +5%
  assert.equal(r.pernaEmRisco, 'short');
  assert.ok(r.margemShort < 50);
  assert.ok(r.margemLong > 50);
});

test('preço caindo aperta a perna COMPRADA', () => {
  const r = avaliarRisco(50, 50, 250, -0.05, MMR_ALT);
  assert.equal(r.pernaEmRisco, 'long');
});

test('o patrimônio total não muda com o preço — só a distribuição', () => {
  const r = avaliarRisco(50, 50, 250, 0.08, MMR_ALT);
  assert.equal(Number((r.margemShort + r.margemLong).toFixed(6)), 100);
});

test('alerta dispara antes do crítico, e crítico antes da liquidação', () => {
  // A 5x com 250 de notional e 50 de margem, a distância inicial é 19%. Os
  // limiares se traduzem em movimento de preço assim:
  //   alerta  (d ≤ 12%) →  margem ≤ 32,5  →  movimento ≥ 7%
  //   crítico (d ≤ 6%)  →  margem ≤ 17,5  →  movimento ≥ 13%
  //   liquida (d = 0)   →  margem = 2,5   →  movimento = 19%
  // Escrevi 5% e 10% na primeira versão e os testes reprovaram — a intuição
  // estava adiantando o alerta em dois pontos.
  const ok = avaliarRisco(50, 50, 250, 0.02, MMR_ALT);
  const alerta = avaliarRisco(50, 50, 250, 0.08, MMR_ALT);
  const critico = avaliarRisco(50, 50, 250, 0.14, MMR_ALT);

  assert.equal(ok.nivel, 'ok');
  assert.equal(alerta.nivel, 'alerta');
  assert.equal(critico.nivel, 'critico');
  assert.ok(critico.distanciaMinima > 0, 'crítico ainda não é liquidado — há tempo de agir');
});

test('a ordem dos níveis nunca inverte conforme o movimento cresce', () => {
  let anterior = Infinity;
  for (let v = 0; v <= 0.18; v += 0.01) {
    const r = avaliarRisco(50, 50, 250, v, MMR_ALT);
    assert.ok(r.distanciaMinima <= anterior, `distância subiu em v=${v}`);
    anterior = r.distanciaMinima;
  }
});

// ── transferência ──────────────────────────────────────────────────────────

test('transferir iguala as margens, que é a distância máxima possível', () => {
  const r = avaliarRisco(50, 50, 250, 0.08, MMR_ALT);
  const t = quantoTransferir(r.margemShort, r.margemLong);
  const novaShort = r.margemShort + (t.de === 'long' ? t.valor : -t.valor);
  const novaLong = r.margemLong + (t.de === 'long' ? -t.valor : t.valor);
  assert.equal(Number(novaShort.toFixed(6)), Number(novaLong.toFixed(6)));
});

test('transferir vem da perna folgada para a apertada', () => {
  const r = avaliarRisco(50, 50, 250, 0.08, MMR_ALT);   // short aperta
  const t = quantoTransferir(r.margemShort, r.margemLong);
  assert.equal(t.de, 'long', 'o dinheiro sai da comprada, que está sobrando');
});

test('depois de transferir, o nível volta para ok', () => {
  const r = avaliarRisco(50, 50, 250, 0.08, MMR_ALT);
  assert.notEqual(r.nivel, 'ok');
  const t = quantoTransferir(r.margemShort, r.margemLong);
  const depois = avaliarRisco(
    r.margemShort + (t.de === 'long' ? t.valor : -t.valor),
    r.margemLong + (t.de === 'long' ? -t.valor : t.valor),
    250, 0, MMR_ALT,
  );
  assert.equal(depois.nivel, 'ok');
});

// ── piso de capital ────────────────────────────────────────────────────────

test('o piso começa no absoluto quando não houve lucro', () => {
  const e = { pico: 100, pisoAbsoluto: 80, fracaoPico: 0.85 };
  assert.equal(pisoAtual(e), 85);   // 100 × 0,85 já passou do absoluto
});

test('o piso móvel sobe com o pico e NUNCA desce', () => {
  let e = { pico: 100, pisoAbsoluto: 80, fracaoPico: 0.85 };
  e = atualizarPico(e, 200);
  assert.equal(e.pico, 200);
  assert.equal(pisoAtual(e), 170);

  // capital cai — o pico e o piso continuam onde estavam
  e = atualizarPico(e, 150);
  assert.equal(e.pico, 200);
  assert.equal(pisoAtual(e), 170);
});

test('o piso absoluto prevalece quando o pico ainda é baixo', () => {
  const e = { pico: 100, pisoAbsoluto: 95, fracaoPico: 0.85 };
  assert.equal(pisoAtual(e), 95);
});

test('parar dispara ao tocar o piso, não só ao ultrapassar', () => {
  const e = { pico: 200, pisoAbsoluto: 80, fracaoPico: 0.85 };
  assert.equal(verificarPiso(e, 170.01).parar, false);
  assert.equal(verificarPiso(e, 170).parar, true);
  assert.equal(verificarPiso(e, 169).parar, true);
});

test('a catraca trava ganho sem limitar ganho', () => {
  // subir de 100 para 500 não impede continuar subindo, mas o piso acompanha
  let e = { pico: 100, pisoAbsoluto: 80, fracaoPico: 0.85 };
  for (const c of [150, 200, 350, 500]) e = atualizarPico(e, c);
  assert.equal(pisoAtual(e), 425);
  assert.equal(verificarPiso(e, 600).parar, false, 'nada impede continuar subindo');
});

// ── alavancagem sustentável ────────────────────────────────────────────────

test('5x nasce dentro do alerta; o limite fica acima disso', () => {
  const max = alavancagemMaxima(LIMIARES_PADRAO, MMR_ALT);
  assert.ok(max > 5, `5x deve ser sustentável, limite calculado ${max.toFixed(2)}x`);
  assert.ok(max < 10, 'e 10x não deve ser');
  assert.equal(Number(max.toFixed(2)), 7.69);
});

test('uma posição nasce fora do alerta na alavancagem máxima', () => {
  const L = alavancagemMaxima(LIMIARES_PADRAO, MMR_ALT);
  const d = distanciaLiquidacao(50, 50 * L, MMR_ALT);
  assert.ok(d >= LIMIARES_PADRAO.alerta - 1e-9, 'nasce no limiar, não abaixo dele');
});
