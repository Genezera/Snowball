/**
 * CHAMPION — parte 2 do pedido "Isolamento Real": tudo que `/api/v2/champion`
 * devolve é lido diretamente das MESMAS fontes que o servidor antigo lê,
 * nunca do servidor antigo em si (nenhum fetch pra porta 8787 aqui).
 *
 * Documentação por campo (arquivo de origem · tipo · unidade · janela ·
 * timestamp · autoritativo/derivado) fica no comentário acima de cada
 * função — não num arquivo separado, pra nunca dessincronizar do código.
 */
import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import { exec } from 'node:child_process';
import { lerVigilancia, saudeVigilancia } from '../../../src/funding/ponte.ts';
import { lerJsonlComNumeroDeLinha, lerJsonSeguro } from '../readers/arquivos.ts';
import { lerTotaisAutoritativos, construirDecomposicao, type TotaisVitalicios, type DecomposicaoBuckets } from './waterfall.ts';

const execAsync = promisify(exec);

/**
 * campo: estado
 * origem: spread/estado.json (autoritativo — o motor real escreve aqui)
 * tipo: objeto | null · unidade: mista (capital em USD) · janela: snapshot atual
 * timestamp: mtime do arquivo · autoritativo
 */
export function lerEstadoChampion(root: string): any | null {
  return lerJsonSeguro(path.join(root, 'spread', 'estado.json'), null);
}

/**
 * campo: marcacao (equityMark, equityLiquidacao inclusos)
 * origem: spread/marcacao.json — escrito pelo motor a cada ciclo de marcação
 * tipo: objeto | null · unidade: USD · janela: snapshot atual
 * timestamp: campo geradoEm dentro do próprio arquivo · autoritativo
 */
export function lerMarcacaoChampion(root: string): any | null {
  return lerJsonSeguro(path.join(root, 'spread', 'marcacao.json'), null);
}

export interface PontoCurva { ts: number; capital: number; evento?: string }
export interface PagamentoDia { dia: string; total: number }

/**
 * campo: curva, pagamentosPorDia
 * origem: spread/diario.jsonl (linhas com `capital` viram ponto da curva;
 * linhas com evento="funding" agregam por dia UTC)
 * tipo: array · unidade: USD por ponto · janela: últimas `limite` linhas do diário
 * timestamp: por ponto (campo ts de cada linha) · DERIVADO — reconstrução por
 * leitura sequencial do diário, mesma lógica que o servidor antigo já fazia
 * (não é um cálculo financeiro novo: só agrupa valores que o motor já gravou)
 */
export function construirCurvaEPagamentos(root: string, limite = 4000): { curva: PontoCurva[]; pagamentosPorDia: PagamentoDia[] } {
  const p = path.join(root, 'spread', 'diario.jsonl');
  if (!fs.existsSync(p)) return { curva: [], pagamentosPorDia: [] };
  const todas = lerJsonlComNumeroDeLinha(p);
  const usadas = todas.slice(-limite);
  const curva: PontoCurva[] = [];
  const porDia = new Map<string, number>();
  for (const { linha } of usadas) {
    const e = linha as any;
    if (e.capital != null) curva.push({ ts: e.ts, capital: e.capital, evento: e.evento });
    if (e.evento === 'funding') {
      const d = new Date(e.ts).toISOString().slice(0, 10);
      porDia.set(d, (porDia.get(d) ?? 0) + (e.ganho ?? 0));
    }
  }
  return { curva, pagamentosPorDia: [...porDia].map(([dia, total]) => ({ dia, total })) };
}

/**
 * campo: vigilancia
 * origem: vigilancia/ciclos.json, via `../../src/funding/ponte.ts` (funções
 * exportadas puras, sem efeito colateral — mesmo padrão de reuso já usado
 * pra `CHALLENGERS_APROVADOS`)
 * tipo: objeto · unidade: mista · janela: snapshot da última varredura
 * timestamp: idadeMinutos relativo a ultimaVarredura · DERIVADO (ranking) mas
 * sobre dado autoritativo (a vigilância é quem escreve ciclos.json)
 */
export function lerVigilanciaChampion(): any {
  const vig = lerVigilancia(3);
  const saude = saudeVigilancia();
  return {
    ...saude,
    fonte: vig.disponivel && vig.oportunidades.length > 0 ? 'vigilância · mercado inteiro' : 'vigilância indisponível',
    motivo: vig.motivo,
    candidatos: vig.oportunidades.length,
  };
}

const PROCESSOS_ESPERADOS = [
  { chave: 'vigilancia', nome: 'Vigilância', padrao: 'vigilancia.ts' },
  { chave: 'custodia', nome: 'Custódia', padrao: 'custodia.ts' },
  { chave: 'motor', nome: 'Motor', padrao: 'spread-live.ts' },
  { chave: 'dashboard', nome: 'Dashboard (antigo)', padrao: 'server.ts' },
  { chave: 'coletor', nome: 'Coletor', padrao: 'coletor.ts' },
  { chave: 'momentum', nome: 'Modo Agressivo', padrao: 'momentum-live.ts' },
  { chave: 'preenchimento', nome: 'Preenchimento', padrao: 'preenchimento-live.ts' },
  { chave: 'pares', nome: 'Pares', padrao: 'pares-live.ts' },
];

let cacheProcessos: { ts: number; dados: any[] } = { ts: 0, dados: [] };

