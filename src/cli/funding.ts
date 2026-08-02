/**
 * FUNDING RATE — renda estrutural, sem previsão de direção.
 *
 * A ideia: comprar o ativo no spot e vender o mesmo tanto no perpétuo. A
 * exposição a preço vira zero — se o preço cai, a perda no spot é compensada
 * pelo ganho no short. O que sobra é o funding.
 *
 * O funding existe para ancorar o perpétuo ao spot. Quando há mais comprados
 * que vendidos (o normal em alta), os comprados pagam os vendidos a cada 8
 * horas. Quem está delta-neutro coleta isso sem tomar risco direcional.
 *
 * Por que isto é categoricamente diferente de tudo que este projeto tentou:
 *
 *   As 6 estratégias, os 3 modelos de ML, as 1.145 candidatas mineradas — todas
 *   tentavam prever. Todas foram limitadas pelo mesmo teto: a vantagem medida
 *   nunca passou de 0,17R e o custo comia quase tudo.
 *
 *   Funding não é previsão. É um fluxo de pagamento contratual da exchange,
 *   observável, com histórico público. Ou ele é positivo no período ou não é —
 *   e dá para medir exatamente quanto foi.
 *
 * Os riscos REAIS, que este arquivo mede em vez de ignorar:
 *   1. funding negativo — em queda forte, os vendidos é que pagam
 *   2. custo de montar e desmontar as duas pernas
 *   3. liquidação da perna short se ela for alavancada e o preço subir muito
 *   4. o spot rende zero: metade do capital fica parado só sustentando a outra
 */
import ccxt from 'ccxt';
import { parseArgs, num, str } from './args.ts';

const a = parseArgs();
const dias = num(a.days, 365);
const capital = num(a.equity, 100);
const topN = num(a.top, 15);

const ex = new (ccxt as any).binanceusdm({ enableRateLimit: true });
await ex.loadMarkets();

console.log(`\n${'='.repeat(88)}`);
console.log(`FUNDING RATE — renda delta-neutra · últimos ${dias} dias · capital US$ ${capital}`);
console.log(`${'='.repeat(88)}\n`);

// ── universo líquido ───────────────────────────────────────────────────────
const tickers = await ex.fetchTickers();
const candidatos = Object.values(ex.markets)
  .filter((m: any) => m.swap && m.quote === 'USDT' && m.active)
  .map((m: any) => ({ sym: m.symbol, vol: tickers[m.symbol]?.quoteVolume ?? 0 }))
  .filter((x: any) => x.vol > 100e6)
  .sort((x: any, y: any) => y.vol - x.vol)
  .slice(0, topN);

console.log(`${candidatos.length} perpétuos com volume acima de US$ 100M/dia\n`);
console.log('coletando histórico de funding…\n');

interface Resultado {
  sym: string;
  n: number;
  mediaPor8h: number;
  apr: number;
  positivos: number;
  fracaoPositiva: number;
  pior: number;
  melhor: number;
  /** desvio padrão do funding — mede a estabilidade da renda */
  desvio: number;
  /** quanto US$ 100 delta-neutro teria rendido no período, em dólares */
  ganhoBruto: number;
}

const resultados: Resultado[] = [];
const desde = Date.now() - dias * 86_400_000;

for (const c of candidatos) {
  try {
    // a API devolve no máximo 1000 registros por chamada; 3 por dia
    const todos: any[] = [];
    let since = desde;
    for (let i = 0; i < 4; i++) {
      const lote = await ex.fetchFundingRateHistory(c.sym, since, 1000);
      if (!lote.length) break;
      todos.push(...lote);
      const ultimo = lote[lote.length - 1].timestamp;
      if (ultimo <= since) break;
      since = ultimo + 1;
      if (since > Date.now()) break;
    }
    if (todos.length < 100) continue;

    const taxas = todos.map((f: any) => f.fundingRate as number);
    const media = taxas.reduce((x, y) => x + y, 0) / taxas.length;
    const desvio = Math.sqrt(taxas.reduce((x, y) => x + (y - media) ** 2, 0) / taxas.length);
    const positivos = taxas.filter((t) => t > 0).length;
    // 3 pagamentos por dia, 365 dias
    const apr = media * 3 * 365;
    // Delta-neutro: metade do capital no spot, metade sustentando o short.
    // O notional que coleta funding é ~metade do capital.
    const notionalNeutro = capital / 2;
    const ganho = notionalNeutro * media * taxas.length;

    resultados.push({
      sym: c.sym, n: taxas.length, mediaPor8h: media, apr,
      positivos, fracaoPositiva: positivos / taxas.length,
      pior: Math.min(...taxas), melhor: Math.max(...taxas), desvio, ganhoBruto: ganho,
    });
  } catch { /* segue */ }
}

