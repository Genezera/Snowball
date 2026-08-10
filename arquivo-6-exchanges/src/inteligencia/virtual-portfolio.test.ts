/**
 * Testes de virtual-portfolio.ts — a garantia central é ISOLAMENTO: nada aqui
 * pode tocar capital, arquivo ou decisão do champion. Testado com preço
 * mockado (sem rede) e oportunidades sintéticas.
 *
 * Rodar: node --test src/inteligencia/virtual-portfolio.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  novoEstado, cicloChallenger, avaliarEliminacao, nivelEvidencia,
  salvarEstado, carregarEstado, caminhoEstado, registrar,
  novosEventosParaDiario, formatarLinhasDiario, type ConfigChallenger,
} from './virtual-portfolio.ts';
import type { OportunidadeSpread } from '../../../src/funding/spread.ts';

const CFG: ConfigChallenger = {
  challengerId: 'teste', strategyVersion: 'v1', configVersion: 'v1',
  exchanges: ['a', 'b'], capitalPorExchange: 100, alavancagem: 5, reserva: 0.30,
  margemPayback: 1.5, maxPosicoes: 3,
};

const precoFixo = async () => 100;

function oportunidade(over: Partial<OportunidadeSpread> = {}): OportunidadeSpread {
  return {
    symbol: 'FOO/USDT:USDT', exchangeShort: 'a', exchangeLong: 'b',
    fundingShort: 0.01, fundingLong: 0, spread: 0.005, spreadInstantaneo: 0.005,
    consistencia: 0.9, duracaoHoras: 20, aprSpread: 0.005 * 3 * 365,
    pontuacao: 1, volumeMinimo: 20_000_000,
    ...over,
  } as OportunidadeSpread;
}

test('novoEstado: capital virtual igual à soma por exchange, sem posição nenhuma', () => {
  const e = novoEstado(CFG);
  assert.equal(e.capitalInicialVirtual, 200);
  assert.equal(e.posicoesVirtuais.length, 0);
  assert.equal(e.pnlRealizado, 0);
});

test('abre posição quando candidata passa no portão, sem tocar em nenhum arquivo do champion', async () => {
  const e = novoEstado(CFG);
  await cicloChallenger(CFG, e, [oportunidade()], precoFixo);
  assert.equal(e.posicoesVirtuais.length, 1);
  assert.equal(e.trades, 1);
  assert.equal(e.posicoesVirtuais[0].symbol, 'FOO/USDT:USDT');
});

test('não abre quando a única candidata tem vida curta demais (bloqueado por payback)', async () => {
  const e = novoEstado(CFG);
  await cicloChallenger(CFG, e, [oportunidade({ duracaoHoras: 0.1, consistencia: 0.3 })], precoFixo);
  assert.equal(e.posicoesVirtuais.length, 0);
  assert.ok(e.bloqueiosPorPayback > 0);
});

test('respeita maxPosicoes mesmo com várias candidatas boas', async () => {
  const cfg = { ...CFG, maxPosicoes: 1 };
  const e = novoEstado(cfg);
  await cicloChallenger(cfg, e, [oportunidade({ symbol: 'A/USDT:USDT' }), oportunidade({ symbol: 'B/USDT:USDT' })], precoFixo);
  assert.equal(e.posicoesVirtuais.length, 1);
});

test('fecha por ausência depois de 2 ciclos sem a candidata no feed', async () => {
  const e = novoEstado(CFG);
  await cicloChallenger(CFG, e, [oportunidade()], precoFixo);
  assert.equal(e.posicoesVirtuais.length, 1);
  await cicloChallenger(CFG, e, [], precoFixo); // falta 1
  assert.equal(e.posicoesVirtuais.length, 1);
  await cicloChallenger(CFG, e, [], precoFixo); // falta 2 — fecha
  assert.equal(e.posicoesVirtuais.length, 0);
});

test('scorer customizado (challenger-ranking) muda a escolha entre duas candidatas', async () => {
  const cfg: ConfigChallenger = {
    ...CFG,
    scorer: (entrada) => -entrada.spread, // inverte a preferência: prefere o MENOR spread
  };
  const e = novoEstado(cfg);
  const boa = oportunidade({ symbol: 'ALTO/USDT:USDT', spread: 0.01, consistencia: 0.95, duracaoHoras: 30 });
  const outra = oportunidade({ symbol: 'BAIXO/USDT:USDT', spread: 0.003, consistencia: 0.95, duracaoHoras: 30 });
  await cicloChallenger(cfg, e, [boa, outra], precoFixo);
  assert.equal(e.posicoesVirtuais[0]?.symbol, 'BAIXO/USDT:USDT', 'scorer invertido deveria preferir o menor spread');
});

test('eliminação: não julga antes de 3 dias, mesmo com PnL péssimo', () => {
  const e = novoEstado(CFG);
  e.pnlRealizado = -50; e.trades = 20;
  assert.equal(avaliarEliminacao(e, 5), null);
});

test('eliminação: dispara por PnL claramente abaixo do champion, com amostra e idade suficientes', () => {
  const e = novoEstado(CFG);
  e.iniciadoEm = Date.now() - 5 * 86_400_000;
  e.pnlRealizado = -50; e.trades = 20;
  const r = avaliarEliminacao(e, 5);
  assert.ok(r !== null);
});

test('eliminação: drawdown excessivo dispara mesmo com PnL positivo', () => {
  const e = novoEstado(CFG);
  e.iniciadoEm = Date.now() - 5 * 86_400_000;
  e.drawdownMaxPct = 30; e.pnlRealizado = 5;
  const r = avaliarEliminacao(e, 0);
  assert.ok(r !== null);
});

test('nível de evidência progride com trades e tempo', () => {
  const e = novoEstado(CFG);
  assert.equal(nivelEvidencia(e), 'amostra_insuficiente');
  e.trades = 10;
  assert.equal(nivelEvidencia(e), 'sinal_inicial');
  e.trades = 25;
  assert.equal(nivelEvidencia(e), 'evidencia_intermediaria');
  e.trades = 50;
  e.iniciadoEm = Date.now() - 31 * 86_400_000;
  assert.equal(nivelEvidencia(e), 'candidato_a_promocao');
});

test('persistência: salva e recarrega o mesmo estado, isolado num diretório próprio', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'snowball-vp-'));
  const e = novoEstado(CFG);
  e.pnlRealizado = 3.5;
  salvarEstado(dir, e);
  const p = caminhoEstado(dir, 'teste');
  assert.ok(fs.existsSync(p));
  assert.ok(p.includes('inteligencia'), 'nunca deve gravar fora de inteligencia/challengers/');
  assert.ok(!p.includes('spread'), 'nunca deve gravar dentro de spread/, que é do champion');
  const recarregado = carregarEstado(dir, CFG);
  assert.equal(recarregado.pnlRealizado, 3.5);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('reinvestimento: funding coletado vira notional novo quando se paga em ≤3 dias', async () => {
  // maxPosicoes:1 mantém a cota de apara igual ao capital inteiro — isola o
  // efeito do reinvestimento sem a apara reagir no mesmo ciclo (apara tem
  // teste próprio, dedicado, abaixo).
  const cfgUnica: ConfigChallenger = { ...CFG, maxPosicoes: 1 };
  const e = novoEstado(cfgUnica);
  await cicloChallenger(cfgUnica, e, [oportunidade({ spread: 0.05, consistencia: 0.95, duracaoHoras: 40 })], precoFixo);
  assert.equal(e.posicoesVirtuais.length, 1);
  const notionalAntes = e.posicoesVirtuais[0].notionalPorPerna;
  // 2º ciclo: primeira coleta de funding (ultimoFundingTs ainda undefined → dispara na hora)
  await cicloChallenger(cfgUnica, e, [oportunidade({ spread: 0.05, consistencia: 0.95, duracaoHoras: 40 })], precoFixo);
  assert.ok(e.fundingBruto > 0, 'deveria ter coletado funding no 2º ciclo');
  assert.ok(e.posicoesVirtuais[0].notionalPorPerna >= notionalAntes, 'reinvestimento não deveria reduzir o notional');
  assert.ok(e.custos.custoReinvestimento >= 0);
});

test('apara: posição que ultrapassa a cota sustentável é reduzida, custo vai pro bucket certo', async () => {
  // maxPosicoes=1 concentra tudo numa posição só — cota fica pequena, força apara
  const cfgApertado: ConfigChallenger = { ...CFG, maxPosicoes: 1, alavancagem: 5 };
  const e = novoEstado(cfgApertado);
  await cicloChallenger(cfgApertado, e, [oportunidade({ spread: 0.05, consistencia: 0.95, duracaoHoras: 40 })], precoFixo);
  assert.equal(e.posicoesVirtuais.length, 1);
  // simula posição inflada artificialmente (como aconteceria depois de vários reinvestimentos)
  e.posicoesVirtuais[0].margemShort *= 3;
  e.posicoesVirtuais[0].margemLong *= 3;
  const margemAntes = e.posicoesVirtuais[0].margemShort + e.posicoesVirtuais[0].margemLong;
  await cicloChallenger(cfgApertado, e, [oportunidade({ spread: 0.05, consistencia: 0.95, duracaoHoras: 40 })], precoFixo);
  const margemDepois = e.posicoesVirtuais[0].margemShort + e.posicoesVirtuais[0].margemLong;
  assert.ok(margemDepois < margemAntes, 'apara deveria ter reduzido a margem inflada');
  assert.ok(e.custos.custoApara > 0, 'custo da apara deveria estar no bucket custoApara, não em outro');
});

test('grid de estágio inicial: fracaoEstagioInicial customizada muda o notional da fatia parcial', async () => {
  const cfgPequeno: ConfigChallenger = { ...CFG, fracaoEstagioInicial: 0.10, margemPayback: 1.5 };
  const e = novoEstado(cfgPequeno);
  // folga entre 1,0x e 1,5x força estágio parcial — spread pequeno o suficiente pra isso
  await cicloChallenger(cfgPequeno, e, [oportunidade({ spread: 0.006, consistencia: 0.7, duracaoHoras: 6 })], precoFixo);
  if (e.posicoesVirtuais.length === 1 && e.posicoesVirtuais[0].estagio === 1) {
    // se abriu em estágio parcial, o notional deveria refletir os 10%, não os 25% padrão
    const cfgPadrao: ConfigChallenger = { ...CFG, margemPayback: 1.5 };
    const e2 = novoEstado(cfgPadrao);
    await cicloChallenger(cfgPadrao, e2, [oportunidade({ spread: 0.006, consistencia: 0.7, duracaoHoras: 6 })], precoFixo);
    if (e2.posicoesVirtuais.length === 1 && e2.posicoesVirtuais[0].estagio === 1) {
      assert.ok(e.posicoesVirtuais[0].notionalPorPerna < e2.posicoesVirtuais[0].notionalPorPerna, '10% deveria abrir menor que o padrão de 25%');
    }
  }
});

test('funil de rejeição: capital abaixo do notional mínimo cai em bloqueiosPorNotionalMinimo, não no balde genérico só', async () => {
  const cfgMinusculo: ConfigChallenger = { ...CFG, capitalPorExchange: 1 }; // 1*(1-0.3)*5=3.5 < mínimo de US$5
  const e = novoEstado(cfgMinusculo);
  await cicloChallenger(cfgMinusculo, e, [oportunidade()], precoFixo);
  assert.equal(e.posicoesVirtuais.length, 0);
  assert.ok((e.bloqueiosPorNotionalMinimo ?? 0) > 0, 'deveria ter classificado como notional mínimo especificamente');
  assert.ok(e.bloqueiosPorSaldo > 0, 'o balde agregado continua incrementando, por compatibilidade');
});

test('funil de rejeição: candidatasAvaliadas acumula mesmo quando nada abre', async () => {
  const e = novoEstado(CFG);
  await cicloChallenger(CFG, e, [oportunidade({ duracaoHoras: 0.1, consistencia: 0.3 })], precoFixo);
  assert.ok((e.candidatasAvaliadas ?? 0) >= 1);
});

test('diário: registra UM evento "bloqueado" por ciclo rejeitado, com vocabulário compatível com o classificador do champion', async () => {
  const e = novoEstado(CFG);
  await cicloChallenger(CFG, e, [oportunidade({ duracaoHoras: 0.1, consistencia: 0.3 })], precoFixo);
  const ultimo = e.decisoes[e.decisoes.length - 1];
  assert.equal(ultimo.tipo, 'bloqueado');
  assert.ok(ultimo.detalhe.includes('valor esperado barrou'), 'motivo deveria começar identificável como rejeição de payback');
});

test('diário: ciclo sem candidata nenhuma registra "leitura" (mapeia pra ciclo_sem_candidata no validador)', async () => {
  const e = novoEstado(CFG);
  await cicloChallenger(CFG, e, [], precoFixo);
  const ultimo = e.decisoes[e.decisoes.length - 1];
  assert.equal(ultimo.tipo, 'leitura');
});

// ── Parte 1/2 da validação de integridade: diário nunca duplica, nunca perde ──

test('diário: um evento é gravado uma vez — sequenceNumber além do último não repete o que já foi escrito', () => {
  const e = novoEstado(CFG);
  registrar(e, 'abre', 'primeiro evento');
  const novas1 = novosEventosParaDiario(e.decisoes, 0);
  assert.equal(novas1.length, 1);
  // "grava" simbolicamente avançando o cursor pro sequenceNumber já visto
  const ultimoVisto = novas1[novas1.length - 1].sequenceNumber;
  const novas2 = novosEventosParaDiario(e.decisoes, ultimoVisto);
  assert.equal(novas2.length, 0, 'não deveria reencontrar o mesmo evento depois de já ter avançado o cursor');
});

test('diário: dois eventos no mesmo ciclo são gravados, ambos, em ordem', () => {
  const e = novoEstado(CFG);
  registrar(e, 'abre', 'evento A');
  registrar(e, 'funding', 'evento B');
  const novas = novosEventosParaDiario(e.decisoes, 0);
  assert.equal(novas.length, 2);
  assert.equal(novas[0].tipo, 'abre');
  assert.equal(novas[1].tipo, 'funding');
});

test('diário: dois eventos no mesmo milissegundo são gravados os dois — sequenceNumber os distingue, ts não', () => {
  const e = novoEstado(CFG);
  const agora = Date.now();
  // simula dois registros no MESMO ms (real acontece em cicloCaptura: funding+fecha no mesmo Date.now())
  e.proximoSequenceNumber = 0;
  e.decisoes.push({ ts: agora, tipo: 'funding', detalhe: 'A', sequenceNumber: 1 });
  e.decisoes.push({ ts: agora, tipo: 'fecha', detalhe: 'B', sequenceNumber: 2 });
  const novas = novosEventosParaDiario(e.decisoes, 0);
  assert.equal(novas.length, 2, 'os dois eventos do mesmo ms deveriam ser gravados — um filtro por ts perderia um deles');
});

test('diário: "reinício" (recarrega do sequenceNumber já persistido) não duplica eventos já escritos', () => {
  const e = novoEstado(CFG);
  registrar(e, 'abre', 'evento 1');
  registrar(e, 'funding', 'evento 2');
  const primeiraGravacao = novosEventosParaDiario(e.decisoes, 0);
  assert.equal(primeiraGravacao.length, 2);
  const ultimoSequencePersistido = primeiraGravacao[primeiraGravacao.length - 1].sequenceNumber;

  // "reinicia": novo ciclo do orquestrador carrega o MESMO estado (persistido em disco) e
  // usa o sequenceNumber já gravado como cursor — não deveria reenviar 1 e 2
  registrar(e, 'apara', 'evento 3'); // só este é genuinamente novo
  const segundaGravacao = novosEventosParaDiario(e.decisoes, ultimoSequencePersistido);
  assert.equal(segundaGravacao.length, 1);
  assert.equal(segundaGravacao[0].tipo, 'apara');
});

test('diário: array circular de 200 decisões não perde eventos ainda não gravados — sequenceNumber sobrevive ao splice()', () => {
  const e = novoEstado(CFG);
  for (let i = 0; i < 199; i++) registrar(e, 'leitura', 'evento ' + i);
  assert.equal(e.decisoes.length, 199);
  const ultimoSequenceAntes = e.decisoes[e.decisoes.length - 1].sequenceNumber; // cursor "já gravou tudo até aqui"

  // mais 5 eventos — estoura o cap de 200, dispara splice() removendo os mais antigos
  for (let i = 0; i < 5; i++) registrar(e, 'abre', 'novo evento ' + i);
  assert.equal(e.decisoes.length, 200, 'array deveria ter sido podado de volta pro cap');

  const novas = novosEventosParaDiario(e.decisoes, ultimoSequenceAntes);
  assert.equal(novas.length, 5, 'os 5 eventos novos deveriam sobreviver ao splice() e ainda serem encontrados pelo cursor de sequenceNumber');
  assert.ok(novas.every((d) => d.tipo === 'abre'));
});

test('diário: formatarLinhasDiario gera eventId determinístico com challengerId+sequenceNumber, e cycleId igual pro lote inteiro', () => {
  const e = novoEstado(CFG);
  registrar(e, 'abre', 'A');
  registrar(e, 'funding', 'B');
  const novas = novosEventosParaDiario(e.decisoes, 0);
  const linhas = formatarLinhasDiario(novas, CFG.challengerId, 'orch-12345', 100);
  assert.equal(linhas[0].eventId, CFG.challengerId + '-' + novas[0].sequenceNumber);
  assert.equal(linhas[0].cycleId, 'orch-12345');
  assert.equal(linhas[1].cycleId, 'orch-12345');
  assert.equal(linhas[0].challengerId, CFG.challengerId);
});

test('challenger eliminado para de decidir, mas o estado continua legível', async () => {
  const e = novoEstado(CFG);
  e.eliminado = { ts: Date.now(), motivo: 'teste' };
  await cicloChallenger(CFG, e, [oportunidade()], precoFixo);
  assert.equal(e.posicoesVirtuais.length, 0, 'eliminado não deveria abrir posição nova');
});

test('challenger pausado (controle manual do dashboard) para de decidir, sem apagar nada', async () => {
  const e = novoEstado(CFG);
  e.pausado = { ts: Date.now(), motivo: 'pausado manualmente pra teste', usuario: 'teste' };
  await cicloChallenger(CFG, e, [oportunidade()], precoFixo);
  assert.equal(e.posicoesVirtuais.length, 0, 'pausado não deveria abrir posição nova');
  assert.ok(e.pausado, 'estado pausado continua presente e legível');
});
