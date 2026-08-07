/**
 * DASHBOARD 2.0 — API EXCLUSIVA, SEPARADA DO SERVIDOR DE PRODUÇÃO
 * ---------------------------------------------------------------------
 * Regras absolutas, verificáveis lendo este arquivo inteiro:
 *   - NUNCA importa `MotorSpread`, nenhum motor, nenhuma lógica econômica.
 *   - NUNCA chama fs.writeFileSync/appendFileSync/qualquer escrita.
 *   - NUNCA importa nem depende de `src/dashboard/server.ts` (o servidor
 *     antigo) — lê os MESMOS arquivos do Snowball diretamente.
 *   - Só importa `CHALLENGERS_APROVADOS` de `src/inteligencia/
 *     challengers.ts` — é uma lista de config estática, sem efeito
 *     colateral, mesmo padrão que o servidor antigo já usava.
 *   - Roda em porta própria (padrão 5184), PID próprio, log próprio.
 *   - Não faz parte dos 8 processos supervisionados pelo watchdog do
 *     champion — tem supervisão própria (scripts/supervisor-dashboard-v2).
 *
 * Fluxo: arquivos/agregadores do Snowball → (somente leitura) → esta API
 * → frontend do Dashboard 2.0. Nunca o caminho inverso.
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CHALLENGERS_APROVADOS } from '../../src/inteligencia/challengers.ts';
import { lerJsonSeguro, caminhoAgregadoLab } from './readers/arquivos.ts';
import { buscarEventosIncremental, type EventoV2 } from './services/eventos.ts';
import { montarManifestoCobertura } from './services/cobertura.ts';
import { lerTotaisAutoritativos, construirDecomposicao } from './services/waterfall.ts';
import { montarChampionCompleto } from './services/champion.ts';
import { montarCapturaStatus } from './services/captura.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..'); // raiz do repositório Snowball
const PORTA = Number(process.env.PORTA_V2_API ?? 5184);
const DIR_LOGS = path.join(__dirname, 'logs');
const JANELA_COBERTURA_MS = 6 * 3_600_000;

fs.mkdirSync(DIR_LOGS, { recursive: true });
function log(msg: string) {
  const linha = `[${new Date().toISOString()}] ${msg}`;
  console.log(linha);
  try { fs.appendFileSync(path.join(DIR_LOGS, 'api.log'), linha + '\n'); } catch { /* log é best-effort, nunca derruba a API por causa disso */ }
}

// ── heartbeat/PID próprios (Parte 13 — supervisão independente) ─────────
interface HeartbeatV2 { pid: number; startedAt: number; ultimaRequisicao: number | null; totalRequisicoes: number; version: string }
const heartbeat: HeartbeatV2 = { pid: process.pid, startedAt: Date.now(), ultimaRequisicao: null, totalRequisicoes: 0, version: '2.0.0-api' };
function salvarHeartbeat() {
  try { fs.writeFileSync(path.join(DIR_LOGS, 'heartbeat.json'), JSON.stringify(heartbeat, null, 2)); } catch { /* best-effort */ }
}

function enviarJson(res: http.ServerResponse, status: number, corpo: unknown) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(corpo));
}

const FONTES_EVENTOS = [
  { fonte: 'champion', ehChampion: true },
  ...CHALLENGERS_APROVADOS.map((c) => ({ fonte: c.challengerId, ehChampion: false })),
];

/**
 * Status geral do Profit Lab — mesma derivação pura que o servidor antigo
 * já fazia (idade do heartbeat + taxa de erro recente), reimplementada aqui
 * pra `/api/v2/profit-lab` não depender do campo equivalente da porta 8787.
 * Achado ao vivo: esse campo tinha ficado de fora da rota V2 desde sempre —
 * o frontend validava contra o schema e falhava com "dado corrompido"
 * porque `status`/`statusMotivo` nunca vinham na resposta.
 */
