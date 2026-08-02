/**
 * A EQUIPE — o laço fechado.
 *
 * Roda os seis módulos em sequência, passando mensagens tipadas entre eles, e
 * imprime a conversa inteira para que a decisão final seja auditável.
 *
 * Diferente dos CLIs anteriores, aqui nenhum resultado passa por interpretação
 * humana no meio do caminho: a saída do Analista é a entrada do Pesquisador, o
 * veredicto do Pesquisador vai ao Risco, e assim por diante.
 *
 * Capital padrão: US$ 100. É a restrição declarada do projeto e ela é tratada
 * como restrição de primeira classe, não como detalhe de configuração.
 */
import fs from 'node:fs';
import path from 'node:path';
import { loadSeries, hasSeries, ROOT } from '../data/store.ts';
import { buildStrategy, REGISTRY } from '../strategies/index.ts';
import { walkForward } from '../validate/walkforward.ts';
import { GRIDS } from '../validate/grids.ts';
import { monteCarlo } from '../validate/montecarlo.ts';
import { deflatedSharpe } from '../backtest/metrics.ts';
import { buildRegimeContext, labelRegime } from '../ml/regime.ts';
import { rule, capitalRunway, maxConcurrent, positionMath } from '../team/risk-officer.ts';
import { buildExpectation, audit, replayAudit } from '../audit/auditor.ts';
import { TeamLog, type ResearchVerdict, type RiskRuling } from '../team/messages.ts';
import { makeConfig, COSTS, RISK_PROFILES } from '../config.ts';
import { parseArgs, num, str, bool } from './args.ts';

const a = parseArgs();
const exchange = str(a.exchange, 'binanceusdm');
const timeframe = str(a.timeframe, '4h');
const equity = num(a.equity, 100); // <-- os 100 dólares
const costPreset = str(a.cost, 'binance-futures-maker');
const riskProfile = str(a.risk, 'seed');
const verbose = bool(a.verbose, false);

const universe = str(a.symbol, 'BTC/USDT:USDT,ETH/USDT:USDT,SOL/USDT:USDT,TRX/USDT:USDT,DOT/USDT:USDT,XRP/USDT:USDT,DOGE/USDT:USDT,BNB/USDT:USDT')
  .split(',').map((s) => s.trim()).filter((s) => hasSeries(exchange, s, timeframe));

const stratNames = str(a.strategy, Object.keys(REGISTRY).join(',')).split(',').map((s) => s.trim());

const cfg = makeConfig({ initialEquity: equity, costPreset, riskProfile, maxBarsInTrade: num(a.maxBars, 100000) });
const state = { equity, cost: COSTS[costPreset], risk: RISK_PROFILES[riskProfile] };
const log = new TeamLog();

console.log(`\n${'='.repeat(78)}`);
console.log(`REUNIÃO DA EQUIPE  ·  capital US$ ${equity}  ·  ${timeframe}  ·  custo ${costPreset}`);
console.log(`${'='.repeat(78)}\n`);

// ─────────────────────────────────────────────────────────────────────────────
// GESTOR DE RISCO — fala PRIMEIRO, não por último.
// Se o capital não comporta a operação, não faz sentido pesquisar nada.
// ─────────────────────────────────────────────────────────────────────────────
console.log('### O QUE US$ ' + equity + ' SUPORTAM\n');
const runway = capitalRunway(state);
console.log('  equity'.padEnd(12) + 'notional'.padEnd(12) + 'posições'.padEnd(12) + 'operável?');
for (const r of runway) {
  const mark = r.equity === equity ? '  <- você está aqui' : '';
  console.log(
    ('  $' + r.equity).padEnd(12) + ('$' + r.notional.toFixed(2)).padEnd(12) +
      String(r.concurrent).padEnd(12) + (r.operable ? 'sim' : 'NÃO') + mark,
  );
}
const conc = maxConcurrent(equity, 0.015, state.cost, state.risk);
const pm = positionMath(equity, 0.015, state.cost, state.risk);
console.log(
  `\n  Com US$ ${equity}: até ${conc.limit} posições simultâneas (limite: ${conc.binding}).\n` +
    `  Cada uma com notional de US$ ${pm.notional.toFixed(2)} e alavancagem ${pm.leverage.toFixed(2)}x.\n` +
    `  A conta deixa de ser operável abaixo de US$ ${pm.minViableEquity.toFixed(2)} — ` +
    `perda de ${((1 - pm.minViableEquity / equity) * 100).toFixed(0)}% do capital.\n`,
);
log.say('risco', `capital US$ ${equity} suporta ${conc.limit} posições; piso operável US$ ${pm.minViableEquity.toFixed(2)}`);

