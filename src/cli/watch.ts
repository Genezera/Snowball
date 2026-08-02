/**
 * Relatório do paper trading — lê o diário e responde a única pergunta que
 * importa: o realizado bate com o que o backtest prometeu?
 *
 * Roda a qualquer momento sem interferir no processo de paper. O diário é
 * append-only, então ler é sempre seguro.
 *
 * Mede também a SELEÇÃO ADVERSA, comparando o preço de referência do sinal com
 * o preço de entrada efetivo. É o número que o backtest não consegue simular e
 * que decide se o edge de 0,17R sobrevive ao mundo real.
 */
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from '../data/store.ts';
import { buildExpectation, audit } from '../audit/auditor.ts';
import { parseArgs, num, str } from './args.ts';
import type { Trade } from '../core/types.ts';

const a = parseArgs();
const timeframe = str(a.timeframe, '4h');
const jf = path.join(ROOT, 'paper', `journal-${timeframe}.jsonl`);
const sf = path.join(ROOT, 'paper', `state-${timeframe}.json`);

if (!fs.existsSync(jf)) {
  console.log(`Sem diário em ${jf}. O paper trading já rodou?`);
  process.exit(0);
}

const eventos = fs.readFileSync(jf, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
const init = eventos.find((e) => e.event === 'init');
const abres = eventos.filter((e) => e.event === 'abre');
const fechas = eventos.filter((e) => e.event === 'fecha');
const bloqueios = eventos.filter((e) => e.event === 'bloqueado');
const halts = eventos.filter((e) => e.event === 'halt');

const state = fs.existsSync(sf) ? JSON.parse(fs.readFileSync(sf, 'utf8')) : null;
const inicio = init?.ts ?? eventos[0].ts;
const dias = (Date.now() - inicio) / 86_400_000;

console.log(`\n${'='.repeat(74)}`);
console.log(`PAPER TRADING — dia ${dias.toFixed(1)} de 90`);
console.log(`${'='.repeat(74)}\n`);

if (state) {
  const ret = (state.equity / 100 - 1) * 100;
  const dd = ((state.peakEquity - state.equity) / state.peakEquity) * 100;
  console.log(`  equity        US$ ${state.equity.toFixed(2)}  (${ret >= 0 ? '+' : ''}${ret.toFixed(2)}%)`);
  console.log(`  pico          US$ ${state.peakEquity.toFixed(2)}  ·  drawdown atual ${dd.toFixed(1)}%`);
  console.log(`  trades        ${state.closedTrades} fechados${state.closedTrades ? `, ${((state.wins / state.closedTrades) * 100).toFixed(0)}% acerto` : ''}`);
  console.log(`  abertas       ${state.positions?.length ?? 0}`);
  if (state.halted) console.log(`  PARADO        ${state.haltReason}`);
}

console.log(`\n  eventos       ${abres.length} aberturas · ${fechas.length} fechamentos · ${bloqueios.length} bloqueios`);
if (bloqueios.length) {
  const porMotivo = bloqueios.reduce((m: Record<string, number>, b: any) => ({ ...m, [b.motivo]: (m[b.motivo] ?? 0) + 1 }), {});
  console.log(`  bloqueios por ${JSON.stringify(porMotivo)}`);
}

// ── seleção adversa: o número que o backtest não simula ────────────────────
if (abres.length) {
  const desvios = abres
    .filter((e: any) => e.refPrice > 0)
    .map((e: any) => Math.abs(e.entryPrice / e.refPrice - 1));
  const medio = desvios.reduce((x, y) => x + y, 0) / desvios.length;
  console.log(`\n  SELEÇÃO ADVERSA (o que o backtest não simula)`);
  console.log(`    desvio médio entrada vs referência: ${(medio * 100).toFixed(4)}%`);
  console.log(`    custo modelado no backtest:         0,0050%`);
  console.log(
    `    ${medio > 0.00005 * 2
      ? 'ACIMA do modelado — o edge real é menor que o previsto'
      : 'dentro do modelado'}`,
  );
}

// ── auditoria contra a expectativa do backtest ─────────────────────────────
if (fechas.length >= 5) {
  const trades: Trade[] = fechas.map((e: any) => ({
    symbol: e.symbol, side: e.side, entryTime: e.ts, entryPrice: e.entryPrice,
    exitTime: e.ts, exitPrice: e.exitPrice, exitReason: e.reason, barsHeld: e.barsHeld ?? 0,
    notional: 0, cost: 0, pnl: e.pnl, rEquity: e.rEquity, rPrice: 0, equityAfter: e.equity,
  }));

  // Expectativa vinda do walk-forward: 0,17R medido, desvio 1,59R
  const expectativa = {
    expectancyR: 0.17, sdR: 0.0085, p95Drawdown: 0.10, p5Return: -0.05,
    approvedRegimes: {}, baselineTrades: 1186,
  };
  const rel = audit(expectativa, { trades }, { minTrades: 25 });

  console.log(`\n  AUDITORIA`);
  console.log(`    estado: ${rel.status}`);
  console.log(`    ${rel.recommendation}`);
  for (const f of rel.findings) console.log(`      · ${f.detail}`);
} else {
  console.log(`\n  AUDITORIA: ${fechas.length} trades fechados — mínimo 25 para julgar.`);
  console.log(`    Julgar antes disso mede ruído, não desempenho.`);
}

console.log(`\n${'─'.repeat(74)}`);
const restam = Math.max(0, 90 - dias);
console.log(
  `Faltam ${restam.toFixed(0)} dias para a resposta.\n` +
  `Nada deve ser mudado no sistema durante a janela — mexer no meio invalida\n` +
  `a medição, que é a única coisa que este período produz.`,
);
