/**
 * Varredura de CAPTURA DE LIQUIDAÇÃO — a pergunta que o motor não fazia.
 *
 * NENHUMA ORDEM É ENVIADA.
 *
 * Em vez de "esse spread sobrevive horas o bastante para o payback fechar?",
 * pergunta "o que a PRÓXIMA liquidação paga cobre o custo de entrar e sair?".
 * Ver liquidacao.ts para por que a primeira pergunta mantinha tudo parado.
 *
 * Mede o escorregamento no livro real de cada finalista (livro.ts) antes de
 * aprovar — os pares de funding extremo são finos, e o custo entra 4 vezes.
 */
import ccxt from 'ccxt';
import { lerUniverso, type ParUniverso } from '../funding/universo.ts';
import { taxaDaOperacao, ESCORREGAMENTO_PERNA } from '../funding/custos-reais.ts';
import { escorregamentoDoPar, escorregamentoLimitado } from '../funding/livro.ts';
import { avaliarCaptura, alinhamento, msAteProximaLiquidacao, fundingPorLiquidacao } from '../funding/liquidacao.ts';
import { parseArgs, num } from './args.ts';

const a = parseArgs();
const NOTIONAL = num(a.notional, 250);
const MARGEM = num(a.margem, 1.5);
const VOL_MIN = num(a.volumeMinimo, 1e6);
/** quantos finalistas medir no livro — cada um custa 2 chamadas de order book */
const MEDIR_TOP = num(a.medir, 12);

console.log(`\n${'='.repeat(104)}`);
console.log(`CAPTURA DE LIQUIDAÇÃO · notional US$ ${NOTIONAL}/perna · margem ${MARGEM}x · volume mínimo US$ ${(VOL_MIN / 1e6).toFixed(1)}M`);
console.log(`${'='.repeat(104)}\n`);
console.log('NENHUMA ORDEM É ENVIADA — só leitura de mercado.\n');

const pares = await lerUniverso({ onProgresso: (ex, n, ms) => console.log(`  ${ex}: ${n} pares em ${ms}ms`) });
console.log();

// ── cruza preservando o intervalo de cada perna ───────────────────────────
//
// `cruzarUniverso` normaliza para 8h e descarta o intervalo. Aqui o intervalo
// é a informação central: ele decide quanto UMA liquidação paga e se as duas
// pernas liquidam juntas.
const porAtivo = new Map<string, ParUniverso[]>();
for (const p of pares) {
  if (!porAtivo.has(p.symbol)) porAtivo.set(p.symbol, []);
  porAtivo.get(p.symbol)!.push(p);
}

interface Candidato {
  symbol: string; exchangeShort: string; exchangeLong: string;
  spread8h: number; intervaloShort: number; intervaloLong: number;
  volumeMinimo: number;
}

const candidatos: Candidato[] = [];
for (const [symbol, lista] of porAtivo) {
  if (lista.length < 2) continue;
  const norm = lista.map((p) => ({ ...p, f8h: p.funding * (8 / (p.intervaloHoras || 8)) }));
  norm.sort((x, y) => y.f8h - x.f8h);
  const alto = norm[0], baixo = norm[norm.length - 1];
  const spread8h = alto.f8h - baixo.f8h;
  if (spread8h <= 0) continue;
  const volumeMinimo = Math.min(alto.volume24h, baixo.volume24h);
  if (volumeMinimo < VOL_MIN) continue;
  candidatos.push({
    symbol, exchangeShort: alto.exchange, exchangeLong: baixo.exchange,
    spread8h, intervaloShort: alto.intervaloHoras || 8, intervaloLong: baixo.intervaloHoras || 8,
    volumeMinimo,
  });
}

// Pré-filtro com a constante de escorregamento: quem nem com o custo otimista
// cobre o pagamento não merece duas chamadas de order book.
const custoOtimista = (c: Candidato) => (taxaDaOperacao(c.exchangeShort, c.exchangeLong) + ESCORREGAMENTO_PERNA) * 4;
// Ordena por COBERTURA com o custo otimista — o quanto o pagamento de uma
// liquidação cobre o custo. Mostra o topo sempre, mesmo quando ninguém passa:
// "nada agora" e "o melhor cobre 4% do custo" são situações muito diferentes,
// e só a segunda diz se vale continuar monitorando.
const alinhados = candidatos.filter((c) => alinhamento(c.intervaloShort, c.intervaloLong).alinhado);
const coberturaOtimista = (c: Candidato) =>
  fundingPorLiquidacao(c.spread8h, c.intervaloShort) / custoOtimista(c);

