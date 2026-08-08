'use strict';
/**
 * lib-progression — base compartilhada da Plataforma de Progressão (read-only).
 *
 * REGRAS: nada aqui envia ordem, move saldo, altera Champion/motores/risco ou
 * escreve em spread/. Só LÊ os dados reais do Champion + datasets shadow e emite
 * artefatos em auditoria/progression/, docs/ e schemas. Tudo append-only e
 * reversível. Distingue sempre observed / replayed / simulated / shadow /
 * hypothetical / live-paper / real.
 *
 * Determinismo: o "agora" de referência é o último ciclo observado do Champion
 * (estado.ultimoCicloTs), não Date.now() — assim os artefatos são reprodutíveis
 * a partir dos mesmos dados.
 */
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..');
const P = {
  estado: path.join(ROOT, 'spread', 'estado.json'),
  marcacao: path.join(ROOT, 'spread', 'marcacao.json'),
  diario: path.join(ROOT, 'spread', 'diario.jsonl'),
  epochs: path.join(ROOT, 'auditoria', 'dataset', 'config-epochs.json'),
  candidatos: path.join(ROOT, 'auditoria', 'dataset', 'candidate-observations.jsonl'),
  episodios: path.join(ROOT, 'auditoria', 'dataset', 'opportunity-episodes.jsonl'),
  outcomes: path.join(ROOT, 'auditoria', 'dataset', 'position-outcomes.jsonl'),
  captura: path.join(ROOT, 'auditoria', 'shadow', 'capture-accounting.json'),
  crossRank: path.join(ROOT, 'auditoria', 'shadow', 'cross-sectional-ranking.jsonl'),
  pares: path.join(ROOT, 'auditoria', 'shadow', 'pares-diagnostico.json'),
  gateV2: path.join(ROOT, 'auditoria', 'shadow', 'gate-v2.json'),
  challengersRel: path.join(ROOT, 'auditoria', 'challengers', 'relatorio-diario.json'),
  outDir: path.join(ROOT, 'auditoria', 'progression'),
};

// ── config REAL observada (config-epochs.json / src/config.ts seed) ──────────
const RESERVA = 0.30;          // reserva operacional (config observada, epoch-0/1)
const ALAVANCAGEM = 5;         // observada
const MAX_POSICOES = 3;        // observada
const MARGEM_PAYBACK = 1.5;    // observada
const MIN_NOTIONAL = 5;        // src/config.ts (seed/grow/turtle)
const ALVO_POR_EXCHANGE = 100; // desenho operacional: US$100 por exchange
const EXCHANGES = ['binanceusdm', 'bybit', 'okx', 'gate', 'bitget', 'bingx'];
const STALE_MS = 20 * 60 * 1000;

const rd = (p, d) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return d; } };
const linhas = (p) => { try { return fs.readFileSync(p, 'utf8').split('\n').filter(Boolean); } catch { return []; } };
const jsonl = (p) => linhas(p).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
const r2 = (x) => Math.round((x + Number.EPSILON) * 100) / 100;
const r4 = (x) => Math.round((x + Number.EPSILON) * 10000) / 10000;

function loadChampion() {
  const estado = rd(P.estado, null);
  const marcacao = rd(P.marcacao, null);
  const epochsDoc = rd(P.epochs, { epochs: [] });
  const asOf = estado && estado.ultimoCicloTs ? estado.ultimoCicloTs : 0;
  return { estado, marcacao, epochs: epochsDoc.epochs || [], asOf, epochsNota: epochsDoc.nota };
}

/**
 * campo(value, source, observedAt, asOf) — classifica origem/confiança de um
 * valor, idêntico ao padrão dos challengers. Nunca inventa: unavailable=0.
 */
