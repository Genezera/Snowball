/**
 * O DESAFIO: US$ 200 → a viagem, sem aporte nenhum, só com lucro.
 *
 * Responde a pergunta que importa quando não há aporte para diluir o risco:
 * **com que agressividade é preciso operar, e qual a chance de quebrar antes
 * de chegar?**
 *
 * ── dois métodos, porque um modelo errado engana mais que nenhum modelo ────
 *
 * A primeira versão deste arquivo usava aposta BINÁRIA (ganha W×r com
 * probabilidade p, perde r com probabilidade 1−p) para todo cenário. Isso é
 * razoável para estratégia de stop/alvo fixo, mas MENTE para `ts-momentum`:
 * a saída dela é por TEMPO, o retorno é contínuo, e a distribuição real tem
 * cauda direita gorda — poucos trades grandes carregam o resultado, não uma
 * moeda com dois desfechos.
 *
 * Por isso o cenário de ações usa o modelo binário (é a aproximação certa lá:
 * saída por stop/alvo), e o de `ts-momentum` usa BOOTSTRAP dos trades reais
 * que ele produziu no universo validado (38 de 57 positivos, 67%, p=0,008 —
 * `npm run momentum`) — reamostra a distribuição que de fato aconteceu, sem
 * impor forma nenhuma. Ver `src/backtest/bootstrap.ts`.
 *
 * ── o piso de ruína, e por que não é zero ─────────────────────────────────
 *
 * Aposta fracionária nunca zera matematicamente. Mas existe um piso PRÁTICO:
 * abaixo de um certo capital, o tamanho mínimo de posição da exchange e o
 * custo fixo por operação tornam impossível continuar. Modelo isso como
 * ruína em US$ 40 — 20% do inicial.
 */
import { loadSeries } from '../data/store.ts';
import { buildStrategy } from '../strategies/index.ts';
import { runBacktest } from '../backtest/engine.ts';
import { makeConfig } from '../config.ts';
import { paraRMultiplos, simularBootstrap } from '../backtest/bootstrap.ts';
import { resolverPoliticaOtima, simularComPolitica, riscoNaPolitica } from '../backtest/dp-risco.ts';
import { paraRMultiplosComTempo, construirBlocos, simularPortfolioConcorrente } from '../backtest/bootstrap-concorrente.ts';
import { UNIVERSO_MOMENTUM, PARAMS_VALIDADOS, MAX_BARS_VALIDADO } from '../data/momentum-universe.ts';
import { poolComExcursoes } from '../pairs/validado.ts';
import { distanciaLiquidacaoPorPerna } from '../pairs/liquidacao.ts';
import { parseArgs, num } from './args.ts';

const a = parseArgs();

const CAPITAL = num(a.capital, 200);
const ALVO = num(a.alvo, 2234);          // viagem econômica, ver `npm run meta`
const PISO_RUINA = num(a.piso, 40);
const CAMINHOS = num(a.caminhos, 20_000);
const HORIZONTE_MESES = num(a.horizonte, 60);
const RISCOS = [0.01, 0.02, 0.03, 0.05, 0.08, 0.10, 0.15, 0.20, 0.30];

console.log(`\n${'='.repeat(100)}`);
console.log(`DESAFIO · US$ ${CAPITAL} → US$ ${ALVO} sem aporte, só com lucro · ${(ALVO / CAPITAL).toFixed(1)}x`);
console.log(`${'='.repeat(100)}\n`);
console.log(`horizonte ${HORIZONTE_MESES} meses · ruína abaixo de US$ ${PISO_RUINA} · ${CAMINHOS.toLocaleString('pt-BR')} caminhos\n`);

function fmtTempo(m: number): string {
  return !isFinite(m) ? '—' : m < 24 ? `${m.toFixed(0)} meses` : `${(m / 12).toFixed(1)} anos`;
}

function imprimirTabela(rows: { risco: number; s: ReturnType<typeof simularBootstrap> }[]) {
  console.log(
    'risco/op'.padEnd(11) + 'chega na meta'.padEnd(16) + 'QUEBRA'.padEnd(11) +
    'ainda tentando'.padEnd(17) + 'tempo mediano'.padEnd(16) + 'capital mediano',
  );
  console.log('-'.repeat(100));
  for (const { risco, s } of rows) {
    console.log(
      ((risco * 100).toFixed(0) + '%').padEnd(11) +
      ((s.pSucesso * 100).toFixed(1) + '%').padEnd(16) +
      ((s.pRuina * 100).toFixed(1) + '%').padEnd(11) +
      ((s.pArrastando * 100).toFixed(1) + '%').padEnd(17) +
      fmtTempo(s.mesesMediano).padEnd(16) +
      'US$ ' + s.capitalMediano.toFixed(0),
    );
  }
  let melhor = rows[0];
  for (const row of rows) if (row.s.pSucesso > melhor.s.pSucesso) melhor = row;
  console.log(`\n  melhor chance de sucesso: risco ${(melhor.risco * 100).toFixed(0)}% por operação → ${(melhor.s.pSucesso * 100).toFixed(1)}%\n`);
}