const promissores = [...alinhados]
  .sort((x, y) => coberturaOtimista(y) - coberturaOtimista(x))
  .slice(0, MEDIR_TOP);

const desalinhados = candidatos.length - alinhados.length;
const acimaDoCusto = alinhados.filter((c) => coberturaOtimista(c) >= 1).length;

console.log(`${candidatos.length} pares cruzados com liquidez · ${desalinhados} descartados por intervalos diferentes`);
console.log(
  `${acimaDoCusto} pagam mais que o custo numa liquidação · ` +
  `medindo o livro real dos ${promissores.length} melhores\n`,
);

if (!promissores.length) {
  console.log('─'.repeat(104));
  console.log('Nenhum par alinhado com liquidez. Nada a medir.');
  console.log(`${'='.repeat(104)}\n`);
  process.exit(0);
}

const pool: Record<string, any> = {};
async function ex(id: string) {
  if (!pool[id]) { pool[id] = new (ccxt as any)[id]({ enableRateLimit: true }); await pool[id].loadMarkets(); }
  return pool[id];
}

const agora = Date.now();
console.log(
  'ativo'.padEnd(12) + 'pernas'.padEnd(26) + 'paga/liq'.padEnd(11) +
  'slip real'.padEnd(11) + 'custo'.padEnd(10) + 'cobre'.padEnd(9) +
  'próx. liq.'.padEnd(12) + 'líquido',
);
console.log('-'.repeat(104));

const aprovados: { c: Candidato; liquidoUSD: number; emMin: number }[] = [];
for (const c of promissores) {
  let slip: number;
  try {
    const [ca, cb] = await Promise.all([ex(c.exchangeShort), ex(c.exchangeLong)]);
    const [ls, ll] = await Promise.all([
      ca.fetchOrderBook(c.symbol, 50), cb.fetchOrderBook(c.symbol, 50),
    ]);
    slip = escorregamentoLimitado(escorregamentoDoPar(ls, ll, NOTIONAL));
  } catch { continue; }

  const v = avaliarCaptura({
    spread8h: c.spread8h, intervaloHoras: c.intervaloShort,
    taxaEfetiva: taxaDaOperacao(c.exchangeShort, c.exchangeLong) + slip,
    margem: MARGEM,
  });
  const emMin = msAteProximaLiquidacao(agora, c.intervaloShort) / 60_000;
  const liquidoUSD = v.liquidoPorLiquidacao * NOTIONAL;

  console.log(
    c.symbol.replace('/USDT:USDT', '').slice(0, 10).padEnd(12) +
    `${c.exchangeShort}→${c.exchangeLong}`.padEnd(26) +
    ((v.pagamentoPorLiquidacao * 100).toFixed(3) + '%').padEnd(11) +
    ((slip * 100).toFixed(4) + '%').padEnd(11) +
    ((v.custoIdaEVolta * 100).toFixed(3) + '%').padEnd(10) +
    (v.cobertura.toFixed(2) + 'x').padEnd(9) +
    (emMin < 60 ? emMin.toFixed(0) + 'min' : (emMin / 60).toFixed(1) + 'h').padEnd(12) +
    (v.vale ? `★ US$ ${liquidoUSD.toFixed(2)}` : `— US$ ${liquidoUSD.toFixed(2)}`),
  );
  if (v.vale) aprovados.push({ c, liquidoUSD, emMin });
}

console.log('\n' + '-'.repeat(104));
if (aprovados.length) {
  const total = aprovados.reduce((s, x) => s + x.liquidoUSD, 0);
  console.log(`${aprovados.length} oportunidade(s) de captura AGORA · líquido somado US$ ${total.toFixed(2)} por US$ ${NOTIONAL}/perna`);
  console.log('\n⚠ Isto é um retrato do agora. O funding da liquidação pode mudar até ela acontecer,');
  console.log('  e o escorregamento medido vale para o livro deste instante, não para o da execução.');
} else {
  console.log('Nenhuma passa na margem depois de medir o livro real.');
  console.log('O escorregamento dos pares de funding extremo é onde a conta costuma morrer.');
}
console.log(`${'='.repeat(104)}\n`);
process.exit(0);