function campo(value, source, observedAt, asOf) {
  const ref = asOf || observedAt || 0;
  const ageMs = observedAt ? Math.max(0, ref - observedAt) : null;
  let confidence = 0;
  if (value == null || source === 'unavailable') { source = value == null ? 'unavailable' : source; confidence = 0; }
  else if (source === 'champion_observed') confidence = 1.0;
  else if (source === 'market_observed') confidence = ageMs != null && ageMs > STALE_MS ? 0.4 : 0.9;
  else if (source === 'derived') confidence = 0.7;
  else confidence = 0;
  return { value: value == null ? null : value, source, observedAt: observedAt || null, ageMs, confidence };
}

function epochDe(ts, epochs) {
  for (const e of epochs) if (ts >= e.inicioTs && (e.fimTs == null || ts < e.fimTs)) return e.configEpochId;
  return epochs.length ? epochs[epochs.length - 1].configEpochId : null;
}

/** Série econômica cronológica do diário: init, aporte, funding, fecha. */
function serieEconomica() {
  const L = jsonl(P.diario).filter((e) => typeof e.ts === 'number');
  const capSeries = L.filter((e) => typeof e.capital === 'number').sort((a, b) => a.ts - b.ts);
  return { eventos: L, capSeries };
}

/** Reconciliação canônica: capital = capitalInicial + funding − custos. */
function reconciliar(estado) {
  const calc = (estado.capitalInicial || 0) + (estado.fundingTotal || 0) - (estado.custosTotal || 0);
  const bate = Math.abs(calc - (estado.capital || 0)) < 0.01;
  return { calculado: r4(calc), reportado: r4(estado.capital || 0), diferenca: r4(calc - (estado.capital || 0)), reconcilia: bate };
}

/** Capital comprometido (margem) e notional das posições abertas. */
function comprometido(estado) {
  const pos = (estado.posicoes || []);
  const margem = pos.reduce((s, p) => s + (p.margemShort || 0) + (p.margemLong || 0), 0);
  const notionalPerna = pos.reduce((s, p) => s + (p.notionalPorPerna || 0), 0);
  return { margem: r4(margem), notionalPorPernaTotal: r4(notionalPerna), nPosicoes: pos.length };
}

/** maxDrawdown observado a partir da série de capital (pico → vale). */
function maxDrawdown(capSeries) {
  let pico = -Infinity, mdd = 0, picoTs = 0, valeTs = 0;
  for (const e of capSeries) {
    if (e.capital > pico) { pico = e.capital; picoTs = e.ts; }
    const dd = pico > 0 ? (pico - e.capital) / pico : 0;
    if (dd > mdd) { mdd = dd; valeTs = e.ts; }
  }
  return { fracao: r4(mdd), pct: r2(mdd * 100), picoTs, valeTs };
}

/**
 * derivarNiveis — capital mínimo por nível DERIVADO da config real (não arbitrário).
 *   Recurso limitante = SLOTS de exchange, cada um com US$100 (a reserva de 30% mora
 *   DENTRO do saldo de cada exchange, não é um multiplicador em cima). Uma posição de
 *   funding delta-neutro ocupa 2 slots (perna long + perna short em 2 exchanges).
 *   slots(nível): N0=0, N1=2 (1 posição), N2=4 (2 concorrentes), N3=6 (3 concorrentes /
 *   2º motor), N4=8, N5=12, N6=20. capitalMinimo = slots × US$100.
 * Níveis 0–3 saem direto do nº de exchanges/posições concorrentes observado no Champion
 * (roda 3 concorrentes em 6 exchanges = US$600). Níveis 4–6 carregam buffer p/ sizing
 * oportunista / múltiplos motores / mercado separado e são marcados como ESTIMATIVA.
 */
