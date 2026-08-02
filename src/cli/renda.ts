/**
 * Simula o motor delta-neutro com dados REAIS de funding e de preço.
 *
 * Responde a pergunta única: em quantas semanas houve lucro?
 */
import ccxt from 'ccxt';
import { dimensionar, abrir, aplicarFunding, saude, rebalancearMargem, fechar, CONFIG_PADRAO } from '../funding/engine.ts';
import { parseArgs, num, str } from './args.ts';

const a = parseArgs();
const CAPITAL = num(a.equity, 100);
const DIAS = num(a.days, 180);
const alvos = str(a.symbol, 'KOMA/USDT:USDT,1000RATS/USDT:USDT,AKE/USDT:USDT,GIGGLE/USDT:USDT').split(',').map((s) => s.trim());

const cfg = CONFIG_PADRAO;
const d = dimensionar(CAPITAL, cfg);

console.log(`\n${'='.repeat(84)}`);
console.log(`RENDA DELTA-NEUTRA — US$ ${CAPITAL} · ${DIAS} dias`);
console.log(`${'='.repeat(84)}\n`);
console.log(
  `  spot            US$ ${d.spot.toFixed(2)}\n` +
  `  margem          US$ ${d.margem.toFixed(2)}  (sustenta ${cfg.alavancagemShort}x)\n` +
  `  notional neutro US$ ${d.notional.toFixed(2)}\n` +
  `  custo de entrada US$ ${d.custoEntrada.toFixed(2)}\n` +
  `  exposição a preço: ZERO\n`,
);

const ex = new (ccxt as any).binanceusdm({ enableRateLimit: true });
await ex.loadMarkets();

interface Res {
  sym: string; semanas: number; semanasPositivas: number; fracao: number;
  fundingTotal: number; custoTotal: number; lucro: number; aprEfetivo: number;
  piorSemana: number; melhorSemana: number; rebalanceamentos: number;
  patrimonioFinal: number;
}
const resultados: Res[] = [];

for (const sym of alvos) {
  try {
    const desde = Date.now() - DIAS * 86_400_000;
    const fh = await ex.fetchFundingRateHistory(sym, desde, 1000);
    if (fh.length < 100) { console.log(`  ${sym}: histórico insuficiente`); continue; }
    const velas = await ex.fetchOHLCV(sym, '8h', desde, 1000);
    if (!velas.length) continue;

    const precoPor = new Map<number, number>();
    for (const v of velas) precoPor.set(v[0], v[4]);
    const precos = velas.map((v: number[]) => v[4]);

    const { posicao, custo } = abrir(sym, CAPITAL, precos[0], cfg);
    let p = posicao;
    let custoTotal = custo;
    let rebal = 0;

    const porSemana: number[] = [];
    let acumSemana = 0;
    let cont = 0;

    for (let i = 0; i < fh.length; i++) {
      const taxa = fh[i].fundingRate as number;
      const antes = p.fundingAcumulado;
      p = aplicarFunding(p, taxa);
      acumSemana += p.fundingAcumulado - antes;

      const preco = precos[Math.min(i, precos.length - 1)];
      const s = saude(p, preco, cfg);
      if (s.precisaRebalancear) {
        const r = rebalancearMargem(p, preco, cfg);
        p = r.posicao; custoTotal += r.custo; rebal++;
      }

      cont++;
      if (cont >= 21) { porSemana.push(acumSemana); acumSemana = 0; cont = 0; }
    }
    if (cont > 0) porSemana.push(acumSemana);

    const precoFinal = precos[precos.length - 1];
    const f = fechar(p, precoFinal, cfg);
    custoTotal += f.custo;
    const lucro = p.fundingAcumulado - custoTotal;
    const positivas = porSemana.filter((x) => x > 0).length;

    resultados.push({
      sym, semanas: porSemana.length, semanasPositivas: positivas,
      fracao: positivas / porSemana.length,
      fundingTotal: p.fundingAcumulado, custoTotal, lucro,
      aprEfetivo: (lucro / CAPITAL) * (365 / DIAS),
      piorSemana: Math.min(...porSemana), melhorSemana: Math.max(...porSemana),
      rebalanceamentos: rebal, patrimonioFinal: CAPITAL + lucro,
    });
  } catch (e) { console.log(`  ${sym}: ${(e as Error).message}`); }
}

resultados.sort((x, y) => y.fracao - x.fracao || y.lucro - x.lucro);

console.log(`${'─'.repeat(84)}`);
console.log('ativo'.padEnd(12) + 'semanas'.padEnd(10) + 'positivas'.padEnd(13) + 'funding'.padEnd(11) + 'custos'.padEnd(10) + 'lucro'.padEnd(10) + 'APR'.padEnd(9) + 'rebal');
for (const r of resultados) {
  console.log(
    r.sym.replace('/USDT:USDT', '').padEnd(12) + String(r.semanas).padEnd(10) +
    (`${r.semanasPositivas}/${r.semanas} (${(r.fracao * 100).toFixed(0)}%)`).padEnd(13) +
    ('$' + r.fundingTotal.toFixed(2)).padEnd(11) +
    ('$' + r.custoTotal.toFixed(2)).padEnd(10) +
    ('$' + r.lucro.toFixed(2)).padEnd(10) +
    ((r.aprEfetivo * 100).toFixed(1) + '%').padEnd(9) + r.rebalanceamentos,
  );
}

const melhor = resultados[0];
if (melhor) {
  const porSemanaMedia = melhor.lucro / melhor.semanas;
  console.log(`\n${'='.repeat(84)}`);
  console.log(
    `MELHOR: ${melhor.sym.replace('/USDT:USDT', '')}\n\n` +
    `  semanas com lucro:  ${melhor.semanasPositivas} de ${melhor.semanas}  (${(melhor.fracao * 100).toFixed(0)}%)\n` +
    `  lucro no período:   US$ ${melhor.lucro.toFixed(2)}\n` +
    `  média por semana:   US$ ${porSemanaMedia.toFixed(3)}\n` +
    `  pior semana:        US$ ${melhor.piorSemana.toFixed(3)}\n` +
    `  melhor semana:      US$ ${melhor.melhorSemana.toFixed(3)}\n` +
    `  APR efetivo:        ${(melhor.aprEfetivo * 100).toFixed(1)}% sobre o capital total\n` +
    `  patrimônio final:   US$ ${melhor.patrimonioFinal.toFixed(2)}`,
  );
}
