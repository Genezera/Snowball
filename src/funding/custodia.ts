/**
 * RISCO DE CUSTÓDIA — o que a estrutura delta-neutra não cobre.
 *
 * As duas pernas se cancelam em preço. Nenhuma delas cancela o risco de a
 * exchange onde o dinheiro está congelar saques ou quebrar. Metade do capital
 * fica em cada uma, e esse é o único caminho conhecido para perda total.
 *
 * Não existe hedge para isso. Existem três coisas menores, e é honesto chamá-las
 * pelo nome:
 *
 *   DETECTAR    congelamento de saque costuma aparecer nos dados antes de
 *               aparecer na notícia. É o sinal de evacuação.
 *   PREFERIR    entre dois spreads parecidos, o que usa exchanges maiores custa
 *               menos risco pelo mesmo retorno.
 *   DILUIR      dividir entre mais exchanges reduz quanto se perde por evento.
 *               Exige múltiplas posições — ainda não implementado.
 *
 * Nenhuma delas impede a falência. Todas reduzem o dano esperado.
 *
 * ── o que dá para ler sem chave de API ────────────────────────────────────
 *
 * Medido em 02/08/2026:
 *
 *   binance, bybit, okx   fetchStatus funciona; fetchCurrencies exige chave
 *   gate, bitget          fetchStatus ausente; fetchCurrencies é público e
 *                         expõe o flag de saque de USDT por rede
 *
 * Cada exchange tem pelo menos um sinal. Nenhuma tem os dois. A cobertura é
 * parcial de propósito — inventar um sinal que não existe seria pior que
 * admitir a lacuna.
 */
import fs from 'node:fs';
import path from 'node:path';
import ccxt from 'ccxt';
import { ROOT } from '../data/store.ts';

export type NivelCustodia = 'ok' | 'degradado' | 'evacuar' | 'desconhecido';

export interface SaudeExchange {
  id: string;
  nivel: NivelCustodia;
  /** o que foi efetivamente verificado, para não confundir "ok" com "não sei" */
  sinais: string[];
  detalhe: string;
  verificadoEm: number;
}

/**
 * Peso de risco de custódia, de 0 (nenhum) a 1 (máximo).
 *
 * Isto NÃO é uma avaliação de solvência — eu não tenho dado para isso. É uma
 * ordenação grosseira por tamanho, tempo de mercado e transparência de reservas,
 * usada só para desempatar spreads parecidos.
 *
 * Usar como critério absoluto seria fingir precisão que o número não tem.
 */
export const PESO_CUSTODIA: Record<string, number> = {
  binanceusdm: 0.10,
  binance: 0.10,
  okx: 0.15,
  bybit: 0.20,
  bitget: 0.35,
  gate: 0.35,
  mexc: 0.45,
  htx: 0.45,
};

export const PESO_DESCONHECIDO = 0.50;

export function pesoDe(id: string): number {
  return PESO_CUSTODIA[id] ?? PESO_DESCONHECIDO;
}

/**
 * Risco de custódia de uma operação de duas pernas.
 *
 * Metade do capital em cada exchange, então o risco é a média dos dois pesos —
 * não a soma, e não o máximo. A média é o dano esperado por unidade de capital
 * se um evento atingir uma das duas com igual probabilidade.
 */
export function riscoDaOperacao(exShort: string, exLong: string): number {
  return (pesoDe(exShort) + pesoDe(exLong)) / 2;
}

async function statusDe(e: any): Promise<{ ok: boolean | null; texto: string }> {
  if (!e.has?.fetchStatus) return { ok: null, texto: 'sem fetchStatus' };
  try {
    const s = await e.fetchStatus();
    return { ok: s.status === 'ok', texto: `status=${s.status}` };
  } catch (err) {
    return { ok: null, texto: `status indisponível` };
  }
}

async function saqueDe(e: any): Promise<{ ok: boolean | null; texto: string }> {
  if (!e.has?.fetchCurrencies) return { ok: null, texto: 'sem fetchCurrencies' };
  try {
    const cs = await e.fetchCurrencies();
    const u = cs?.USDT;
    // Binance, bybit e okx devolvem vazio sem chave. Ausência não é problema —
    // é falta de informação, e tratar como problema geraria alarme falso diário.
    if (!u) return { ok: null, texto: 'saque exige chave' };
    if (u.withdraw === false) return { ok: false, texto: 'SAQUE DE USDT SUSPENSO' };
    const redes = Object.values(u.networks ?? {}) as any[];
    if (redes.length) {
      const abertas = redes.filter((n) => n.withdraw).length;
      if (abertas === 0) return { ok: false, texto: 'NENHUMA REDE DE SAQUE ABERTA' };
      if (abertas < redes.length / 3) {
        return { ok: false, texto: `só ${abertas} de ${redes.length} redes com saque` };
      }
      return { ok: true, texto: `saque em ${abertas}/${redes.length} redes` };
    }
    return { ok: u.withdraw !== false, texto: 'saque habilitado' };
  } catch {
    return { ok: null, texto: 'saque indisponível' };
  }
}

