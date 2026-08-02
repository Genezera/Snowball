/**
 * Intervalo de funding — a alavanca que eu não tinha olhado.
 *
 * Toda a matemática deste projeto assumiu 3 pagamentos por dia (a cada 8h).
 * Mas o intervalo NÃO é universal: várias exchanges pagam a cada 4 horas em
 * alguns pares, e algumas encurtam o intervalo em períodos de volatilidade.
 *
 * Se um par paga a cada 4h, são 6 pagamentos por dia em vez de 3 — o DOBRO da
 * renda com o mesmo capital e o mesmo spread. É a maior alavanca isolada que
 * ainda não foi explorada, e não custa risco nenhum: é só escolher onde operar.
 *
 * O intervalo é medido pelos timestamps reais do histórico, não pelo que a
 * documentação diz.
 */
import ccxt from 'ccxt';
import { parseArgs, num, str } from './args.ts';

const a = parseArgs();
const EXCHANGES = str(a.exchanges, 'binanceusdm,bybit,okx,gate,kucoinfutures,bitget,mexc,htx').split(',');
const ATIVOS = str(a.symbol, 'BTC/USDT:USDT,ETH/USDT:USDT,SOL/USDT:USDT,INJ/USDT:USDT,UNI/USDT:USDT,AAVE/USDT:USDT,DOGE/USDT:USDT,XRP/USDT:USDT,LTC/USDT:USDT,TRX/USDT:USDT,SUI/USDT:USDT,FIL/USDT:USDT').split(',');

console.log(`\n${'='.repeat(88)}`);
console.log('INTERVALO DE FUNDING — quantos pagamentos por dia em cada lugar');
console.log(`${'='.repeat(88)}\n`);

interface Medida {
  exchange: string;
  symbol: string;
  intervaloHoras: number;
  pagamentosPorDia: number;
  mediaTaxa: number;
  /** APR considerando o intervalo REAL, não assumindo 8h */
  aprReal: number;
  amostras: number;
}

const medidas: Medida[] = [];

for (const exId of EXCHANGES) {
  try {
    const ex = new (ccxt as any)[exId]({ enableRateLimit: true });
    await ex.loadMarkets();
    let lidos = 0;
    for (const sym of ATIVOS) {
      try {
        if (!ex.markets[sym]) continue;
        const h = await ex.fetchFundingRateHistory(sym, Date.now() - 14 * 86_400_000, 100);
        if (h.length < 10) continue;

        // mede o intervalo real pela mediana das diferenças de timestamp
        const difs: number[] = [];
        for (let i = 1; i < h.length; i++) {
          const d = (h[i].timestamp - h[i - 1].timestamp) / 3_600_000;
          if (d > 0.5 && d < 25) difs.push(d);
        }
        if (!difs.length) continue;
        difs.sort((x, y) => x - y);
        const intervalo = difs[Math.floor(difs.length / 2)];
        const porDia = 24 / intervalo;

        const taxas = h.map((f: any) => f.fundingRate as number);
        const media = taxas.reduce((x: number, y: number) => x + y, 0) / taxas.length;

        medidas.push({
          exchange: exId, symbol: sym, intervaloHoras: intervalo,
          pagamentosPorDia: porDia, mediaTaxa: media,
          aprReal: media * porDia * 365, amostras: h.length,
        });
        lidos++;
      } catch { /* segue */ }
    }
    console.log(`  ${exId.padEnd(16)} ${lidos} pares medidos`);
  } catch { console.log(`  ${exId.padEnd(16)} indisponível`); }
}

// ── quais exchanges pagam mais vezes ao dia ────────────────────────────────
console.log(`\n${'─'.repeat(88)}`);
console.log('PAGAMENTOS POR DIA, POR EXCHANGE\n');
const porExchange = new Map<string, number[]>();
for (const m of medidas) {
  if (!porExchange.has(m.exchange)) porExchange.set(m.exchange, []);
  porExchange.get(m.exchange)!.push(m.pagamentosPorDia);
}
console.log('exchange'.padEnd(18) + 'intervalo típico'.padEnd(20) + 'pagamentos/dia'.padEnd(18) + 'vs padrão 8h');
for (const [ex, v] of [...porExchange].sort((x, y) => {
  const mx = x[1].reduce((p, q) => p + q, 0) / x[1].length;
  const my = y[1].reduce((p, q) => p + q, 0) / y[1].length;
  return my - mx;
})) {
  const media = v.reduce((x, y) => x + y, 0) / v.length;
  const horas = 24 / media;
  console.log(
    ex.padEnd(18) + (horas.toFixed(1) + 'h').padEnd(20) +
    media.toFixed(1).padEnd(18) +
    (media > 3.5 ? `+${((media / 3 - 1) * 100).toFixed(0)}% de pagamentos` : 'padrão'),
  );
}

