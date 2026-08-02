/**
 * Varredura do mercado inteiro — todos os perpétuos USDT de todas as
 * exchanges com endpoint em massa.
 */
import { lerUniverso, cruzarUniverso, estatisticas } from '../funding/universo.ts';
import { dimensionarSpread } from '../funding/spread.ts';
import { parseArgs, num } from './args.ts';

const a = parseArgs();
const CAPITAL = num(a.equity, 100);
const LEV = num(a.alavancagem, 5);
const VOL_MIN = num(a.volumeMinimo, 5e6);

console.log(`\n${'='.repeat(92)}`);
console.log('VARREDURA DO MERCADO INTEIRO');
console.log(`${'='.repeat(92)}\n`);

const t0 = Date.now();
const pares = await lerUniverso({
  onProgresso: (ex, n, ms) => console.log(`  ${ex.padEnd(15)} ${String(n).padStart(4)} pares  ${(ms / 1000).toFixed(1)}s`),
});
const ops = cruzarUniverso(pares, { volumeMinimo: VOL_MIN });
const st = estatisticas(pares, ops);
const total = ((Date.now() - t0) / 1000).toFixed(1);

console.log(
  `\n  ${st.paresLidos.toLocaleString('pt-BR')} pares lidos em ${total}s · ` +
  `${st.exchangesAtivas} exchanges · ${st.ativosUnicos.toLocaleString('pt-BR')} ativos únicos\n` +
  `  ${st.ativosEmDuasOuMais.toLocaleString('pt-BR')} ativos presentes em 2+ exchanges → ${st.oportunidades} com spread positivo\n` +
  `  melhor APR ${(st.melhorApr * 100).toFixed(1)}% · mediana ${(st.medianaApr * 100).toFixed(1)}%\n`,
);

const d = dimensionarSpread(CAPITAL, LEV);

console.log(`${'─'.repeat(92)}`);
console.log(`TOP 25 · notional US$ ${d.notionalPorPerna.toFixed(0)}/perna com US$ ${CAPITAL} a ${LEV}x\n`);
console.log(
  'ativo'.padEnd(13) + 'vendido'.padEnd(14) + 'comprado'.padEnd(14) +
  'spread'.padEnd(11) + 'APR'.padEnd(11) + 'pontas'.padEnd(9) +
  'liquidez'.padEnd(12) + 'renda/semana',
);
for (const o of ops.slice(0, 25)) {
  const renda = d.notionalPorPerna * o.spread * 21;
  console.log(
    o.symbol.replace('/USDT:USDT', '').slice(0, 11).padEnd(13) +
    o.exchangeShort.padEnd(14) + o.exchangeLong.padEnd(14) +
    ((o.spread * 100).toFixed(4) + '%').padEnd(11) +
    ((o.aprSpread * 100).toFixed(1) + '%').padEnd(11) +
    String(o.presencaEm).padEnd(9) +
    ('$' + (o.volumeMinimo / 1e6).toFixed(0) + 'M').padEnd(12) +
    '$' + renda.toFixed(3),
  );
}

// ── o que os filtros descartaram ──────────────────────────────────────────
const semFiltro = cruzarUniverso(pares, { volumeMinimo: 0, desvioPrecoMax: 1 });
console.log(`\n${'─'.repeat(92)}`);
console.log('O QUE OS FILTROS CORTARAM\n');
console.log(
  `  sem filtro nenhum:        ${semFiltro.length} oportunidades · melhor APR ${(semFiltro[0]?.aprSpread * 100 || 0).toFixed(0)}%\n` +
  `  com liquidez ≥ US$ ${(VOL_MIN / 1e6).toFixed(0)}M:  ${ops.length} oportunidades · melhor APR ${(st.melhorApr * 100).toFixed(1)}%\n` +
  `  descartadas:              ${semFiltro.length - ops.length}\n\n` +
  `  O corte é grande de propósito. Spread altíssimo em par sem liquidez é\n` +
  `  onde o backtest brilha e a execução falha — não dá para montar a posição.`,
);

// comparação com a varredura anterior
console.log(`\n${'='.repeat(92)}`);
console.log(
  `ANTES: 32 ativos escolhidos à mão · 320 requisições\n` +
  `AGORA: ${st.ativosUnicos.toLocaleString('pt-BR')} ativos · ${st.exchangesAtivas} requisições · ${total}s\n\n` +
  `O universo deixou de ser uma amostra que eu escolhi.`,
);