function derivarNiveis() {
  const baseLeg = ALVO_POR_EXCHANGE;                 // 100
  const slots = { 0: 0, 1: 2, 2: 4, 3: 6, 4: 8, 5: 12, 6: 20 };
  const cap = (lvl) => slots[lvl] * baseLeg;
  const defs = [
    { levelId: 0, nome: 'Fundação', exposto: 0, estimativa: false,
      descricao: 'Dados íntegros, contabilidade reconciliada, processos estáveis, zero perda/duplicação.',
      modulos: ['ledger', 'reconciliação', 'supervisão', 'monitor de integridade'],
      riscos: ['corrupção de estado', 'perda/duplicação de evento'],
      bossCondition: 'Integridade: reconcilia exato + monitor sem perda/duplicação.' },
    { levelId: 1, nome: 'Motor principal', exposto: cap(1), estimativa: false,
      descricao: 'Funding delta-neutro em 2 exchanges, US$100 cada, protegendo o capital inicial e provando lucro líquido após custos.',
      modulos: ['Champion funding', 'marcação executável', 'saída de risco'],
      riscos: ['inversão de spread', 'custo > funding', 'liquidação'],
      bossCondition: 'Chefe dos Custos + Chefe da Sobrevivência derrotados na amostra viva.' },
    { levelId: 2, nome: 'Eficiência', exposto: cap(2), estimativa: false,
      descricao: 'Segunda posição simultânea, melhor timing de fechamento e uso de margem, seleção dinâmica de exchanges.',
      modulos: ['close-timing challengers', 'exchange selector', '2ª posição simultânea'],
      riscos: ['concentração', 'correlação entre posições'],
      bossCondition: 'Challenger de timing com gate LIBERADO + Chefe da Concentração derrotado.' },
    { levelId: 3, nome: 'Segunda fonte de lucro', exposto: cap(3), estimativa: false,
      descricao: 'Um segundo motor comprovado (captura de settlement, cross-sectional, momentum ou pares) contribuindo lucro independente.',
      modulos: ['settlement capture', 'funding cross-sectional', 'momentum', 'pares'],
      riscos: ['dependência do mesmo evento', 'correlação oculta'],
      bossCondition: 'Chefe da Diversificação derrotado (≥2 fontes independentes lucrativas).' },
    { levelId: 4, nome: 'Eventos especiais', exposto: cap(4), estimativa: true,
      descricao: 'Radar de notícias/eventos, novas listagens, unlocks, anomalias de volume — oportunidades raras.',
      modulos: ['news/event radar', 'listing opportunity lab'],
      riscos: ['sinal de LLM tratado como verdade', 'iliquidez de listagem', 'slippage extremo'],
      bossCondition: 'Chefe da Capacidade derrotado (motor atual satura) + dados de evento suficientes.' },
    { levelId: 5, nome: 'Portfólio multimotor', exposto: cap(5), estimativa: true,
      descricao: 'Alocador de capital distribuindo entre várias estratégias comprovadas conforme oportunidade.',
      modulos: ['capital allocator', 'capital opportunity router (live)'],
      riscos: ['má alocação', 'risco sistêmico entre motores'],
      bossCondition: '≥2 motores ELIGIBLE + router shadow fiel por ≥2 janelas.' },
    { levelId: 6, nome: 'Novos mercados', exposto: cap(6), estimativa: true,
      descricao: 'Ações fracionárias/ETFs/eventos em ações, com capital, risco, execução e contabilidade separados de cripto.',
      modulos: ['stock data provider', 'broker adapter', 'market calendar', 'corporate actions'],
      riscos: ['gap overnight', 'calendário/execução distintos', 'mistura de contabilidade'],
      bossCondition: 'Arquitetura multi-mercado com capital separado + custos/risco normalizados.' },
  ];
  return defs.map((d) => ({ levelId: d.levelId, nome: d.nome, capitalMinimo: d.exposto, slots: d.exposto / baseLeg, estimativa: d.estimativa,
    descricao: d.descricao, modulos: d.modulos, riscos: d.riscos, bossCondition: d.bossCondition }));
}

/** Capital deployável = realizado × (1 − reserva): quanto pode ser ativamente exposto. */
function capitalDeployable(estado) { return r4((estado.capital || 0) * (1 - RESERVA)); }

/**
 * Nível ATUAL POR CAPITAL = maior nível cujo capitalMinimo ≤ capital realizado.
 * Usa o capital total (a reserva de 30% mora dentro do saldo de cada exchange, que já
 * está contado em capitalMinimo = slots × US$100). O bloqueio real de progressão é
 * EVIDÊNCIA (amostra/gate), tratado em levels.json — não o capital.
 */
