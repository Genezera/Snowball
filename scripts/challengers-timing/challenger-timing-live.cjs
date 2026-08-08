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
const DIR = path.join(ROOT, 'challengers-timing', POLICY);
fs.mkdirSync(DIR, { recursive: true });
const F = {
  estado: path.join(DIR, 'estado.json'), diario: path.join(DIR, 'diario.jsonl'),
  heartbeat: path.join(DIR, 'heartbeat.json'), telemetria: path.join(DIR, 'telemetria.jsonl'),
  lock: path.join(DIR, 'challenger.lock'), log: path.join(DIR, 'live.log'),
};
// fontes do Champion — SOMENTE LEITURA
const CH = {
  diario: path.join(ROOT, 'spread', 'diario.jsonl'), estado: path.join(ROOT, 'spread', 'estado.json'),
  marcacao: path.join(ROOT, 'spread', 'marcacao.json'), ciclos: path.join(ROOT, 'vigilancia', 'ciclos.json'),
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

// telemetria por ciclo de uma posição virtual
function telemetriaPosicao(vp, cycleId, marcMap, estMap) {
  const m = marcMap[vp.symbol]; const e = estMap[vp.symbol];
  const espelhadaNoChampion = !!e; // Champion ainda segura → dados reais
  const dShort = e ? distanciaLiq(e.margemShort, e.notionalPorPerna) : null;
  const dLong = e ? distanciaLiq(e.margemLong, e.notionalPorPerna) : null;
  const distMin = (dShort != null && dLong != null) ? Math.min(dShort, dLong) : null;
  const mkt = dadosMercado(vp.key);
  const t = {
    ts: now(), positionId: vp.positionId, cycleId, policy: POLICY, symbol: vp.symbol,
    espelhadaNoChampion, // false = segurando ALÉM do fechamento do Champion (telemetria estimada)
    markShort: m ? m.markPriceShort : null, markLong: m ? m.markPriceLong : null,
    notionalShort: vp.notionalShort, notionalLong: vp.notionalLong,
    pnlPernaShort: m ? m.pnlNaoRealizadoShort : null, pnlPernaLong: m ? m.pnlNaoRealizadoLong : null,
    pnlResidual: m ? m.pnlNaoRealizadoExecutavelTotal : null,
    fundingAcumulado: vp.fundingAcumulado, spreadAtual: mkt ? mkt.spread : null, spreadEntrada: vp.spreadEntrada,
    custoEstimadoFechamento: m ? m.custoEstimadoFechamento : vp.custoEstimadoFechamentoUlt ?? null,
    margemUsada: e ? (e.margemShort + e.margemLong) : null,
    distanciaLiqShort: dShort, distanciaLiqLong: dLong, distanciaMinima: distMin,
    riscoCritico: distMin != null && distMin <= 0.06, // piso de emergência do próprio Champion
    dadoStale: mkt ? (now() - (mkt.atualizadoEm || 0) > 20 * 60_000) : true,
    proximoSettlement: vp.proximoSettlementTs, tempoAteSettlementMin: vp.proximoSettlementTs ? (vp.proximoSettlementTs - now()) / 60_000 : null,
    evContinuar: vp.evContinuarUlt ?? null, motivoDecisao: vp.motivoDecisaoUlt ?? null,
  };
  try { fs.appendFileSync(F.telemetria, JSON.stringify(t) + '\n'); } catch {}
  return t;
}

// SAÍDAS DE RISCO OBRIGATÓRIAS — nenhuma regra de "segurar" as atrasa
function saidaDeRiscoObrigatoria(tel) {
  if (tel.riscoCritico) return 'distancia_critica_liquidacao';
  if (tel.dadoStale) return 'dado_stale';
  if (tel.markShort == null && !tel.espelhadaNoChampion && tel.spreadAtual == null) return 'mark_invalido';
  return null;
}

function fecharVirtual(vp, motivo, cycleId) {
  if (!vp.fechaSimTs) vp.fechaSimTs = now();
  const pnl = vp.fundingAcumulado - vp.custoAcumulado;
  const seguralem = !!(vp.championFechaTs && vp.fechaSimTs > vp.championFechaTs);
  estado.fechados.push({ positionId: vp.positionId, symbol: vp.symbol, modo: vp.modo, abreTs: vp.abreTs, fechaTs: now(), championFechaTs: vp.championFechaTs, motivo, funding: +vp.fundingAcumulado.toFixed(4), custo: +vp.custoAcumulado.toFixed(4), pnlLiquido: +pnl.toFixed(4), settlementsExtras: vp.settlementsExtras || 0, seguralemChampion: seguralem });
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
    if (!vp.proximoSettlementTs || now() > vp.proximoSettlementTs) vp.proximoSettlementTs = Math.ceil(now() / intMs) * intMs;
    // funding esperado do próximo settlement (rate observado × notional)
    const rate = mkt && mkt.spread != null ? mkt.spread : 0; // spread ~ funding por settlement (proxy honesto do observado)
    const fundingEsperado = rate * vp.notionalLong;
    const custoOportCiclo = vp.notionalLong * (INTERVALO_S / 3600) * (estado.capitalInicial ? 0 : 0) + 0; // ver opportunity-cost observado (processo separado)
    const evContinuar = fundingEsperado - (marcMap[vp.symbol]?.custoEstimadoFechamento ?? 0) * 0 /* custo saída é adiado, não incremental */ - 0;
    vp.evContinuarUlt = +evContinuar.toFixed(6);

    let segurar = false, motivo = '';
    if (POLICY === 'closeConfirm') {
      // espera exatamente 1 ciclo após o fecha do Champion por inversão/ausência
      const ciclosDesdeFecha = (now() - vp.championFechaTs) / (INTERVALO_S * 1000);
      if (/invert|ausente|falta/i.test(vp.championMotivo || '')) { segurar = ciclosDesdeFecha < 1.5 && !invertido; motivo = invertido ? 'inversao-persistiu' : 'aguardando-confirmacao'; }
      else { segurar = false; motivo = 'champion-fechou-nao-por-inversao'; }
    } else if (POLICY === 'nextSettlement') {
      segurar = fundingEsperado > 0 && !invertido && !tel.dadoStale && !(tel.distanciaMinima != null && tel.distanciaMinima <= 0.06);
      motivo = segurar ? 'segura-ate-proximo-settlement' : 'condicao-falhou';
    } else if (POLICY === 'evExit') {
      segurar = evContinuar > 0 && !invertido && !tel.dadoStale;
      motivo = segurar ? 'ev-positivo' : 'ev<=0';
    }
    vp.motivoDecisaoUlt = motivo;
    if (invertido && segurar === false) estado.contadores.inversoesSofridas++;
    if (!segurar) { fecharVirtual(vp, motivo, cycleId); }
    else { vp.settlementsExtras = vp.settlementsExtras || 0; }
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
