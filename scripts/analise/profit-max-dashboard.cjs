#!/usr/bin/env node
'use strict';
/**
 * Builder de dados para a página "Maximização de Lucro" do dashboard. READ-ONLY.
 * Emite auditoria/progression/profit-maximization.json com: economia real do Champion, ranking das
 * 2 melhores exchanges (dados reconciliados), status ao vivo do head-to-head, levers de maximização
 * e o "o que estamos fazendo agora". NÃO opera, NÃO toca no Champion. Não emite ordens.
 */
const L = require('./../progression/lib-progression.cjs');
const fs = require('node:fs');
const path = require('node:path');
const OUT = path.join(L.ROOT, 'auditoria', 'progression');
const COMPETE = path.join(OUT, 'compete');
const rd = (p, d) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return d; } };

function championEcon() {
  const { estado: e } = L.loadChampion();
  const dias = e && e.iniciadoEm ? (Date.now() - e.iniciadoEm) / 86400000 : 0;
  const funding = (e && e.fundingTotal) || 0, custos = (e && e.custosTotal) || 0;
  const net = funding - custos, cap = e ? Object.values(e.saldos || {}).reduce((a, b) => a + b, 0) : 0;
  return { capitalInicial: e ? e.capitalInicial : 600, capital: L.r4(cap), fundingTotal: L.r4(funding), custosTotal: L.r4(custos),
    lucroLiquido: L.r4(net), dias: L.r2(dias), lucroPorDia: dias > 0 ? L.r4(net / dias) : 0, pctPorDia: dias > 0 ? L.r2(net / 600 / dias * 100) : 0,
    custoSobreFunding: funding > 0 ? L.r2(custos / funding * 100) : 0,
    posicoesAbertas: (e && e.posicoes || []).map((p) => ({ symbol: p.symbol, par: p.exchangeLong + '/' + p.exchangeShort, fundingAcum: L.r4(p.fundingAcumulado || 0), estagio: p.estagio })) };
}

function rankingPares() {
  const sel = rd(path.join(OUT, 'exchange-selector.json'), null);
  const r = (sel && sel.ranking || []).map((x) => ({ par: x.par, net: x.realizado ? L.r4(x.realizado.pnlLiquido) : 0, posicoes: x.realizado ? x.realizado.posicoes : 0, funding: x.realizado ? L.r4(x.realizado.funding) : 0, custo: x.realizado ? L.r4(x.realizado.custo) : 0 }))
    .filter((x) => x.posicoes > 0).sort((a, b) => b.net - a.net);
  return r;
}

function headToHead() {
  const comps = [];
  for (const def of [{ label: 'compete-bybit-bitget', par: 'bybit + bitget' }, { label: 'compete-gate-okx', par: 'gate + okx' }]) {
    const est = rd(path.join(COMPETE, def.label, 'estado.json'), null);
    const hb = rd(path.join(COMPETE, def.label, 'heartbeat.json'), null);
    if (!est) { comps.push({ ...def, disponivel: false }); continue; }
    const funding = est.fundingAcum || 0, custos = est.custosAcum || 0, net = funding - custos;
    const dias = est.iniciadoEm ? (Date.now() - est.iniciadoEm) / 86400000 : 0;
    const c = est.contadores || {}, b = est.bloqueios || {};
    comps.push({ ...def, disponivel: true, capitalInicial: est.capitalInicial, capital: L.r4(est.capitalInicial + net),
      fundingAcum: L.r4(funding), custosAcum: L.r4(custos), net: L.r4(net), dias: L.r2(dias),
      pctPorDia: dias > 0 && est.capitalInicial ? L.r2(net / est.capitalInicial / dias * 100) : 0,
      abertas: Object.keys(est.virtuais || {}).length, fechadas: c.fechadas || 0, avaliadas: c.avaliadas || 0,
      persistencePending: b.persistencePending || 0,
      vivo: !!(hb && hb.ultimoCiclo && Date.now() - hb.ultimoCiclo < 15 * 60000), idadeS: hb && hb.ultimoCiclo ? Math.round((Date.now() - hb.ultimoCiclo) / 1000) : null });
  }
  comps.sort((a, b) => (b.net || -1e9) - (a.net || -1e9));
  const comTrade = comps.filter((c) => c.disponivel && (c.abertas + c.fechadas) > 0);
  return { competidores: comps, lider: comTrade.length ? comTrade[0].par : null, acumulando: comTrade.length === 0 };
}