// ── cenário 1: ts-momentum, BOOTSTRAP dos trades reais ────────────────────
console.log('─'.repeat(100));
console.log('CENÁRIO: ts-momentum (bootstrap de trades reais)\n');
console.log('carregando os 57 ativos do universo validado e rodando o backtest...');

const RISCO_BACKTEST = 0.005;
const cfg = makeConfig({ initialEquity: 10_000, costPreset: 'binance-futures-maker', riskProfile: 'seed', maxBarsInTrade: MAX_BARS_VALIDADO });
const rMultiplos: number[] = [];
for (const sym of UNIVERSO_MOMENTUM) {
  let series;
  try { series = loadSeries('binanceusdm', sym, '1d'); } catch { continue; }
  const res = runBacktest(series, buildStrategy('ts-momentum', PARAMS_VALIDADOS), cfg);
  rMultiplos.push(...paraRMultiplos(res.trades, RISCO_BACKTEST));
}
const OPS_POR_MES = num(a.opsPorMes, 20); // ~8 ativos em paralelo, ~30 trades/ano cada
const expectancy = rMultiplos.reduce((s, r) => s + r, 0) / rMultiplos.length;
console.log(`${rMultiplos.length} trades reais pooled · expectancy ${expectancy.toFixed(3)}R · ${OPS_POR_MES} op/mês assumidas\n`);

const linhasMomentum = RISCOS.map((risco) => ({
  risco,
  s: simularBootstrap({
    rMultiplos, capitalInicial: CAPITAL, alvo: ALVO, pisoRuina: PISO_RUINA,
    opsPorMes: OPS_POR_MES, horizonteMeses: HORIZONTE_MESES, riscoFracao: risco, caminhos: CAMINHOS,
  }),
}));
imprimirTabela(linhasMomentum);

// ── risco ADAPTATIVO (função de capital e tempo restante, não fixo) ───────
//
// A tabela acima usa fração de risco CONSTANTE em toda a trajetória. Isso
// não é ótimo: quem tem 1200 operações pela frente e capital baixo não está
// na mesma situação que quem tem poucas operações restantes e ainda não
// chegou perto da meta. `resolverPoliticaOtima` acha, por programação
// dinâmica sobre um histograma quantílico dos R-múltiplos reais, a fração
// de risco que maximiza a chance de sucesso em CADA combinação de capital
// e tempo restante. Validado com holdout (política resolvida só com a
// DESCOBERTA, avaliada só com o HOLDOUT): bate a melhor fração fixa nos dois
// eixos ao mesmo tempo — mais sucesso E menos ruína — não é reamostragem
// favorável, ver docs/RESULTADOS.md item 11.
console.log('─'.repeat(100));
console.log('RISCO ADAPTATIVO (ts-momentum, política resolvida por DP em vez de fração fixa)\n');
console.log('resolvendo a política ótima (poucos segundos)...');
const TOTAL_OPS = Math.round(OPS_POR_MES * HORIZONTE_MESES);
const politicaOtima = resolverPoliticaOtima({
  rMultiplos, capitalInicial: CAPITAL, alvo: ALVO, pisoRuina: PISO_RUINA, totalOps: TOTAL_OPS,
});
const resultadoAdaptativo = simularComPolitica({
  politica: politicaOtima, rMultiplos, capitalInicial: CAPITAL, alvo: ALVO, pisoRuina: PISO_RUINA,
  opsPorMes: OPS_POR_MES, horizonteMeses: HORIZONTE_MESES, caminhos: CAMINHOS,
});
const melhorFixo = linhasMomentum.reduce((m, l) => (l.s.pSucesso > m.s.pSucesso ? l : m));
console.log(
  'política'.padEnd(11) + 'chega na meta'.padEnd(16) + 'QUEBRA'.padEnd(11) +
  'ainda tentando'.padEnd(17) + 'tempo mediano'.padEnd(16) + 'capital mediano',
);
console.log('-'.repeat(100));
console.log(
  `fixa ${(melhorFixo.risco * 100).toFixed(0)}%`.padEnd(11) +
  ((melhorFixo.s.pSucesso * 100).toFixed(1) + '%').padEnd(16) +
  ((melhorFixo.s.pRuina * 100).toFixed(1) + '%').padEnd(11) +
  ((melhorFixo.s.pArrastando * 100).toFixed(1) + '%').padEnd(17) +
  fmtTempo(melhorFixo.s.mesesMediano).padEnd(16) + 'US$ ' + melhorFixo.s.capitalMediano.toFixed(0),
);
console.log(
  'adaptativa'.padEnd(11) +
  ((resultadoAdaptativo.pSucesso * 100).toFixed(1) + '%').padEnd(16) +
  ((resultadoAdaptativo.pRuina * 100).toFixed(1) + '%').padEnd(11) +
  ((resultadoAdaptativo.pArrastando * 100).toFixed(1) + '%').padEnd(17) +
  fmtTempo(resultadoAdaptativo.mesesMediano).padEnd(16) + 'US$ ' + resultadoAdaptativo.capitalMediano.toFixed(0),
);
console.log(`\n  no início (US$ ${CAPITAL}, horizonte cheio): risco recomendado ${(riscoNaPolitica(politicaOtima, CAPITAL, 0) * 100).toFixed(0)}% por operação\n`);

