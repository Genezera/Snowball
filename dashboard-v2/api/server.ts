/**
 * DASHBOARD 2.0 — API EXCLUSIVA, SEPARADA DO SERVIDOR DE PRODUÇÃO
 * ---------------------------------------------------------------------
 * Regras absolutas, verificáveis lendo este arquivo inteiro:
 *   - NUNCA importa `MotorSpread`, nenhum motor, nenhuma lógica econômica.
 *   - NUNCA chama fs.writeFileSync/appendFileSync/qualquer escrita.
 *   - NUNCA importa nem depende de `src/dashboard/server.ts` (o servidor
 *     antigo) — lê os MESMOS arquivos do Snowball diretamente.
 *   - Roda em porta própria (padrão 5184), PID próprio, log próprio.
 *   - Não faz parte dos processos supervisionados pelo watchdog principal —
 *     tem supervisão própria (scripts/supervisor-dashboard-v2).
 *
 * ARQUIVO 6-EXCHANGES: as rotas /api/v2/champion, /api/v2/profit-lab,
 * /api/v2/opportunities, /api/v2/waterfall e /api/v2/events (e os serviços
 * que só existiam pra elas: champion.ts, captura.ts, oportunidades.ts,
 * cobertura.ts, waterfall.ts, eventos.ts) foram ARQUIVADAS — ver
 * arquivo-6-exchanges/README.md. Devolvem `{ok:true, arquivado:true}`
 * abaixo em vez de tentar ler arquivos/processos que não existem mais.
 *
 * Fluxo: arquivos/agregadores do Snowball → (somente leitura) → esta API
 * → frontend do Dashboard 2.0. Nunca o caminho inverso.
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { lerJsonSeguro, lerJsonlComNumeroDeLinha } from './readers/arquivos.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..'); // raiz do repositório Snowball
const PORTA = Number(process.env.PORTA_V2_API ?? 5184);
// Diretório de runtime (heartbeat/logs/crash-diagnostics). Padrão de PRODUÇÃO
// preservado (`api/logs`); só é sobrescrito por API_V2_LOG_DIR para permitir
// uma instância ISOLADA de teste (porta 5199) que nunca clobber o heartbeat
// de produção que o supervisor lê. Nada de leitura de estado do Snowball muda.
const DIR_LOGS = process.env.API_V2_LOG_DIR ? path.resolve(process.env.API_V2_LOG_DIR) : path.join(__dirname, 'logs');

fs.mkdirSync(DIR_LOGS, { recursive: true });
function log(msg: string) {
  const linha = `[${new Date().toISOString()}] ${msg}`;
  console.log(linha);
  try { fs.appendFileSync(path.join(DIR_LOGS, 'api.log'), linha + '\n'); } catch { /* log é best-effort, nunca derruba a API por causa disso */ }
}

// ── heartbeat/PID próprios (Parte 4/13 — supervisão independente) ───────
interface HeartbeatV2 { pid: number; startedAt: number; ultimaRequisicao: number | null; totalRequisicoes: number; version: string }
const heartbeat: HeartbeatV2 = { pid: process.pid, startedAt: Date.now(), ultimaRequisicao: null, totalRequisicoes: 0, version: '2.0.0-api' };
let ultimaRota: string | null = null;
function salvarHeartbeat() {
  try { fs.writeFileSync(path.join(DIR_LOGS, 'heartbeat.json'), JSON.stringify(heartbeat, null, 2)); } catch { /* best-effort */ }
}

// ── diagnóstico persistente de quedas (Parte 11) ─────────────────────────
// Registra CADA saída do processo (limpa ou não) num jsonl append-only —
// nunca sobrescreve entradas antigas, nunca depende de o processo ainda
// estar vivo pra ser lido depois. Classificação sempre explícita — nunca
// deixa "motivoClassificado" vazio/adivinhado.
type MotivoQueda = 'startup' | 'shutdown_limpo' | 'maintenance' | 'crash' | 'watchdog_restart' | 'porta_ocupada' | 'erro_de_build' | 'erro_nao_tratado';
function registrarDiagnosticoQueda(motivo: MotivoQueda, extra: Record<string, unknown> = {}) {
  const entrada = {
    timestamp: Date.now(), timestampLegivel: new Date().toISOString(),
    processo: 'dashboard-v2-api', pid: process.pid,
    exitCode: extra.exitCode ?? null, signal: extra.signal ?? null,
    stderrFinal: extra.stderrFinal ?? null, stdoutFinal: extra.stdoutFinal ?? null,
    stack: extra.stack ?? null,
    memoriaRssMB: Math.round(process.memoryUsage().rss / 1e6),
    porta: PORTA, ultimoRequest: ultimaRota,
    motivoClassificado: motivo,
  };
  try { fs.appendFileSync(path.join(DIR_LOGS, 'crash-diagnostics.jsonl'), JSON.stringify(entrada) + '\n'); } catch { /* best-effort — nunca impede o shutdown/registro de seguir */ }
}
registrarDiagnosticoQueda('startup');