function build() {
  const champion = championEcon();
  const ranking = rankingPares();
  const h2h = headToHead();
  const out = {
    schema: 'snowball.profit-maximization.v1', geradoEm: Date.now(),
    titulo: 'Maximização de Lucro — Champion & escolha das 2 exchanges para dinheiro real',
    oQueEstamosFazendo: [
      'O Champion (bot real em paper) rende de verdade. Objetivo: extrair MAIS lucro e escolher as 2 melhores exchanges para o dinheiro real (US$100 em cada).',
      'Dois competidores paper isolados rodam AO VIVO no engine reconciliado — bybit+bitget vs gate+okx — cada um com US$200, filtro de persistência ligado. Eles acumulam o número calibrado para a decisão.',
      'O maior lever de lucro identificado: cortar o vazamento de custo (hoje 40% do funding) sendo mais seletivo, segurando os vencedores e filtrando entradas prematuras.',
    ],
    champion,
    ranking2Exchanges: {
      nota: 'Net líquido por par (dados reconciliados do replay). Amostra pequena — o head-to-head ao vivo confirma.',
      pares: ranking,
      recomendacaoPrimaria: 'bybit + bitget', motivoPrimaria: 'Net alto (+5,91) em mais posições (robusto) + maior oferta de oportunidades + o Champion já usa bybit como âncora ao vivo.',
      alternativa: 'gate + okx', motivoAlternativa: 'Melhor net bruto (+6,13) porém amostra menor e oferta mais fina.',
    },
    headToHead: h2h,
    leversDeMaximizacao: [
      { lever: 'Filtro de persistência', descricao: 'Só entrar após 30min de sinal positivo — corta entradas prematuras (causa nº1 do custo de 40%).', status: 'ATIVO nos competidores', impacto: 'Alto' },
      { lever: 'Segurar vencedores', descricao: 'Sair mais tarde (menos inversão/deterioração cedo) captura mais funding por custo pago.', status: 'em teste', impacto: 'Alto' },
      { lever: 'Concentração 2 exchanges', descricao: 'Focar capital no melhor par em vez de espalhar por 15 pares marginais.', status: 'em teste (head-to-head)', impacto: 'Médio' },
      { lever: 'Utilização de capital', descricao: 'Capital fica ocioso 76–92% do tempo com 2 exchanges — sizing maior quando aparece oportunidade boa acelera o lucro.', status: 'a decidir', impacto: 'Médio (acelera)' },
    ],
    comoVaiMelhorar: (() => { const cf = rd(path.join(OUT, 'counterfactual-maximizacao.json'), null); if (!cf) return null;
      return { nota: 'Quanto cada lever melhora o lucro — dados reconciliados + matemática exata dos presets reais (src/config.ts).',
        lever1_maker: { titulo: 'Ordens maker (limite) em vez de market', champion6exAtual: cf.lever1_makerOrders.atual6ex.net, champion6exComMaker: cf.lever1_makerOrders.comMakerRealista.net, ganhoPct: cf.lever1_makerOrders.comMakerRealista.ganhoPct, custoAtualPct: cf.lever1_makerOrders.atual6ex.custoSobreFunding, explicacao: 'Corta o custo de ~41% do funding para ~15%. É o maior lever. O código já suporta.' },
        lever2_paresMaker: (cf.lever2_paresTakerVsMaker || []).slice(0, 3).map((p) => ({ par: p.par, netTaker: p.netTaker, netMaker: p.netMakerRealista, ganhoPct: p.ganhoMakerPct })),
        melhorCaminho: cf.melhorCaminho.config }; })(),
    ml: { veredito: 'O alvo certo de ML é um classificador de sobrevivência ("esta oportunidade persiste até o break-even?"). Precisa de outcomes rotulados por posição — os competidores estão gerando. Agora: filtro heurístico (80% do ganho, sem overfit). Depois: treinar o modelo.', prontoParaTreinar: false },
    proximosPassos: [
      'Deixar o head-to-head rodar 1–3 dias para o veredito calibrado.',
      'Medir o ganho do filtro de persistência (variante baseline opcional).',
      'Com a evidência, travar as 2 exchanges e o tamanho para o dinheiro real.',
    ],
    honestidade: 'Tudo paper e read-only. Champion intacto. Números do head-to-head crescem com o tempo. Nenhuma ordem real.',
  };
  const p = path.join(OUT, 'profit-maximization.json');
  fs.writeFileSync(p, JSON.stringify(out, null, 2));
  console.log(JSON.stringify({ saida: p, championNet: champion.lucroLiquido, championPctDia: champion.pctPorDia, rankingTop: ranking.slice(0, 2).map((r) => r.par + ':' + r.net), h2hLider: h2h.lider, acumulando: h2h.acumulando }, null, 2));
}
build();
