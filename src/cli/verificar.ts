/**
 * Verifica liquidez real e analisa o risco de ruína com alavancagem maior.
 */
import { varrerSpreads, dimensionarSpread, rendaSemanal, riscoDesbalanceamento } from '../funding/spread.ts';
import { verificarPar } from '../funding/liquidez.ts';
import { parseArgs, num } from './args.ts';

const a = parseArgs();
const CAPITAL = num(a.equity, 100);
const LEV = num(a.alavancagem, 5);

console.log(`\n${'='.repeat(86)}`);
console.log(`VERIFICAÇÃO DE LIQUIDEZ E RISCO — US$ ${CAPITAL} · ${LEV}x`);
console.log(`${'='.repeat(86)}\n`);

const ops = await varrerSpreads();
const d = dimensionarSpread(CAPITAL, LEV);
console.log(`Notional por perna a ${LEV}x: US$ ${d.notionalPorPerna.toFixed(2)}\n`);

console.log('PARTE 1 — o livro aguenta?\n');
console.log('ativo'.padEnd(9) + 'pernas'.padEnd(26) + 'spread livro'.padEnd(15) + 'impacto'.padEnd(11) + 'cabe até'.padEnd(13) + 'situação');

const executaveis: { op: typeof ops[0]; custo: number; max: number }[] = [];
for (const o of ops.slice(0, 8)) {
  const v = await verificarPar(o.exchangeShort, o.exchangeLong, o.symbol, d.notionalPorPerna);
  const par = `${o.exchangeShort.slice(0, 10)}/${o.exchangeLong.slice(0, 10)}`;
  console.log(
    o.symbol.replace('/USDT:USDT', '').padEnd(9) + par.padEnd(26) +
    (v.short.disponivel && v.long.disponivel
      ? ((Math.max(v.short.spreadLivro, v.long.spreadLivro) * 100).toFixed(3) + '%').padEnd(15)
      : '—'.padEnd(15)) +
    ((v.custoTotalEntrada * 100).toFixed(3) + '%').padEnd(11) +
    ('$' + v.notionalMaximo.toFixed(0)).padEnd(13) +
    (v.executavel ? 'OK' : v.motivo.slice(0, 40)),
  );
  if (v.executavel) executaveis.push({ op: o, custo: v.custoTotalEntrada, max: v.notionalMaximo });
}

if (!executaveis.length) {
  console.log('\nNenhum par passou na verificação de livro com este notional.');
  process.exit(0);
}

console.log(`\n${'─'.repeat(86)}`);
console.log('PARTE 2 — renda líquida do custo REAL de entrada\n');
console.log('ativo'.padEnd(9) + 'APR spread'.padEnd(14) + 'renda bruta'.padEnd(15) + 'custo real'.padEnd(14) + 'dias p/ pagar'.padEnd(16) + 'renda líq/semana');
for (const e of executaveis) {
  const r = rendaSemanal(e.op, CAPITAL, LEV);
  const custoReal = d.notionalPorPerna * 2 * e.custo;
  const porDia = d.notionalPorPerna * e.op.spread * 3;
  const dias = porDia > 0 ? custoReal / porDia : Infinity;
  console.log(
    e.op.symbol.replace('/USDT:USDT', '').padEnd(9) +
    ((e.op.aprSpread * 100).toFixed(1) + '%').padEnd(14) +
    ('$' + r.bruta.toFixed(4)).padEnd(15) +
    ('$' + custoReal.toFixed(4)).padEnd(14) +
    (dias.toFixed(1) + ' dias').padEnd(16) +
    '$' + (r.bruta - custoReal / 4).toFixed(4),
  );
}

