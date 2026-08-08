#!/usr/bin/env node
/**
 * CHALLENGER LIVE-PAPER DE TIMING DE FECHAMENTO — ISOLADO, READ-ONLY sobre o
 * Champion. Observa as decisões reais do Champion (spread/diario.jsonl,
 * spread/estado.json, spread/marcacao.json — só LEITURA) e mantém posições
 * VIRTUAIS que replicam as entradas/sizing do Champion, divergindo SÓ na regra
 * de fechamento. Escreve APENAS no próprio diretório isolado
 * (challengers-timing/<policy>/). NUNCA escreve em spread/, estado do Champion,
 * motores, e NUNCA envia ordem nem toca exchange.
 *
 * Uso: node challenger-timing-live.cjs --policy <control|closeConfirm|nextSettlement|evExit> [--intervalo 300] [--once]
 * Políticas divergem só no fechamento; entradas são sempre espelhadas do Champion.
 */
const fs = require('node:fs');
const path = require('node:path');

const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf('--' + n); return i >= 0 ? args[i + 1] : d; };
const POLICY = opt('policy', 'control');
const INTERVALO_S = Number(opt('intervalo', 300));
const ONCE = args.includes('--once');
const POLICIES = ['control', 'closeConfirm', 'nextSettlement', 'evExit'];
if (!POLICIES.includes(POLICY)) { console.error('policy inválida:', POLICY); process.exit(1); }

const ROOT = path.resolve(__dirname, '..', '..');
// diretório do challenger e fontes do Champion parametrizáveis por env (SÓ para
// TESTE isolado com diario sintético); default = produção.
const DIR = process.env.CHALLENGER_DIR || path.join(ROOT, 'challengers-timing', POLICY);
fs.mkdirSync(DIR, { recursive: true });
const F = {
  estado: path.join(DIR, 'estado.json'), diario: path.join(DIR, 'diario.jsonl'),
  heartbeat: path.join(DIR, 'heartbeat.json'), telemetria: path.join(DIR, 'telemetria.jsonl'),
  lock: path.join(DIR, 'challenger.lock'), log: path.join(DIR, 'live.log'),
  divergencia: path.join(DIR, 'divergencia.jsonl'), fidelidade: path.join(DIR, 'fidelidade.json'),
};
// fontes do Champion — SOMENTE LEITURA (env override só para teste isolado)
const CH = {
  diario: process.env.CH_DIARIO || path.join(ROOT, 'spread', 'diario.jsonl'),
  estado: process.env.CH_ESTADO || path.join(ROOT, 'spread', 'estado.json'),
  marcacao: process.env.CH_MARCACAO || path.join(ROOT, 'spread', 'marcacao.json'),
  ciclos: process.env.CH_CICLOS || path.join(ROOT, 'vigilancia', 'ciclos.json'),
};
const now = () => Date.now();
const readJSON = (p, d) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return d; } };
const logLine = (m) => { try { fs.appendFileSync(F.log, `[${new Date().toISOString()}] ${m}\n`); } catch {} };

// lock de instância única (por política)
function adquirirLock() {
  const cur = readJSON(F.lock, null);
  if (cur && cur.pid && cur.heartbeat && now() - cur.heartbeat < 90_000) {
    try { process.kill(cur.pid, 0); logLine(`lock ocupado por PID ${cur.pid} vivo — não subo 2ª instância`); return false; } catch {}
  }
  fs.writeFileSync(F.lock, JSON.stringify({ pid: process.pid, startedAt: now(), heartbeat: now() }));
  return true;
}
function atualizarLock() { const l = readJSON(F.lock, {}); l.heartbeat = now(); fs.writeFileSync(F.lock, JSON.stringify(l)); }

// estado isolado
let estado = readJSON(F.estado, null) || {
  policy: POLICY, iniciadoEm: now(), capitalInicial: 600, capital: 600,
  cursorDiario: 0, // byte offset lido do diario do Champion
  virtuais: {},    // positionId -> posição virtual (evita colisão de símbolo reutilizado)
  symbolAtual: {}, // symbol -> positionId da instância ABERTA no Champion agora
  fechados: [],    // outcomes
  contadores: { entradas: 0, fechamentos: 0, settlementsExtras: 0, inversoesSofridas: 0, riscoExits: 0 },
};

const MMR = 0.01;
function distanciaLiq(margem, notional) { return notional > 0 ? margem / notional - MMR : null; }

