/**
 * CONTROLES DO DASHBOARD (Parte 18 do "Paper Profit Dashboard") — a ÚNICA
 * porta de escrita que o dashboard tem sobre o Paper Profit Lab. Superfície
 * deliberadamente pequena:
 *
 *   - pausar / retomar um challenger JÁ APROVADO (challengers.ts)
 *   - adicionar observação (texto livre, nunca lido pela lógica de decisão)
 *   - marcar status de experimento (bookkeeping, nunca influencia PnL)
 *
 * O que NÃO existe aqui, de propósito, porque o pedido original marca como
 * proibido: editar código, criar challenger arbitrário, alterar o champion,
 * enviar ordem, mexer em dinheiro real, promover pra live, mudar limite
 * real. "Duplicar configuração como nova versão" (também pedido) fica de
 * fora por ambiguidade de escopo — duplicar de verdade exigiria o poder de
 * criar uma config nova em `challengers.ts`, que é exatamente o que este
 * módulo se recusa a fazer. Ver nota em `duplicarComoNovaVersao()`.
 *
 * Toda ação passa por `registrarAuditoria()` antes de retornar — nunca há
 * mutação de estado sem o evento correspondente em `auditoria.jsonl`.
 */
import fs from 'node:fs';
import path from 'node:path';
import { CHALLENGERS_APROVADOS } from './challengers.ts';
import { carregarEstado, salvarEstado, type ConfigChallenger, type EstadoVirtual } from './virtual-portfolio.ts';

export interface EventoAuditoria {
  ts: number;
  usuario: string;
  acao: 'pausar' | 'retomar' | 'observacao' | 'concluir-experimento' | 'duplicar-negado';
  challenger: string;
  versao?: string;
  configuracaoAnterior?: unknown;
  configuracaoNova?: unknown;
  motivo: string;
}

export interface ResultadoControle {
  ok: boolean;
  erro?: string;
}

function caminhoAuditoria(root: string): string {
  return path.join(root, 'inteligencia', 'auditoria.jsonl');
}

function registrarAuditoria(root: string, evento: EventoAuditoria): void {
  const p = caminhoAuditoria(root);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.appendFileSync(p, JSON.stringify(evento) + '\n');
}

export function lerAuditoria(root: string, limite = 200): EventoAuditoria[] {
  const p = caminhoAuditoria(root);
  if (!fs.existsSync(p)) return [];
  const linhas = fs.readFileSync(p, 'utf8').trim().split('\n').filter(Boolean);
  return linhas.slice(-limite).map((l) => { try { return JSON.parse(l) as EventoAuditoria; } catch { return null; } })
    .filter((x): x is EventoAuditoria => x !== null).reverse();
}

/**
 * O ÚNICO ponto de verdade sobre "isto é um challenger aprovado" — qualquer
 * ID que não esteja em `CHALLENGERS_APROVADOS` é recusado, sem exceção. É a
 * garantia de que o dashboard nunca controla nada fora da lista revisada em
 * código.
 */
function cfgAprovada(challengerId: string): ConfigChallenger | null {
  return CHALLENGERS_APROVADOS.find((c) => c.challengerId === challengerId) ?? null;
}

export function pausarChallenger(root: string, challengerId: string, usuario: string, motivo: string): ResultadoControle {
  const cfg = cfgAprovada(challengerId);
  if (!cfg) return { ok: false, erro: `"${challengerId}" não está na lista de challengers aprovados` };
  if (!motivo || !motivo.trim()) return { ok: false, erro: 'motivo é obrigatório para pausar' };
  const e = carregarEstado(root, cfg);
  if (e.pausado) return { ok: false, erro: 'já está pausado' };
  e.pausado = { ts: Date.now(), motivo, usuario };
  e.experimentoStatus = 'pausado';
  salvarEstado(root, e);
  registrarAuditoria(root, { ts: Date.now(), usuario, acao: 'pausar', challenger: challengerId, versao: cfg.configVersion, motivo });
  return { ok: true };
}

export function retomarChallenger(root: string, challengerId: string, usuario: string, motivo: string): ResultadoControle {
  const cfg = cfgAprovada(challengerId);
  if (!cfg) return { ok: false, erro: `"${challengerId}" não está na lista de challengers aprovados` };
  const e = carregarEstado(root, cfg);
  if (!e.pausado) return { ok: false, erro: 'não está pausado' };
  e.pausado = undefined;
  e.experimentoStatus = 'rodando';
  salvarEstado(root, e);
  registrarAuditoria(root, { ts: Date.now(), usuario, acao: 'retomar', challenger: challengerId, versao: cfg.configVersion, motivo: motivo || 'retomado sem motivo declarado' });
  return { ok: true };
}

export function adicionarObservacao(root: string, challengerId: string, usuario: string, texto: string): ResultadoControle {
  const cfg = cfgAprovada(challengerId);
  if (!cfg) return { ok: false, erro: `"${challengerId}" não está na lista de challengers aprovados` };
  if (!texto || !texto.trim()) return { ok: false, erro: 'observação vazia' };
  const e = carregarEstado(root, cfg);
  (e.observacoes ??= []).push({ ts: Date.now(), usuario, texto: texto.slice(0, 2000) });
  salvarEstado(root, e);
  registrarAuditoria(root, { ts: Date.now(), usuario, acao: 'observacao', challenger: challengerId, versao: cfg.configVersion, motivo: texto.slice(0, 200) });
  return { ok: true };
}

const STATUS_VALIDOS = new Set(['planejado', 'rodando', 'pausado', 'concluido', 'eliminado', 'inconclusivo']);

export function marcarStatusExperimento(root: string, challengerId: string, usuario: string, status: string, motivo: string): ResultadoControle {
  const cfg = cfgAprovada(challengerId);
  if (!cfg) return { ok: false, erro: `"${challengerId}" não está na lista de challengers aprovados` };
  if (!STATUS_VALIDOS.has(status)) return { ok: false, erro: `status inválido: ${status}` };
  const e = carregarEstado(root, cfg);
  const anterior = e.experimentoStatus;
  e.experimentoStatus = status as EstadoVirtual['experimentoStatus'];
  salvarEstado(root, e);
  registrarAuditoria(root, {
    ts: Date.now(), usuario, acao: 'concluir-experimento', challenger: challengerId, versao: cfg.configVersion,
    configuracaoAnterior: anterior, configuracaoNova: status, motivo: motivo || `status alterado para ${status}`,
  });
  return { ok: true };
}

/**
 * "Duplicar configuração como nova versão" — pedido no requisito, mas
 * deliberadamente NÃO implementado como criação real de challenger. Um
 * challenger novo só pode nascer de uma revisão de código em
 * `challengers.ts` (mesma disciplina de todo o resto do Lab: "não é uma
 * decisão em tempo de execução"). Esta função existe só pra dar uma resposta
 * honesta e auditável quando alguém tenta pelo dashboard, em vez de a rota
 * simplesmente não existir e parecer um bug.
 */
export function duplicarComoNovaVersao(root: string, challengerId: string, usuario: string): ResultadoControle {
  registrarAuditoria(root, {
    ts: Date.now(), usuario, acao: 'duplicar-negado', challenger: challengerId,
    motivo: 'duplicar como nova versão exige uma config nova em challengers.ts, revisada em código — o dashboard não cria challenger novo',
  });
  return { ok: false, erro: 'não disponível no dashboard — duplicar uma configuração exige revisão de código em challengers.ts' };
}

export function listarAprovados(): ConfigChallenger[] {
  return CHALLENGERS_APROVADOS;
}