resultados.sort((x, y) => y.apr - x.apr);

console.log('ativo'.padEnd(12) + 'amostras'.padEnd(11) + 'média/8h'.padEnd(12) + 'APR'.padEnd(11) + '% positivo'.padEnd(13) + 'pior'.padEnd(11) + 'melhor'.padEnd(11) + 'US$100 rendeu');
for (const r of resultados) {
  console.log(
    r.sym.replace('/USDT:USDT', '').padEnd(12) + String(r.n).padEnd(11) +
    ((r.mediaPor8h * 100).toFixed(4) + '%').padEnd(12) +
    ((r.apr * 100).toFixed(1) + '%').padEnd(11) +
    ((r.fracaoPositiva * 100).toFixed(0) + '%').padEnd(13) +
    ((r.pior * 100).toFixed(3) + '%').padEnd(11) +
    ((r.melhor * 100).toFixed(3) + '%').padEnd(11) +
    '$' + r.ganhoBruto.toFixed(2),
  );
}

// ── o que sobra depois dos custos reais ────────────────────────────────────
console.log(`\n${'─'.repeat(88)}`);
console.log('O QUE SOBRA DEPOIS DOS CUSTOS\n');

// Montar a posição: comprar spot (0,1% taker) + vender perp (0,05% taker).
// Desmontar: o mesmo. Total ~0,3% do notional, pago uma vez por ciclo.
const custoMontagem = 0.003;
const notionalNeutro = capital / 2;

console.log(
  `  Montar e desmontar a posição custa ~${(custoMontagem * 100).toFixed(2)}% do notional\n` +
  `  (spot taker 0,10% + perp taker 0,05%, ida e volta)\n\n` +
  `  Com US$ ${capital}, o notional delta-neutro é ~US$ ${notionalNeutro.toFixed(0)}\n` +
  `  — metade do capital fica no spot, que não rende nada sozinho.\n`,
);

console.log('ativo'.padEnd(12) + 'APR bruto'.padEnd(13) + 'custo 1 ciclo'.padEnd(16) + 'dias p/ pagar o custo'.padEnd(23) + 'ganho líquido/ano em US$100');
for (const r of resultados.slice(0, 8)) {
  const custoAbs = notionalNeutro * custoMontagem;
  const ganhoDia = notionalNeutro * r.mediaPor8h * 3;
  const diasPagar = ganhoDia > 0 ? custoAbs / ganhoDia : Infinity;
  const liquidoAno = notionalNeutro * r.apr - custoAbs;
  console.log(
    r.sym.replace('/USDT:USDT', '').padEnd(12) +
    ((r.apr * 100).toFixed(1) + '%').padEnd(13) +
    ('$' + custoAbs.toFixed(2)).padEnd(16) +
    (isFinite(diasPagar) ? diasPagar.toFixed(1) + ' dias' : 'nunca').padEnd(23) +
    '$' + liquidoAno.toFixed(2),
  );
}

const melhor = resultados[0];
if (melhor) {
  const custoAbs = notionalNeutro * custoMontagem;
  const liquidoAno = notionalNeutro * melhor.apr - custoAbs;
  console.log(
    `\n${'='.repeat(88)}\n` +
    `MELHOR: ${melhor.sym.replace('/USDT:USDT', '')} · APR ${(melhor.apr * 100).toFixed(1)}% · ` +
    `funding positivo em ${(melhor.fracaoPositiva * 100).toFixed(0)}% dos períodos\n\n` +
    `  Com US$ ${capital}: ganho líquido de ~US$ ${liquidoAno.toFixed(2)} por ano.\n` +
    `  Isso é ${((liquidoAno / capital) * 100).toFixed(1)}% ao ano sobre o capital total.\n\n` +
    `  RISCO DIRECIONAL: zero. Você não aposta em alta nem em baixa.\n` +
    `  RISCO REAL: funding virar negativo (aconteceu em ${((1 - melhor.fracaoPositiva) * 100).toFixed(0)}% dos períodos),\n` +
    `  e a perna vendida ser liquidada se você alavancar demais.`,
  );
}
