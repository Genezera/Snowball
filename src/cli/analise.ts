/**
 * ANÁLISE DETALHADA DO QUE FOI COLETADO
 *
 * Lê tudo que o coletor arquivou (vigilancia/arquivo-*.jsonl) mais o diário
 * permanente do motor (spread/diario.jsonl) e produz um relatório único.
 *
 * Pensado pra rodar a qualquer momento, inclusive com pouco dado — mas
 * OS NÚMEROS SÓ SIGNIFICAM ALGO COM AMOSTRA GRANDE. Com poucas horas de
 * coleta, trate isto como "o que já dá pra ver", não como conclusão.
 *
 * NENHUMA ORDEM É ENVIADA — só leitura de arquivo local.
 */
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from '../data/store.ts';

const DIR = path.join(ROOT, 'vigilancia');
const ARQ_OBS = path.join(DIR, 'arquivo-observacoes.jsonl');
const ARQ_CICLOS = path.join(DIR, 'arquivo-ciclos.jsonl');
const ARQ_CUSTODIA = path.join(DIR, 'arquivo-custodia.jsonl');
const DIARIO = path.join(ROOT, 'spread', 'diario.jsonl');

function lerJsonl<T>(p: string): T[] {
  if (!fs.existsSync(p)) return [];
  return fs.readFileSync(p, 'utf8').trim().split('\n').filter(Boolean)
    .map((l) => { try { return JSON.parse(l) as T; } catch { return null; } })
    .filter((x): x is T => x !== null);
}

function percentil(vals: number[], p: number): number {
  if (!vals.length) return 0;
  const s = [...vals].sort((a, b) => a - b);
  const idx = Math.min(s.length - 1, Math.max(0, Math.floor((p / 100) * s.length)));
  return s[idx];
}

function fmtHoras(h: number): string {
  return h < 1 ? `${(h * 60).toFixed(0)}min` : `${h.toFixed(1)}h`;
}

function linha(w = 78) { return '─'.repeat(w); }

// ── observações brutas ──────────────────────────────────────────────────
interface Obs { ts: number; k: string; spread: number; apr: number; vol: number }
const obs = lerJsonl<Obs>(ARQ_OBS);

// ── ciclos de vida fechados ─────────────────────────────────────────────
interface CicloArquivado {
  arquivadoEm: number; chave: string; symbol: string;
  exchangeShort: string; exchangeLong: string;
  abertoEm: number; fechadoEm: number; observacoes: number;
  spreadMedio: number; spreadMax: number; spreadMin: number;
  consistencia: number; volumeMedio: number;
}
const ciclos = lerJsonl<CicloArquivado>(ARQ_CICLOS);

// ── custódia ao longo do tempo ──────────────────────────────────────────
interface CustodiaSnap { verificadoEm: number; saude: Record<string, { nivel: string; detalhe: string }> }
const custodia = lerJsonl<CustodiaSnap>(ARQ_CUSTODIA);

// ── diário do motor (permanente, sem poda) ──────────────────────────────
interface EventoDiario {
  ts: number; evento: string; symbol?: string; motivo?: string;
  capital?: number; ganho?: number; candidatasBarradas?: number;
  pctDoCaminho?: number; vidaEsperadaHoras?: number; paybackExigidoHoras?: number;
  apr?: number; spread?: number; consistencia?: number;
}
const diario = lerJsonl<EventoDiario>(DIARIO);

console.log(`\n${'='.repeat(78)}`);
console.log('ANÁLISE DO QUE FOI COLETADO');
console.log(`${'='.repeat(78)}\n`);

// ── janela de coleta ─────────────────────────────────────────────────────
const todosTs = [
  ...obs.map((o) => o.ts), ...ciclos.map((c) => c.arquivadoEm),
  ...diario.map((d) => d.ts),
].filter((t) => typeof t === 'number');
if (!todosTs.length) {
  console.log('Nada coletado ainda. Deixe o coletor rodar (`npm run coletor`) e rode de novo.\n');
  process.exit(0);
}
const inicio = Math.min(...todosTs), fim = Math.max(...todosTs);
const diasJanela = (fim - inicio) / 86_400_000;
console.log(`Janela: ${new Date(inicio).toLocaleString('pt-BR')} → ${new Date(fim).toLocaleString('pt-BR')}`);
console.log(`Duração: ${diasJanela.toFixed(2)} dias (${(diasJanela * 24).toFixed(1)}h)\n`);
if (diasJanela < 1) {
  console.log('⚠ AMOSTRA CURTA — menos de 1 dia de coleta. Os números abaixo são um retrato');
  console.log('  do que já apareceu, não uma conclusão sobre o mercado. Quanto mais tempo');
  console.log('  rodando, mais os percentis e o topo de duração vão mudar.\n');
}

// ── observações brutas ───────────────────────────────────────────────────
console.log(linha());
console.log(`OBSERVAÇÕES BRUTAS · ${obs.length} linhas`);
console.log(linha());
if (obs.length) {
  const pares = new Set(obs.map((o) => o.k));
  const aprs = obs.map((o) => o.apr * 100);
  console.log(`  pares únicos observados: ${pares.size}`);
  console.log(`  APR — mediana ${percentil(aprs, 50).toFixed(1)}% · p90 ${percentil(aprs, 90).toFixed(1)}% · máximo ${Math.max(...aprs).toFixed(1)}%`);
  const top = [...obs].sort((a, b) => b.apr - a.apr).slice(0, 5);
  console.log(`\n  top 5 APR instantâneo já visto (pico, não é média — cuidado ao interpretar):`);
  for (const o of top) {
    console.log(`    ${o.k.padEnd(38)} ${(o.apr * 100).toFixed(1)}% · ${new Date(o.ts).toLocaleString('pt-BR')}`);
  }
}
console.log();