function statusProfitLabV2(hb: any): { status: string; motivo: string } {
  if (!hb) return { status: 'parado', motivo: 'nenhum heartbeat encontrado — o Lab nunca rodou ou o arquivo foi apagado' };
  const idadeMin = hb.ultimoCiclo ? (Date.now() - hb.ultimoCiclo) / 60_000 : Infinity;
  if (idadeMin === Infinity) return { status: 'parado', motivo: 'heartbeat existe mas nenhum ciclo foi processado ainda' };
  if (idadeMin > 15) return { status: 'parado', motivo: `sem ciclo processado há ${idadeMin.toFixed(0)}min` };
  if (idadeMin > 6) return { status: 'stale', motivo: `último ciclo há ${idadeMin.toFixed(1)}min — mais lento que o esperado (5min)` };
  if (hb.ciclosComErro > 0 && hb.ciclosProcessados > 0 && hb.ciclosComErro / hb.ciclosProcessados > 0.2) return { status: 'degradado', motivo: 'mais de 20% dos ciclos recentes com erro' };
  return { status: 'saudavel', motivo: 'ciclos recentes e sem erro relevante' };
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

  try {
    // ── saúde da própria API ────────────────────────────────────────────
    if (url.pathname === '/api/v2/health') {
      return enviarJson(res, 200, { ok: true, ...heartbeat, uptimeMs: Date.now() - heartbeat.startedAt });
    }

    // ── champion completo (Parte 2 — paridade com o /api/dados antigo, mas
    // sem NENHUMA dependência da porta 8787: cada campo é lido direto da
    // fonte, documentado campo a campo em services/champion.ts) ──────────
    if (url.pathname === '/api/v2/champion') {
      montarChampionCompleto(ROOT)
        .then((dados) => enviarJson(res, 200, { ok: dados.estado != null, ...dados }))
        .catch((e) => { log(`ERRO em /api/v2/champion: ${(e as Error).stack}`); enviarJson(res, 500, { ok: false, erro: (e as Error).message }); });
      return;
    }

    // ── Profit Lab: agregados já prontos (o Lab calcula, esta API só lê) ─
    if (url.pathname === '/api/v2/profit-lab') {
      const dir = path.join(ROOT, 'inteligencia', 'dashboard');
      const hb = lerJsonSeguro<any>(path.join(ROOT, 'inteligencia', 'heartbeat.json'), null);
      const st = statusProfitLabV2(hb);
      return enviarJson(res, 200, {
        ok: true,
        status: st.status, statusMotivo: st.motivo,
        resumo: lerJsonSeguro(path.join(dir, 'resumo.json'), null),
        leaderboard: lerJsonSeguro(path.join(dir, 'leaderboard.json'), null),
        leaderboardMulti: lerJsonSeguro(path.join(dir, 'leaderboard-multi.json'), null),
        janelaComum: lerJsonSeguro(path.join(dir, 'janela-comum.json'), null),
        custos: lerJsonSeguro(path.join(dir, 'custos.json'), null),
        riscos: lerJsonSeguro(path.join(dir, 'riscos.json'), null),
        telemetria: lerJsonSeguro(path.join(dir, 'telemetria.json'), null),
        championVsControl: lerJsonSeguro(path.join(dir, 'champion-vs-control.json'), null),
        capturaStatus: montarCapturaStatus(ROOT),
        heartbeat: lerJsonSeguro(path.join(ROOT, 'inteligencia', 'heartbeat.json'), null),
        geradoEm: Date.now(),
      });
    }

    // ── transporte incremental de eventos (Parte 4) ──────────────────────
    if (url.pathname === '/api/v2/events') {
      const cursor = url.searchParams.get('after');
      const limit = Math.min(2000, Math.max(1, Number(url.searchParams.get('limit') ?? 200)));
      const resultado = buscarEventosIncremental(ROOT, FONTES_EVENTOS, cursor, limit);

      // cobertura (Parte 7) reusa o que este request já leu — nunca lê o
      // diário duas vezes só pra montar o manifesto
      const idsComEvento = new Set<string>(resultado.eventos.map((e: EventoV2) => e.challengerId));
      const cobertura = montarManifestoCobertura(ROOT, CHALLENGERS_APROVADOS, idsComEvento, JANELA_COBERTURA_MS);

      return enviarJson(res, 200, { ok: true, ...resultado, cobertura });
    }

    // ── waterfall reconciliado (Parte 8) ─────────────────────────────────
    if (url.pathname === '/api/v2/waterfall') {
      const autoritativo = lerTotaisAutoritativos(ROOT);
      const decomposicao = construirDecomposicao(ROOT, autoritativo);
      return enviarJson(res, 200, { ok: true, autoritativo, decomposicao, geradoEm: Date.now() });
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

process.on('SIGINT', () => { log('shutdown limpo (SIGINT)'); process.exit(0); });
process.on('SIGTERM', () => { log('shutdown limpo (SIGTERM)'); process.exit(0); });
process.on('uncaughtException', (err) => { log(`uncaughtException: ${err.stack}`); });
