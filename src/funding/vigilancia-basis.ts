/**
 * VIGILÂNCIA DE BASIS — o mesmo tratamento rigoroso que vigilancia.ts já dá
 * ao spread entre exchanges, aplicado a candidatos de basis trade (funding
 * de UMA exchange só, ver basis.ts).
 *
 * Arquivo separado, não toca em vigilancia.ts — o rastreador de spread
 * entre exchanges está provado (dias de coleta, corrigiu o bug do
 * "piscar") e não há motivo pra arriscar isso por uma feature nova.
 *
 * Reaproveita a MESMA varredura de mercado que a vigilância de spread já
 * faz a cada 5 min (`observar()` agora devolve os `pares` individuais,
 * antes de cruzar) — não escaneia o mercado uma segunda vez.
 *
 * Mesma lição já aprendida aplicada de novo: TOLERÂNCIA A FALTAS. Um
 * candidato que sai do ranking por uma leitura (thin volume momentâneo,
 * exchange lenta) não é o mesmo que um funding que realmente virou negativo.
 * Fechar na primeira ausência mediria o buraco, não o mercado — foi
 * exatamente esse bug que custou dinheiro de verdade na vigilância
 * original.
 *
 * `processarPassada` é pura (sem disco) de propósito, pra ser testável sem
 * mock de arquivo — mesmo padrão de `coleta.ts`. Quem lê e escreve é
 * `atualizarBasis`.
 */
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from '../data/store.ts';
import { candidatosBasis, type CandidatoBasis, type ParFunding } from './basis.ts';

const DIR = path.join(ROOT, 'vigilancia');
const HISTORICO = path.join(DIR, 'historico-basis.jsonl');
const CICLOS = path.join(DIR, 'ciclos-basis.json');

/** Mesma tolerância da vigilância original — 3 faltas a 5min/varredura = 15min. */
export const TOLERANCIA_FALTAS_BASIS = 3;
export const VOLUME_MINIMO_BASIS = 1e6;

export const chaveBasis = (c: { symbol: string; exchange: string }) => `${c.symbol}|${c.exchange}`;

export interface CicloBasis {
  chave: string;
  symbol: string;
  exchange: string;
  abertoEm: number;
  fechadoEm?: number;
  observacoes: number;
  funding8hMedio: number;
  funding8hMax: number;
  funding8hMin: number;
  /** fração das observações em que o candidato se manteve acima do mínimo */
  consistencia: number;
  /** varreduras seguidas sem ver este candidato; zera a cada avistamento */
  faltas?: number;
  volumeMedio: number;
}

export interface EstadoVigilanciaBasis {
  iniciadoEm: number;
  varreduras: number;
  ciclos: Record<string, CicloBasis>;
  ultimaVarredura: number;
}

/**
 * O núcleo, sem disco: dado o estado atual e os candidatos vistos agora,
 * atualiza `estado.ciclos` in-place e devolve o que é novo e o que fechou.
 */
export function processarPassada(
  estado: EstadoVigilanciaBasis,
  candidatos: CandidatoBasis[],
  agora: number,
): { novas: CandidatoBasis[]; fechadas: CicloBasis[] } {
  const vistas = new Set(candidatos.map(chaveBasis));
  const novas: CandidatoBasis[] = [];
  const fechadas: CicloBasis[] = [];

  for (const c of candidatos) {
    const k = chaveBasis(c);
    const existente = estado.ciclos[k];
    if (!existente || existente.fechadoEm) {
      estado.ciclos[k] = {
        chave: k, symbol: c.symbol, exchange: c.exchange,
        abertoEm: agora, observacoes: 1,
        funding8hMedio: c.funding8h, funding8hMax: c.funding8h, funding8hMin: c.funding8h,
        consistencia: 1, volumeMedio: c.volume24h,
      };
      novas.push(c);
    } else {
      const n = existente.observacoes + 1;
      existente.funding8hMedio = (existente.funding8hMedio * existente.observacoes + c.funding8h) / n;
      existente.funding8hMax = Math.max(existente.funding8hMax, c.funding8h);
      existente.funding8hMin = Math.min(existente.funding8hMin, c.funding8h);
      existente.volumeMedio = (existente.volumeMedio * existente.observacoes + c.volume24h) / n;
      existente.observacoes = n;
      existente.consistencia = 1;
      existente.faltas = 0;
    }
  }

  for (const [k, c] of Object.entries(estado.ciclos)) {
    if (c.fechadoEm || vistas.has(k)) continue;
    c.faltas = (c.faltas ?? 0) + 1;
    if (c.faltas >= TOLERANCIA_FALTAS_BASIS) {
      c.fechadoEm = agora;
      fechadas.push(c);
    }
  }

  estado.varreduras++;
  const intervaloMedio = estado.ultimaVarredura
    ? (agora - estado.iniciadoEm) / Math.max(1, estado.varreduras)
    : 0;
  for (const c of Object.values(estado.ciclos)) {
    if (c.fechadoEm || !intervaloMedio) continue;
    const esperadas = Math.max(1, Math.round((agora - c.abertoEm) / intervaloMedio) + 1);
    c.consistencia = Math.min(1, c.observacoes / esperadas);
  }
  estado.ultimaVarredura = agora;

  return { novas, fechadas };
}

