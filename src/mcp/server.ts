/**
 * Servidor MCP local do Snowball.
 *
 * Expoe o backtester, o walk-forward e o ML como ferramentas para o Claude.
 * A diferenca em relacao a servidores de backtest de terceiros: aqui os dados
 * sao seus, o modelo de custo e explicito, e nenhuma ferramenta devolve
 * "retorno total" sem devolver junto o custo pago, o drawdown e o veredito de
 * validacao. Isso e proposital -- e para tornar dificil se enganar.
 *
 * Instalacao (ajuste o caminho):
 *   claude mcp add --scope user snowball -- node "C:/Users/Renan/Nova pasta/snowball/src/mcp/server.ts"
 */
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import fs from 'node:fs';
import path from 'node:path';

import { loadSeries, auditSeries, downloadSeries, DATA_DIR } from '../data/store.ts';
import { buildStrategy, REGISTRY } from '../strategies/index.ts';
import { runBacktest } from '../backtest/engine.ts';
import { computeMetrics, deflatedSharpe } from '../backtest/metrics.ts';
import { walkForward } from '../validate/walkforward.ts';
import { GRIDS } from '../validate/grids.ts';
import { monteCarlo } from '../validate/montecarlo.ts';
import { buildDataset, purgedWalkForwardCV, thresholdSweep, pickThreshold } from '../ml/metalabel.ts';
import { minViableCapital, simulateSnowball } from '../risk/capital.ts';
import { makeConfig, COSTS, RISK_PROFILES } from '../config.ts';

const server = new Server(
  { name: 'snowball', version: '0.1.0' },
  { capabilities: { tools: {} } },
);

const cfgProps = {
  exchange: { type: 'string', default: 'binanceusdm', description: 'id da exchange no ccxt' },
  symbol: { type: 'string', description: 'ex "TRX/USDT:USDT"' },
  timeframe: { type: 'string', default: '5m' },
  strategy: { type: 'string', enum: Object.keys(REGISTRY) },
  params: { type: 'object', description: 'parametros da estrategia, ex {"stopPct":0.015}' },
  cost: { type: 'string', enum: Object.keys(COSTS), default: 'binance-futures' },
  risk: { type: 'string', enum: Object.keys(RISK_PROFILES), default: 'seed' },
  equity: { type: 'number', default: 100 },
  maxBars: { type: 'number', default: 288 },
};

const TOOLS = [
  {
    name: 'list_data',
    description: 'Lista as series de dados em cache, com auditoria de integridade (gaps, cobertura, OHLC invalido).',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'download_data',
    description: 'Baixa OHLCV de uma exchange via ccxt e guarda em cache local.',
    inputSchema: {
      type: 'object',
      properties: {
        exchange: cfgProps.exchange,
        symbol: cfgProps.symbol,
        timeframe: cfgProps.timeframe,
        days: { type: 'number', default: 365 },
      },
      required: ['symbol'],
    },
  },
  {
    name: 'backtest',
    description:
      'Roda um backtest com custos explicitos. Devolve SEMPRE as taxas pagas como fracao do lucro bruto -- se esse numero passa de 100%, a estrategia so existe sem custo.',
    inputSchema: { type: 'object', properties: cfgProps, required: ['symbol', 'strategy'] },
  },
  {
    name: 'compare_costs',
    description:
      'Roda a MESMA estrategia sob varios modelos de custo (zero, maker, taker, stress) e mostra onde o edge morre. E a ferramenta mais util deste servidor.',
    inputSchema: { type: 'object', properties: cfgProps, required: ['symbol', 'strategy'] },
  },
  {
    name: 'walk_forward',
    description:
      'Otimiza parametros in-sample e testa out-of-sample, fold a fold. Devolve a eficiencia WF, o Sharpe deflacionado pelo numero de tentativas e um veredito de aprovacao.',
    inputSchema: {
      type: 'object',
      properties: { ...cfgProps, folds: { type: 'number', default: 6 } },
      required: ['symbol', 'strategy'],
    },
  },
  {
    name: 'ml_meta_label',
    description:
      'Treina um filtro de meta-labeling com purged walk-forward CV e mede se filtrar os sinais ruins torna a expectancy positiva.',
    inputSchema: { type: 'object', properties: cfgProps, required: ['symbol', 'strategy'] },
  },
  {
    name: 'capital_analysis',
    description:
      'Calcula o capital minimo viavel (abaixo do qual a posicao nao atinge o notional minimo da exchange) e projeta a bola de neve por Monte Carlo.',
    inputSchema: {
      type: 'object',
      properties: {
        stopPct: { type: 'number', default: 0.015 },
        cost: cfgProps.cost,
        risk: cfgProps.risk,
        startEquity: { type: 'number', default: 100 },
        expectancyR: { type: 'number', default: 0.05 },
        tradesPerMonth: { type: 'number', default: 40 },
        months: { type: 'number', default: 24 },
      },
    },
  },
];

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