// ── AVISO sobre as duas tabelas acima ──────────────────────────────────────
//
// As duas tabelas de ts-momentum acima (fração fixa e risco adaptativo)
// reamostram os 6821 trades como se fossem sorteios INDEPENDENTES, um de
// cada vez. Isso não é como a estratégia realmente roda: em média 54,5 das
// 57 posições do universo ficam abertas AO MESMO TEMPO, e trades cujas
// janelas se sobrepõem têm correlação real medida de +0,13 (crash de
// mercado atinge várias posições juntas, não uma por vez). Ignorar isso
// SUBESTIMA risco de ruína e SUPERESTIMA a chance de sucesso — as tabelas
// acima são otimistas demais pra guiar uma decisão real.
//
// A tabela abaixo (`simularPortfolioConcorrente`) corrige isso: reamostra
// BLOCOS de calendário real (não trades individuais), preservando a
// simultaneidade e a correlação de fato observadas. Ver docs/RESULTADOS.md
// item 12 — é uma CORREÇÃO do item 11, não uma alternativa a ele.
console.log('─'.repeat(100));
console.log('CENÁRIO CORRIGIDO: ts-momentum com CONCORRÊNCIA REAL (block bootstrap no calendário)\n');
console.log('reconstruindo trades com timestamps e agrupando em blocos de calendário...');
const rMultiplosComTempo = paraRMultiplosComTempoTodos();
function paraRMultiplosComTempoTodos() {
  const out: { entryTime: number; exitTime: number; r: number }[] = [];
  for (const sym of UNIVERSO_MOMENTUM) {
    let series;
    try { series = loadSeries('binanceusdm', sym, '1d'); } catch { continue; }
    const res = runBacktest(series, buildStrategy('ts-momentum', PARAMS_VALIDADOS), cfg);
    out.push(...paraRMultiplosComTempo(res.trades, RISCO_BACKTEST));
  }
  return out;
}
const BLOCO_DIAS = num(a.blocoDias, 63);
const blocosCalendario = construirBlocos(rMultiplosComTempo, BLOCO_DIAS);
console.log(`${blocosCalendario.blocos.length} blocos de ${BLOCO_DIAS} dias\n`);

