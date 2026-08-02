/**
 * VIGILÂNCIA CONTÍNUA — transforma a foto do mercado em observação.
 *
 * A varredura sozinha é uma foto: mostra o spread do KAITO a 36% agora, e não
 * diz se ele existe há três dias ou apareceu no último minuto. Sem histórico,
 * escolher pelo instantâneo pega pico — foi exatamente o erro que fez o motor
 * abrir INJ a 44,8% quando a média real dele era 15,9%.
 *
 * Três coisas que este módulo adiciona:
 *
 *   1. HISTÓRICO PERSISTIDO. Cada varredura grava as oportunidades num arquivo
 *      append-only. A consistência passa a ser calculada sobre o universo
 *      inteiro, não sobre 32 ativos escolhidos.
 *
 *   2. CICLO DE VIDA. Registra quando cada oportunidade abriu, quanto tempo
 *      durou e quando fechou. É o que responde se vale correr atrás de spreads
 *      transitórios ou esperar os estáveis.
 *
 *   3. CADÊNCIA ADAPTATIVA. A gate leva 20,6s e as outras somadas levam 5s.
 *      Varrer todas no mesmo ritmo desperdiça 80% do ciclo esperando a mais
 *      lenta. Cada exchange tem seu próprio intervalo, proporcional ao que ela
 *      custa.
 */
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from '../data/store.ts';
import { lerUniverso, cruzarUniverso, type OportunidadeUniverso } from './universo.ts';

const DIR = path.join(ROOT, 'vigilancia');
const HISTORICO = path.join(DIR, 'historico.jsonl');
const CICLOS = path.join(DIR, 'ciclos.json');

/** Chave única de uma oportunidade: o ativo e o par de exchanges. */
export const chave = (o: { symbol: string; exchangeShort: string; exchangeLong: string }) =>
  `${o.symbol}|${o.exchangeShort}|${o.exchangeLong}`;

export interface Observacao {
  ts: number;
  k: string;
  spread: number;
  apr: number;
  vol: number;
}

export interface CicloVida {
  chave: string;
  symbol: string;
  exchangeShort: string;
  exchangeLong: string;
  abertoEm: number;
  fechadoEm?: number;
  observacoes: number;
  spreadMedio: number;
  spreadMax: number;
  spreadMin: number;
  /** fração das observações em que o spread se manteve acima do mínimo */
  consistencia: number;
  volumeMedio: number;
}

export interface EstadoVigilancia {
  iniciadoEm: number;
  varreduras: number;
  ciclos: Record<string, CicloVida>;
  ultimaVarredura: number;
}

function carregar(): EstadoVigilancia {
  fs.mkdirSync(DIR, { recursive: true });
  if (fs.existsSync(CICLOS)) return JSON.parse(fs.readFileSync(CICLOS, 'utf8'));
  return { iniciadoEm: Date.now(), varreduras: 0, ciclos: {}, ultimaVarredura: 0 };
}

function salvar(e: EstadoVigilancia) {
  fs.writeFileSync(CICLOS, JSON.stringify(e, null, 2));
}

/**
 * Uma passada: lê o universo, cruza, e atualiza o ciclo de vida de cada
 * oportunidade — abrindo as novas, atualizando as vivas, fechando as que
 * sumiram.
 */