function carregar(): EstadoVigilanciaBasis {
  if (fs.existsSync(CICLOS)) {
    try { return JSON.parse(fs.readFileSync(CICLOS, 'utf8')); } catch { /* recomeça do zero */ }
  }
  return { iniciadoEm: Date.now(), varreduras: 0, ciclos: {}, ultimaVarredura: 0 };
}

function salvar(e: EstadoVigilanciaBasis) {
  fs.mkdirSync(DIR, { recursive: true });
  fs.writeFileSync(CICLOS, JSON.stringify(e, null, 2));
}

/** Uma passada de verdade, a partir dos `pares` que a vigilância de spread já buscou. */
export function atualizarBasis(
  pares: ParFunding[],
  volumeMinimo = VOLUME_MINIMO_BASIS,
): { estado: EstadoVigilanciaBasis; candidatos: CandidatoBasis[]; novas: CandidatoBasis[]; fechadas: CicloBasis[] } {
  const estado = carregar();
  const agora = Date.now();
  const candidatos = candidatosBasis(pares, volumeMinimo);

  const linhas = candidatos.map((c) =>
    JSON.stringify({ ts: agora, k: chaveBasis(c), funding8h: c.funding8h, apr: c.aprFunding, vol: c.volume24h }));

  const { novas, fechadas } = processarPassada(estado, candidatos, agora);

  if (linhas.length) {
    fs.mkdirSync(DIR, { recursive: true });
    fs.appendFileSync(HISTORICO, linhas.join('\n') + '\n');
  }
  salvar(estado);

  return { estado, candidatos, novas, fechadas };
}

/** Poda o histórico depois de N dias — mesma política da vigilância original. */
export function podarBasis(diasParaManter = 7) {
  if (fs.existsSync(HISTORICO)) {
    const corte = Date.now() - diasParaManter * 86_400_000;
    const linhas = fs.readFileSync(HISTORICO, 'utf8').trim().split('\n').filter(Boolean);
    const mantidas = linhas.filter((l) => { try { return JSON.parse(l).ts >= corte; } catch { return false; } });
    fs.writeFileSync(HISTORICO, mantidas.join('\n') + (mantidas.length ? '\n' : ''));
  }
  const estado = carregar();
  const corte = Date.now() - diasParaManter * 86_400_000;
  for (const [k, c] of Object.entries(estado.ciclos)) {
    if (c.fechadoEm && c.fechadoEm < corte) delete estado.ciclos[k];
  }
  salvar(estado);
}

/** Estatísticas do ciclo de vida — mesma pergunta que a vigilância original responde. */
export function estatisticasCicloBasis(estado: EstadoVigilanciaBasis): {
  vivas: number; fechadas: number; duracaoMedianaHoras: number; duracaoMaximaHoras: number;
} {
  const todas = Object.values(estado.ciclos);
  const fechadas = todas.filter((c) => c.fechadoEm);
  const duracoes = fechadas
    .map((c) => (c.fechadoEm! - c.abertoEm) / 3_600_000)
    .sort((a, b) => a - b);
  return {
    vivas: todas.filter((c) => !c.fechadoEm).length,
    fechadas: fechadas.length,
    duracaoMedianaHoras: duracoes.length ? duracoes[Math.floor(duracoes.length / 2)] : 0,
    duracaoMaximaHoras: duracoes.length ? duracoes[duracoes.length - 1] : 0,
  };
}