// funding rate observado agora para a chave (vigilancia/ciclos → spreadMedio/apr proxy)
function dadosMercado(key) {
  const ciclos = readJSON(CH.ciclos, { ciclos: {} });
  const c = ciclos.ciclos ? ciclos.ciclos[key] : null;
  if (!c) return null;
  return { spread: c.spreadMedio, consistencia: c.consistencia, volume: c.volumeMedio, faltas: c.faltas, atualizadoEm: c.abertoEm };
}

// SOURCE CLASSIFICATION (item 1): todo campo carrega value/source/observedAt/
// ageMs/confidence. sources: champion_observed | market_observed | derived | unavailable.
const STALE_MS = 20 * 60_000;
function campo(value, source, observedAt) {
  const obs = observedAt ?? (value == null ? null : now());
  const ageMs = obs != null ? now() - obs : null;
  let confidence = 0;
  if (source === 'champion_observed' && value != null) confidence = 1.0;
  else if (source === 'market_observed' && value != null) confidence = ageMs != null && ageMs <= STALE_MS ? 0.9 : 0.4;
  else if (source === 'derived' && value != null) confidence = 0.7;
  else { source = 'unavailable'; confidence = 0; }
  return { value: value ?? null, source, observedAt: obs, ageMs, confidence: +confidence.toFixed(2) };
}

// telemetria por ciclo de uma posição virtual — com classificação de fonte
function telemetriaPosicao(vp, cycleId, marcMap, estMap) {
  const m = marcMap[vp.symbol]; const e = estMap[vp.symbol];
  const espelhadaNoChampion = !!e; // Champion ainda segura → dados champion_observed
  const src = espelhadaNoChampion ? 'champion_observed' : 'unavailable';
  const dShort = e ? distanciaLiq(e.margemShort, e.notionalPorPerna) : null;
  const dLong = e ? distanciaLiq(e.margemLong, e.notionalPorPerna) : null;
  const distMin = (dShort != null && dLong != null) ? Math.min(dShort, dLong) : null;
  const mkt = dadosMercado(vp.key);
  const mktObs = mkt ? mkt.atualizadoEm : null;
  const t = {
    ts: now(), positionId: vp.positionId, cycleId, policy: POLICY, symbol: vp.symbol, espelhadaNoChampion,
    markShort: campo(m ? m.markPriceShort : null, src, mktObs), markLong: campo(m ? m.markPriceLong : null, src, mktObs),
    notionalShort: campo(vp.notionalShort, 'champion_observed', vp.abreTs), notionalLong: campo(vp.notionalLong, 'champion_observed', vp.abreTs),
    pnlPernaShort: campo(m ? m.pnlNaoRealizadoShort : null, src, mktObs), pnlPernaLong: campo(m ? m.pnlNaoRealizadoLong : null, src, mktObs),
    pnlResidual: campo(m ? m.pnlNaoRealizadoExecutavelTotal : null, src, mktObs),
    // funding REAL enquanto o Champion segura vs contrafactual observado ao vivo na extensão
    fundingAcumulado: campo(vp.fundingAcumulado, 'champion_observed', vp.abreTs),
    liveObservedCounterfactualFunding: campo(espelhadaNoChampion ? null : (vp.liveCounterfactualFunding ?? 0), espelhadaNoChampion ? 'unavailable' : 'market_observed', mktObs),
    spreadAtual: campo(mkt ? mkt.spread : null, 'market_observed', mktObs), spreadEntrada: campo(vp.spreadEntrada, 'champion_observed', vp.abreTs),
    custoEstimadoFechamento: campo(m ? m.custoEstimadoFechamento : null, m ? 'champion_observed' : 'unavailable', mktObs),
    margemUsada: campo(e ? (e.margemShort + e.margemLong) : null, src, mktObs),
    distanciaLiqShort: campo(dShort, src, mktObs), distanciaLiqLong: campo(dLong, src, mktObs), distanciaMinima: campo(distMin, e ? 'derived' : 'unavailable', mktObs),
    slippageEstimado: campo(null, 'unavailable', null), // não instrumentado por ciclo — honesto
    proximoSettlement: campo(vp.proximoSettlementTs, vp.proximoSettlementTs ? 'derived' : 'unavailable', null),
    evContinuar: campo(vp.evContinuarUlt ?? null, 'derived', null),
    motivoDecisao: vp.motivoDecisaoUlt ?? null,
  };
  // flags derivadas para as regras (a partir dos campos classificados)
  t.riscoCritico = distMin != null && distMin <= 0.06;
  t.dadoStale = !(mkt && (now() - (mktObs || 0) <= STALE_MS));
  // ELEGIBILIDADE DE EXTENSÃO (item 6): inelegível se qualquer fonte crítica falta
  const motivos = [];
  if (t.dadoStale) motivos.push('dado_stale');
  if (t.markShort.value == null && t.spreadAtual.value == null) motivos.push('mark_indisponivel');
  if (t.distanciaMinima.value == null) motivos.push('distancia_liquidacao_indisponivel');
  if (t.proximoSettlement.value == null) motivos.push('settlement_desconhecido');
  if (t.distanciaLiqShort.value == null || t.distanciaLiqLong.value == null) { if (!espelhadaNoChampion) motivos.push('telemetria_de_perna_ausente'); }
  t.extensionEligible = motivos.length === 0;
  t.ineligibilityReasons = motivos;
  try { fs.appendFileSync(F.telemetria, JSON.stringify(t) + '\n'); } catch {}
  return t;
}