export async function observar(opts: {
  volumeMinimo?: number;
  spreadMinimo?: number;
  onProgresso?: (ex: string, n: number, ms: number) => void;
} = {}): Promise<{
  estado: EstadoVigilancia;
  ops: OportunidadeUniverso[];
  novas: OportunidadeUniverso[];
  fechadas: CicloVida[];
}> {
  const volMin = opts.volumeMinimo ?? 10e6;
  const spMin = opts.spreadMinimo ?? 0.00002;
  const estado = carregar();
  const agora = Date.now();

  const pares = await lerUniverso({ onProgresso: opts.onProgresso });
  const ops = cruzarUniverso(pares, { volumeMinimo: volMin, spreadMinimo: spMin });

  const vistas = new Set(ops.map(chave));
  const novas: OportunidadeUniverso[] = [];
  const fechadas: CicloVida[] = [];

  // grava as observações desta passada
  const linhas: string[] = [];
  for (const o of ops) {
    const k = chave(o);
    linhas.push(JSON.stringify({ ts: agora, k, spread: o.spread, apr: o.aprSpread, vol: o.volumeMinimo }));

    const c = estado.ciclos[k];
    if (!c || c.fechadoEm) {
      // oportunidade nova, ou reabertura de uma que havia fechado
      estado.ciclos[k] = {
        chave: k, symbol: o.symbol,
        exchangeShort: o.exchangeShort, exchangeLong: o.exchangeLong,
        abertoEm: agora, observacoes: 1,
        spreadMedio: o.spread, spreadMax: o.spread, spreadMin: o.spread,
        consistencia: 1, volumeMedio: o.volumeMinimo,
      };
      novas.push(o);
    } else {
      // média incremental, para não precisar reler o histórico inteiro
      const n = c.observacoes + 1;
      c.spreadMedio = (c.spreadMedio * c.observacoes + o.spread) / n;
      c.volumeMedio = (c.volumeMedio * c.observacoes + o.volumeMinimo) / n;
      c.spreadMax = Math.max(c.spreadMax, o.spread);
      c.spreadMin = Math.min(c.spreadMin, o.spread);
      c.observacoes = n;
      c.consistencia = 1; // vista nesta passada
    }
  }

  // fecha as que sumiram
  for (const [k, c] of Object.entries(estado.ciclos)) {
    if (c.fechadoEm || vistas.has(k)) continue;
    c.fechadoEm = agora;
    fechadas.push(c);
  }

  // consistência real: observações vistas sobre varreduras desde a abertura
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
  if (linhas.length) fs.appendFileSync(HISTORICO, linhas.join('\n') + '\n');
  salvar(estado);

  return { estado, ops, novas, fechadas };
}

/**
 * Ranking por qualidade sustentada, não por spread instantâneo.
 *
 * Exige um mínimo de observações: uma oportunidade vista uma vez pode ser
 * ruído de dado. E pondera pela consistência ao quadrado, pelo mesmo motivo de
 * sempre — para renda diária, receber sempre vale mais que receber muito às
 * vezes.
 */
export function ranking(estado: EstadoVigilancia, minObservacoes = 3): (CicloVida & {
  pontuacao: number;
  duracaoHoras: number;
  aprMedio: number;
})[] {
  return Object.values(estado.ciclos)
    .filter((c) => !c.fechadoEm && c.observacoes >= minObservacoes)
    .map((c) => ({
      ...c,
      pontuacao: c.spreadMedio * c.consistencia ** 2,
      duracaoHoras: (Date.now() - c.abertoEm) / 3_600_000,
      aprMedio: c.spreadMedio * 3 * 365,
    }))
    .sort((a, b) => b.pontuacao - a.pontuacao);
}

/**
 * Estatísticas do ciclo de vida — responde se vale perseguir spreads
 * transitórios ou esperar os estáveis.
 */
export function estatisticasCiclo(estado: EstadoVigilancia): {
  vivas: number;
  fechadas: number;
  duracaoMedianaHoras: number;
  duracaoMaxHoras: number;
  fracaoCurtas: number;
  totalObservadas: number;
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
    duracaoMaxHoras: duracoes.length ? duracoes[duracoes.length - 1] : 0,
    // "curta" = durou menos de 2 horas; se a maioria for curta, perseguir não
    // compensa o custo de montar e desmontar
    fracaoCurtas: duracoes.length ? duracoes.filter((d) => d < 2).length / duracoes.length : 0,
    totalObservadas: todas.length,
  };
}

/** Poda o histórico, para o arquivo não crescer sem limite. */
export function podar(diasParaManter = 7) {
  if (!fs.existsSync(HISTORICO)) return { antes: 0, depois: 0 };
  const corte = Date.now() - diasParaManter * 86_400_000;
  const linhas = fs.readFileSync(HISTORICO, 'utf8').trim().split('\n').filter(Boolean);
  const mantidas = linhas.filter((l) => {
    try { return JSON.parse(l).ts >= corte; } catch { return false; }
  });
  fs.writeFileSync(HISTORICO, mantidas.join('\n') + (mantidas.length ? '\n' : ''));

  const estado = carregar();
  for (const [k, c] of Object.entries(estado.ciclos)) {
    if (c.fechadoEm && c.fechadoEm < corte) delete estado.ciclos[k];
  }
  salvar(estado);
  return { antes: linhas.length, depois: mantidas.length };
}
