/**
 * O PLANO DA BOLA DE NEVE.
 *
 * Não é um cronograma. É uma **máquina de estados dirigida pelo equity**, e
 * essa distinção é o ponto inteiro do arquivo.
 *
 * Um cronograma diz "no mês 6 você terá US$ 130". Isso é falso e perigoso: o
 * resultado é uma distribuição, não um número, e planos com data marcada levam
 * o operador a forçar a mão quando a data chega e o dinheiro não.
 *
 * Esta máquina diz: "**enquanto** o equity estiver nesta faixa, opere assim;
 * **quando** cruzar para cima, mude assim; **quando** cruzar para baixo, recue
 * assim". Ela se adapta sozinha porque só reage ao que já aconteceu.
 *
 * As faixas não são arbitrárias — saem da aritmética da exchange. Com notional
 * mínimo de US$ 5 e risco de 0,5%, o número de posições que a conta suporta
 * muda em degraus, e cada degrau é uma mudança real de capacidade.
 */
import type { CostModel, RiskConfig } from '../core/types.ts';
import { positionMath, maxConcurrent } from './risk-officer.ts';

export interface Stage {
  id: string;
  name: string;
  /** faixa de equity, em dólares */
  from: number;
  to: number;
  positions: number;
  riskPerTrade: number;
  notionalPerPosition: number;
  /** o que muda ao entrar nesta faixa */
  objetivo: string;
  regras: string[];
  /** condição para subir de faixa */
  avancarQuando: string;
  /** condição para recuar */
  recuarQuando: string;
}

/**
 * Constrói a escada a partir da configuração real de custo e risco.
 * Se você mudar o notional mínimo ou o risco por trade, a escada se recalcula.
 */
export function buildLadder(cost: CostModel, risk: RiskConfig, stopPct = 0.015): Stage[] {
  const at = (eq: number) => {
    const m = positionMath(eq, stopPct, cost, risk);
    const c = maxConcurrent(eq, stopPct, cost, risk);
    return { notional: m.notional, positions: c.limit, minViable: m.minViableEquity };
  };

  const piso = at(100).minViable;

  return [
    {
      id: 'S0',
      name: 'Prova — dinheiro nenhum',
      from: 100, to: 100,
      positions: at(100).positions,
      riskPerTrade: risk.riskPerTrade,
      notionalPerPosition: at(100).notional,
      objetivo:
        'Descobrir se o backtest sabe alguma coisa sobre a realidade. Nenhum dólar é arriscado aqui.',
      regras: [
        'paper trading por 90 dias, com o mesmo tamanho que seria usado com dinheiro real',
        'o Auditor roda semanalmente comparando realizado com a distribuição prevista',
        'registrar TODA divergência entre preço de entrada esperado e obtido — é a medida da seleção adversa, que o backtest não modela',
      ],
      avancarQuando:
        'após 90 dias E pelo menos 60 trades E o Auditor em SAUDAVEL E a expectancy realizada dentro de 1 desvio do previsto',
      recuarQuando:
        'Auditor em REBAIXAR, ou expectancy realizada negativa após 60 trades. Nesse caso volta-se à pesquisa — não se ajusta o plano para caber no resultado.',
    },
    {
      id: 'S1',
      name: 'Semente — capital real mínimo',
      from: Math.ceil(piso * 1.6), to: 149,
      positions: at(100).positions,
      riskPerTrade: risk.riskPerTrade,
      notionalPerPosition: at(100).notional,
      objetivo:
        'Trocar a incerteza do paper pela do dinheiro real, ao menor custo possível. O objetivo aqui NÃO é lucro — é medir o atrito real de execução.',
      regras: [
        `arriscar ${(risk.riskPerTrade * 100).toFixed(2)}% por trade, ${at(100).positions} posições no máximo`,
        'nada de aumentar risco depois de sequência boa — o tamanho sobe sozinho com o equity',
        'sacar zero. Todo lucro fica na conta; é isso que é a bola de neve',
        'se o equity cair abaixo de US$ 85, parar e auditar antes de continuar',
      ],
      avancarQuando: 'equity ≥ US$ 150 com o Auditor em SAUDAVEL',
      recuarQuando: `equity < US$ 85 → parar e reauditar. Equity < US$ ${Math.ceil(piso * 1.6)} → voltar para paper.`,
    },
    {
      id: 'S2',
      name: 'Tração — o composto começa a aparecer',
      from: 150, to: 399,
      positions: at(200).positions,
      riskPerTrade: risk.riskPerTrade,
      notionalPerPosition: at(200).notional,
      objetivo:
        'Aproveitar que o notional já é confortável para diversificar mecanismo, não só ativo.',
      regras: [
        'adicionar um segundo par apenas se ele usar MECANISMO diferente (ex.: saída em ATR vs percentual fixo)',
        'dois pares no mesmo ativo não é diversificação',
        'medir a correlação realizada entre os pares ativos, não assumi-la',
        'manter o risco por trade — o crescimento vem do composto, não de apostar mais',
      ],
      avancarQuando: 'equity ≥ US$ 400 com correlação medida e Auditor SAUDAVEL em todos os pares',
      recuarQuando: 'equity < US$ 130, ou correlação realizada > 0,7 entre os pares ativos → reduzir para um par',
    },
    {
      id: 'S3',
      name: 'Consolidação — primeira retirada',
      from: 400, to: 999,
      positions: at(500).positions,
      riskPerTrade: risk.riskPerTrade,
      notionalPerPosition: at(500).notional,
      objetivo:
        'Retirar o capital inicial de risco. A partir daqui você opera com dinheiro que o sistema produziu.',
      regras: [
        'ao cruzar US$ 400, sacar os US$ 100 iniciais. O experimento passa a ter custo zero',
        'este saque é a única exceção à regra de não sacar, e ele existe por razão psicológica, não matemática',
        'revisar o pool completo: rodar o scanner e o walk-forward do zero, com os testes acumulados contando no Sharpe deflacionado',
      ],
      avancarQuando: 'equity ≥ US$ 1.000 após o saque',
      recuarQuando: 'equity < US$ 300 → voltar a S2 e reduzir para um par',
    },
    {
      id: 'S4',
      name: 'Escala — onde o problema muda de natureza',
      from: 1000, to: Infinity,
      positions: at(1000).positions,
      riskPerTrade: risk.riskPerTrade,
      notionalPerPosition: at(1000).notional,
      objetivo:
        'A partir daqui a restrição deixa de ser o notional mínimo e passa a ser liquidez e impacto de mercado.',
      regras: [
        'reavaliar o modelo de custo: com notional maior, o slippage deixa de ser desprezível em alts',
        'considerar reduzir o risco por trade — a utilidade marginal do ganho cai e a do drawdown sobe',
        'imposto de renda passa a ser material e precisa entrar no cálculo',
      ],
      avancarQuando: 'não há próximo estágio definido; o problema é outro e exige replanejamento',
      recuarQuando: 'drawdown de 20% desde o pico → reduzir risco pela metade até recuperar',
    },
  ];
}

