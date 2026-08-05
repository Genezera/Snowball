/**
 * HISTÓRICO DE FUNDING RATE por ativo único — diferente de tudo o mais em
 * `src/funding/`, que sempre olha a DIFERENÇA entre exchanges ou o valor
 * absoluto como fonte de renda. Aqui o funding é lido como SINAL DE
 * POSICIONAMENTO: funding muito positivo significa que a maioria está
 * comprada e pagando para segurar a posição — mercado "lotado" de um lado,
 * frágil a qualquer notícia negativa. Funding extremo é hipótese clássica de
 * mercado cripto como sinal CONTRÁRIO de preço, nunca testada neste projeto
 * (tudo que já foi testado usa funding como fonte de receita, não como sinal
 * de entrada direcional).
 *
 * ccxt limita `fetchFundingRateHistory` a 1000 registros por chamada — este
 * módulo pagina avançando no tempo (`since` = último timestamp + 1) até
 * cobrir o período pedido, e cacheia em disco no mesmo formato de
 * `data/store.ts` para não re-baixar toda vez.
 */
import fs from 'node:fs';
import path from 'node:path';
import ccxt from 'ccxt';
import { DATA_DIR } from './store.ts';

export interface RegistroFunding {
  t: number;
  fundingRate: number;
}

function cachePath(exchange: string, symbol: string): string {
  const safe = symbol.replace(/[/:]/g, '_');
  return path.join(DATA_DIR, `funding__${exchange}__${safe}.json`);
}

/** Baixa (paginando) todo o histórico de funding disponível na exchange para o símbolo. */
export async function baixarHistoricoFunding(
  exchangeId: string, symbol: string, diasAtras = 730,
): Promise<RegistroFunding[]> {
  const ExClass = (ccxt as any)[exchangeId];
  if (!ExClass) throw new Error(`exchange desconhecida no ccxt: ${exchangeId}`);
  const ex = new ExClass({ enableRateLimit: true });
  await ex.loadMarkets();

  let since = Date.now() - diasAtras * 86_400_000;
  const todos: RegistroFunding[] = [];
  const vistos = new Set<number>();

  for (let pagina = 0; pagina < 50; pagina++) {
    const lote = await ex.fetchFundingRateHistory(symbol, since, 1000);
    if (!lote.length) break;
    let novos = 0;
    for (const r of lote) {
      if (vistos.has(r.timestamp)) continue;
      vistos.add(r.timestamp);
      todos.push({ t: r.timestamp, fundingRate: r.fundingRate });
      novos++;
    }
    if (novos === 0) break; // sem novidade — a exchange não tem mais dado antigo
    since = lote[lote.length - 1].timestamp + 1;
    if (since >= Date.now()) break;
  }
  todos.sort((a, b) => a.t - b.t);
  return todos;
}

export function salvarHistoricoFunding(exchangeId: string, symbol: string, registros: RegistroFunding[]) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(cachePath(exchangeId, symbol), JSON.stringify({ exchange: exchangeId, symbol, registros }));
}

export function carregarHistoricoFunding(exchangeId: string, symbol: string): RegistroFunding[] {
  const p = cachePath(exchangeId, symbol);
  if (!fs.existsSync(p)) {
    throw new Error(`sem funding em cache para ${symbol} em ${exchangeId}. Rode baixarHistoricoFunding primeiro.`);
  }
  const raw = JSON.parse(fs.readFileSync(p, 'utf8')) as { registros: RegistroFunding[] };
  return raw.registros;
}

export function temHistoricoFunding(exchangeId: string, symbol: string): boolean {
  return fs.existsSync(cachePath(exchangeId, symbol));
}
