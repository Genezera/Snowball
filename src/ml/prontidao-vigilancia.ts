/**
 * PIPELINE DE TREINO REAL SOBRE O ARQUIVO DA VIGILÂNCIA — infraestrutura
 * pedida explicitamente: "não tem como construir esse pipeline de
 * validação?". A resposta é sim, e este é o pipeline.
 *
 * ── por que não existia antes ──────────────────────────────────────────────
 *
 * O dashboard já mostrava "prontidão de ML" (positivos/mínimo necessário),
 * mas isso é só CONTAGEM — nunca havia um treino de verdade rodando. A razão
 * não era falta de dado bruto (50 mil+ observações, 9 mil+ ciclos arquivados
 * já existiam) — era que ninguém tinha escrito o código que transforma esse
 * arquivo em exemplos rotulados sem usar informação que só existe DEPOIS do
 * fato (a duração final do ciclo, por exemplo, não pode ser feature de um
 * modelo que precisa decidir no INÍCIO do ciclo).
 *
 * ── a solução: feature da PRIMEIRA observação, rótulo do desfecho final ────
 *
 * Cada ciclo arquivado tem uma `chave` (ativo+rota) e um `abertoEm`. Cruzando
 * com `arquivo-observacoes.jsonl` (toda leitura de toda varredura, desde
 * sempre), acha-se a primeira observação daquela chave dentro da janela do
 * ciclo — o spread/APR/volume que o motor via no instante em que a
 * oportunidade abriu, não a média de toda a vida dela. O rótulo continua
 * sendo o desfecho real (`avaliarCicloArquivado`, `rotulo-ciclo.ts`) — isso é
 * o que estamos tentando prever, não uma feature.
 *
 * Sem isso, um modelo treinado com `consistencia`/`duracaoHoras` do ciclo
 * inteiro estaria usando o resultado pra prever o resultado — a mesma
 * armadilha de olhar o futuro que o resto do projeto já corrigiu em outros
 * lugares (bar-close, escorregamento medido no livro real, etc.).
 */
import { GBDT, auc } from './gbdt.ts';
import { avaliarCicloArquivado, type CicloArquivado } from './rotulo-ciclo.ts';

export const MINIMO_POSITIVOS_TREINO = 30;
/** tolerância pra achar a observação "de abertura" — um ciclo de varredura de folga. */
const JANELA_MATCH_MS = 6 * 60_000;
export const FEATURE_NAMES = ['spread_abertura', 'apr_abertura', 'log_volume_abertura'];

export interface ObservacaoArquivada {
  ts: number;
  k: string;
  spread: number;
  apr: number;
  vol: number;
}

export interface ExemploTreino {
  chave: string;
  ts: number;
  features: number[];
  rotulo: 0 | 1;
}

/**
 * Pra cada ciclo confiável, acha a observação mais antiga da mesma chave
 * dentro de [abertoEm − janela, fechadoEm] — a leitura mais próxima possível
 * do instante em que a oportunidade nasceu, sem usar dado que só existiria
 * depois de o ciclo já ter acontecido.
 */
export function construirDataset(
  ciclos: CicloArquivado[], observacoes: ObservacaoArquivada[], janelaMs = JANELA_MATCH_MS,
): ExemploTreino[] {
  const porChave = new Map<string, ObservacaoArquivada[]>();
  for (const o of observacoes) {
    if (!porChave.has(o.k)) porChave.set(o.k, []);
    porChave.get(o.k)!.push(o);
  }
  for (const lista of porChave.values()) lista.sort((a, b) => a.ts - b.ts);

  const exemplos: ExemploTreino[] = [];
  for (const c of ciclos) {
    const av = avaliarCicloArquivado(c);
    if (!av.confiavel) continue;
    const candidatas = porChave.get(c.chave);
    if (!candidatas) continue;
    const inicio = c.abertoEm - janelaMs;
    const primeira = candidatas.find((o) => o.ts >= inicio && o.ts <= c.fechadoEm);
    if (!primeira) continue;
    exemplos.push({
      chave: c.chave, ts: c.abertoEm,
      features: [primeira.spread, primeira.apr, Math.log(Math.max(1, primeira.vol))],
      rotulo: av.positivo ? 1 : 0,
    });
  }
  return exemplos;
}