function posicaoNiveis(estado, niveis) {
  const cap = estado.capital || 0;
  let atual = 0;
  for (const n of niveis) if (cap >= n.capitalMinimo) atual = n.levelId;
  const prox = niveis.find((n) => n.levelId === atual + 1) || null;
  const gap = prox ? Math.max(0, r2(prox.capitalMinimo - cap)) : 0;
  return { capitalDeployable: capitalDeployable(estado), nivelAtualPorCapital: atual, proximoNivel: prox ? prox.levelId : null, capitalNecessarioProximoNivel: gap };
}

/**
 * reconstruirPosicoes — reconstrói as posições REAIS do Champion a partir do diário
 * (abre/funding/escalona/apara/fecha) + posições abertas do estado. Cada posição:
 * {symbol, long, short, par, notional, margem, abreTs, fechaTs, funding, custo, pnl, aberta}.
 * margem = notional / alavancagem. Funding/custo OBSERVADOS. Base honesta (não filtra nada).
 */
function reconstruirPosicoes(estado) {
  const L = jsonl(P.diario).filter((e) => typeof e.ts === 'number').sort((a, b) => a.ts - b.ts);
  const ab = {}; const pos = [];
  for (const e of L) {
    if (e.evento === 'abre' || e.evento === 'abre-captura') ab[e.symbol] = { symbol: e.symbol, long: e.long, short: e.short, notional: e.notional || 0, abreTs: e.ts, funding: 0, custo: e.custo || 0 };
    else if (e.evento === 'funding' && ab[e.symbol]) ab[e.symbol].funding += e.ganho || 0;
    else if ((e.evento === 'escalona' || e.evento === 'apara' || e.evento === 'socorre' || e.evento === 'reinveste') && ab[e.symbol]) { if (typeof e.notionalNovo === 'number') ab[e.symbol].notional = e.notionalNovo; ab[e.symbol].custo += e.custo || 0; }
    else if (e.evento === 'fecha' && ab[e.symbol]) { const o = ab[e.symbol]; o.custo += e.custo || 0; o.fechaTs = e.ts; o.margem = o.notional / ALAVANCAGEM; o.pnl = o.funding - o.custo; o.aberta = false; pos.push(o); delete ab[e.symbol]; }
  }
  for (const p of (estado.posicoes || [])) pos.push({ symbol: p.symbol, long: p.exchangeLong, short: p.exchangeShort, notional: p.notionalPorPerna, abreTs: p.abertaEm, fechaTs: null, funding: p.fundingAcumulado || 0, custo: 0, pnl: p.fundingAcumulado || 0, margem: (p.margemShort || 0) + (p.margemLong || 0), aberta: true });
  return pos.map((p) => ({ ...p, par: (EXCHANGES.includes(p.long) && EXCHANGES.includes(p.short)) ? [p.long, p.short].sort().join('+') : null }));
}

function ensureOut() { try { fs.mkdirSync(P.outDir, { recursive: true }); } catch {} }
function writeJSON(nome, obj) { ensureOut(); fs.writeFileSync(path.join(P.outDir, nome), JSON.stringify(obj, null, 2)); return path.join('auditoria', 'progression', nome); }
function writeJSONL(nome, arr) { ensureOut(); fs.writeFileSync(path.join(P.outDir, nome), arr.map((x) => JSON.stringify(x)).join('\n') + (arr.length ? '\n' : '')); return path.join('auditoria', 'progression', nome); }

module.exports = {
  ROOT, P, RESERVA, ALAVANCAGEM, MAX_POSICOES, MARGEM_PAYBACK, MIN_NOTIONAL, ALVO_POR_EXCHANGE, EXCHANGES, STALE_MS,
  rd, linhas, jsonl, r2, r4, loadChampion, campo, epochDe, serieEconomica, reconciliar, comprometido, maxDrawdown,
  derivarNiveis, capitalDeployable, posicaoNiveis, reconstruirPosicoes, writeJSON, writeJSONL, ensureOut,
};
