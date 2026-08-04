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

/**
 * Quantas varreduras seguidas sem ver um par antes de declará-lo morto.
 *
 * Três, a 5 minutos por varredura, dão 15 minutos de tolerância — menos que o
 * ciclo de 20 minutos do motor, então um spread que morreu de verdade ainda é
 * detectado antes de a próxima decisão acontecer.
 */
export const TOLERANCIA_FALTAS = 3;

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
  /** varreduras seguidas sem ver este par; zera a cada avistamento */
  faltas?: number;
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
/**
 * Piso de liquidez calibrado pelo NOTIONAL REAL da posição, não por um
 * número redondo genérico.
 *
 * Medido em 04/08/2026: dos 736 cruzamentos com spread válido no universo
 * inteiro, só 2 sobreviviam ao piso antigo de US$ 10M. US$ 250/perna (o
 * notional típico desta escala de capital) é 0,025% de US$ 1M — uma ordem
 * assim não move o livro o bastante pra justificar exigir 10x mais volume.
 * Escorregamento real checado no livro de ofertas nos candidatos que só
 * entram com o piso menor (ver `ESCORREGAMENTO_PERNA` em custos-reais.ts):
 * pior caso 0,0666%, ainda pequeno. Com US$ 1M o universo de candidatos
 * passa de 2 para 12 — mais chance real de achar um que dure, sem abrir
 * mão de liquidez que a ordem realmente precisa.
 */
export const VOLUME_MINIMO_PADRAO = 1e6;

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
  const volMin = opts.volumeMinimo ?? VOLUME_MINIMO_PADRAO;
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

  // ── fecha as que sumiram, COM TOLERÂNCIA ────────────────────────────────
  //
  // A primeira versão fechava o ciclo na primeira ausência. Isso parecia
  // conservador e custou dinheiro de verdade.
  //
  // Medido em 44 varreduras: KAITO apareceu em 38 delas, com o padrão
  //
  //   ●●●●●●●●●●●●●●●●●●●·●●●···●··●●●●●●●●●●●●●●●
  //
  // Os pares não invertem — eles PISCAM. Uma leitura falha, um par cai abaixo
  // do volume mínimo por um instante, uma exchange demora a responder. Fechar
  // na primeira ausência transformava cada buraco de cinco minutos num
  // fechamento de posição de US$ 0,08 a US$ 0,25.
  //
  // O resultado foi 8 fechamentos em 2,5 horas, todos rotulados "spread
  // invertido", e um prejuízo de US$ 2,30 em custo puro contra US$ 0,17 de
  // funding recebido.
  //
  // Com tolerância de 3 faltas seguidas (15 minutos), um piscar não mata a
  // posição e um spread que morreu de verdade ainda é detectado em 15 minutos —
  // bem dentro do ciclo de 20 minutos do motor.
  for (const [k, c] of Object.entries(estado.ciclos)) {
    if (c.fechadoEm) continue;
    if (vistas.has(k)) { c.faltas = 0; continue; }
    c.faltas = (c.faltas ?? 0) + 1;
    if (c.faltas >= TOLERANCIA_FALTAS) {
      c.fechadoEm = agora;
      fechadas.push(c);
    }
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
 * Limite inferior do intervalo de Wilson para uma proporção.
 *
 * Responde "qual o menor valor de consistência que esta amostra sustenta com
 * 95% de confiança", em vez de tomar a proporção observada ao pé da letra.
 *
 * Isto existe por causa de um caso real. MU entrou no ranking com consistência
 * de 100% em TRÊS observações e venceu KAITO, que tinha 86% em seis. O motor
 * montou MU, o par sumiu doze minutos depois, e a troca custou US$ 0,50 — mais
 * de meia semana de renda no cenário central.
 *
 * Cem por cento de três amostras não é cem por cento; é ignorância. Wilson
 * penaliza amostra pequena sem descartá-la, e converge para a proporção
 * observada conforme as observações se acumulam. Com 3 de 3 devolve 0,44; com
 * 30 de 30 devolve 0,88.
 */
export function consistenciaAjustada(consistencia: number, observacoes: number, z = 1.96): number {
  const n = Math.max(1, observacoes);
  const p = Math.min(1, Math.max(0, consistencia));
  const z2n = z * z / n;
  const centro = (p + z2n / 2) / (1 + z2n);
  const margem = (z / (1 + z2n)) * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n));
  return Math.max(0, centro - margem);
}

/**
 * Ranking por qualidade sustentada, não por spread instantâneo.
 *
 * Exige um mínimo de observações e pondera pela consistência ao quadrado —
 * para renda semanal, receber sempre vale mais que receber muito às vezes.
 *
 * A consistência usada na pontuação é a AJUSTADA por tamanho de amostra. Sem
 * isso, um par recém-descoberto com poucas observações perfeitas passa na
 * frente de um par já provado, e o custo dessa troca é real.
 */
export function ranking(estado: EstadoVigilancia, minObservacoes = 3): (CicloVida & {
  pontuacao: number;
  duracaoHoras: number;
  aprMedio: number;
  consistenciaAjustada: number;
})[] {
  return Object.values(estado.ciclos)
    .filter((c) => !c.fechadoEm && c.observacoes >= minObservacoes)
    .map((c) => {
      const cAdj = consistenciaAjustada(c.consistencia, c.observacoes);
      return {
        ...c,
        consistenciaAjustada: cAdj,
        pontuacao: c.spreadMedio * cAdj ** 2,
        duracaoHoras: (Date.now() - c.abertoEm) / 3_600_000,
        aprMedio: c.spreadMedio * 3 * 365,
      };
    })
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
