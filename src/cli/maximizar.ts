/**
 * Alavancas para aumentar a renda semanal, medidas com dados reais.
 *
 * Três caminhos, do mais simples ao mais sofisticado:
 *
 *   1. RENDER O SPOT — os 75% do capital que ficam comprados no spot estão
 *      parados. Se renderem qualquer coisa, é receita adicional sobre capital
 *      já comprometido, sem risco novo.
 *
 *   2. ALAVANCAGEM DA PERNA VENDIDA — cada ponto a mais aumenta o notional que
 *      coleta funding. A 3x são US$ 75; a 5x são US$ 83. O limite é a folga
 *      até a chamada de margem.
 *
 *   3. FUNDING ENTRE EXCHANGES — o mesmo ativo tem funding diferente em cada
 *      exchange. Ficar vendido onde paga mais e comprado onde paga menos
 *      captura a DIFERENÇA, e continua delta-neutro.
 */
import ccxt from 'ccxt';
import { dimensionar, CONFIG_PADRAO } from '../funding/engine.ts';
import { parseArgs, num, str } from './args.ts';

const a = parseArgs();
const CAPITAL = num(a.equity, 100);
const cfg = CONFIG_PADRAO;

console.log(`\n${'='.repeat(84)}`);
console.log(`MAXIMIZAR A RENDA SEMANAL — US$ ${CAPITAL}`);
console.log(`${'='.repeat(84)}\n`);

// ── ALAVANCA 2: alavancagem da perna vendida ──────────────────────────────
console.log('ALAVANCA 1 — alavancagem da perna vendida\n');
console.log('alavancagem'.padEnd(14) + 'spot'.padEnd(11) + 'margem'.padEnd(11) + 'notional'.padEnd(12) + 'ganho vs 3x'.padEnd(14) + 'liquidação em');
const base = dimensionar(CAPITAL, { ...cfg, alavancagemShort: 3 }).notional;
for (const lev of [2, 3, 4, 5, 6, 8]) {
  const d = dimensionar(CAPITAL, { ...cfg, alavancagemShort: lev });
  // a perna vendida é liquidada quando a alta consome a margem
  const distLiq = 1 / lev - 0.004;
  console.log(
    (lev + 'x').padEnd(14) + ('$' + d.spot.toFixed(2)).padEnd(11) + ('$' + d.margem.toFixed(2)).padEnd(11) +
    ('$' + d.notional.toFixed(2)).padEnd(12) +
    (((d.notional / base - 1) * 100).toFixed(1) + '%').padEnd(14) +
    '+' + (distLiq * 100).toFixed(1) + '% de alta',
  );
}
console.log(
  `\n  O spot sobe junto com a alta, então o patrimônio não muda — o risco é de\n` +
  `  CHAMADA DE MARGEM, não de perda. Acima de 5x a folga fica curta demais para\n` +
  `  o movimento de um dia em altcoin.\n`,
);

// ── ALAVANCA 3: funding entre exchanges ───────────────────────────────────
console.log(`${'─'.repeat(84)}`);
console.log('ALAVANCA 2 — funding entre exchanges (o mesmo ativo paga diferente)\n');

const exchanges = ['binanceusdm', 'bybit', 'okx'];
const ativos = str(a.symbol, 'BTC/USDT:USDT,ETH/USDT:USDT,SOL/USDT:USDT,DOGE/USDT:USDT,XRP/USDT:USDT').split(',').map((s) => s.trim());
const taxas = new Map<string, Map<string, number>>();

for (const exId of exchanges) {
  try {
    const ex = new (ccxt as any)[exId]({ enableRateLimit: true });
    await ex.loadMarkets();
    const m = new Map<string, number>();
    for (const sym of ativos) {
      try {
        if (!ex.markets[sym]) continue;
        const fr = await ex.fetchFundingRate(sym);
        if (fr?.fundingRate != null) m.set(sym, fr.fundingRate);
      } catch { /* segue */ }
    }
    taxas.set(exId, m);
    console.log(`  ${exId}: ${m.size} ativos lidos`);
  } catch (e) { console.log(`  ${exId}: indisponível`); }
}

