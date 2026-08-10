/**
 * Testes da captura de liquidação.
 *
 * Rodar: node --test src/funding/liquidacao.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  msAteProximaLiquidacao, fundingPorLiquidacao, alinhamento, avaliarCaptura,
  cruzarParaCaptura, type PernaCaptura,
} from './liquidacao.ts';

const H = 3_600_000;
/** 04/08/2026 12:00 UTC — meio-dia exato, para contas verificáveis à mão */
const MEIO_DIA = Date.UTC(2026, 7, 4, 12, 0, 0);

test('às 12h UTC, a próxima liquidação de 8h é às 16h — faltam 4h', () => {
  assert.equal(msAteProximaLiquidacao(MEIO_DIA, 8), 4 * H);
});

test('às 12h UTC, a próxima liquidação de 4h é às 12h+4h — o ciclo acabou de virar', () => {
  // 12h é múltiplo de 4, então o ciclo virou agora e o próximo é daqui a 4h
  assert.equal(msAteProximaLiquidacao(MEIO_DIA, 4), 4 * H);
});

test('faltando 5 minutos, devolve 5 minutos — é o caso que a estratégia quer', () => {
  const cincoAntes = Date.UTC(2026, 7, 4, 15, 55, 0);
  assert.equal(msAteProximaLiquidacao(cincoAntes, 8), 5 * 60_000);
});

test('nunca devolve zero nem negativo, em qualquer instante do dia', () => {
  for (const intervalo of [1, 4, 8]) {
    for (let m = 0; m < 1440; m += 7) {
      const t = Date.UTC(2026, 7, 4, 0, m, 0);
      const r = msAteProximaLiquidacao(t, intervalo);
      assert.ok(r > 0 && r <= intervalo * H, `intervalo ${intervalo}h, minuto ${m}: ${r}`);
    }
  }
});

test('um par de 8h paga o valor normalizado inteiro por liquidação', () => {
  assert.equal(fundingPorLiquidacao(0.01, 8), 0.01);
});

test('um par de 4h paga METADE por liquidação — e o dobro de vezes', () => {
  assert.equal(fundingPorLiquidacao(0.01, 4), 0.005);
});

test('um par de 1h paga um oitavo — o erro que faria ele parecer 8x melhor', () => {
  assert.equal(fundingPorLiquidacao(0.01, 1), 0.00125);
});

test('intervalos iguais são alinhados; diferentes não são elegíveis', () => {
  assert.equal(alinhamento(8, 8).alinhado, true);
  assert.equal(alinhamento(4, 4).alinhado, true);
  assert.equal(alinhamento(1, 8).alinhado, false);
  assert.equal(alinhamento(4, 8).alinhado, false);
});

test('o caso HOME real: 1,340% por 8h num par de 4h ainda cobre o custo 2x', () => {
  // Observado em 04/08/2026, depois da correção de intervalo.
  const c = avaliarCaptura({
    spread8h: 0.01340, intervaloHoras: 4,
    taxaEfetiva: 0.000525 + 0.0003, margem: 1.5,
  });
  assert.ok(Math.abs(c.pagamentoPorLiquidacao - 0.0067) < 1e-9, 'metade do normalizado');
  assert.ok(Math.abs(c.custoIdaEVolta - 0.0033) < 1e-9);
  assert.ok(c.cobertura > 2 && c.cobertura < 2.1);
  assert.equal(c.vale, true);
});

test('o mesmo HOME sob a conta ANTIGA seria barrado — é a regressão que importa', () => {
  // A conta antiga exigia vida ≥ payback × 1,5, com payback contínuo:
  //   payback = 32 × taxa / spread = 32 × 0,000825 / 0,0134 = 1,97h
  //   exigia 2,95h de vida provada; HOME tinha vivido 1,3h → BARRADO
  const paybackContinuo = 32 * (0.000525 + 0.0003) / 0.01340;
  const exigidoAntigo = paybackContinuo * 1.5;
  const vidaQueTinha = 1.3;
  assert.ok(vidaQueTinha < exigidoAntigo, 'a conta antiga barrava');

  // a conta nova só pergunta se o pagamento cobre o custo
  const c = avaliarCaptura({
    spread8h: 0.01340, intervaloHoras: 4, taxaEfetiva: 0.000825, margem: 1.5,
  });
  assert.equal(c.vale, true, 'a conta de captura aprova');
});

test('spread que não cobre o custo é recusado, por mais alto que pareça', () => {
  // 0,5% por 8h parece muito, mas num par de 1h a liquidação paga 0,0625%
  const c = avaliarCaptura({
    spread8h: 0.005, intervaloHoras: 1, taxaEfetiva: 0.000825, margem: 1.5,
  });
  assert.ok(c.pagamentoPorLiquidacao < c.custoIdaEVolta);
  assert.equal(c.vale, false);
});

test('a margem é respeitada — cobrir o custo exato não basta', () => {
  const exato = avaliarCaptura({
    spread8h: 0.0033, intervaloHoras: 8, taxaEfetiva: 0.000825, margem: 1.5,
  });
  assert.ok(Math.abs(exato.cobertura - 1) < 1e-9);
  assert.equal(exato.vale, false, 'cobertura 1,0 não passa numa margem de 1,5');
});

test('escorregamento pior encolhe a cobertura — o custo entra 4 vezes', () => {
  const base = { spread8h: 0.01, intervaloHoras: 8, margem: 1.5 };
  const liquido = avaliarCaptura({ ...base, taxaEfetiva: 0.000525 + 0.0003 });
  const fino = avaliarCaptura({ ...base, taxaEfetiva: 0.000525 + 0.003 });
  assert.ok(fino.cobertura < liquido.cobertura / 2, 'par fino perde mais da metade da cobertura');
  assert.equal(fino.vale, false);
});