export interface Projection {
  months: number;
  p5: number;
  median: number;
  p95: number;
  probAbaixoDoInicial: number;
  probAtinge150: number;
  probAtinge400: number;
  probMorte: number;
}

/**
 * Projeção honesta: simula a escada com a distribuição medida, incluindo o
 * ramo em que NÃO existe edge nenhum.
 *
 * O parâmetro `expectancyR` é a suposição crítica e não deve ser tratado como
 * dado. Rode com 0 para ver o que acontece se o edge for ilusório.
 */
export function project(opts: {
  start: number;
  expectancyR: number;
  sdR: number;
  tradesPerMonth: number;
  months: number;
  cost: CostModel;
  risk: RiskConfig;
  stopPct?: number;
  sims?: number;
}): Projection {
  const stopPct = opts.stopPct ?? 0.015;
  const sims = opts.sims ?? 5000;
  let seed = 424242;
  const rnd = () => { seed ^= seed << 13; seed >>>= 0; seed ^= seed >> 17; seed ^= seed << 5; seed >>>= 0; return seed / 4294967296; };
  const gauss = () => Math.sqrt(-2 * Math.log(Math.max(1e-9, rnd()))) * Math.cos(2 * Math.PI * rnd());

  const finals: number[] = [];
  let below = 0, hit150 = 0, hit400 = 0, dead = 0;

  for (let s = 0; s < sims; s++) {
    let eq = opts.start;
    let peak = eq;
    let reached150 = false, reached400 = false, died = false;

    for (let m = 0; m < opts.months && !died; m++) {
      // o número de posições — e portanto de trades — muda com o equity
      const conc = maxConcurrent(eq, stopPct, opts.cost, opts.risk);
      const trades = Math.round(opts.tradesPerMonth * Math.max(1, conc.limit) / 3);
      for (let k = 0; k < trades; k++) {
        const pm = positionMath(eq, stopPct, opts.cost, opts.risk);
        if (pm.notional < opts.risk.minNotional) { died = true; break; }
        const r = opts.expectancyR + opts.sdR * gauss();
        eq += r * (eq * opts.risk.riskPerTrade);
        if (eq > peak) peak = eq;
        if (eq >= 150) reached150 = true;
        if (eq >= 400) reached400 = true;
        if ((peak - eq) / peak >= opts.risk.maxDrawdownStop) { died = true; break; }
      }
    }
    finals.push(eq);
    if (eq < opts.start) below++;
    if (reached150) hit150++;
    if (reached400) hit400++;
    if (died) dead++;
  }

  finals.sort((a, b) => a - b);
  const q = (p: number) => finals[Math.floor((finals.length - 1) * p)];
  return {
    months: opts.months,
    p5: q(0.05), median: q(0.5), p95: q(0.95),
    probAbaixoDoInicial: below / sims,
    probAtinge150: hit150 / sims,
    probAtinge400: hit400 / sims,
    probMorte: dead / sims,
  };
}