/** Só conta — nunca treina. É o que o dashboard já mostrava antes deste pipeline existir. */
export function avaliarProntidao(ciclos: CicloArquivado[]): { confiaveis: number; positivos: number; minimo: number; pronto: boolean } {
  let confiaveis = 0, positivos = 0;
  for (const c of ciclos) {
    const av = avaliarCicloArquivado(c);
    if (av.confiavel) confiaveis++;
    if (av.positivo) positivos++;
  }
  return { confiaveis, positivos, minimo: MINIMO_POSITIVOS_TREINO, pronto: positivos >= MINIMO_POSITIVOS_TREINO };
}

/**
 * Corte por TEMPO, não aleatório — treina no passado, valida no futuro.
 * Amostra pequena e desbalanceada (poucos positivos) então isto é o único
 * corte honesto disponível; k-fold aleatório com tão poucos exemplos positivos
 * inflaria a confiança do número.
 */
export function dividirPorTempo(exemplos: ExemploTreino[], fracaoTreino = 0.7): { treino: ExemploTreino[]; teste: ExemploTreino[] } {
  const ordenados = [...exemplos].sort((a, b) => a.ts - b.ts);
  const corte = Math.floor(ordenados.length * fracaoTreino);
  return { treino: ordenados.slice(0, corte), teste: ordenados.slice(corte) };
}

export interface ResultadoTreino {
  treinadoEm: number;
  amostraTreino: number;
  amostraTeste: number;
  positivosTreino: number;
  positivosTeste: number;
  auc: number | null;
  precisao: number | null;
  recall: number | null;
  motivo?: string;
}

/**
 * Treina e avalia num corte temporal simples. Devolve `auc: null` (não
 * `auc: 0`) quando a amostra de teste não tem os dois rótulos — AUC não é
 * definido nesse caso, e fingir um número aqui seria o mesmo erro de
 * confiança fabricada que o resto do projeto evita.
 */
export function treinarEavaliar(exemplos: ExemploTreino[]): ResultadoTreino {
  const agora = Date.now();
  const { treino, teste } = dividirPorTempo(exemplos);
  const positivosTreino = treino.filter((e) => e.rotulo === 1).length;
  const positivosTeste = teste.filter((e) => e.rotulo === 1).length;

  const base = {
    treinadoEm: agora, amostraTreino: treino.length, amostraTeste: teste.length,
    positivosTreino, positivosTeste, auc: null, precisao: null, recall: null,
  };

  if (treino.length < 20 || positivosTreino < 5) {
    return { ...base, motivo: 'treino com menos de 20 exemplos ou menos de 5 positivos — não tenta treinar' };
  }
  if (teste.length < 5 || positivosTeste === 0 || positivosTeste === teste.length) {
    return { ...base, motivo: 'teste sem os dois rótulos representados — AUC indefinido, não fabricado' };
  }

  const modelo = new GBDT({ nTrees: 60, maxDepth: 2, learningRate: 0.08, minSamplesLeaf: 5, lambda: 3 });
  modelo.fit(treino.map((e) => e.features), treino.map((e) => e.rotulo), FEATURE_NAMES);

  const scores = modelo.predictAll(teste.map((e) => e.features));
  const yTeste = teste.map((e) => e.rotulo);
  const aucValor = auc(yTeste, scores);

  let vp = 0, fp = 0, fn = 0;
  for (let i = 0; i < teste.length; i++) {
    const previsto = scores[i] >= 0.5 ? 1 : 0;
    if (previsto === 1 && yTeste[i] === 1) vp++;
    else if (previsto === 1 && yTeste[i] === 0) fp++;
    else if (previsto === 0 && yTeste[i] === 1) fn++;
  }
  const precisao = vp + fp > 0 ? vp / (vp + fp) : null;
  const recall = vp + fn > 0 ? vp / (vp + fn) : null;

  return { ...base, auc: aucValor, precisao, recall };
}