test('o líquido é o que sobra, e é independente do notional', () => {
  const c = avaliarCaptura({
    spread8h: 0.0134, intervaloHoras: 4, taxaEfetiva: 0.000825, margem: 1.5,
  });
  assert.ok(Math.abs(c.liquidoPorLiquidacao - (0.0067 - 0.0033)) < 1e-9);
  // em dólares: só multiplicar. Nenhum termo da conta acima viu o notional.
  assert.ok(Math.abs(c.liquidoPorLiquidacao * 250 - 0.85) < 0.01);
});

// ── cruzamento para captura ────────────────────────────────────────────────

const AGORA = Date.UTC(2026, 7, 4, 12, 0, 0);
const perna = (o: Partial<PernaCaptura>): PernaCaptura => ({
  symbol: 'X/USDT:USDT', exchange: 'a', funding: 0.001, intervaloHoras: 8, volume24h: 5e6, ...o,
});

test('cruza duas pernas alinhadas e calcula o pagamento da liquidação', () => {
  const out = cruzarParaCaptura([
    perna({ exchange: 'alta', funding: 0.003 }),
    perna({ exchange: 'baixa', funding: 0.001 }),
  ], { agora: AGORA, volumeMinimo: 1e6 });
  assert.equal(out.length, 1);
  assert.equal(out[0].exchangeShort, 'alta');
  assert.equal(out[0].exchangeLong, 'baixa');
  assert.ok(Math.abs(out[0].spread8h - 0.002) < 1e-12);
  assert.ok(Math.abs(out[0].pagamentoPorLiquidacao - 0.002) < 1e-12, '8h paga o valor inteiro');
});

test('perna ilíquida é removida ANTES de escolher os extremos', () => {
  // A ilíquida tem o funding mais alto. A regra antiga escolhia ela como
  // extremo e depois descartava o ativo inteiro pelo filtro de volume —
  // perdendo o par líquido bom que existia dentro do mesmo símbolo.
  const out = cruzarParaCaptura([
    perna({ exchange: 'fantasma', funding: 0.010, volume24h: 100 }),
    perna({ exchange: 'alta', funding: 0.003 }),
    perna({ exchange: 'baixa', funding: 0.001 }),
  ], { agora: AGORA, volumeMinimo: 1e6 });
  assert.equal(out.length, 1, 'o par líquido sobrevive');
  assert.equal(out[0].exchangeShort, 'alta');
  assert.ok(Math.abs(out[0].spread8h - 0.002) < 1e-12);
});

test('pernas de intervalos diferentes viram grupos separados, nunca se cruzam', () => {
  const out = cruzarParaCaptura([
    perna({ exchange: 'a8', funding: 0.003, intervaloHoras: 8 }),
    perna({ exchange: 'b8', funding: 0.001, intervaloHoras: 8 }),
    perna({ exchange: 'a4', funding: 0.002, intervaloHoras: 4 }),
    perna({ exchange: 'b4', funding: 0.0005, intervaloHoras: 4 }),
  ], { agora: AGORA, volumeMinimo: 1e6 });
  assert.equal(out.length, 2);
  for (const c of out) {
    const exs = [c.exchangeShort, c.exchangeLong];
    const sufixo = c.intervaloHoras === 8 ? '8' : '4';
    for (const e of exs) assert.ok(e.endsWith(sufixo), `${e} não pertence ao grupo de ${c.intervaloHoras}h`);
  }
});

test('um ativo com um só listing não gera candidato', () => {
  const out = cruzarParaCaptura([perna({ exchange: 'unica' })], { agora: AGORA, volumeMinimo: 1e6 });
  assert.equal(out.length, 0);
});

test('a próxima liquidação é absoluta e está no futuro', () => {
  const out = cruzarParaCaptura([
    perna({ exchange: 'alta', funding: 0.003 }),
    perna({ exchange: 'baixa', funding: 0.001 }),
  ], { agora: AGORA, volumeMinimo: 1e6 });
  assert.ok(out[0].proximaLiquidacaoEm > AGORA);
  assert.equal(out[0].proximaLiquidacaoEm, AGORA + 4 * 3_600_000, 'às 12h UTC, a de 8h é às 16h');
});

test('ordena por pagamento por liquidação, não pelo spread normalizado', () => {
  const out = cruzarParaCaptura([
    // 8h: spread 0,002 → paga 0,002 por liquidação
    perna({ symbol: 'OITO/USDT:USDT', exchange: 'a', funding: 0.003, intervaloHoras: 8 }),
    perna({ symbol: 'OITO/USDT:USDT', exchange: 'b', funding: 0.001, intervaloHoras: 8 }),
    // 1h: funding cru 0,0005 vira f8h 0,004 (spread normalizado MAIOR),
    // mas cada liquidação paga só 0,0005 — tem que ficar atrás
    perna({ symbol: 'UMA/USDT:USDT', exchange: 'a', funding: 0.0005, intervaloHoras: 1 }),
    perna({ symbol: 'UMA/USDT:USDT', exchange: 'b', funding: 0, intervaloHoras: 1 }),
  ], { agora: AGORA, volumeMinimo: 1e6 });
  assert.equal(out.length, 2);
  assert.equal(out[0].symbol, 'OITO/USDT:USDT', 'quem paga mais por liquidação vem primeiro');
  assert.ok(out[1].spread8h > out[0].spread8h, 'e o de trás tinha spread normalizado maior');
});