// ─────────────────────────────────────────────────────────────────────────────
// ANALISTA -> PESQUISADOR
// ─────────────────────────────────────────────────────────────────────────────
console.log(`### ANALISTA: ${universe.length} ativos com dados em ${timeframe}\n`);
log.say('analista', `${universe.length} candidatos propostos: ${universe.map((s) => s.replace('/USDT:USDT', '')).join(', ')}`);

const totalTests = universe.length * stratNames.length;
console.log(`### PESQUISADOR: walk-forward em ${totalTests} pares (usado no Sharpe deflacionado)\n`);

const verdicts: ResearchVerdict[] = [];
for (const symbol of universe) {
  const series = loadSeries(exchange, symbol, timeframe);
  const ctx = buildRegimeContext(series.bars);
  for (const name of stratNames) {
    const grid = GRIDS[name];
    if (!grid) continue;
    let wf;
    try { wf = walkForward({ series, strategyName: name, grid, cfg, folds: 5 }); } catch { continue; }
    if (!wf.folds.length || wf.combined.trades < 40) continue;

    const dsr = deflatedSharpe(wf.combined.sharpe, wf.totalCombosTested * totalTests, wf.combined.trades);
    const mc = monteCarlo(wf.combinedTrades, { sims: 3000, ddStop: cfg.risk.maxDrawdownStop });

    const reasons: string[] = [];
    if (wf.combined.expectancyR <= 0) reasons.push('expectancy OOS não positiva');
    if (wf.efficiency < 0.4) reasons.push(`eficiência WF ${wf.efficiency.toFixed(2)} < 0.40`);
    if (dsr < 0.9) reasons.push(`Sharpe deflacionado ${dsr.toFixed(2)} < 0.90`);
    if (mc.pRuin50 > 0.01) reasons.push('risco de ruína > 1%');

    verdicts.push({
      from: 'pesquisador', symbol, strategy: name, timeframe,
      approved: reasons.length === 0,
      expectancyR: wf.combined.expectancyR,
      oosTrades: wf.combined.trades,
      walkForwardEfficiency: wf.efficiency,
      deflatedSharpe: dsr,
      maxDrawdown: wf.combined.maxDrawdown,
      p5Return: mc.p5Return,
      p95Drawdown: mc.p95MaxDd,
      reasons,
      oosTradeRecord: wf.combinedTrades,
    });
  }
}

const approved = verdicts.filter((v) => v.approved).sort((x, y) => y.expectancyR - x.expectancyR);
console.log('  ativo'.padEnd(12) + 'estratégia'.padEnd(22) + 'expect'.padEnd(10) + 'trades'.padEnd(9) + 'efic'.padEnd(8) + 'DSR'.padEnd(7) + 'veredicto');
for (const v of verdicts.sort((x, y) => y.expectancyR - x.expectancyR).slice(0, 14)) {
  console.log(
    ('  ' + v.symbol.replace('/USDT:USDT', '')).padEnd(12) + v.strategy.split('(')[0].padEnd(22) +
      (v.expectancyR.toFixed(3) + 'R').padEnd(10) + String(v.oosTrades).padEnd(9) +
      v.walkForwardEfficiency.toFixed(2).padEnd(8) + v.deflatedSharpe.toFixed(2).padEnd(7) +
      (v.approved ? 'APROVADO' : v.reasons[0]),
  );
}
log.say('pesquisador', `${approved.length} de ${verdicts.length} pares aprovados no walk-forward`);

// ─────────────────────────────────────────────────────────────────────────────
// PESQUISADOR -> RISCO (veto assimétrico)
// ─────────────────────────────────────────────────────────────────────────────
console.log(`\n### GESTOR DE RISCO: julgando ${approved.length} aprovados\n`);
const rulings: RiskRuling[] = approved.map((v) => rule(v, state));
for (const r of rulings) {
  console.log(
    `  ${r.symbol.replace('/USDT:USDT', '').padEnd(8)} ${r.strategy.split('(')[0].padEnd(20)} ` +
      (r.vetoed ? `VETADO — ${r.vetoReason}` : `ok, notional US$ ${r.notionalAtCurrentEquity.toFixed(2)}`),
  );
}
const cleared = rulings.filter((r) => !r.vetoed);
log.say('risco', `${cleared.length} liberados, ${rulings.length - cleared.length} vetados`);

