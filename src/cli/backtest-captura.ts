/**
 * BACKTEST DA CAPTURA DE LIQUIDAÇÃO contra as observações reais arquivadas.
 *
 * NENHUMA ORDEM É ENVIADA. É contagem sobre dado já coletado.
 *
 * Simula o que o motor teria feito, com as regras que ele usa hoje:
 * abre até JANELA min antes de uma liquidação se o pagamento cobrir o custo
 * com margem, recebe, e fecha. Respeita capital, teto de posições e o fato de
 * que só existe uma vaga por ativo.
 *
 * ── as três suposições, e para que lado cada uma erra ─────────────────────
 *
 * 1. ESCORREGAMENTO. O arquivo não guarda o livro de ordens da época, então
 *    não há como saber o escorregamento real de cada momento. Uso um valor
 *    fixo, e o relatório roda com três (otimista/medido/pessimista) para
 *    mostrar a sensibilidade. Isto é a maior fonte de erro: SKR, medido ao
 *    vivo, custou US$ 14,73 num par que "pagava" US$ 0,89.
 *
 * 2. INTERVALO. O arquivo não guarda o intervalo de liquidação. Leio o real
 *    de cada par do universo AO VIVO e aplico retroativamente. Um par que
 *    mudou de intervalo no meio da janela fica errado — raro, mas possível.
 *
 * 3. A TAXA NO MOMENTO DA LIQUIDAÇÃO. O motor recebe o que a liquidação pagar,
 *    não o que a última leitura mostrou. Uso a observação mais próxima DEPOIS
 *    da liquidação quando existe; se o par sumiu, conto zero recebido e o
 *    custo inteiro — que é o que o motor faz.
 *
 * O resultado NÃO é lucro que existiu. É o que a regra teria decidido sobre um
 * mercado que já passou, com as lacunas acima. Serve para dimensionar ordem de
 * grandeza e frequência, não para prometer retorno.
 */
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from '../data/store.ts';
import { lerUniverso } from '../funding/universo.ts';
import { taxaDaOperacao } from '../funding/custos-reais.ts';
import { avaliarCaptura, msAteProximaLiquidacao, fundingPorLiquidacao } from '../funding/liquidacao.ts';
import { dimensionar } from '../funding/tesouraria.ts';
import { parseArgs, num } from './args.ts';

const a = parseArgs();
const POR_EXCHANGE = num(a.porExchange, 100);
const ALAVANCAGEM = num(a.alavancagem, 5);
const MARGEM = num(a.margem, 1.5);
const RESERVA = num(a.reserva, 0.30);
const MAX_POSICOES = num(a.maxPosicoes, 3);
const JANELA_MIN = num(a.janela, 12);
const ANTECEDENCIA_MIN = num(a.antecedencia, 2);

interface Obs { ts: number; k: string; spread: number; vol: number }

const ARQ = path.join(ROOT, 'vigilancia', 'arquivo-observacoes.jsonl');
if (!fs.existsSync(ARQ)) { console.log('\nsem observações arquivadas.\n'); process.exit(0); }

const obs: Obs[] = fs.readFileSync(ARQ, 'utf8').trim().split('\n').filter(Boolean)
  .map((l) => { try { return JSON.parse(l); } catch { return null; } })
  .filter((o): o is Obs => !!o && o.spread > 0)
  .sort((x, y) => x.ts - y.ts);

if (!obs.length) { console.log('\nnenhuma observação utilizável.\n'); process.exit(0); }

console.log(`\n${'='.repeat(100)}`);
console.log('BACKTEST DA CAPTURA DE LIQUIDAÇÃO — contra observações reais arquivadas');
console.log(`${'='.repeat(100)}\n`);
console.log('NENHUMA ORDEM FOI ENVIADA. Simulação sobre dado já coletado.\n');

// ── intervalos reais, lidos ao vivo e aplicados retroativamente ────────────
console.log('lendo intervalos reais de liquidação do universo ao vivo…');
const universo = await lerUniverso({});
const intervaloDe = new Map<string, number>();
for (const p of universo) intervaloDe.set(`${p.symbol}|${p.exchange}`, p.intervaloHoras || 8);

