/**
 * Quanto a constante única de escorregamento custa, medido contra o livro real.
 *
 * NENHUMA ORDEM É ENVIADA — só lê o livro de ordens.
 *
 * Responde a pergunta que decide se vale trocar a constante pela medição:
 * quantos candidatos MUDAM DE LADO no portão quando o custo passa a ser o
 * real em vez do pior caso? E — igualmente importante — quantos ficam mais
 * caros do que o motor assumia?
 */
import fs from 'node:fs';
import path from 'node:path';
import ccxt from 'ccxt';
import { ROOT } from '../data/store.ts';
import { ranking } from '../funding/vigilancia.ts';
import { taxaEfetiva, ESCORREGAMENTO_PERNA } from '../funding/custos-reais.ts';
import { escorregamentoDoPar, escorregamentoLimitado } from '../funding/livro.ts';
import { avaliarValor } from '../funding/valor.ts';
import { parseArgs, num } from './args.ts';

const a = parseArgs();
const NOTIONAL = num(a.notional, 250);
const MARGEM = num(a.margem, 1.5);
const MIN_OBS = num(a.minObservacoes, 3);

// Lê o estado da vigilância direto, sem passar pela ponte: a ponte recusa dado
// com mais de alguns minutos, e ela está CERTA em recusar — o motor não pode
// decidir com retrato velho. Esta ferramenta é de análise e roda com o sistema
// parado; o livro é lido ao vivo de qualquer forma, e spread/consistência/
// duração mudam devagar o bastante para a comparação continuar honesta.
const CICLOS = path.join(ROOT, 'vigilancia', 'ciclos.json');
if (!fs.existsSync(CICLOS)) {
  console.log('\nvigilância nunca rodou — rode `npm run vigilancia` por alguns ciclos primeiro.\n');
  process.exit(0);
}
const estado = JSON.parse(fs.readFileSync(CICLOS, 'utf8'));
const idadeMin = (Date.now() - (estado.ultimaVarredura || 0)) / 60_000;
const oportunidades = ranking(estado, MIN_OBS).map((r) => ({
  symbol: r.symbol, exchangeShort: r.exchangeShort, exchangeLong: r.exchangeLong,
  spread: r.spreadMedio, consistencia: r.consistenciaAjustada, duracaoHoras: r.duracaoHoras,
}));
if (!oportunidades.length) {
  console.log(`\nsem candidatos com ${MIN_OBS}+ observações no estado atual.\n`);
  process.exit(0);
}
const vig = { oportunidades, idadeMinutos: idadeMin };

console.log(`\n${'='.repeat(100)}`);
console.log(`ESCORREGAMENTO: CONSTANTE × LIVRO REAL · notional US$ ${NOTIONAL}/perna · portão ${MARGEM}x`);
console.log(`${'='.repeat(100)}\n`);
console.log(`constante em uso: ${(ESCORREGAMENTO_PERNA * 100).toFixed(4)}% por perna`);
console.log(
  `candidatos com ${MIN_OBS}+ observações: ${vig.oportunidades.length} · ` +
  `retrato da vigilância com ${vig.idadeMinutos.toFixed(0)} min` +
  (vig.idadeMinutos > 10 ? ' (sistema parado — livro ainda é lido ao vivo)' : ''),
);
console.log();

const pool: Record<string, any> = {};
async function ex(id: string) {
  if (!pool[id]) { pool[id] = new (ccxt as any)[id]({ enableRateLimit: true }); await pool[id].loadMarkets(); }
  return pool[id];
}

console.log(
  'ativo'.padEnd(12) + 'pernas'.padEnd(26) + 'slip real'.padEnd(12) +
  'payback const'.padEnd(15) + 'payback real'.padEnd(15) + 'efeito',
);
console.log('-'.repeat(100));

let maisBaratos = 0, maisCaros = 0, passamAgora = 0, deixamDePassar = 0, naoMedidos = 0;
const slips: number[] = [];

for (const o of vig.oportunidades.slice(0, 20)) {
  let slip: number | null = null;
  try {
    const [ca, cb] = await Promise.all([ex(o.exchangeShort), ex(o.exchangeLong)]);
    const [ls, ll] = await Promise.all([
      ca.fetchOrderBook(o.symbol, 50),
      cb.fetchOrderBook(o.symbol, 50),
    ]);
    slip = escorregamentoLimitado(escorregamentoDoPar(ls, ll, NOTIONAL));
  } catch { naoMedidos++; continue; }

  slips.push(slip);
  const base = {
    spread: o.spread, consistencia: o.consistencia,
    duracaoHoras: o.duracaoHoras ?? 0, notional: NOTIONAL,
  };
  const vConst = avaliarValor({ ...base, taxa: taxaEfetiva(o.exchangeShort, o.exchangeLong) });
  const vReal = avaliarValor({ ...base, taxa: taxaEfetiva(o.exchangeShort, o.exchangeLong, slip) });

  const passaConst = vConst.folga >= MARGEM;
  const passaReal = vReal.folga >= MARGEM;
  if (slip < ESCORREGAMENTO_PERNA) maisBaratos++; else maisCaros++;
  if (!passaConst && passaReal) passamAgora++;
  if (passaConst && !passaReal) deixamDePassar++;

  const efeito = !passaConst && passaReal ? '★ PASSA a valer'
    : passaConst && !passaReal ? '✖ deixa de valer'
    : slip < ESCORREGAMENTO_PERNA ? 'mais barato' : 'MAIS CARO';

  const fmtH = (h: number) => isFinite(h) && h < 1e4 ? h.toFixed(1) + 'h' : '—';
  console.log(
    o.symbol.replace('/USDT:USDT', '').slice(0, 10).padEnd(12) +
    `${o.exchangeShort}→${o.exchangeLong}`.padEnd(26) +
    ((slip * 100).toFixed(4) + '%').padEnd(12) +
    fmtH(vConst.paybackHoras * MARGEM).padEnd(15) +
    fmtH(vReal.paybackHoras * MARGEM).padEnd(15) +
    efeito,
  );
}

console.log('\n' + '-'.repeat(100));
if (slips.length) {
  const ord = [...slips].sort((x, y) => x - y);
  const q = (p: number) => ord[Math.min(ord.length - 1, Math.floor(p * ord.length))];
  console.log(
    `slip medido — mediana ${(q(0.5) * 100).toFixed(4)}% · p75 ${(q(0.75) * 100).toFixed(4)}% · ` +
    `p90 ${(q(0.9) * 100).toFixed(4)}% · máximo ${(ord[ord.length - 1] * 100).toFixed(4)}%`,
  );
  console.log(
    `${maisBaratos} pares mais baratos que a constante · ${maisCaros} MAIS CAROS` +
    (naoMedidos ? ` · ${naoMedidos} sem livro legível` : ''),
  );
  console.log(`\nefeito no portão: ${passamAgora} passam a valer · ${deixamDePassar} deixam de valer`);
  console.log(
    passamAgora || deixamDePassar
      ? '\nA medição muda decisões — não é cosmética.'
      : '\nNenhum candidato muda de lado AGORA. A medição continua valendo: ela corrige o\n' +
        'custo assumido nos dois sentidos, e o efeito aparece quando um candidato chegar\n' +
        'perto da barra — que é exatamente quando o erro custa dinheiro.',
  );
}
console.log(`\n${'='.repeat(100)}\n`);
process.exit(0);