// caminhos menor que o resto do arquivo: cada caminho aqui gera ~29 blocos
// x ~240 trades = milhares de eventos (vs. um sorteio simples por operação
// no bootstrap i.i.d.), o custo por caminho e bem maior.
const CAMINHOS_CONCORRENTE = num(a.caminhosConcorrente, 3000);
const RISCOS_POSICAO = [0.001, 0.002, 0.003, 0.005, 0.008, 0.01, 0.015, 0.02, 0.03, 0.05];
console.log('risco/posição   chega na meta   QUEBRA     ainda tentando   tempo mediano');
console.log('-'.repeat(100));
const linhasConcorrente = RISCOS_POSICAO.map((risco) => ({
  risco,
  s: simularPortfolioConcorrente({
    blocosCalendario, capitalInicial: CAPITAL, alvo: ALVO, pisoRuina: PISO_RUINA,
    riscoPorPosicao: risco, horizonteMeses: HORIZONTE_MESES, caminhos: CAMINHOS_CONCORRENTE,
  }),
}));
for (const { risco, s } of linhasConcorrente) {
  console.log(
    `${(risco * 100).toFixed(1)}%`.padEnd(16) + `${(s.pSucesso * 100).toFixed(1)}%`.padEnd(16) +
    `${(s.pRuina * 100).toFixed(1)}%`.padEnd(11) + `${(s.pArrastando * 100).toFixed(1)}%`.padEnd(17) +
    fmtTempo(s.mesesMediano),
  );
}
const melhorConcorrente = linhasConcorrente.reduce((m, l) => (l.s.pSucesso > m.s.pSucesso ? l : m));
console.log(`\n  melhor chance de sucesso (com concorrência real): risco ${(melhorConcorrente.risco * 100).toFixed(1)}% por posição → ${(melhorConcorrente.s.pSucesso * 100).toFixed(1)}%`);
console.log(`  (${BLOCO_DIAS} dias/bloco — o resultado é sensível a essa escolha, ver docs/RESULTADOS.md item 12 pra faixa de sensibilidade)\n`);

// ── cenário 2: pares cointegrados, BOOTSTRAP + risco de liquidação por perna ──
//
// Uma versão anterior deste cenário ignorava um risco real: o `retorno` que
// `backtestPar` calcula assume que a posição sempre chega ao desfecho natural
// (reversão/timeout), sem checar se alguma perna se moveu contra a margem o
// bastante para ser LIQUIDADA no meio do caminho. Medido nos trades reais
// (descoberta+holdout): os piores movimentos adversos intra-trade vão de
// 100% a 252% do preço de entrada — pequenas altcoins com choques de
// liquidez/listagem que o z-score do SPREAD não vê, porque olha a diferença
// entre as pernas, não o nível absoluto de cada uma.
//
// A distância até liquidação de uma perna NÃO depende de quantos pares
// dividem o capital (margem e notional escalam juntos por 1/N, a RAZÃO entre
// eles cancela N) — só da alavancagem: distância = 1/alavancagem − mmr. A 5x
// (o padrão do resto do projeto, calibrado para BTC/ETH — ativos bem mais
// líquidos que os pares aqui), 38,6% dos trades liquidariam. Mesmo a 2x,
// 6,8% liquidariam. `poolComExcursoes` já faz essa substituição — cada trade
// que excede a distância vira -1/alavancagem (perda da margem inteira
// daquela perna), não o retorno teórico que o backtest assumia.
console.log('─'.repeat(100));
console.log('CENÁRIO: pares cointegrados (bootstrap + risco de liquidação por perna)\n');
console.log('carregando 57 ativos, achando pares, medindo excursão intra-trade de cada perna...');

const pool = poolComExcursoes();
console.log(`\n${pool.rMultiplos.length} trades pooled · duração média ${pool.duracaoMediaBarras.toFixed(1)} dias\n`);
console.log('alavancagem'.padEnd(14) + 'distância liquid.'.padEnd(19) + '% que liquida'.padEnd(15) + 'expectancy corrigida');
console.log('-'.repeat(100));
for (const alav of [1, 1.5, 2, 3, 5]) {
  const dist = distanciaLiquidacaoPorPerna(1, alav);
  const fracao = pool.fracaoLiquida(alav);
  const rCorrigido = pool.rMultiplosComLiquidacao(alav);
  const expCorrigida = rCorrigido.reduce((s, r) => s + r, 0) / rCorrigido.length;
  console.log(
    (`${alav}x`).padEnd(14) + ((dist * 100).toFixed(1) + '%').padEnd(19) +
    ((fracao * 100).toFixed(1) + '%').padEnd(15) + expCorrigida.toFixed(4),
  );
}