/**
 * campo: processos
 * origem: consulta OS via PowerShell (Get-CimInstance Win32_Process) —
 * NUNCA lê nada do servidor antigo, é uma leitura independente do SO,
 * mesmo padrão que o servidor antigo já usa (nenhuma escrita, nenhum sinal
 * enviado a processo nenhum)
 * tipo: array · unidade: memoriaMB em MB, desde em epoch ms · janela: snapshot
 * timestamp: cache de 10s · DERIVADO (leitura de SO, não de arquivo do Snowball)
 */
export async function saudeProcessosV2(): Promise<any[]> {
  if (Date.now() - cacheProcessos.ts < 10_000) return cacheProcessos.dados;
  try {
    const { stdout } = await execAsync(
      'powershell -NoProfile -Command "Get-CimInstance Win32_Process -Filter \\"Name=\'node.exe\'\\" ' +
      '| Select-Object CommandLine,WorkingSetSize,CreationDate | ConvertTo-Json -Compress"',
      { timeout: 8000 },
    );
    let lista: any = [];
    try { lista = JSON.parse(stdout || '[]'); } catch { lista = []; }
    const arr = Array.isArray(lista) ? lista : (lista ? [lista] : []);
    const dados = PROCESSOS_ESPERADOS.map((p) => {
      const proc = arr.find((x: any) => typeof x.CommandLine === 'string' && x.CommandLine.includes(p.padrao));
      let desde = 0;
      if (proc?.CreationDate) {
        const m = /\/Date\((\d+)\)\//.exec(proc.CreationDate);
        desde = m ? Number(m[1]) : Date.parse(proc.CreationDate) || 0;
      }
      return { ...p, vivo: !!proc, memoriaMB: proc ? Math.round((proc.WorkingSetSize ?? 0) / 1e6) : 0, desde };
    });
    cacheProcessos = { ts: Date.now(), dados };
    return dados;
  } catch {
    return cacheProcessos.dados.length ? cacheProcessos.dados : PROCESSOS_ESPERADOS.map((p) => ({ ...p, vivo: false, memoriaMB: 0, desde: 0 }));
  }
}

/**
 * campo: posicoes[].distanciaShort/distanciaLong/distanciaMinima/pernaEmRisco/horasAberta
 * origem: derivado de spread/estado.json (margemShort/margemLong/notionalPorPerna/abertaEm,
 * todos autoritativos) — MESMA fórmula que o servidor antigo usa em
 * `montarDados()`, só que sem preço ao vivo: aquele é um cache em memória
 * do PROCESSO do servidor antigo (tick de WebSocket), nunca persistido em
 * disco — a V2 não tem como ler isso sem depender do processo antigo, então
 * honestamente omite (`precoAoVivoShort/Long: null`) em vez de fabricar.
 * tipo: número (fração) · janela: snapshot atual · DERIVADO
 */
function enriquecerPosicoes(estado: any | null): any[] {
  const abertas: any[] = estado?.posicoes ?? (estado?.posicao ? [estado.posicao] : []);
  const mmr = 0.01;
  return abertas.map((p) => {
    const dShort = p.margemShort / p.notionalPorPerna - mmr;
    const dLong = p.margemLong / p.notionalPorPerna - mmr;
    return {
      ...p,
      distanciaShort: dShort, distanciaLong: dLong,
      distanciaMinima: Math.min(dShort, dLong),
      pernaEmRisco: dShort <= dLong ? 'short' : 'long',
      horasAberta: (Date.now() - p.abertaEm) / 3_600_000,
      precoAoVivoShort: null, precoAoVivoLong: null, // honestamente ausente — ver comentário acima
    };
  });
}

export interface ChampionCompleto {
  estado: any | null;
  marcacao: any | null;
  posicoes: any[];
  curva: PontoCurva[];
  pagamentosPorDia: PagamentoDia[];
  processos: any[];
  vigilancia: any;
  custos: { autoritativo: TotaisVitalicios | null; decomposicao: DecomposicaoBuckets | null };
  equityMark: number | null;
  equityLiquidacao: number | null;
  fundingTotal: number | null;
  custosTotal: number | null;
  pnlRealizado: number | null;
  atualizadoEm: number;
}

/**
 * campo: equityMark, equityLiquidacao
 * origem: spread/marcacao.json (mesmos campos, passthrough) · autoritativo
 * campo: fundingTotal, custosTotal, pnlRealizado
 * origem: spread/estado.json via lerTotaisAutoritativos (waterfall.ts) ·
 * autoritativo — MESMA fonte usada por /api/v2/waterfall, nunca duas
 * leituras divergentes do mesmo total em endpoints diferentes
 */
export async function montarChampionCompleto(root: string): Promise<ChampionCompleto> {
  const estado = lerEstadoChampion(root);
  const marcacao = lerMarcacaoChampion(root);
  const { curva, pagamentosPorDia } = construirCurvaEPagamentos(root);
  const processos = await saudeProcessosV2();
  const vigilancia = lerVigilanciaChampion();
  const autoritativo = lerTotaisAutoritativos(root);
  const decomposicao = construirDecomposicao(root, autoritativo);
  return {
    estado, marcacao,
    posicoes: enriquecerPosicoes(estado),
    curva, pagamentosPorDia, processos, vigilancia,
    custos: { autoritativo, decomposicao },
    equityMark: marcacao?.equityMark ?? null,
    equityLiquidacao: marcacao?.equityLiquidacao ?? null,
    fundingTotal: autoritativo?.fundingTotalLifetime ?? null,
    custosTotal: autoritativo?.custosTotalLifetime ?? null,
    pnlRealizado: autoritativo?.pnlRealizadoLifetime ?? null,
    atualizadoEm: Date.now(),
  };
}
