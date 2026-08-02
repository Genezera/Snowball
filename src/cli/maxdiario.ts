/**
 * Maximizar o lucro DIÁRIO — testa as alavancas que sobraram.
 *
 * Duas descobertas mudaram o que faz sentido testar:
 *
 *   1. O intervalo de funding é 8h em TODAS as exchanges medidas. Não existe
 *      a alavanca de "pagar mais vezes por dia".
 *
 *   2. Selecionar pelo spread INSTANTÂNEO pega pico, não nível. O INJ marcava
 *      44,8% no instante e tem 15,9% de média em 14 dias. O UNI marca menos no
 *      instante e sustenta 25,3%.
 *
 * Restam duas alavancas reais:
 *
 *   A. SELEÇÃO POR MÉDIA em vez de instantâneo — pega o que se repete.
 *   B. MÚLTIPLAS POSIÇÕES — capturar os 3 melhores spreads em vez de 1.
 *
 * A pergunta da alavanca B não é óbvia: concentrar no melhor rende mais por
 * dólar, mas diversificar protege contra o spread fechar. Este arquivo mede a
 * troca em vez de assumir.
 */
import ccxt from 'ccxt';
import { parseArgs, num, str } from './args.ts';

const a = parseArgs();
const CAPITAL = num(a.equity, 100);
const LEV = 5;
const TAXA = 0.0005;
const DIAS_HIST = num(a.dias, 14);

const EXCHANGES = ['binanceusdm', 'bybit', 'okx', 'gate', 'kucoinfutures', 'bitget', 'mexc', 'htx'];
const ATIVOS = str(a.symbol, 'BTC/USDT:USDT,ETH/USDT:USDT,SOL/USDT:USDT,INJ/USDT:USDT,UNI/USDT:USDT,AAVE/USDT:USDT,DOGE/USDT:USDT,XRP/USDT:USDT,LTC/USDT:USDT,TRX/USDT:USDT,SUI/USDT:USDT,FIL/USDT:USDT,LINK/USDT:USDT,AVAX/USDT:USDT,DOT/USDT:USDT,NEAR/USDT:USDT,APT/USDT:USDT,ARB/USDT:USDT,OP/USDT:USDT,ATOM/USDT:USDT').split(',');

console.log(`\n${'='.repeat(90)}`);
console.log(`MAXIMIZAR O LUCRO DIÁRIO — US$ ${CAPITAL} · ${LEV}x · histórico de ${DIAS_HIST} dias`);
console.log(`${'='.repeat(90)}\n`);

// ── coleta: média E estabilidade do spread, não só o instantâneo ──────────
interface Serie { exchange: string; symbol: string; taxas: number[]; media: number; atual: number }
const series: Serie[] = [];

for (const exId of EXCHANGES) {
  try {
    const ex = new (ccxt as any)[exId]({ enableRateLimit: true });
    await ex.loadMarkets();
    let n = 0;
    for (const sym of ATIVOS) {
      try {
        if (!ex.markets[sym]) continue;
        const h = await ex.fetchFundingRateHistory(sym, Date.now() - DIAS_HIST * 86_400_000, 100);
        if (h.length < 10) continue;
        const taxas = h.map((f: any) => f.fundingRate as number);
        series.push({
          exchange: exId, symbol: sym, taxas,
          media: taxas.reduce((x: number, y: number) => x + y, 0) / taxas.length,
          atual: taxas[taxas.length - 1],
        });
        n++;
      } catch { /* segue */ }
    }
    console.log(`  ${exId.padEnd(16)} ${n} pares`);
  } catch { /* segue */ }
}

// ── monta os spreads por ativo, com média e consistência ──────────────────
interface Spread {
  symbol: string; short: string; long: string;
  spreadMedio: number; spreadAtual: number;
  /** fração dos períodos em que o spread se manteve positivo */
  consistencia: number;
  aprMedio: number;
}
const spreads: Spread[] = [];
const porAtivo = new Map<string, Serie[]>();
for (const s of series) {
  if (!porAtivo.has(s.symbol)) porAtivo.set(s.symbol, []);
  porAtivo.get(s.symbol)!.push(s);
}

for (const [sym, lista] of porAtivo) {
  if (lista.length < 2) continue;
  const ord = [...lista].sort((x, y) => y.media - x.media);
  const alto = ord[0], baixo = ord[ord.length - 1];
  const spreadMedio = alto.media - baixo.media;
  if (spreadMedio <= 0) continue;

  // consistência: em quantos períodos o spread se manteve positivo
  const n = Math.min(alto.taxas.length, baixo.taxas.length);
  let positivos = 0;
  for (let i = 0; i < n; i++) {
    if (alto.taxas[alto.taxas.length - n + i] - baixo.taxas[baixo.taxas.length - n + i] > 0) positivos++;
  }

  spreads.push({
    symbol: sym, short: alto.exchange, long: baixo.exchange,
    spreadMedio, spreadAtual: alto.atual - baixo.atual,
    consistencia: positivos / n, aprMedio: spreadMedio * 3 * 365,
  });
}

