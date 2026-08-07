/**
 * SUPERVISÃO DO LAB — heartbeat, lock contra instância duplicada, detecção
 * de estado corrompido. Completamente separado do watchdog dos 8 processos
 * do champion (`scripts/supervisor.sh`) — o Lab pode cair e ser religado sem
 * qualquer relação com o champion, de propósito (Parte 6: "continuará
 * completamente separado dos oito processos do champion").
 */
import fs from 'node:fs';
import path from 'node:path';

export interface HeartbeatLab {
  pid: number;
  startedAt: number;
  ultimoCiclo: number;
  ciclosProcessados: number;
  ciclosComErro: number;
  reinicios: number;
  statusPorChallenger: Record<string, 'ok' | 'erro' | 'eliminado'>;
  ultimoEstadoSalvo: number;
  /** funil de oportunidades (Parte 9/22 do dashboard) — acumulado desde startedAt, nunca recalculado a partir de histórico */
  ciclosComCandidata: number;
  ciclosSemCandidata: number;
  observadasAcumuladas: number;
  /** janela recente de latência total por ciclo, em ms — cap de 200 amostras, pra p50/p95/p99/max sem reler histórico */
  latenciasRecentesMs: number[];
  /** últimos erros com timestamp — usado pra "erros nas últimas 24h" na barra de status, sem reler log inteiro */
  errosRecentes: { ts: number; mensagem: string }[];
}

function caminhoHeartbeat(root: string): string {
  return path.join(root, 'inteligencia', 'heartbeat.json');
}
function caminhoLock(root: string): string {
  return path.join(root, 'inteligencia', 'lab.lock');
}

/**
 * Tenta travar. Devolve `null` se já existe um lock de um PID que ainda está
 * vivo (outra instância do Lab rodando) — quem chama deve recusar subir.
 * Um lock de PID morto é tratado como resíduo de um shutdown sujo e
 * substituído, não como impedimento (retomada idempotente, Parte 6).
 */
export function travar(root: string): { pid: number } | null {
  const p = caminhoLock(root);
  if (fs.existsSync(p)) {
    try {
      const existente = JSON.parse(fs.readFileSync(p, 'utf8')) as { pid: number };
      if (processoVivo(existente.pid)) return null; // outra instância real rodando
    } catch { /* lock corrompido — trata como morto, sobrescreve */ }
  }
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const registro = { pid: process.pid, ts: Date.now() };
  fs.writeFileSync(p, JSON.stringify(registro));
  return { pid: process.pid };
}

export function destravar(root: string): void {
  const p = caminhoLock(root);
  try { fs.unlinkSync(p); } catch { /* já não existe — shutdown limpo mesmo assim */ }
}

function processoVivo(pid: number): boolean {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

export function novoHeartbeat(): HeartbeatLab {
  return {
    pid: process.pid, startedAt: Date.now(), ultimoCiclo: 0,
    ciclosProcessados: 0, ciclosComErro: 0, reinicios: 0,
    statusPorChallenger: {}, ultimoEstadoSalvo: 0,
    ciclosComCandidata: 0, ciclosSemCandidata: 0, observadasAcumuladas: 0,
    latenciasRecentesMs: [], errosRecentes: [],
  };
}

const MAX_LATENCIAS_GUARDADAS = 200;
const MAX_ERROS_GUARDADOS = 50;

/** Anexa uma amostra de latência ao heartbeat, mantendo só a janela recente (mutação in-place, quem chama salva depois). */
export function registrarLatencia(hb: HeartbeatLab, ms: number): void {
  hb.latenciasRecentesMs.push(ms);
  if (hb.latenciasRecentesMs.length > MAX_LATENCIAS_GUARDADAS) hb.latenciasRecentesMs.splice(0, hb.latenciasRecentesMs.length - MAX_LATENCIAS_GUARDADAS);
}

/** Anexa um erro com timestamp — "erros nas últimas 24h" da barra de status filtra por idade na leitura, não aqui. */
export function registrarErro(hb: HeartbeatLab, mensagem: string): void {
  hb.errosRecentes.push({ ts: Date.now(), mensagem: mensagem.slice(0, 300) });
  if (hb.errosRecentes.length > MAX_ERROS_GUARDADOS) hb.errosRecentes.splice(0, hb.errosRecentes.length - MAX_ERROS_GUARDADOS);
}

/** Erros com timestamp dentro da janela — usado pra "erros nas últimas 24h" sem guardar 24h inteiras de amostras. */
export function errosNaJanela(hb: HeartbeatLab, janelaMs = 24 * 3_600_000): number {
  const limite = Date.now() - janelaMs;
  return hb.errosRecentes.filter((e) => e.ts >= limite).length;
}

/** Migração leve: heartbeat salvo por uma versão anterior, sem os campos de funil/latência/erro. */
function migrarHeartbeatSeNecessario(hb: HeartbeatLab): HeartbeatLab {
  if (hb.ciclosComCandidata == null) hb.ciclosComCandidata = 0;
  if (hb.ciclosSemCandidata == null) hb.ciclosSemCandidata = 0;
  if (hb.observadasAcumuladas == null) hb.observadasAcumuladas = 0;
  if (hb.latenciasRecentesMs == null) hb.latenciasRecentesMs = [];
  if (hb.errosRecentes == null) hb.errosRecentes = [];
  return hb;
}

/** Carrega o heartbeat anterior se existir (retomada idempotente) e incrementa reinícios. */
export function carregarOuRetomar(root: string): HeartbeatLab {
  const p = caminhoHeartbeat(root);
  if (fs.existsSync(p)) {
    try {
      const anterior = migrarHeartbeatSeNecessario(JSON.parse(fs.readFileSync(p, 'utf8')) as HeartbeatLab);
      return {
        ...anterior, pid: process.pid, startedAt: Date.now(),
        reinicios: (anterior.reinicios ?? 0) + 1,
      };
    } catch {
      // JSON corrompido — não propaga o erro, começa um heartbeat novo e
      // registra a detecção (quem chama decide se loga)
      return novoHeartbeat();
    }
  }
  return novoHeartbeat();
}

export function salvarHeartbeat(root: string, hb: HeartbeatLab): void {
  const p = caminhoHeartbeat(root);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(hb, null, 2));
}

/** Idade do último ciclo em ms — usado por quem for alertar "Lab parado" de fora. */
export function idadeUltimoCiclo(hb: HeartbeatLab): number {
  return hb.ultimoCiclo > 0 ? Date.now() - hb.ultimoCiclo : Infinity;
}

/** Limiar sugerido: 3x o intervalo esperado do ciclo já é "provavelmente parado". */
export function labProvavelmenteParado(hb: HeartbeatLab, intervaloEsperadoMs: number): boolean {
  return idadeUltimoCiclo(hb) > intervaloEsperadoMs * 3;
}