// ─────────────────────────────────────────────────────────────────────────────
// ALOCADOR — respeita o teto de posições simultâneas do Risco
// ─────────────────────────────────────────────────────────────────────────────
const active = cleared.slice(0, conc.limit);
const benched = cleared.slice(conc.limit);
console.log(`\n### ALOCADOR: ${active.length} ativos, ${benched.length} no banco\n`);
for (const r of active) {
  const v = approved.find((x) => x.symbol === r.symbol && x.strategy === r.strategy)!;
  console.log(`  OPERAR   ${r.symbol.replace('/USDT:USDT', '').padEnd(8)} ${r.strategy.split('(')[0].padEnd(20)} expect ${v.expectancyR.toFixed(3)}R  risco ${(r.riskPerTrade * 100).toFixed(2)}%`);
}
for (const r of benched) console.log(`  banco    ${r.symbol.replace('/USDT:USDT', '').padEnd(8)} ${r.strategy.split('(')[0].padEnd(20)} (teto de ${conc.limit} posições)`);

const symbolsActive = new Set(active.map((r) => r.symbol));
if (symbolsActive.size < active.length) {
  console.log(`\n  ATENÇÃO: há mais de uma estratégia no mesmo ativo — o risco não é independente.`);
}
const cryptoMajors = active.filter((r) => /BTC|ETH|SOL|BNB|XRP|DOGE/.test(r.symbol)).length;
const corrWarn = cryptoMajors >= 3
  ? `${cryptoMajors} posições em majors de cripto, que caem juntas. O risco simultâneo real é menor que ${cryptoMajors}× mas maior que 1×. Correlação precisa ser MEDIDA antes de tratar isto como diversificação.`
  : undefined;
if (corrWarn) console.log(`\n  CORRELAÇÃO: ${corrWarn}`);
log.say('alocador', `${active.length} pares ativos${corrWarn ? ' (alerta de correlação)' : ''}`);

// ─────────────────────────────────────────────────────────────────────────────
// AUDITOR — o laço que fecha
// Replay: "quando o Auditor teria puxado o freio?" Validar o Auditor ANTES de
// confiar nele: um que rebaixa cedo demais destrói estratégia boa.
// ─────────────────────────────────────────────────────────────────────────────
console.log(`\n### AUDITOR: replay sobre o histórico out-of-sample\n`);
for (const r of active) {
  const v = approved.find((x) => x.symbol === r.symbol && x.strategy === r.strategy)!;
  const series = loadSeries(exchange, v.symbol, timeframe);
  const ctx = buildRegimeContext(series.bars);
  const idx = new Map(series.bars.map((b, i) => [b.t, i]));
  const regimes = v.oosTradeRecord.map((t) => labelRegime(ctx, idx.get(t.entryTime) ?? 0));

  const expectation = buildExpectation(v.oosTradeRecord, cfg.risk.maxDrawdownStop, regimes);
  const now = audit(expectation, {
    trades: v.oosTradeRecord.slice(-40),
    currentRegime: labelRegime(ctx, ctx.rows.length - 1),
  });

  console.log(`  ${v.symbol.replace('/USDT:USDT', '')} ${v.strategy.split('(')[0]} — estado: ${now.status}`);
  console.log(`    ${now.recommendation}`);
  for (const f of now.findings.filter((x) => x.severity > 0)) console.log(`    · ${f.detail}`);

  const rp = replayAudit(expectation, v.oosTradeRecord, 40, 20);
  const alerts = rp.filter((x) => x.status !== 'SAUDAVEL');
  console.log(
    `    replay: ${rp.length} janelas avaliadas, ${alerts.length} teriam gerado alerta` +
      (alerts.length ? ` (primeiro em ${alerts[0].date}, z=${alerts[0].z.toFixed(2)})` : ' — nenhum falso alarme'),
  );
  log.say('auditor', `${v.symbol.replace('/USDT:USDT', '')} ${v.strategy.split('(')[0]}: ${now.status}`);
}

// ─────────────────────────────────────────────────────────────────────────────
console.log(`\n### A CONVERSA\n`);
log.print(verbose);

const plan = {
  capital: equity, timeframe, costPreset,
  maxConcurrent: conc.limit, bindingConstraint: conc.binding,
  minViableEquity: pm.minViableEquity,
  active: active.map((r) => ({ symbol: r.symbol, strategy: r.strategy, riskPerTrade: r.riskPerTrade, notional: r.notionalAtCurrentEquity })),
  benched: benched.map((r) => ({ symbol: r.symbol, strategy: r.strategy })),
  correlationWarning: corrWarn,
  conversation: log.all(),
};
const dir = path.join(ROOT, 'reports');
fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(path.join(dir, `team-${timeframe}.json`), JSON.stringify(plan, null, 2));

console.log(`\nplano salvo em reports/team-${timeframe}.json`);
console.log(
  `\nLEMBRETE: este plano é para PAPER TRADING. Nada aqui foi operado com\n` +
    `dinheiro real, e o portão de 90 dias continua de pé.`,
);