const text = (o: unknown) => ({ content: [{ type: 'text', text: JSON.stringify(o, null, 2) }] });

function cfgFrom(a: any) {
  return makeConfig({
    initialEquity: a.equity ?? 100,
    costPreset: a.cost ?? 'binance-futures',
    riskProfile: a.risk ?? 'seed',
    maxBarsInTrade: a.maxBars ?? 288,
  });
}

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const a: any = req.params.arguments ?? {};
  const tf = a.timeframe ?? '5m';
  const ex = a.exchange ?? 'binanceusdm';

  try {
    switch (req.params.name) {
      case 'list_data': {
        if (!fs.existsSync(DATA_DIR)) return text({ series: [] });
        const out = fs.readdirSync(DATA_DIR).filter((f) => f.endsWith('.json')).map((f) => {
          const [exchange, sym, timeframe] = f.replace('.json', '').split('__');
          const symbol = sym.replace(/_/g, '/').replace(/\/(USDT)$/, ':$1');
          try {
            return { file: f, exchange, symbol, timeframe, audit: auditSeries(loadSeries(exchange, symbol, timeframe.replace('.json', ''))) };
          } catch {
            return { file: f, exchange, symbol, timeframe, audit: null };
          }
        });
        return text({ series: out });
      }

      case 'download_data': {
        const s = await downloadSeries({ exchange: ex, symbol: a.symbol, timeframe: tf, days: a.days ?? 365 });
        return text({ ok: true, audit: auditSeries(s) });
      }

      case 'backtest': {
        const cfg = cfgFrom(a);
        const series = loadSeries(ex, a.symbol, tf);
        const res = runBacktest(series, buildStrategy(a.strategy, a.params ?? {}), cfg);
        const m = computeMetrics(res, cfg.initialEquity);
        return text({
          symbol: a.symbol, strategy: a.strategy, costPreset: a.cost ?? 'binance-futures',
          metrics: m,
          aviso: m.feesAsPctOfGross > 1
            ? 'As taxas superaram o lucro bruto. Esta estrategia so e lucrativa com custo zero.'
            : undefined,
        });
      }

      case 'compare_costs': {
        const series = loadSeries(ex, a.symbol, tf);
        const presets = ['zero-cost', 'binance-futures-maker', 'binance-futures', 'stress'];
        const rows = presets.map((p) => {
          const cfg = cfgFrom({ ...a, cost: p });
          const res = runBacktest(series, buildStrategy(a.strategy, a.params ?? {}), cfg);
          const m = computeMetrics(res, cfg.initialEquity);
          return {
            preset: p, takerFee: COSTS[p].takerFee, trades: m.trades,
            profitFactor: m.profitFactor, expectancyR: m.expectancyR,
            totalReturn: m.totalReturn, maxDrawdown: m.maxDrawdown, sharpe: m.sharpe,
            feesAsPctOfGross: m.feesAsPctOfGross, halted: m.halted,
          };
        });
        return text({
          symbol: a.symbol, strategy: a.strategy, rows,
          leitura: 'Se profitFactor cai abaixo de 1 entre zero-cost e o preset que voce realmente paga, nao existe estrategia -- existe um backtest sem custo.',
        });
      }

      case 'walk_forward': {
        const cfg = cfgFrom(a);
        const series = loadSeries(ex, a.symbol, tf);
        const grid = GRIDS[a.strategy];
        if (!grid) return text({ erro: `sem grade definida para ${a.strategy}` });
        const wf = walkForward({ series, strategyName: a.strategy, grid, cfg, folds: a.folds ?? 6 });
        const dsr = deflatedSharpe(wf.combined.sharpe, wf.totalCombosTested, wf.combined.trades);
        const mc = monteCarlo(wf.combinedTrades, { sims: 3000, ddStop: cfg.risk.maxDrawdownStop });
        const reasons: string[] = [];
        if (wf.combined.trades < 100) reasons.push('poucos trades OOS');
        if (wf.combined.expectancyR <= 0) reasons.push('expectancy OOS nao positiva');
        if (wf.efficiency < 0.4) reasons.push('eficiencia WF < 0.40 (sobreajuste)');
        if (dsr < 0.9) reasons.push('Sharpe deflacionado < 0.90');
        if (mc.pRuin50 > 0.01) reasons.push('risco de ruina > 1%');
        return text({
          symbol: a.symbol, strategy: a.strategy,
          folds: wf.folds.map((f) => ({
            is: `${f.isFrom}..${f.isTo}`, oos: `${f.oosFrom}..${f.oosTo}`,
            params: f.bestParams,
            isExpectancyR: f.isMetrics.expectancyR, oosExpectancyR: f.oosMetrics.expectancyR,
          })),
          oosCombinado: wf.combined,
          eficienciaWF: wf.efficiency,
          combosTestados: wf.totalCombosTested,
          sharpeDeflacionado: dsr,
          monteCarlo: mc,
          aprovado: reasons.length === 0,
          motivos: reasons,
        });
      }

      case 'ml_meta_label': {
        const cfg = cfgFrom(a);
        const series = loadSeries(ex, a.symbol, tf);
        const collect = { ...cfg, risk: { ...cfg.risk, maxDrawdownStop: 1, dailyLossLimit: 1 } };
        const res = runBacktest(series, buildStrategy(a.strategy, a.params ?? {}), collect);
        if (res.trades.length < 300) return text({ erro: `so ${res.trades.length} trades, insuficiente para ML` });
        const ds = buildDataset(res.trades);
        const cv = purgedWalkForwardCV(ds, { folds: 5 });
        const rows = thresholdSweep(cv.allScored);
        const pick = pickThreshold(rows);
        return text({
          symbol: a.symbol, strategy: a.strategy,
          tradesBase: ds.trades.length,
          aucPorFold: cv.folds.map((f) => f.auc),
          aucMedio: cv.meanAuc,
          varreduraLimiar: rows,
          limiarEscolhido: pick,
          leitura: cv.meanAuc < 0.55
            ? 'AUC abaixo de 0.55: o modelo mal distingue trade bom de ruim. Nao confie no filtro.'
            : 'AUC acima de 0.55: ha estrutura aproveitavel, mas valide com Monte Carlo antes de operar.',
        });
      }

      case 'capital_analysis': {
        const cost = COSTS[a.cost ?? 'binance-futures'];
        const risk = RISK_PROFILES[a.risk ?? 'seed'];
        const stopPct = a.stopPct ?? 0.015;
        const cap = minViableCapital(stopPct, cost, risk);
        const sim = simulateSnowball({
          startEquity: a.startEquity ?? 100,
          expectancyR: a.expectancyR ?? 0.05,
          volR: 1.0,
          tradesPerMonth: a.tradesPerMonth ?? 40,
          months: a.months ?? 24,
          stopPct, cost, risk,
        });
        return text({ capitalMinimo: cap, projecao: sim });
      }

      default:
        return text({ erro: `ferramenta desconhecida: ${req.params.name}` });
    }
  } catch (e) {
    return text({ erro: (e as Error).message });
  }
});

await server.connect(new StdioServerTransport());