function enviarJson(res: http.ServerResponse, status: number, corpo: unknown) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(corpo));
}

const servidor = http.createServer((req, res) => {
  heartbeat.ultimaRequisicao = Date.now();
  heartbeat.totalRequisicoes++;
  // CORS: API somente-leitura, sem autenticação, sem efeito colateral — o
  // frontend V2 roda em porta diferente (5183) desta API (5184), então
  // precisa disto pra falar direto sem depender de proxy de nenhum outro
  // servidor (isso incluiria o antigo, na 8787 — nunca é usado aqui).
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
  const url = new URL(req.url ?? '/', `http://localhost:${PORTA}`);
  ultimaRota = url.pathname;

  try {
    // ── saúde da própria API ────────────────────────────────────────────
    if (url.pathname === '/api/v2/health') {
      return enviarJson(res, 200, { ok: true, ...heartbeat, uptimeMs: Date.now() - heartbeat.startedAt });
    }

    // ── ARQUIVO 6-EXCHANGES: Champion e Paper Profit Lab foram isolados em
    // arquivo-6-exchanges/ e não rodam mais — ver README lá. Estas rotas
    // existem só pra qualquer cliente antigo não quebrar com 404 silencioso.
    if (url.pathname === '/api/v2/champion' || url.pathname === '/api/v2/profit-lab'
      || url.pathname === '/api/v2/opportunities' || url.pathname === '/api/v2/waterfall'
      || url.pathname === '/api/v2/events') {
      return enviarJson(res, 200, { ok: true, arquivado: true, motivo: 'Champion/Paper Profit Lab (bloco "6 exchanges") foram arquivados — ver arquivo-6-exchanges/README.md. Esta rota não serve mais dado.' });
    }

    // ── maximização de lucro: Champion + ranking 2-exchanges + head-to-head ao vivo ──
    // Serve o JSON pré-construído (scripts/analise/profit-max-dashboard.cjs) + relê os
    // estados dos competidores AO VIVO para o head-to-head não ficar defasado. SÓ LEITURA.
    if (url.pathname === '/api/v2/profit-maximization') {
      const base = lerJsonSeguro<any>(path.join(ROOT, 'auditoria', 'progression', 'profit-maximization.json'), null);
      if (base && base.headToHead) {
        const compDir = path.join(ROOT, 'auditoria', 'progression', 'compete');
        base.headToHead.competidores = (base.headToHead.competidores || []).map((c: any) => {
          const est = lerJsonSeguro<any>(path.join(compDir, c.label, 'estado.json'), null);
          const hb = lerJsonSeguro<any>(path.join(compDir, c.label, 'heartbeat.json'), null);
          // diretório não existe mais (competidor aposentado pós-consolidação) — nunca herdar o
          // "vivo:true" congelado do JSON estático, senão a página mente que ainda está rodando.
          if (!est) return { ...c, vivo: false, disponivel: false };
          const funding = est.fundingAcum || 0, custos = est.custosAcum || 0, rend = est.yieldAcum || 0, net = funding + rend - custos;
          const vivo = !!(hb && hb.ultimoCiclo && Date.now() - hb.ultimoCiclo < 15 * 60000);
          return { ...c, fundingAcum: Math.round(funding * 1e4) / 1e4, custosAcum: Math.round(custos * 1e4) / 1e4, net: Math.round(net * 1e4) / 1e4,
            capital: Math.round((est.capitalInicial + net) * 1e4) / 1e4, abertas: Object.keys(est.virtuais || {}).length,
            fechadas: (est.contadores || {}).fechadas || 0, persistencePending: (est.bloqueios || {}).persistencePending || 0, vivo };
        });
      }
      return enviarJson(res, 200, { ok: true, dados: base, geradoEm: Date.now() });
    }

    // ── competidores 2-exchange: detalhe rico por competidor (dupla, cada um separado) ──
    // dinheiro, curva de capital, ordens abertas, operações (histórico), "o que está pensando".
    // Tudo lido AO VIVO dos arquivos do motor (estado/diario/snapshots). SÓ LEITURA.
    if (url.pathname === '/api/v2/competidores') {
      const compDir = path.join(ROOT, 'auditoria', 'progression', 'compete');
      // BOT ÚNICO — a configuração do dinheiro real: bybit+bitget, maker + persistência,
      // utilização máxima (5 pos · reserva 20%) + rendimento na reserva. Sem várias frentes.
      const defs = [{ label: 'snowball-2ex', par: 'bybit + bitget · MOTOR REAL' }];
      const r2 = (n: number, c = 4) => Math.round(n * 10 ** c) / 10 ** c;
      const competidores = defs.map((d) => {
        const est = lerJsonSeguro<any>(path.join(compDir, d.label, 'estado.json'), null);
        const hb = lerJsonSeguro<any>(path.join(compDir, d.label, 'heartbeat.json'), null);
        if (!est) return { ...d, disponivel: false };
        const funding = est.fundingAcum || 0, custos = est.custosAcum || 0, rend = est.yieldAcum || 0, net = funding + rend - custos;
        const dias = est.iniciadoEm ? (Date.now() - est.iniciadoEm) / 86400000 : 0;
        const vivo = !!(hb && hb.ultimoCiclo && Date.now() - hb.ultimoCiclo < 15 * 60000);
        const abertas = Object.values(est.virtuais || {}).map((v: any) => ({
          tipo: v.tipo === 'spotperp' ? 'spot-perp' : 'cross',
          symbol: String(v.sym || v.k || '').replace('/USDT:USDT', '').replace(/^sp:/, ''),
          long: v.tipo === 'spotperp' ? v.exchange : v.long, short: v.tipo === 'spotperp' ? 'spot+perp' : v.short,
          notional: v.notional, fundingAcum: r2(v.fundingAcum || 0), aprEntrada: r2(v.aprEntrada || 0, 2),
          holdH: v.positionOpenedAt ? r2((Date.now() - v.positionOpenedAt) / 3.6e6, 1) : null }));
        const diario = lerJsonlComNumeroDeLinha(path.join(compDir, d.label, 'diario.jsonl')).map((x) => x.linha as any);
        const operacoes = diario.filter((e) => e.evento === 'abre' || e.evento === 'fecha').slice(-15).reverse()
          .map((e) => ({ ts: e.ts, tipo: e.evento, symbol: String(e.k || '').split('|')[0], apr: e.apr != null ? r2(e.apr, 2) : null, funding: e.funding != null ? r2(e.funding) : null, pnl: e.pnl != null ? r2(e.pnl) : null, motivo: e.closeReason || null }));
        const pend = diario.filter((e) => e.evento === 'bloqueada' && e.motivo === 'persistencePending').slice(-40);
        const candidatos = [...new Set(pend.map((e) => String(e.k || '').split('|')[0]))].slice(0, 10);
        const snaps = lerJsonlComNumeroDeLinha(path.join(compDir, d.label, 'snapshots.jsonl')).map((x) => x.linha as any).slice(-300);
        const curva = snaps.map((s: any, i: number) => ({ ts: s.eventCount || i, capital: s.capital != null ? s.capital : (est.capitalInicial + (s.funding || 0) - (s.custos || 0)) }));
        return { ...d, disponivel: true, vivo, idadeS: hb && hb.ultimoCiclo ? Math.round((Date.now() - hb.ultimoCiclo) / 1000) : null,
          dinheiro: { capitalInicial: est.capitalInicial, capital: r2(est.capitalInicial + net, 2), funding: r2(funding), rendimento: r2(rend), custos: r2(custos), net: r2(net), dias: r2(dias, 2), pctDia: dias > 0 && est.capitalInicial ? r2(net / est.capitalInicial / dias * 100, 3) : 0 },
          abertas, operacoes,
          pensando: { avaliadas: (est.contadores || {}).avaliadas || 0, abertas: abertas.length, fechadas: (est.contadores || {}).fechadas || 0,
            aguardandoPersistencia: (est.bloqueios || {}).persistencePending || 0, rejeitadasSemEV: (est.bloqueios || {}).evNaoPositivo || 0,
            semCapacidade: ((est.bloqueios || {}).maxPositionsBlocked || 0) + ((est.bloqueios || {}).localBalanceBlocked || 0), candidatosObservados: candidatos },
          curva };
      });
      return enviarJson(res, 200, { ok: true, competidores, geradoEm: Date.now() });
    }

    // ── spot-perp: oportunidades reais (cash-and-carry no perp) do coletor. SÓ LEITURA ──
    if (url.pathname === '/api/v2/spotperp') {
      const feed = path.join(ROOT, 'vigilancia', 'arquivo-spotperp.jsonl');
      let ops: any[] = [];
      try {
        const st = fs.statSync(feed);
        const N = Math.min(st.size, 500 * 1024);
        const fd = fs.openSync(feed, 'r'); const buf = Buffer.alloc(N);
        fs.readSync(fd, buf, 0, N, st.size - N); fs.closeSync(fd);
        const parsed = buf.toString('utf8').split('\n').filter(Boolean)
          .map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean) as any[];
        const ultimoTs = parsed.reduce((m, o) => Math.max(m, o.ts || 0), 0);
        ops = parsed.filter((o) => o.ts === ultimoTs);
      } catch { /* feed pode não existir ainda */ }
      const r2 = (n: number, c = 4) => Math.round(n * 10 ** c) / 10 ** c;
      ops.sort((a, b) => (b.evDiaBruto || 0) - (a.evDiaBruto || 0));
      const porExchange: Record<string, number> = {};
      for (const o of ops) porExchange[o.exchange] = (porExchange[o.exchange] || 0) + 1;
      const top = ops.slice(0, 20).map((o) => ({ sym: o.sym, exchange: o.exchange,
        pctDia: r2((o.fundingDia || 0) * 100, 3), fundingIntervalo: r2((o.funding || 0) * 100, 4), iv: o.iv,
        paybackDias: r2(o.paybackDias || 0, 1), vol: o.vol }));
      return enviarJson(res, 200, { ok: true, total: ops.length, porExchange, geradoEm: ops[0]?.ts || null, top });
    }

    enviarJson(res, 404, { ok: false, erro: 'rota não encontrada', rota: url.pathname });
  } catch (e) {
    log(`ERRO não tratado em ${url.pathname}: ${(e as Error).stack}`);
    enviarJson(res, 500, { ok: false, erro: (e as Error).message });
  }
});

