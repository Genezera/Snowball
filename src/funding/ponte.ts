/**
 * PONTE entre a vigilância e o motor.
 *
 * Antes eram dois processos cegos um para o outro: a vigilância enxergava
 * 3.492 pares do mercado inteiro e o motor decidia com base na própria
 * varredura de 32 ativos escolhidos à mão. O motor operava SEI a 19,5%
 * enquanto a vigilância via KAITO a 36,2% e não tinha como avisar.
 *
 * Agora a vigilância é os olhos e o motor são as mãos. A divisão é
 * deliberada: varrer o mercado é caro e lento (5 a 14 segundos), gerenciar
 * posição precisa ser rápido. Separar deixa cada um no seu ritmo.
 *
 * A ponte é um arquivo em disco, não uma chamada. Se a vigilância morrer, o
 * motor percebe pela idade do dado e para de abrir posição nova — em vez de
 * operar às cegas com informação velha, que é o pior dos dois mundos.
 */
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from '../data/store.ts';
import { ranking, type EstadoVigilancia } from './vigilancia.ts';
import type { OportunidadeSpread } from './spread.ts';

const CICLOS = path.join(ROOT, 'vigilancia', 'ciclos.json');

/** Acima disso o dado da vigilância é velho demais para decidir. */
export const IDADE_MAXIMA_MS = 20 * 60_000;

export interface LeituraPonte {
  disponivel: boolean;
  idadeMinutos: number;
  varreduras: number;
  oportunidades: OportunidadeSpread[];
  motivo: string;
}

/**
 * Lê o ranking da vigilância e converte para o formato que o motor já entende.
 *
 * `minObservacoes` existe porque uma oportunidade vista uma única vez pode ser
 * ruído de dado ou um spread que pisca. Na observação real, SKHY abriu, fechou
 * e reabriu em quatro minutos — entraria em qualquer ranking instantâneo e
 * sumiria antes de a posição ser montada.
 */
export function lerVigilancia(minObservacoes = 3): LeituraPonte {
  if (!fs.existsSync(CICLOS)) {
    return { disponivel: false, idadeMinutos: -1, varreduras: 0, oportunidades: [], motivo: 'vigilância nunca rodou' };
  }

  let estado: EstadoVigilancia;
  try { estado = JSON.parse(fs.readFileSync(CICLOS, 'utf8')); }
  catch { return { disponivel: false, idadeMinutos: -1, varreduras: 0, oportunidades: [], motivo: 'estado ilegível' }; }

  const idade = Date.now() - (estado.ultimaVarredura || 0);
  const idadeMin = idade / 60_000;

  if (idade > IDADE_MAXIMA_MS) {
    return {
      disponivel: false, idadeMinutos: idadeMin, varreduras: estado.varreduras,
      oportunidades: [],
      motivo: `dado com ${idadeMin.toFixed(0)} min — a vigilância parou?`,
    };
  }

  const rk = ranking(estado, minObservacoes);
  const ops: OportunidadeSpread[] = rk.map((r) => ({
    symbol: r.symbol,
    exchangeShort: r.exchangeShort,
    exchangeLong: r.exchangeLong,
    fundingShort: r.spreadMedio,
    fundingLong: 0,
    spread: r.spreadMedio,
    spreadInstantaneo: r.spreadMax,
    consistencia: r.consistencia,
    aprSpread: r.aprMedio,
    pontuacao: r.pontuacao,
    volumeMinimo: r.volumeMedio,
  }));

  return {
    disponivel: true, idadeMinutos: idadeMin, varreduras: estado.varreduras,
    oportunidades: ops,
    motivo: `${ops.length} oportunidades com ${minObservacoes}+ observações`,
  };
}

/**
 * Health check da vigilância, para o motor e o dashboard reportarem.
 */
export function saudeVigilancia(): {
  viva: boolean;
  idadeMinutos: number;
  varreduras: number;
  vivas: number;
  fechadas: number;
} {
  if (!fs.existsSync(CICLOS)) return { viva: false, idadeMinutos: -1, varreduras: 0, vivas: 0, fechadas: 0 };
  try {
    const e: EstadoVigilancia = JSON.parse(fs.readFileSync(CICLOS, 'utf8'));
    const todas = Object.values(e.ciclos ?? {});
    return {
      viva: Date.now() - (e.ultimaVarredura || 0) <= IDADE_MAXIMA_MS,
      idadeMinutos: (Date.now() - (e.ultimaVarredura || 0)) / 60_000,
      varreduras: e.varreduras ?? 0,
      vivas: todas.filter((c) => !c.fechadoEm).length,
      fechadas: todas.filter((c) => c.fechadoEm).length,
    };
  } catch {
    return { viva: false, idadeMinutos: -1, varreduras: 0, vivas: 0, fechadas: 0 };
  }
}