// ── ciclos de vida fechados ──────────────────────────────────────────────
console.log(linha());
console.log(`CICLOS DE VIDA FECHADOS · ${ciclos.length}`);
console.log(linha());
if (ciclos.length) {
  const duracoes = ciclos.map((c) => (c.fechadoEm - c.abertoEm) / 3_600_000);
  console.log(`  duração — mediana ${fmtHoras(percentil(duracoes, 50))} · p75 ${fmtHoras(percentil(duracoes, 75))} · máxima ${fmtHoras(Math.max(...duracoes))}`);
  const faixas = [
    { nome: '< 30min', min: 0, max: 0.5 },
    { nome: '30min–2h', min: 0.5, max: 2 },
    { nome: '2h–6h', min: 2, max: 6 },
    { nome: '6h–24h', min: 6, max: 24 },
    { nome: '> 24h', min: 24, max: Infinity },
  ];
  console.log(`\n  distribuição:`);
  for (const f of faixas) {
    const n = duracoes.filter((d) => d >= f.min && d < f.max).length;
    const pct = (n / duracoes.length * 100).toFixed(0);
    console.log(`    ${f.nome.padEnd(12)} ${String(n).padStart(5)} (${pct}%) ${'█'.repeat(Math.round(Number(pct) / 2))}`);
  }
  const maisLongos = [...ciclos].sort((a, b) => (b.fechadoEm - b.abertoEm) - (a.fechadoEm - a.abertoEm)).slice(0, 10);
  console.log(`\n  top 10 mais duradouros:`);
  for (const c of maisLongos) {
    const d = (c.fechadoEm - c.abertoEm) / 3_600_000;
    console.log(`    ${c.symbol.replace('/USDT:USDT', '').padEnd(12)} ${c.exchangeShort}→${c.exchangeLong.padEnd(14)} ${fmtHoras(d).padStart(8)} · consistência ${(c.consistencia * 100).toFixed(0)}% · ${c.observacoes} obs`);
  }
} else {
  console.log('  nenhum ciclo fechou ainda dentro da janela coletada.');
}
console.log();

// ── decisões do motor ────────────────────────────────────────────────────
console.log(linha());
console.log(`DECISÕES DO MOTOR (spread/diario.jsonl) · ${diario.length} eventos`);
console.log(linha());
const porTipo = new Map<string, number>();
for (const e of diario) porTipo.set(e.evento, (porTipo.get(e.evento) ?? 0) + 1);
for (const [tipo, n] of [...porTipo].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${tipo.padEnd(14)} ${n}`);
}
const aberturas = diario.filter((e) => e.evento === 'abre');
const fechamentos = diario.filter((e) => e.evento === 'fecha');
const fundingRecebido = diario.filter((e) => e.evento === 'funding').reduce((x, e) => x + (e.ganho ?? 0), 0);
console.log(`\n  aberturas: ${aberturas.length} · fechamentos: ${fechamentos.length} · funding total recebido: US$ ${fundingRecebido.toFixed(4)}`);

// quão perto chegou de abrir, entre os bloqueados por payback
const bloqueadosComNumero = diario.filter((e) => e.evento === 'bloqueado' && typeof e.pctDoCaminho === 'number');
if (bloqueadosComNumero.length) {
  const porSymbol = new Map<string, EventoDiario>();
  for (const e of bloqueadosComNumero) {
    const atual = porSymbol.get(e.symbol!);
    if (!atual || (e.pctDoCaminho ?? 0) > (atual.pctDoCaminho ?? 0)) porSymbol.set(e.symbol!, e);
  }
  const maisPerto = [...porSymbol.values()].sort((a, b) => (b.pctDoCaminho ?? 0) - (a.pctDoCaminho ?? 0)).slice(0, 5);
  console.log(`\n  candidatos que chegaram mais perto do portão (maior % do caminho já visto):`);
  for (const e of maisPerto) {
    console.log(
      `    ${(e.symbol ?? '?').replace('/USDT:USDT', '').padEnd(12)} ` +
      `${(e.pctDoCaminho ?? 0).toFixed(0)}% do caminho · vida ${fmtHoras(e.vidaEsperadaHoras ?? 0)} de ${fmtHoras(e.paybackExigidoHoras ?? 0)} exigidas · ` +
      `APR ${((e.apr ?? 0) * 100).toFixed(1)}%`,
    );
  }
}
console.log();

// ── custódia ao longo do tempo ───────────────────────────────────────────
console.log(linha());
console.log(`CUSTÓDIA · ${custodia.length} amostras`);
console.log(linha());
if (custodia.length) {
  const eventos: string[] = [];
  for (const snap of custodia) {
    for (const [ex, s] of Object.entries(snap.saude)) {
      if (s.nivel !== 'ok') eventos.push(`${new Date(snap.verificadoEm).toLocaleString('pt-BR')} · ${ex} · ${s.nivel} · ${s.detalhe}`);
    }
  }
  if (eventos.length) {
    console.log(`  ${eventos.length} amostra(s) com exchange fora de "ok":`);
    for (const e of eventos.slice(0, 20)) console.log(`    ${e}`);
    if (eventos.length > 20) console.log(`    ... e mais ${eventos.length - 20}`);
  } else {
    console.log('  todas as amostras vieram "ok" — nenhum sinal de degradação na janela coletada.');
  }
} else {
  console.log('  nenhuma amostra ainda.');
}
console.log(`\n${'='.repeat(78)}\n`);
