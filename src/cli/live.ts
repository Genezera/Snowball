/**
 * Ponto de entrada do executor ao vivo.
 *
 * Padrao e `--mode paper`: nenhuma ordem sai daqui. Para testnet ou live e
 * preciso passar o modo explicitamente E ter as chaves em variavel de ambiente.
 * O modo `live` ainda exige `--i-understand`, porque um erro de digitacao nao
 * deve ser capaz de comecar a gastar dinheiro real.
 *
 * O laco acorda logo depois de cada fechamento de barra, com uma folga de
 * alguns segundos para a exchange consolidar a vela.
 */
import fs from 'node:fs';
import path from 'node:path';
import { LiveExecutor, type Mode } from '../live/executor.ts';
import { buildStrategy } from '../strategies/index.ts';
import { GBDT } from '../ml/gbdt.ts';
import { makeConfig } from '../config.ts';
import { tfMs, ROOT } from '../data/store.ts';
import { DEFAULT_RATCHET, CONSERVATIVE_RATCHET } from '../core/volatility.ts';
import { parseArgs, num, str, bool, parseParams } from './args.ts';

const a = parseArgs();
const mode = str(a.mode, 'paper') as Mode;
const exchange = str(a.exchange, 'binanceusdm');
const symbol = str(a.symbol, 'BTC/USDT:USDT');
const timeframe = str(a.timeframe, '4h');
const stratName = str(a.strategy, 'body-breakout');
const params = parseParams(a.params);

if (mode === 'live' && !bool(a['i-understand'], false)) {
  console.error(
    'Modo live exige --i-understand.\n\n' +
      'Antes de passar essa flag, confira se voce realmente completou:\n' +
      '  1. walk-forward aprovado (npm run validate)\n' +
      '  2. no minimo 90 dias de paper trading com desvio pequeno em relacao ao esperado\n' +
      '  3. capital que voce aceita perder integralmente\n\n' +
      'Nenhuma estrategia deste projeto foi aprovada para dinheiro real ate agora.',
  );
  process.exit(1);
}

const cfg = makeConfig({
  initialEquity: num(a.equity, 100),
  costPreset: str(a.cost, mode === 'paper' ? 'binance-futures-maker' : 'binance-futures'),
  riskProfile: str(a.risk, 'seed'),
  maxBarsInTrade: num(a.maxBars, 48),
});

// Filtro de ML opcional, se houver modelo treinado para este par/estrategia.
let mlModel: GBDT | undefined;
let mlThreshold: number | undefined;
const modelPath = path.join(ROOT, 'models', `${symbol.replace(/[/:]/g, '_')}__${stratName}__${timeframe}.json`);
if (bool(a.ml, false)) {
  if (!fs.existsSync(modelPath)) {
    console.error(`--ml pedido mas nao existe modelo em ${modelPath}. Rode npm run ml primeiro.`);
    process.exit(1);
  }
  const saved = JSON.parse(fs.readFileSync(modelPath, 'utf8'));
  mlModel = GBDT.fromJSON(saved.model);
  mlThreshold = saved.threshold;
  console.log(`filtro de ML carregado (limiar ${mlThreshold})`);
}

// Configuração final validada: catraca + piso móvel + vol-targeting.
// É a única política que sobrevive bem tanto ao cenário com edge (+US$ 2.540
// sobre só poupar) quanto ao sem edge (-US$ 12). Ver docs/POLITICA-FINAL.md.
const perfil = str(a.perfil, 'catraca');
const ratchet = perfil === 'catraca' ? DEFAULT_RATCHET
  : perfil === 'conservador' ? CONSERVATIVE_RATCHET
  : null;

const exec = new LiveExecutor({
  exchange, symbol, timeframe, mode,
  strategy: buildStrategy(stratName, params),
  cost: cfg.cost,
  risk: cfg.risk,
  startEquity: cfg.initialEquity,
  maxBarsInTrade: cfg.maxBarsInTrade,
  ratchet,
  useFloor: bool(a.piso, true),
  volTargeting: bool(a.vol, true),
  mlModel, mlThreshold,
});

await exec.init();

console.log(
  `\nmodo=${mode}  ${symbol} ${timeframe}  estrategia=${stratName}\n` +
    `perfil de risco: ${ratchet ? `CATRACA ${ratchet.map((s) => `>${s.acima}:${(s.risco * 100).toFixed(0)}%`).join(' ')}` : `fixo ${(cfg.risk.riskPerTrade * 100).toFixed(2)}%`}\n` +
    `piso movel: ${bool(a.piso, true) ? 'ativo (corta risco pela metade ao devolver 25% do pico)' : 'desligado'}\n` +
    `vol-targeting: ${bool(a.vol, true) ? 'ativo (tamanho escala com volatilidade prevista)' : 'desligado'}\n` +
    `limite diario ${(cfg.risk.dailyLossLimit * 100).toFixed(0)}%  ` +
    `desliga em ${(cfg.risk.maxDrawdownStop * 100).toFixed(0)}% de drawdown\n` +
    (mode === 'paper' ? 'NENHUMA ordem sera enviada.\n' : `ORDENS SERAO ENVIADAS (${mode}).\n`),
);

const step = tfMs(timeframe);
const SETTLE_MS = 5_000; // folga para a exchange consolidar a vela

async function loop() {
  try {
    await exec.tick();
  } catch (e) {
    // Erro de rede nao deve matar o bot; a proxima barra tenta de novo.
    console.error(`[erro no tick] ${(e as Error).message}`);
  }
  const st = exec.getState();
  if (st.halted) {
    console.log(`\n### PARADO: ${st.haltReason}\nEquity final ${st.equity.toFixed(2)} apos ${st.closedTrades} trades.`);
    process.exit(0);
  }
  const now = Date.now();
  const nextClose = Math.ceil(now / step) * step;
  setTimeout(loop, nextClose - now + SETTLE_MS);
}

process.on('SIGINT', () => {
  const st = exec.getState();
  console.log(`\ninterrompido. Equity ${st.equity.toFixed(2)}, ${st.closedTrades} trades, posicao ${st.position ? st.position.side : 'nenhuma'}.`);
  console.log('O estado foi salvo; reiniciar retoma de onde parou.');
  process.exit(0);
});

await loop();