// ── os pares que pagam com mais frequência ────────────────────────────────
console.log(`\n${'─'.repeat(88)}`);
console.log('PARES QUE PAGAM MAIS VEZES AO DIA\n');
const rapidos = medidas.filter((m) => m.pagamentosPorDia > 3.5).sort((x, y) => y.aprReal - x.aprReal);
if (rapidos.length) {
  console.log('ativo'.padEnd(9) + 'exchange'.padEnd(17) + 'intervalo'.padEnd(13) + 'pag/dia'.padEnd(11) + 'taxa média'.padEnd(14) + 'APR real');
  for (const m of rapidos.slice(0, 15)) {
    console.log(
      m.symbol.replace('/USDT:USDT', '').padEnd(9) + m.exchange.padEnd(17) +
      (m.intervaloHoras.toFixed(0) + 'h').padEnd(13) +
      m.pagamentosPorDia.toFixed(0).padEnd(11) +
      ((m.mediaTaxa * 100).toFixed(4) + '%').padEnd(14) +
      (m.aprReal * 100).toFixed(1) + '%',
    );
  }
} else {
  console.log('  Todos os pares medidos pagam no intervalo padrão de 8h.');
}

// ── o efeito no spread: onde combinar intervalo curto com spread largo ────
console.log(`\n${'─'.repeat(88)}`);
console.log('COMBINANDO: spread largo + intervalo curto\n');

const porAtivo = new Map<string, Medida[]>();
for (const m of medidas) {
  if (!porAtivo.has(m.symbol)) porAtivo.set(m.symbol, []);
  porAtivo.get(m.symbol)!.push(m);
}

interface Combo {
  symbol: string; short: Medida; long: Medida;
  spread: number; pagDiaEfetivo: number; aprCombinado: number;
}
const combos: Combo[] = [];
for (const [sym, lista] of porAtivo) {
  if (lista.length < 2) continue;
  const ord = [...lista].sort((x, y) => y.mediaTaxa - x.mediaTaxa);
  const short = ord[0], long = ord[ord.length - 1];
  const spread = short.mediaTaxa - long.mediaTaxa;
  if (spread <= 0) continue;
  // o número de pagamentos efetivo é o MENOR dos dois — só se recebe quando
  // as duas pernas pagam
  const pagDia = Math.min(short.pagamentosPorDia, long.pagamentosPorDia);
  combos.push({ symbol: sym, short, long, spread, pagDiaEfetivo: pagDia, aprCombinado: spread * pagDia * 365 });
}
combos.sort((x, y) => y.aprCombinado - x.aprCombinado);

console.log('ativo'.padEnd(9) + 'vendido em'.padEnd(17) + 'comprado em'.padEnd(17) + 'spread'.padEnd(12) + 'pag/dia'.padEnd(10) + 'APR real');
for (const c of combos.slice(0, 12)) {
  console.log(
    c.symbol.replace('/USDT:USDT', '').padEnd(9) + c.short.exchange.padEnd(17) + c.long.exchange.padEnd(17) +
    ((c.spread * 100).toFixed(4) + '%').padEnd(12) +
    c.pagDiaEfetivo.toFixed(0).padEnd(10) +
    (c.aprCombinado * 100).toFixed(1) + '%',
  );
}

const melhor = combos[0];
if (melhor) {
  const CAPITAL = num(a.equity, 100);
  const notional = (CAPITAL / 2) * 5;
  const rendaDia = notional * melhor.spread * melhor.pagDiaEfetivo;
  const comPadrao = notional * melhor.spread * 3;
  console.log(
    `\n${'='.repeat(88)}\n` +
    `MELHOR COMBINAÇÃO: ${melhor.symbol.replace('/USDT:USDT', '')}\n\n` +
    `  vendido na ${melhor.short.exchange} (paga a cada ${melhor.short.intervaloHoras.toFixed(0)}h)\n` +
    `  comprado na ${melhor.long.exchange} (paga a cada ${melhor.long.intervaloHoras.toFixed(0)}h)\n` +
    `  pagamentos efetivos: ${melhor.pagDiaEfetivo.toFixed(0)}/dia\n\n` +
    `  Com US$ ${CAPITAL} e notional US$ ${notional.toFixed(0)}/perna:\n` +
    `    renda por dia     US$ ${rendaDia.toFixed(4)}\n` +
    `    renda por semana  US$ ${(rendaDia * 7).toFixed(4)}\n` +
    `    APR               ${(melhor.aprCombinado * 100).toFixed(1)}%\n\n` +
    (melhor.pagDiaEfetivo > 3.5
      ? `  Este par paga ${melhor.pagDiaEfetivo.toFixed(0)}x por dia em vez de 3 — ` +
        `${((melhor.pagDiaEfetivo / 3 - 1) * 100).toFixed(0)}% mais pagamentos\n  pelo mesmo capital.`
      : `  Este par paga no intervalo padrão de 8h.`),
  );
}