console.log(`\nativo'`.padEnd(12) + 'binance'.padEnd(13) + 'bybit'.padEnd(13) + 'okx'.padEnd(13) + 'spread'.padEnd(12) + 'APR do spread');
const oportunidades: { sym: string; spread: number; longEm: string; shortEm: string }[] = [];
for (const sym of ativos) {
  const linha: { ex: string; taxa: number }[] = [];
  for (const [exId, m] of taxas) {
    const t = m.get(sym);
    if (t != null) linha.push({ ex: exId, taxa: t });
  }
  if (linha.length < 2) continue;
  linha.sort((x, y) => y.taxa - x.taxa);
  const spread = linha[0].taxa - linha[linha.length - 1].taxa;
  oportunidades.push({ sym, spread, shortEm: linha[0].ex, longEm: linha[linha.length - 1].ex });

  const get = (e: string) => {
    const t = taxas.get(e)?.get(sym);
    return t != null ? (t * 100).toFixed(4) + '%' : '—';
  };
  console.log(
    sym.replace('/USDT:USDT', '').padEnd(12) + get('binanceusdm').padEnd(13) + get('bybit').padEnd(13) +
    get('okx').padEnd(13) + ((spread * 100).toFixed(4) + '%').padEnd(12) +
    (spread * 3 * 365 * 100).toFixed(1) + '%',
  );
}

const melhorSpread = oportunidades.sort((x, y) => y.spread - x.spread)[0];
if (melhorSpread && melhorSpread.spread > 0) {
  const d = dimensionar(CAPITAL, cfg);
  console.log(
    `\n  MELHOR: ${melhorSpread.sym.replace('/USDT:USDT', '')} — vendido na ${melhorSpread.shortEm}, ` +
    `comprado na ${melhorSpread.longEm}\n` +
    `  spread ${(melhorSpread.spread * 100).toFixed(4)}%/8h = ${(melhorSpread.spread * 3 * 365 * 100).toFixed(1)}% ao ano\n` +
    `  Em US$ ${d.notional.toFixed(0)} de notional: US$ ${(d.notional * melhorSpread.spread * 21).toFixed(4)} por semana\n\n` +
    `  Aqui as DUAS pernas são perpétuos, então não há spot parado — o capital\n` +
    `  inteiro fica produtivo. Mas exige conta nas duas exchanges e o spread\n` +
    `  muda o tempo todo.`,
  );
}

// ── ALAVANCA 1: render o spot ─────────────────────────────────────────────
console.log(`\n${'─'.repeat(84)}`);
console.log('ALAVANCA 3 — fazer o spot render\n');
const d3 = dimensionar(CAPITAL, cfg);
console.log(
  `  Hoje US$ ${d3.spot.toFixed(2)} ficam comprados no spot rendendo ZERO.\n` +
  `  Eles existem só para neutralizar a perna vendida.\n\n` +
  `  Se rendessem, seria receita pura sobre capital já comprometido:\n`,
);
console.log('rendimento do spot'.padEnd(22) + 'ganho extra/ano'.padEnd(19) + 'ganho extra/semana'.padEnd(22) + 'aumento na renda total');
const rendaBaseSemanal = d3.notional * 0.000189 * 21;
for (const apr of [0.02, 0.04, 0.06, 0.10]) {
  const extraAno = d3.spot * apr;
  const extraSemana = extraAno / 52;
  console.log(
    ((apr * 100).toFixed(0) + '% ao ano').padEnd(22) +
    ('$' + extraAno.toFixed(2)).padEnd(19) +
    ('$' + extraSemana.toFixed(4)).padEnd(22) +
    '+' + ((extraSemana / rendaBaseSemanal) * 100).toFixed(0) + '%',
  );
}
console.log(
  `\n  Renda base atual: US$ ${rendaBaseSemanal.toFixed(4)}/semana só de funding.\n` +
  `  Colocar o spot para render é a alavanca de maior retorno por unidade de\n` +
  `  esforço, porque não adiciona risco nenhum — o ativo continua lá, apenas\n` +
  `  depositado num produto que paga juros.`,
);