// SAÍDAS DE RISCO OBRIGATÓRIAS — nenhuma regra de "segurar" as atrasa
function saidaDeRiscoObrigatoria(tel) {
  if (tel.riscoCritico) return 'distancia_critica_liquidacao';
  if (tel.dadoStale) return 'dado_stale';
  if (tel.markShort.value == null && !tel.espelhadaNoChampion && tel.spreadAtual.value == null) return 'mark_invalido';
  if (!tel.extensionEligible) return 'extensao_inelegivel:' + tel.ineligibilityReasons.join('|');
  return null;
}

function fecharVirtual(vp, motivo, cycleId) {
  if (!vp.fechaSimTs) vp.fechaSimTs = now();
  const cf = vp.liveCounterfactualFunding || 0; // funding contrafactual observado ao vivo na extensão (NUNCA "realizado")
  const pnl = vp.fundingAcumulado + cf - vp.custoAcumulado;
  const seguralem = !!(vp.championFechaTs && vp.fechaSimTs > vp.championFechaTs);
  estado.fechados.push({ positionId: vp.positionId, symbol: vp.symbol, modo: vp.modo, abreTs: vp.abreTs, fechaTs: now(), championFechaTs: vp.championFechaTs, motivo, fundingChampionObservado: +vp.fundingAcumulado.toFixed(4), liveObservedCounterfactualFunding: +cf.toFixed(4), custo: +vp.custoAcumulado.toFixed(4), pnlLiquido: +pnl.toFixed(4), settlementsExtras: vp.settlementsExtras || 0, seguralemChampion: seguralem });
  estado.contadores.fechamentos++;
  fs.appendFileSync(F.diario, JSON.stringify({ ts: now(), evento: 'fecha-virtual', cycleId, symbol: vp.symbol, positionId: vp.positionId, motivo, pnl: +pnl.toFixed(4) }) + '\n');
  delete estado.virtuais[vp.positionId];
  if (estado.symbolAtual[vp.symbol] === vp.positionId) delete estado.symbolAtual[vp.symbol];
}