const inicio = obs[0].ts, fim = obs[obs.length - 1].ts;
const dias = (fim - inicio) / 86_400_000;
console.log(
  `${obs.length} observações · ${new Date(inicio).toLocaleString('pt-BR')} → ` +
  `${new Date(fim).toLocaleString('pt-BR')} · ${dias.toFixed(2)} dias\n`,
);

/** Agrupa observações por par, para achar o que estava vivo em cada instante. */
const porPar = new Map<string, Obs[]>();
for (const o of obs) {
  if (!porPar.has(o.k)) porPar.set(o.k, []);
  porPar.get(o.k)!.push(o);
}

interface Operacao {
  ts: number; symbol: string; short: string; long: string;
  intervalo: number; notional: number;
  recebido: number; custo: number; liquido: number; cobertura: number;
}

function simular(slip: number): { ops: Operacao[]; capitalFinal: number } {
  // capital por exchange, como ele existe de verdade — não um número só
  const saldos: Record<string, number> = {};
  for (const p of universo) if (!(p.exchange in saldos)) saldos[p.exchange] = POR_EXCHANGE;
  const ops: Operacao[] = [];

  // Todos os instantes de liquidação possíveis na janela do dado, para cada
  // intervalo que aparece. Um par de 4h tem o dobro de chances de um de 8h.
  const instantes = new Set<number>();
  for (const intervalo of [1, 2, 4, 8]) {
    const ms = intervalo * 3_600_000;
    let t = Math.ceil(inicio / ms) * ms;
    for (; t <= fim; t += ms) instantes.add(t);
  }
  const ordenados = [...instantes].sort((x, y) => x - y);

  for (const liq of ordenados) {
    const abertasAgora: string[] = [];
    // candidatos vistos na janela de abertura desta liquidação
    const janelaIni = liq - JANELA_MIN * 60_000;
    const janelaFim = liq - ANTECEDENCIA_MIN * 60_000;

    const candidatos: { k: string; spread: number; intervalo: number }[] = [];
    for (const [k, lista] of porPar) {
      const [symbol, short, long] = k.split('|');
      const intervalo = intervaloDe.get(`${symbol}|${short}`) ?? 8;
      // esta liquidação pertence a este par? (o instante tem que ser múltiplo
      // do intervalo DELE, não de qualquer intervalo)
      if (liq % (intervalo * 3_600_000) !== 0) continue;
      const naJanela = lista.filter((o) => o.ts >= janelaIni && o.ts <= janelaFim);
      if (!naJanela.length) continue;
      // a leitura mais recente dentro da janela é a que o motor teria visto
      const ultima = naJanela[naJanela.length - 1];
      candidatos.push({ k, spread: ultima.spread, intervalo });
    }

    // ordena por pagamento, como o motor faz
    candidatos.sort((x, y) =>
      fundingPorLiquidacao(y.spread, y.intervalo) - fundingPorLiquidacao(x.spread, x.intervalo));

    for (const c of candidatos) {
      if (abertasAgora.length >= MAX_POSICOES) break;
      const [symbol, short, long] = c.k.split('|');
      if (abertasAgora.includes(symbol)) continue;

      const d = dimensionar(saldos, {}, short, long, ALAVANCAGEM, RESERVA);
      if (!d.possivel) continue;

      const taxaEfetivaAqui = taxaDaOperacao(short, long) + slip;
      const v = avaliarCaptura({
        spread8h: c.spread, intervaloHoras: c.intervalo,
        taxaEfetiva: taxaEfetivaAqui, margem: MARGEM,
      });
      if (!v.vale) continue;

      // ── o que a liquidação REALMENTE pagou ───────────────────────────────
      // a observação mais próxima depois do instante; se o par sumiu, zero
      const lista = porPar.get(c.k)!;
      const depois = lista.find((o) => o.ts >= liq && o.ts <= liq + 20 * 60_000);
      const fracaoRecebida = depois ? fundingPorLiquidacao(depois.spread, c.intervalo) : 0;

      const recebido = d.notionalPorPerna * fracaoRecebida;
      const custo = d.notionalPorPerna * taxaEfetivaAqui * 4;
      const liquido = recebido - custo;

      saldos[short] += liquido / 2;
      saldos[long] += liquido / 2;
      abertasAgora.push(symbol);
      ops.push({
        ts: liq, symbol: symbol.replace('/USDT:USDT', ''), short, long,
        intervalo: c.intervalo, notional: d.notionalPorPerna,
        recebido, custo, liquido, cobertura: v.cobertura,
      });
    }
  }

  const capitalFinal = Object.values(saldos).reduce((x, y) => x + y, 0);
  return { ops, capitalFinal };
}