servidor.listen(PORTA, () => {
  log(`Dashboard 2.0 API no ar — porta ${PORTA}, PID ${process.pid}, ROOT=${ROOT}`);
  log('SOMENTE LEITURA — nenhuma escrita em estado do Snowball acontece neste processo.');
  salvarHeartbeat();
  setInterval(salvarHeartbeat, 10_000);
});

servidor.on('error', (err: NodeJS.ErrnoException) => {
  if (err.code === 'EADDRINUSE') {
    log(`ERRO FATAL: porta ${PORTA} já está em uso — outra instância viva? Não sobe uma segunda.`);
    registrarDiagnosticoQueda('porta_ocupada', { stderrFinal: err.message });
    process.exit(1);
  }
  log(`ERRO FATAL no servidor: ${err.stack}`);
  registrarDiagnosticoQueda('erro_nao_tratado', { stderrFinal: err.message, stack: err.stack ?? null });
  process.exit(1);
});

process.on('SIGINT', () => { log('shutdown limpo (SIGINT)'); registrarDiagnosticoQueda('shutdown_limpo', { signal: 'SIGINT' }); process.exit(0); });
process.on('SIGTERM', () => { log('shutdown limpo (SIGTERM)'); registrarDiagnosticoQueda('shutdown_limpo', { signal: 'SIGTERM' }); process.exit(0); });
process.on('uncaughtException', (err) => {
  log(`uncaughtException: ${err.stack}`);
  registrarDiagnosticoQueda('erro_nao_tratado', { stderrFinal: err.message, stack: err.stack ?? null });
  // nunca segue rodando depois de um estado potencialmente corrompido — o
  // supervisor detecta o PID morto e decide se reinicia (com limite de
  // tentativas), igual ao padrão já usado em scripts/supervisor-profit-lab
  process.exit(1);
});