// ── um ciclo ────────────────────────────────────────────────────────────────
function umCiclo() {
  const cycleId = `${POLICY}-${now()}`;
  const est = readJSON(CH.estado, { posicoes: [] });
  const marc = readJSON(CH.marcacao, { posicoes: [] });
  const estMap = Object.fromEntries((est.posicoes || []).map((p) => [p.symbol, p]));
  const marcMap = Object.fromEntries((marc.posicoes || []).map((p) => [p.symbol, p]));

  // 1) lê eventos NOVOS do diario do Champion (incremental por byte offset)
  let novos = [];
  try {
    const stat = fs.statSync(CH.diario);
    if (stat.size < estado.cursorDiario) estado.cursorDiario = 0; // rotação
    const fd = fs.openSync(CH.diario, 'r');
    const buf = Buffer.alloc(stat.size - estado.cursorDiario);
    fs.readSync(fd, buf, 0, buf.length, estado.cursorDiario);
    fs.closeSync(fd);
    estado.cursorDiario = stat.size;
    novos = buf.toString('utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  } catch (e) { logLine('erro lendo diario: ' + e.message); }

  // 2) processa eventos do Champion (replica entradas; contabiliza funding real; trata fecha por política)
  const atual = (sym) => estado.virtuais[estado.symbolAtual[sym]]; // instância champion-aberta do símbolo
  for (const ev of novos) {
    if (ev.evento === 'abre' || ev.evento === 'abre-captura') {
      const sym = ev.symbol; const key = `${sym}|${ev.short}|${ev.long}`; const pid = `${POLICY}:${sym}:${ev.ts}`;
      estado.virtuais[pid] = {
        positionId: pid, symbol: sym, key, modo: ev.evento === 'abre-captura' ? 'captura' : 'normal',
        long: ev.long, short: ev.short, notionalLong: ev.notional, notionalShort: ev.notional, precoEntrada: ev.preco,
        spreadEntrada: ev.spread, intervaloHoras: ev.intervaloHoras || 8, abreTs: ev.ts,
        fundingAcumulado: 0, custoAcumulado: ev.custo || 0, settlementsExtras: 0, championAberta: true, championFechaTs: null, fechaSimTs: null,
        proximoSettlementTs: null,
      };
      estado.symbolAtual[sym] = pid; estado.contadores.entradas++;
      fs.appendFileSync(F.diario, JSON.stringify({ ts: now(), evento: 'abre-virtual', symbol: sym, positionId: pid, notional: ev.notional, replicadoDoChampion: true }) + '\n');
    } else if (['reinveste', 'escalona', 'apara'].includes(ev.evento) && ev.symbol && atual(ev.symbol)) {
      atual(ev.symbol).custoAcumulado += ev.custo || 0; // replica gestão do Champion
    } else if (ev.evento === 'funding' && atual(ev.symbol)) {
      atual(ev.symbol).fundingAcumulado += ev.ganho || 0; // funding REAL observado enquanto o Champion segura
    } else if (ev.evento === 'fecha' && atual(ev.symbol)) {
      const vp = atual(ev.symbol);
      vp.custoAcumulado += ev.custo || 0; vp.championFechaTs = ev.ts; vp.championAberta = false; vp.championMotivo = ev.motivo;
      delete estado.symbolAtual[ev.symbol]; // não é mais a instância aberta do Champion
      if (POLICY === 'control') { vp.fechaSimTs = ev.ts; fecharVirtual(vp, 'espelha-champion', cycleId); }
      // demais políticas: instância vira "held-beyond", decidida na gestão abaixo
    }
  }

  // 3) gestão por ciclo das posições virtuais AINDA abertas (telemetria + regras + risco)
  for (const vp of Object.values(estado.virtuais)) {
    const tel = telemetriaPosicao(vp, cycleId, marcMap, estMap); // telemetria SEMPRE registrada
    // Control e QUALQUER posição enquanto o Champion a segura: espelho puro —
    // NENHUMA ação independente (nem risk-exit; o risco do Champion já se aplica
    // via os eventos que ele emite). Divergência só ALÉM do fechamento dele.
    if (POLICY === 'control') continue;
    if (vp.championAberta) { vp.motivoDecisaoUlt = 'champion-ainda-aberta'; continue; }

    // ── ALÉM do fechamento do Champion: aqui as saídas de risco e as regras valem ──
    const risco = saidaDeRiscoObrigatoria(tel);
    if (risco) { estado.contadores.riscoExits++; vp.motivoDecisaoUlt = 'risco:' + risco; fecharVirtual(vp, 'risco:' + risco, cycleId); continue; }
    const mkt = dadosMercado(vp.key);
    const invertido = mkt ? (mkt.spread != null && mkt.spread <= 0) : false; // proxy de inversão
    const intMs = (vp.intervaloHoras || 8) * 3600_000;
    if (!vp.proximoSettlementTs) vp.proximoSettlementTs = Math.ceil(now() / intMs) * intMs;
    const rate = mkt && mkt.spread != null ? mkt.spread : 0; // spread ~ funding por settlement (observado)
    const fundingEsperado = rate * vp.notionalLong;
    const evContinuar = fundingEsperado; // custo de saída é adiado (não incremental); opp cost é processo separado observado
    vp.evContinuarUlt = +evContinuar.toFixed(6);

    let segurar = false, motivo = '';
    if (POLICY === 'closeConfirm') {
      const ciclosDesdeFecha = (now() - vp.championFechaTs) / (INTERVALO_S * 1000);
      if (/invert|ausente|falta/i.test(vp.championMotivo || '')) { segurar = ciclosDesdeFecha < 1.5 && !invertido; motivo = invertido ? 'inversao-persistiu' : 'aguardando-confirmacao'; }
      else { segurar = false; motivo = 'champion-fechou-nao-por-inversao'; }
    } else if (POLICY === 'nextSettlement') {
      segurar = fundingEsperado > 0 && !invertido && tel.extensionEligible && !(tel.distanciaMinima.value != null && tel.distanciaMinima.value <= 0.06);
      motivo = segurar ? 'segura-ate-proximo-settlement' : 'condicao-falhou';
    } else if (POLICY === 'evExit') {
      segurar = evContinuar > 0 && !invertido && tel.extensionEligible;
      motivo = segurar ? 'ev-positivo' : 'ev<=0';
    }
    vp.motivoDecisaoUlt = motivo;
    // registro de divergência por ciclo (item 8) — decisão/EV/motivo/risco
    try { fs.appendFileSync(F.divergencia, JSON.stringify({ ts: now(), cycleId, positionId: vp.positionId, symbol: vp.symbol, decisao: segurar ? 'segurar' : 'fechar', evContinuar: vp.evContinuarUlt, fundingEsperado: +fundingEsperado.toFixed(6), distanciaMinima: tel.distanciaMinima.value, distanciaMinimaSource: tel.distanciaMinima.source, invertido, motivo, extensionEligible: tel.extensionEligible }) + '\n'); } catch {}
    // crédito contrafactual ao vivo: se segura E cruzou um settlement, credita o funding observado e avança
    if (segurar && now() >= vp.proximoSettlementTs && tel.extensionEligible) {
      vp.liveCounterfactualFunding = (vp.liveCounterfactualFunding || 0) + fundingEsperado;
      vp.settlementsExtras = (vp.settlementsExtras || 0) + 1; estado.contadores.settlementsExtras++;
      vp.proximoSettlementTs += intMs;
    }
    if (invertido && !segurar) estado.contadores.inversoesSofridas++;
    if (!segurar) fecharVirtual(vp, motivo, cycleId);
  }

  // 5) FIDELIDADE INCREMENTAL do Control (item 5) — compara PnL fechado do Control
  // com o PnL real do Champion (por instância) a cada ciclo. Se divergir além da
  // tolerância → comparisonStatus=SUSPENDED_CONTROL_DIVERGENCE (a coleta NÃO para).
  if (POLICY === 'control') {
    const chEv = (() => { try { return fs.readFileSync(CH.diario, 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean); } catch { return []; } })();
    const ab = {}; let pnlRealFechadas = 0;
    for (const e of chEv) {
      if (e.evento === 'abre' || e.evento === 'abre-captura') ab[e.symbol] = { f: 0, c: e.custo || 0 };
      else if (e.evento === 'funding' && ab[e.symbol]) ab[e.symbol].f += e.ganho || 0;
      else if (['reinveste', 'escalona', 'apara'].includes(e.evento) && e.symbol && ab[e.symbol]) ab[e.symbol].c += e.custo || 0;
      else if (e.evento === 'fecha' && ab[e.symbol]) { ab[e.symbol].c += e.custo || 0; pnlRealFechadas += ab[e.symbol].f - ab[e.symbol].c; delete ab[e.symbol]; }
    }
    const pnlControl = estado.fechados.reduce((s, f) => s + f.pnlLiquido, 0);
    const difAbs = Math.abs(pnlRealFechadas - pnlControl);
    const status = difAbs <= 0.01 ? 'OK' : 'SUSPENDED_CONTROL_DIVERGENCE';
    fs.writeFileSync(F.fidelidade, JSON.stringify({ ts: now(), pnlRealFechadas: +pnlRealFechadas.toFixed(4), pnlControl: +pnlControl.toFixed(4), difAbs: +difAbs.toFixed(6), tolerancia: 0.01, comparisonStatus: status }, null, 2));
    if (status !== 'OK') logLine(`FIDELIDADE ROMPIDA: dif ${difAbs.toFixed(4)} > 0.01 — comparações econômicas SUSPENSAS (coleta continua)`);
  }

  // 4) heartbeat + persiste estado
  estado.capital = estado.capitalInicial + estado.fechados.reduce((s, f) => s + f.pnlLiquido, 0);
  fs.writeFileSync(F.heartbeat, JSON.stringify({ pid: process.pid, policy: POLICY, ultimoCiclo: now(), virtuaisAbertas: Object.keys(estado.virtuais).length, fechados: estado.fechados.length, capital: estado.capital }, null, 2));
  fs.writeFileSync(F.estado, JSON.stringify(estado, null, 2));
  atualizarLock();
}

if (!adquirirLock()) process.exit(0);
process.on('SIGINT', () => { try { fs.unlinkSync(F.lock); } catch {} process.exit(0); });
process.on('SIGTERM', () => { try { fs.unlinkSync(F.lock); } catch {} process.exit(0); });
logLine(`challenger ${POLICY} iniciado — intervalo ${INTERVALO_S}s — ISOLADO, read-only sobre o Champion, NENHUMA ORDEM`);
umCiclo();
if (!ONCE) setInterval(umCiclo, INTERVALO_S * 1000);
