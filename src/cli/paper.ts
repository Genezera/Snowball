/**
 * Paper trading em produção — um processo, vários pares, capital compartilhado.
 *
 * É aqui que os 90 dias começam a contar. Tudo antes disto foi simulação; a
 * partir daqui o sistema encontra o mercado real e a única coisa que importa é
 * o diário em paper/journal-*.jsonl.
 *
 * Nenhuma ordem é enviada. Este arquivo não tem código capaz de enviar ordem.
 */
import { hasSeries } from '../data/store.ts';
import { buildStrategy } from '../strategies/index.ts';
import { PaperOrchestrator, type PaperLeg } from '../live/orchestrator.ts';
import { DEFAULT_RATCHET, CONSERVATIVE_RATCHET } from '../core/volatility.ts';
import { makeConfig } from '../config.ts';
import { tfMs } from '../data/store.ts';
import { parseArgs, num, str, bool } from './args.ts';

const a = parseArgs();
const exchange = str(a.exchange, 'binanceusdm');
const timeframe = str(a.timeframe, '4h');
const perfil = str(a.perfil, 'catraca');

const spec = str(a.pairs, 'BTC/USDT:USDT=body-breakout,ETH/USDT:USDT=momentum-breakout,XRP/USDT:USDT=body-breakout,DOT/USDT:USDT=body-breakout')
  .split(',').map((s) => { const [sym, st] = s.split('='); return { sym: sym.trim(), st: st.trim() }; });

const cfg = makeConfig({
  initialEquity: num(a.equity, 100),
  costPreset: str(a.cost, 'binance-futures-maker'),
  riskProfile: 'seed',
  maxBarsInTrade: num(a.maxBars, 60),
});

const legs: PaperLeg[] = spec.map((p) => ({ symbol: p.sym, strategy: buildStrategy(p.st, {}) }));
const ratchet = perfil === 'catraca' ? DEFAULT_RATCHET : perfil === 'conservador' ? CONSERVATIVE_RATCHET : null;

const orch = new PaperOrchestrator({
  exchange, timeframe, legs,
  cost: cfg.cost, risk: cfg.risk,
  startEquity: cfg.initialEquity,
  maxBarsInTrade: cfg.maxBarsInTrade,
  maxConcurrent: num(a.concurrent, 3),
  maxHeat: num(a.maxHeat, 0.012),
  ratchet,
  useFloor: bool(a.piso, true),
  volTargeting: bool(a.vol, true),
});

console.log(`\n${'='.repeat(78)}`);
console.log(`PAPER TRADING  ·  US$ ${cfg.initialEquity}  ·  ${timeframe}  ·  ${legs.length} pares`);
console.log(`${'='.repeat(78)}\n`);

await orch.init();

console.log(
  `\nperfil            ${ratchet ? `CATRACA ${ratchet.map((s) => `>${s.acima}:${(s.risco * 100).toFixed(0)}%`).join(' ')}` : 'risco fixo'}\n` +
  `piso móvel        ${bool(a.piso, true) ? 'ativo' : 'desligado'}\n` +
  `vol-targeting     ${bool(a.vol, true) ? 'ativo' : 'desligado'}\n` +
  `posições máx      ${num(a.concurrent, 3)}  ·  teto de calor ${(num(a.maxHeat, 0.012) * 100).toFixed(2)}%\n` +
  `desliga em        ${(cfg.risk.maxDrawdownStop * 100).toFixed(0)}% de drawdown de carteira\n` +
  `\nNENHUMA ORDEM SERÁ ENVIADA. Este processo não tem código para isso.\n` +
  `Diário: paper/journal-${timeframe}.jsonl\n`,
);

const step = tfMs(timeframe);
const FOLGA = 8_000; // deixa a exchange consolidar a vela

async function loop() {
  try {
    await orch.tick();
  } catch (e) {
    console.error(`[erro no ciclo] ${(e as Error).message}`);
  }
  const st = orch.getState();
  console.log(`  ${orch.status()}`);
  if (st.halted) {
    console.log(`\n### PARADO: ${st.haltReason}`);
    console.log(`O sistema desligou sozinho. Isto é a proteção funcionando, não uma falha.`);
    process.exit(0);
  }
  const now = Date.now();
  const prox = Math.ceil(now / step) * step;
  const espera = prox - now + FOLGA;
  console.log(`  próxima barra em ${(espera / 60000).toFixed(0)} min`);
  setTimeout(loop, espera);
}

process.on('SIGINT', () => {
  console.log(`\n${orch.status()}`);
  console.log('Estado salvo. Reiniciar retoma exatamente de onde parou.');
  process.exit(0);
});

await loop();