/**
 * Verifica a saúde de uma exchange combinando os sinais disponíveis.
 *
 * A distinção entre `ok` e `desconhecido` é o ponto do desenho. Um monitor que
 * devolve "ok" quando na verdade não conseguiu verificar nada é pior que não
 * ter monitor: ele produz confiança sem base.
 */
export async function verificarExchange(id: string, timeoutMs = 12_000): Promise<SaudeExchange> {
  const vazio = (nivel: NivelCustodia, detalhe: string, sinais: string[] = []): SaudeExchange =>
    ({ id, nivel, sinais, detalhe, verificadoEm: Date.now() });

  let e: any;
  try {
    e = new (ccxt as any)[id]({ enableRateLimit: true, timeout: timeoutMs });
  } catch {
    return vazio('desconhecido', 'exchange não existe no ccxt');
  }

  const corrida = <T,>(p: Promise<T>, fallback: T): Promise<T> =>
    Promise.race([p, new Promise<T>((r) => setTimeout(() => r(fallback), timeoutMs))]);

  const [st, sq] = await Promise.all([
    corrida(statusDe(e), { ok: null, texto: 'timeout no status' }),
    corrida(saqueDe(e), { ok: null, texto: 'timeout no saque' }),
  ]);

  const sinais = [st.texto, sq.texto];

  // Saque suspenso é o sinal forte: é assim que um congelamento aparece antes
  // de virar notícia. Vale evacuação, não só alerta.
  if (sq.ok === false) return vazio('evacuar', sq.texto, sinais);
  if (st.ok === false) return vazio('degradado', st.texto, sinais);
  if (st.ok === null && sq.ok === null) return vazio('desconhecido', 'nenhum sinal disponível', sinais);
  return vazio('ok', sinais.filter((s) => !s.startsWith('sem ')).join(' · '), sinais);
}

export async function verificarTodas(ids: string[]): Promise<Record<string, SaudeExchange>> {
  const rs = await Promise.all(ids.map((id) => verificarExchange(id)));
  const out: Record<string, SaudeExchange> = {};
  for (const r of rs) out[r.id] = r;
  return out;
}

/**
 * Uma operação pode ser montada, dado o estado de saúde das exchanges?
 *
 * `desconhecido` NÃO bloqueia. Se bloqueasse, binance, bybit e okx sairiam do
 * universo sempre que o saque não pudesse ser lido — que é o caso permanente
 * sem chave de API. O sistema pararia de operar por falta de informação, não
 * por presença de risco.
 */
export function podeOperar(
  saude: Record<string, SaudeExchange>, exShort: string, exLong: string,
): { pode: boolean; motivo: string } {
  for (const id of [exShort, exLong]) {
    const s = saude[id];
    if (s?.nivel === 'evacuar') return { pode: false, motivo: `${id}: ${s.detalhe}` };
    if (s?.nivel === 'degradado') return { pode: false, motivo: `${id}: ${s.detalhe}` };
  }
  return { pode: true, motivo: 'ok' };
}

/**
 * Ajusta a pontuação de uma oportunidade pelo risco de custódia.
 *
 * `intensidade` a 0 desliga o ajuste; a 1 aplica o desconto cheio. Isto
 * REORDENA, não elimina: nenhuma oportunidade sai do conjunto por causa do
 * peso, apenas cai de posição. Eliminar por peso removeria trades lucrativos,
 * o que a regra permanente do projeto proíbe sem medição.
 */
/**
 * Lê a última verificação persistida pelo processo de custódia.
 *
 * Dado velho é tratado como ausência de dado, pela mesma razão da ponte da
 * vigilância: uma verificação de ontem dizendo "ok" não informa nada sobre
 * hoje, e agir com base nela é pior que saber que não se sabe.
 */
export const IDADE_MAXIMA_CUSTODIA_MS = 60 * 60_000;

export function lerSaude(): Record<string, SaudeExchange> {
  try {
    const p = path.join(ROOT, 'vigilancia', 'custodia.json');
    if (!fs.existsSync(p)) return {};
    const j = JSON.parse(fs.readFileSync(p, 'utf8'));
    if (Date.now() - (j.verificadoEm ?? 0) > IDADE_MAXIMA_CUSTODIA_MS) return {};
    return j.saude ?? {};
  } catch {
    return {};
  }
}

export function pontuacaoAjustada(
  pontuacao: number, exShort: string, exLong: string, intensidade = 0.5,
): number {
  return pontuacao * (1 - riscoDaOperacao(exShort, exLong) * intensidade);
}