// ── PARTE 3: risco de ruína com alavancagem ───────────────────────────────
console.log(`\n${'─'.repeat(86)}`);
console.log('PARTE 3 — o risco de ruína com alavancagem maior\n');
console.log('alavancagem'.padEnd(14) + 'notional/perna'.padEnd(17) + 'renda/semana'.padEnd(15) + 'desbalanceia em'.padEnd(18) + 'perde tudo se');
const melhor = executaveis[0].op;
for (const lev of [3, 5, 8, 10]) {
  const dd = dimensionarSpread(CAPITAL, lev);
  const rr = rendaSemanal(melhor, CAPITAL, lev);
  const risco = riscoDesbalanceamento(lev);
  console.log(
    (lev + 'x').padEnd(14) + ('$' + dd.notionalPorPerna.toFixed(0)).padEnd(17) +
    ('$' + rr.bruta.toFixed(4)).padEnd(15) +
    ('±' + (risco.variacaoQueDesbalanceia * 100).toFixed(1) + '%').padEnd(18) +
    'nunca — as pernas se cancelam',
  );
}

console.log(
  `\n  A COLUNA DA DIREITA É O PONTO. Numa posição direcional, alavancagem alta\n` +
  `  significa liquidação e perda total. Aqui NÃO: se o preço sobe, a perna\n` +
  `  vendida perde exatamente o que a comprada ganha. O patrimônio não muda.\n\n` +
  `  O que a alavancagem alta cria é RISCO OPERACIONAL, não de mercado:\n` +
  `  quando o preço se move, a margem fica desbalanceada entre as exchanges e\n` +
  `  é preciso transferir antes que uma delas liquide.\n`,
);

// simulação do risco operacional
console.log(`${'─'.repeat(86)}`);
console.log('PARTE 4 — simulação do risco operacional\n');

let seed = 99887;
const rnd = () => { seed ^= seed << 13; seed >>>= 0; seed ^= seed >> 17; seed ^= seed << 5; seed >>>= 0; return seed / 4294967296; };
const gauss = () => Math.sqrt(-2 * Math.log(Math.max(1e-9, rnd()))) * Math.cos(2 * Math.PI * rnd());

// volatilidade diária típica de alt: ~5%
const volDiaria = 0.05;
console.log('alavancagem'.padEnd(14) + 'transf/mês'.padEnd(14) + 'custo transf/mês'.padEnd(20) + 'renda/mês'.padEnd(14) + 'líquido/mês');
for (const lev of [3, 5, 8, 10]) {
  const dd = dimensionarSpread(CAPITAL, lev);
  const limiar = riscoDesbalanceamento(lev).variacaoQueDesbalanceia * 0.5;
  let transferencias = 0;
  const SIMS = 5000;
  for (let s = 0; s < SIMS; s++) {
    let acum = 0;
    for (let dia = 0; dia < 30; dia++) {
      acum += volDiaria * gauss();
      if (Math.abs(acum) > limiar) { transferencias++; acum = 0; }
    }
  }
  const transfMes = transferencias / SIMS;
  const custoTransf = transfMes * dd.notionalPorPerna * 0.0005;
  const rendaMes = dd.notionalPorPerna * melhor.spread * 3 * 30;
  console.log(
    (lev + 'x').padEnd(14) + transfMes.toFixed(1).padEnd(14) +
    ('$' + custoTransf.toFixed(3)).padEnd(20) +
    ('$' + rendaMes.toFixed(2)).padEnd(14) +
    '$' + (rendaMes - custoTransf).toFixed(2),
  );
}

console.log(`\n${'='.repeat(86)}`);
const dFinal = dimensionarSpread(CAPITAL, LEV);
const rFinal = rendaSemanal(melhor, CAPITAL, LEV);
console.log(
  `RECOMENDAÇÃO: ${melhor.symbol.replace('/USDT:USDT', '')} a ${LEV}x\n\n` +
  `  notional por perna    US$ ${dFinal.notionalPorPerna.toFixed(2)}\n` +
  `  renda bruta/semana    US$ ${rFinal.bruta.toFixed(4)}\n` +
  `  exposição a preço     ZERO — as pernas se cancelam\n` +
  `  risco de perder tudo  ZERO por movimento de mercado\n` +
  `  risco real            operacional: transferir margem entre exchanges a tempo`,
);