const CENARIOS: [string, number][] = [
  ['otimista  (slip 0,010%)', 0.0001],
  ['medido    (slip 0,030%)', 0.0003],
  ['pessimista(slip 0,070%)', 0.0007],
];

const capitalInicial = new Set(universo.map((p) => p.exchange)).size * POR_EXCHANGE;
console.log(`capital inicial: US$ ${POR_EXCHANGE} em cada uma de ${new Set(universo.map((p) => p.exchange)).size} exchanges = US$ ${capitalInicial}\n`);

let detalhado: Operacao[] = [];
console.log('cenário'.padEnd(26) + 'operações'.padEnd(12) + 'ganhas'.padEnd(9) + 'recebido'.padEnd(12) + 'custo'.padEnd(12) + 'LÍQUIDO'.padEnd(13) + 'por dia');
console.log('-'.repeat(100));
for (const [nome, slip] of CENARIOS) {
  const { ops } = simular(slip);
  const rec = ops.reduce((s, o) => s + o.recebido, 0);
  const cus = ops.reduce((s, o) => s + o.custo, 0);
  const liq = rec - cus;
  const ganhas = ops.filter((o) => o.liquido > 0).length;
  console.log(
    nome.padEnd(26) + String(ops.length).padEnd(12) +
    `${ganhas}`.padEnd(9) +
    ('US$ ' + rec.toFixed(2)).padEnd(12) +
    ('US$ ' + cus.toFixed(2)).padEnd(12) +
    ((liq >= 0 ? '+' : '') + 'US$ ' + liq.toFixed(2)).padEnd(13) +
    (liq >= 0 ? '+' : '') + 'US$ ' + (liq / dias).toFixed(2),
  );
  if (slip === 0.0003) detalhado = ops;
}

// ── todas as operações do cenário medido ──────────────────────────────────
console.log(`\n${'-'.repeat(100)}`);
console.log('TODAS AS OPERAÇÕES · cenário medido (slip 0,030%)');
console.log(`${'-'.repeat(100)}`);
if (!detalhado.length) {
  console.log('\nNENHUMA operação teria sido aberta neste período.');
  console.log('Nenhum par pagou, numa única liquidação, o custo de entrar e sair com a margem exigida.\n');
} else {
  console.log(
    'quando'.padEnd(20) + 'ativo'.padEnd(10) + 'pernas'.padEnd(24) +
    'int'.padEnd(5) + 'recebeu'.padEnd(11) + 'custou'.padEnd(11) + 'líquido',
  );
  for (const o of detalhado) {
    console.log(
      new Date(o.ts).toLocaleString('pt-BR').padEnd(20) +
      o.symbol.slice(0, 8).padEnd(10) +
      `${o.short}→${o.long}`.slice(0, 22).padEnd(24) +
      (o.intervalo + 'h').padEnd(5) +
      ('US$ ' + o.recebido.toFixed(2)).padEnd(11) +
      ('US$ ' + o.custo.toFixed(2)).padEnd(11) +
      (o.liquido >= 0 ? '+' : '') + 'US$ ' + o.liquido.toFixed(2),
    );
  }
  const liq = detalhado.reduce((s, o) => s + o.liquido, 0);
  console.log(`\n  ${detalhado.length} operações · líquido US$ ${liq.toFixed(2)} em ${dias.toFixed(2)} dias`);
  console.log(`  capital: US$ ${capitalInicial} → US$ ${(capitalInicial + liq).toFixed(2)} (${(liq / capitalInicial * 100).toFixed(2)}%)`);
}

console.log(`\n${'='.repeat(100)}`);
console.log('O período tem só ' + dias.toFixed(1) + ' dias, e as quatro exchanges novas só entraram na última hora dele —');
console.log('antes disso o dado é de binance↔bybit apenas. A frequência aqui NÃO representa a de');
console.log('um universo de 6 exchanges. Ver o comentário no topo do arquivo para as suposições.');
console.log(`${'='.repeat(100)}\n`);
process.exit(0);