const ALAVANCAGEM_PARES = num(a.alavancagem, 1); // 1x: a única onde a expectancy corrigida continua positiva
console.log(`\nusando ${ALAVANCAGEM_PARES}x (passe --alavancagem para testar outra) — tabela abaixo JÁ inclui liquidação\n`);
const rMultiplosPares = pool.rMultiplosComLiquidacao(ALAVANCAGEM_PARES);
// cada par completa um ciclo a cada `duracaoMediaBarras` dias; N pares
// simultâneos rodam N ciclos em paralelo, então ops/mês escala com N
const opsPorParPorMes = pool.duracaoMediaBarras > 0 ? 30 / pool.duracaoMediaBarras : 3;
const NS_PARES = [2, 3, 4, 5, 6, 7, 8, 10];
console.log(
  'pares simult.'.padEnd(15) + 'risco/op'.padEnd(11) + 'ops/mês'.padEnd(10) +
  'chega na meta'.padEnd(16) + 'QUEBRA'.padEnd(11) + 'tempo mediano',
);
console.log('-'.repeat(100));
for (const n of NS_PARES) {
  const riscoFracao = ALAVANCAGEM_PARES / n;
  const opsPorMes = n * opsPorParPorMes;
  const s = simularBootstrap({
    rMultiplos: rMultiplosPares, capitalInicial: CAPITAL, alvo: ALVO, pisoRuina: PISO_RUINA,
    opsPorMes, horizonteMeses: HORIZONTE_MESES, riscoFracao, caminhos: CAMINHOS,
  });
  console.log(
    String(n).padEnd(15) + ((riscoFracao * 100).toFixed(0) + '%').padEnd(11) + opsPorMes.toFixed(1).padEnd(10) +
    ((s.pSucesso * 100).toFixed(1) + '%').padEnd(16) + ((s.pRuina * 100).toFixed(1) + '%').padEnd(11) +
    fmtTempo(s.mesesMediano),
  );
}
console.log(
  `\n  a alavancagem escolhida (${ALAVANCAGEM_PARES}x) é a que mantém a expectancy corrigida positiva —` +
  ' ver a tabela de alavancagem acima. Em 5x (o padrão do resto do projeto), a\n' +
  '  expectancy corrigida vira NEGATIVA e nenhum N salva o resultado.\n',
);

// ── cenário 3: ações, modelo binário (saída por stop/alvo — a aproximação certa lá) ──
console.log('─'.repeat(100));
console.log('CENÁRIO: ações (walk-forward, modelo binário — saída por stop/alvo fixo)\n');
const E_ACOES = 0.066, POR_MES_ACOES = 12, W = 2;
const p = (E_ACOES + 1) / (W + 1);
console.log(`expectancy ${E_ACOES}R · ${POR_MES_ACOES} op/mês · payoff ${W}:1 · acerto implícito ${(p * 100).toFixed(1)}%\n`);

function criarRng(semente: number) {
  let s = semente >>> 0;
  return () => { s ^= s << 13; s >>>= 0; s ^= s >> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
}
function simularBinario(risco: number, semente = 12345) {
  const totalOps = Math.round(POR_MES_ACOES * HORIZONTE_MESES);
  const rng = criarRng(semente);
  let sucessos = 0, ruinas = 0;
  const mesesAteSucesso: number[] = [], finais: number[] = [];
  for (let c = 0; c < CAMINHOS; c++) {
    let v = CAPITAL, terminou = false;
    for (let i = 1; i <= totalOps; i++) {
      v += rng() < p ? v * risco * W : -v * risco;
      if (v >= ALVO) { sucessos++; mesesAteSucesso.push(i / POR_MES_ACOES); finais.push(v); terminou = true; break; }
      if (v <= PISO_RUINA) { ruinas++; finais.push(v); terminou = true; break; }
    }
    if (!terminou) finais.push(v);
  }
  mesesAteSucesso.sort((x, y) => x - y); finais.sort((x, y) => x - y);
  return {
    pSucesso: sucessos / CAMINHOS, pRuina: ruinas / CAMINHOS,
    pArrastando: (CAMINHOS - sucessos - ruinas) / CAMINHOS,
    mesesMediano: mesesAteSucesso.length ? mesesAteSucesso[Math.floor(mesesAteSucesso.length / 2)] : Infinity,
    capitalMediano: finais[Math.floor(finais.length / 2)],
  };
}
imprimirTabela(RISCOS.map((risco) => ({ risco, s: simularBinario(risco) })));

console.log('='.repeat(100));
console.log('COMO LER ISTO\n');
console.log('A coluna que decide não é "chega na meta" — é ela ao lado de "QUEBRA". Risco alto');
console.log('aumenta as duas ao mesmo tempo, e existe um ponto onde quebrar cresce mais rápido');
console.log('que chegar. "Ainda tentando" no fim do horizonte é capital preso sem ter chegado');
console.log('nem quebrado — o desfecho mais comum quando o risco é baixo demais para a meta.');
console.log();
console.log('O cenário ts-momentum usa os R-múltiplos REAIS de 7.634 trades, não uma forma');
console.log('assumida — a cauda direita gorda dele (poucos trades grandes) muda o resultado');
console.log('de forma que o modelo binário não capturaria.');
console.log('='.repeat(100) + '\n');