// ── ALAVANCA A: selecionar por média × consistência ───────────────────────
console.log(`\n${'─'.repeat(90)}`);
console.log('ALAVANCA A — selecionar por MÉDIA e CONSISTÊNCIA, não pelo instantâneo\n');

const pontuados = spreads
  .map((s) => ({ ...s, pontos: s.spreadMedio * s.consistencia ** 2 }))
  .sort((x, y) => y.pontos - x.pontos);

console.log('ativo'.padEnd(9) + 'pernas'.padEnd(28) + 'spread médio'.padEnd(15) + 'instantâneo'.padEnd(15) + 'consistência'.padEnd(15) + 'APR médio');
for (const s of pontuados.slice(0, 12)) {
  console.log(
    s.symbol.replace('/USDT:USDT', '').padEnd(9) +
    `${s.short.slice(0, 11)}/${s.long.slice(0, 11)}`.padEnd(28) +
    ((s.spreadMedio * 100).toFixed(4) + '%').padEnd(15) +
    ((s.spreadAtual * 100).toFixed(4) + '%').padEnd(15) +
    ((s.consistencia * 100).toFixed(0) + '%').padEnd(15) +
    (s.aprMedio * 100).toFixed(1) + '%',
  );
}

// ── ALAVANCA B: concentrar em 1 ou dividir em N? ──────────────────────────
console.log(`\n${'─'.repeat(90)}`);
console.log('ALAVANCA B — concentrar no melhor ou dividir entre vários?\n');

const custoMontagem = (cap: number) => (cap / 2) * LEV * TAXA * 2;

console.log('posições'.padEnd(12) + 'capital cada'.padEnd(16) + 'notional total'.padEnd(18) + 'renda/dia'.padEnd(14) + 'custo montagem'.padEnd(18) + 'se 1 spread fechar');
for (const n of [1, 2, 3, 4, 5]) {
  if (pontuados.length < n) break;
  const capCada = CAPITAL / n;
  const notionalCada = (capCada / 2) * LEV;
  const usados = pontuados.slice(0, n);
  const rendaDia = usados.reduce((x, s) => x + notionalCada * s.spreadMedio * 3, 0);
  const custo = usados.reduce((x) => x + custoMontagem(capCada), 0);
  // quanto se perde se o melhor spread fechar
  const perdaSeFechar = notionalCada * usados[0].spreadMedio * 3;
  console.log(
    String(n).padEnd(12) + ('$' + capCada.toFixed(2)).padEnd(16) +
    ('$' + (notionalCada * n * 2).toFixed(0)).padEnd(18) +
    ('$' + rendaDia.toFixed(4)).padEnd(14) +
    ('$' + custo.toFixed(3)).padEnd(18) +
    `-${((perdaSeFechar / rendaDia) * 100).toFixed(0)}% da renda`,
  );
}

// ── a recomendação ────────────────────────────────────────────────────────
const melhor1 = pontuados[0];
const notional1 = (CAPITAL / 2) * LEV;
const rendaDia1 = notional1 * melhor1.spreadMedio * 3;

const top3 = pontuados.slice(0, 3);
const cap3 = CAPITAL / 3;
const not3 = (cap3 / 2) * LEV;
const rendaDia3 = top3.reduce((x, s) => x + not3 * s.spreadMedio * 3, 0);

console.log(`\n${'='.repeat(90)}`);
console.log(
  `CONCENTRADO em ${melhor1.symbol.replace('/USDT:USDT', '')}\n` +
  `  renda/dia US$ ${rendaDia1.toFixed(4)} · renda/semana US$ ${(rendaDia1 * 7).toFixed(3)} · ` +
  `APR ${(melhor1.aprMedio * 100).toFixed(1)}%\n` +
  `  se o spread fechar, a renda vai a zero até o motor trocar\n\n` +
  `DIVIDIDO em 3 (${top3.map((s) => s.symbol.replace('/USDT:USDT', '')).join(', ')})\n` +
  `  renda/dia US$ ${rendaDia3.toFixed(4)} · renda/semana US$ ${(rendaDia3 * 7).toFixed(3)}\n` +
  `  se um spread fechar, perde ${((not3 * top3[0].spreadMedio * 3 / rendaDia3) * 100).toFixed(0)}% da renda, não 100%\n\n` +
  `DIFERENÇA: ${rendaDia3 > rendaDia1 ? '+' : ''}${(((rendaDia3 / rendaDia1) - 1) * 100).toFixed(1)}% ` +
  `em renda diária ao dividir`,
);
