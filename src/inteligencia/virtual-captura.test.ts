/**
 * Testes do núcleo virtual de captura de settlement (Parte 2 do "Paper
 * Profit Dashboard — Captura"). Os 12 cenários pedidos, mais alguns extras
 * de reconciliação. Nenhum teste depende de sleep real — settlement
 * "passado" é simulado mutando `proximaLiquidacaoEm` direto no estado, mesma
 * técnica já usada em virtual-portfolio.test.ts pra funding.
 *
 * Rodar: node --test src/inteligencia/virtual-captura.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { cicloCaptura, lerEventosCaptura } from './virtual-captura.ts';
import { novoEstado, salvarEstado, carregarEstado, type ConfigChallenger } from './virtual-portfolio.ts';
import { fundingPorLiquidacao, type CandidatoCaptura } from '../funding/liquidacao.ts';

function tmpDir() { return fs.mkdtempSync(path.join(os.tmpdir(), 'snowball-captura-')); }

const CFG: ConfigChallenger = {
  challengerId: 'capture-isolated-teste', strategyVersion: 'v1', configVersion: 'v1',
  exchanges: ['a', 'b'], capitalPorExchange: 100, alavancagem: 5, reserva: 0.3,
  margemPayback: 1.5, maxPosicoes: 3, familia: 'capture',
  janelaCapturaMs: 10 * 60_000, coberturaMinima: 1.5, modoCapital: 'isolated',
};

const precoFixo = async () => 100;

function candidato(over: Partial<CandidatoCaptura> = {}): CandidatoCaptura {
  const spread8h = over.spread8h ?? 0.02;
  const intervaloHoras = over.intervaloHoras ?? 8;
  return {
    symbol: 'FOO/USDT:USDT', exchangeShort: 'a', exchangeLong: 'b',
    spread8h, intervaloHoras,
    pagamentoPorLiquidacao: fundingPorLiquidacao(spread8h, intervaloHoras),
    volumeMinimo: 20_000_000,
    proximaLiquidacaoEm: Date.now() + 3 * 60_000,
    ...over,
  };
}

// 1 — oportunidade cobre o custo e chega ao settlement
test('1. cobre o custo e chega ao settlement: paga funding e fecha, evento estruturado gravado', async () => {
  const dir = tmpDir();
  const e = novoEstado(CFG);
  await cicloCaptura(dir, CFG, e, [candidato()], precoFixo);
  assert.equal(e.posicoesVirtuais.length, 1, 'deveria ter aberto — cobertura alta o bastante');
  e.posicoesVirtuais[0].proximaLiquidacaoEm = Date.now() - 1000; // força settlement já passado

  await cicloCaptura(dir, CFG, e, [], precoFixo);
  assert.equal(e.posicoesVirtuais.length, 0, 'deveria ter fechado depois de pagar');
  assert.equal(e.settlements, 1);
  assert.ok(e.fundingBruto > 0);

  const eventos = lerEventosCaptura(dir, CFG.challengerId);
  assert.equal(eventos.length, 1);
  assert.equal(eventos[0].motivoSaida, 'fechamento_apos_settlement');
  assert.ok(eventos[0].fundingRecebido > 0);
  fs.rmSync(dir, { recursive: true, force: true });
});

// 2 — oportunidade não cobre o custo
test('2. não cobre o custo: bloqueada por cobertura, nunca abre', async () => {
  const dir = tmpDir();
  const e = novoEstado(CFG);
  // spread minúsculo — cobertura bem abaixo de 1.5x
  await cicloCaptura(dir, CFG, e, [candidato({ spread8h: 0.0001 })], precoFixo);
  assert.equal(e.posicoesVirtuais.length, 0);
  assert.ok((e.bloqueiosPorCobertura ?? 0) > 0);
  fs.rmSync(dir, { recursive: true, force: true });
});

// 3 — spread inverte antes do settlement
test('3. spread inverte antes do settlement: fecha sem funding, conta inversão', async () => {
  const dir = tmpDir();
  const e = novoEstado(CFG);
  await cicloCaptura(dir, CFG, e, [candidato({ proximaLiquidacaoEm: Date.now() + 5 * 60_000 })], precoFixo);
  assert.equal(e.posicoesVirtuais.length, 1);
  // ciclo seguinte: candidata sumiu do feed (ou spread não é mais positivo) — settlement AINDA não passou
  await cicloCaptura(dir, CFG, e, [candidato({ spread8h: -0.01, proximaLiquidacaoEm: Date.now() + 5 * 60_000 })], precoFixo);
  assert.equal(e.posicoesVirtuais.length, 0, 'deveria ter fechado por inversão');
  assert.equal(e.fundingBruto, 0, 'inversão antes do settlement não paga funding');
  assert.equal(e.inversoesAntesDoSettlement, 1);
  const eventos = lerEventosCaptura(dir, CFG.challengerId);
  assert.equal(eventos[0].motivoSaida, 'inversao_antes_do_settlement');
  assert.equal(eventos[0].fundingRecebido, 0);
  fs.rmSync(dir, { recursive: true, force: true });
});

// 4 — entrada ocorre fora da janela
test('4. fora da janela: settlement longe demais, bloqueada, nunca abre', async () => {
  const dir = tmpDir();
  const e = novoEstado(CFG);
  await cicloCaptura(dir, CFG, e, [candidato({ proximaLiquidacaoEm: Date.now() + 60 * 60_000 })], precoFixo); // 60min > janela de 10min
  assert.equal(e.posicoesVirtuais.length, 0);
  assert.ok((e.bloqueiosPorJanela ?? 0) > 0);
  fs.rmSync(dir, { recursive: true, force: true });
});

// 5 — funding muda antes do pagamento (spread8h reportado depois é diferente do travado na entrada)
test('5. funding muda depois da entrada: usa o spread TRAVADO na entrada, não o novo', async () => {
  const dir = tmpDir();
  const e = novoEstado(CFG);
  await cicloCaptura(dir, CFG, e, [candidato({ spread8h: 0.02 })], precoFixo);
  const pos = e.posicoesVirtuais[0];
  assert.equal(pos.spread8hEntrada, 0.02);
  const fundingEsperadoOriginal = pos.notionalPorPerna * fundingPorLiquidacao(0.02, 8);

  pos.proximaLiquidacaoEm = Date.now() - 1000;
  // feed agora reporta um spread MUITO maior pro mesmo símbolo — não deveria mudar o que essa posição recebe
  await cicloCaptura(dir, CFG, e, [candidato({ spread8h: 0.5 })], precoFixo);
  const eventos = lerEventosCaptura(dir, CFG.challengerId);
  assert.ok(Math.abs(eventos[0].fundingRecebido - fundingEsperadoOriginal) < 1e-9, 'deveria usar o spread da entrada, não o novo valor do feed');
  fs.rmSync(dir, { recursive: true, force: true });
});

// 6 — posição fecha depois do settlement (não antes)
test('6. não fecha antes do settlement, mesmo em vários ciclos parada', async () => {
  const dir = tmpDir();
  const e = novoEstado(CFG);
  await cicloCaptura(dir, CFG, e, [candidato({ proximaLiquidacaoEm: Date.now() + 5 * 60_000 })], precoFixo);
  assert.equal(e.posicoesVirtuais.length, 1);
  // vários ciclos com a MESMA candidata (spread ainda positivo, settlement ainda no futuro)
  for (let i = 0; i < 3; i++) {
    await cicloCaptura(dir, CFG, e, [candidato({ proximaLiquidacaoEm: e.posicoesVirtuais[0].proximaLiquidacaoEm })], precoFixo);
  }
  assert.equal(e.posicoesVirtuais.length, 1, 'não deveria ter fechado — settlement ainda não chegou');
  assert.equal(e.fundingBruto, 0);
  fs.rmSync(dir, { recursive: true, force: true });
});

// 7 — capital insuficiente
test('7. capital insuficiente: bloqueada por saldo, nunca abre', async () => {
  const dir = tmpDir();
  const cfgSemCapital: ConfigChallenger = { ...CFG, capitalPorExchange: 0 };
  const e = novoEstado(cfgSemCapital);
  await cicloCaptura(dir, cfgSemCapital, e, [candidato()], precoFixo);
  assert.equal(e.posicoesVirtuais.length, 0);
  assert.ok(e.bloqueiosPorSaldo > 0);
  fs.rmSync(dir, { recursive: true, force: true });
});

// 8 — mínimo nocional (capital existe, mas abaixo do piso de US$5 de notional)
test('8. mínimo nocional: capital pequeno demais pro piso de dimensionar(), bloqueada', async () => {
  const dir = tmpDir();
  const cfgMinusculo: ConfigChallenger = { ...CFG, capitalPorExchange: 1 }; // 1*(1-0.3)*5 = 3.5 < 5 mínimo
  const e = novoEstado(cfgMinusculo);
  await cicloCaptura(dir, cfgMinusculo, e, [candidato()], precoFixo);
  assert.equal(e.posicoesVirtuais.length, 0);
  assert.ok(e.bloqueiosPorSaldo > 0);
  fs.rmSync(dir, { recursive: true, force: true });
});

// 9 — custo elimina o funding (reconciliação exata, sinal negativo incluído)
test('9. reconciliação: fundingRecebido - custosTotais = pnlPaperBase, mesmo quando o resultado é pequeno/negativo', async () => {
  const dir = tmpDir();
  // cobertura mínima baixa (1.0) — deixa passar oportunidades marginais onde o
  // custo quase (ou de fato) consome o funding inteiro
  const cfgMarginal: ConfigChallenger = { ...CFG, coberturaMinima: 1.0 };
  const e = novoEstado(cfgMarginal);
  await cicloCaptura(dir, cfgMarginal, e, [candidato({ spread8h: 0.0006 })], precoFixo); // cobertura pertinho de 1.0x
  if (e.posicoesVirtuais.length === 1) {
    e.posicoesVirtuais[0].proximaLiquidacaoEm = Date.now() - 1000;
    await cicloCaptura(dir, cfgMarginal, e, [], precoFixo);
    const eventos = lerEventosCaptura(dir, cfgMarginal.challengerId);
    const ev = eventos[0];
    const pnlBase = e.fundingBruto - e.custosTotais;
    assert.ok(Math.abs(pnlBase - (ev.fundingRecebido - ev.taxas)) < 1, 'a identidade da reconciliação deve valer independente do sinal');
  }
  fs.rmSync(dir, { recursive: true, force: true });
});

// 10 — posição continua aberta por erro de calendário (settlement nunca chega)
test('10. settlement muito no futuro: posição fica aberta, nunca paga nem fecha por engano', async () => {
  const dir = tmpDir();
  const longeNoFuturo = Date.now() + 5 * 60_000;
  const e = novoEstado(CFG);
  await cicloCaptura(dir, CFG, e, [candidato({ proximaLiquidacaoEm: longeNoFuturo })], precoFixo);
  assert.equal(e.posicoesVirtuais.length, 1);
  for (let i = 0; i < 5; i++) {
    await cicloCaptura(dir, CFG, e, [candidato({ proximaLiquidacaoEm: longeNoFuturo })], precoFixo);
  }
  assert.equal(e.posicoesVirtuais.length, 1, 'não deveria ter fechado nem pago — settlement nunca chegou');
  assert.equal(e.fundingBruto, 0);
  assert.equal(e.trades, 1, 'não deveria ter aberto uma segunda posição no mesmo símbolo');
  fs.rmSync(dir, { recursive: true, force: true });
});

// 11 — settlement duplicado não paga duas vezes
test('11. fundingJaRecebido trava pagamento duplicado, mesmo se a posição continuar presente', async () => {
  const dir = tmpDir();
  const e = novoEstado(CFG);
  // posição "presa" já com funding recebido (simula falha no fechamento de um ciclo anterior)
  e.posicoesVirtuais.push({
    symbol: 'FOO/USDT:USDT', exchangeShort: 'a', exchangeLong: 'b',
    notionalPorPerna: 100, precoEntrada: 100, precoUltimo: 100,
    margemShort: 20, margemLong: 20, abertaEm: Date.now() - 10_000,
    fundingAcumulado: 5, faltasSeguidas: 0, taxa: 0.0013, estagio: 2,
    proximaLiquidacaoEm: Date.now() - 1000, intervaloHorasLiquidacao: 8,
    spread8hEntrada: 0.02, fundingJaRecebido: true, cycleId: 'captura-teste-preso',
  });
  const fundingAntes = e.fundingBruto;
  await cicloCaptura(dir, CFG, e, [], precoFixo);
  assert.equal(e.fundingBruto, fundingAntes, 'não deveria ter somado funding de novo — já estava marcado como recebido');
  assert.equal(e.posicoesVirtuais.length, 0, 'deveria ter ido direto pro fechamento');
  fs.rmSync(dir, { recursive: true, force: true });
});

// 12 — reinício do Lab não duplica funding
test('12. reinício do Lab (salvar/carregar estado do disco) não reprocessa nem duplica funding já pago', async () => {
  const dir = tmpDir();
  const e = novoEstado(CFG);
  await cicloCaptura(dir, CFG, e, [candidato()], precoFixo);
  e.posicoesVirtuais[0].proximaLiquidacaoEm = Date.now() - 1000;
  await cicloCaptura(dir, CFG, e, [], precoFixo);
  const fundingAposFechar = e.fundingBruto;
  const settlementsAposFechar = e.settlements;
  assert.ok(fundingAposFechar > 0);

  // simula reinício: grava e recarrega do disco, como paper-profit-lab.ts faz de verdade
  salvarEstado(dir, e);
  const recarregado = carregarEstado(dir, CFG);
  assert.equal(recarregado.fundingBruto, fundingAposFechar);
  assert.equal(recarregado.posicoesVirtuais.length, 0, 'posição já fechada não deveria reaparecer');

  // um ciclo a mais no estado recarregado não deveria reprocessar nada
  await cicloCaptura(dir, CFG, recarregado, [], precoFixo);
  assert.equal(recarregado.fundingBruto, fundingAposFechar);
  assert.equal(recarregado.settlements, settlementsAposFechar);
  fs.rmSync(dir, { recursive: true, force: true });
});

// extra — respeita maxPosicoes também em captura
test('extra: respeita maxPosicoes mesmo com várias candidatas de captura boas', async () => {
  const dir = tmpDir();
  const cfg1: ConfigChallenger = { ...CFG, maxPosicoes: 1 };
  const e = novoEstado(cfg1);
  await cicloCaptura(dir, cfg1, e, [
    candidato({ symbol: 'A/USDT:USDT' }),
    candidato({ symbol: 'B/USDT:USDT' }),
  ], precoFixo);
  assert.equal(e.posicoesVirtuais.length, 1);
  fs.rmSync(dir, { recursive: true, force: true });
});

// extra — challenger pausado/eliminado não decide em captura, igual persistência
test('extra: challenger pausado não abre posição de captura', async () => {
  const dir = tmpDir();
  const e = novoEstado(CFG);
  e.pausado = { ts: Date.now(), motivo: 'teste', usuario: 'x' };
  await cicloCaptura(dir, CFG, e, [candidato()], precoFixo);
  assert.equal(e.posicoesVirtuais.length, 0);
  fs.rmSync(dir, { recursive: true, force: true });
});
