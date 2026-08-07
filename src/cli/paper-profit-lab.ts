/**
 * CLI do Paper Profit Lab — roda os challengers aprovados em loop contínuo.
 *
 * NUNCA envia ordem. NUNCA toca `spread/`, `momentum/` ou `pares/`. Todo
 * estado fica em `inteligencia/`.
 *
 * v2 desta sessão: lock contra duas instâncias, heartbeat persistido,
 * retomada idempotente, migração automática de challengers renomeados
 * (Parte 2), e validação periódica do control (Parte 1) — tudo somado sem
 * acoplar ao watchdog dos 8 processos do champion, de propósito.
 */
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from '../data/store.ts';
import { ProfitOrchestrator, percentis } from '../inteligencia/profit-orchestrator.ts';
import { migrarChallenger } from '../inteligencia/virtual-portfolio.ts';
import { MIGRACOES } from '../inteligencia/challengers.ts';
import { validarControl, type RelatorioValidacao } from '../inteligencia/validacao-control.ts';
import { carregarOuCriarJanelaValidacao } from '../inteligencia/validacao-persistente.ts';
import { CHALLENGER_CONTROL } from '../inteligencia/challengers.ts';
import {
  travar, destravar, carregarOuRetomar, salvarHeartbeat, labProvavelmenteParado,
  registrarLatencia, registrarErro,
} from '../inteligencia/supervisao.ts';
import { executarAgregacao } from '../inteligencia/dashboard-aggregator.ts';
import { carregarEstado } from '../inteligencia/virtual-portfolio.ts';
import { CHALLENGERS_APROVADOS } from '../inteligencia/challengers.ts';
import { parseArgs, num } from './args.ts';

const a = parseArgs();
const INTERVALO_MS = num(a.intervalo, 5) * 60_000;

function log(m: string) { console.log(`[${new Date().toISOString().slice(0, 19)}] ${m}`); }

function championPnlPct(): number {
  try {
    const p = path.join(ROOT, 'spread', 'estado.json');
    const e = JSON.parse(fs.readFileSync(p, 'utf8'));
    return e.capitalInicial > 0 ? ((e.capital - e.capitalInicial) / e.capitalInicial) * 100 : 0;
  } catch { return 0; }
}

async function main() {
  const lock = travar(ROOT);
  if (!lock) {
    console.error('Paper Profit Lab já está rodando (lock ativo com processo vivo) — recusando subir uma segunda instância.');
    process.exit(1);
  }
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  console.log('='.repeat(78));
  console.log('PAPER PROFIT LAB — challengers em paper, isolados do champion');
  console.log('NENHUMA ORDEM É ENVIADA. Capital 100% virtual, arquivos próprios.');
  console.log('='.repeat(78));

  // migração de challengers renomeados (Parte 2) — roda uma vez, idempotente
  // (migrarChallenger sobrescreve com os mesmos dados se rodar de novo)
  for (const [antigo, novo] of MIGRACOES) {
    if (migrarChallenger(ROOT, antigo, novo)) log(`migrado: ${antigo} → ${novo} (histórico preservado)`);
  }

  const orch = new ProfitOrchestrator(ROOT);
  let hb = carregarOuRetomar(ROOT);
  if (hb.reinicios > 0) log(`retomada idempotente — reinício #${hb.reinicios}, contadores preservados`);
  const latenciasTotais: number[] = [];
  let ultimoRelatorio = '';
  let ultimaValidacao = 0;
  let ultimaValidacaoResultado: RelatorioValidacao | null = null;

  function shutdown() {
    log('shutdown limpo — destravando lock');
    destravar(ROOT);
    process.exit(0);
  }

  async function ciclo() {
    try {
      const pnlChampion = championPnlPct();
      const r = await orch.ciclo(pnlChampion);

      hb.ultimoCiclo = r.ts;
      hb.ciclosProcessados++;
      hb.ciclosComErro += r.challengersComErro.length > 0 ? 1 : 0;
      hb.ultimoEstadoSalvo = Date.now();
      hb.statusPorChallenger = Object.fromEntries(
        r.leaderboard.linhas.map((l) => [l.challengerId, l.eliminado ? 'eliminado' : (r.challengersComErro.some((c) => c.id === l.challengerId) ? 'erro' : 'ok')]),
      );
      // funil de oportunidades (Parte 9/22 do dashboard) — acumulado, nunca reconstruído a partir de histórico
      if (r.funilCiclo.teveCandidata) hb.ciclosComCandidata++; else hb.ciclosSemCandidata++;
      hb.observadasAcumuladas += r.funilCiclo.observadas;
      registrarLatencia(hb, r.latencia.duracaoTotalCicloMs);
      for (const c of r.challengersComErro) registrarErro(hb, `${c.id}: ${c.erro}`);
      salvarHeartbeat(ROOT, hb);
      latenciasTotais.push(r.latencia.duracaoTotalCicloMs);

      log(`ciclo ok · ${r.challengersRodados.length} challengers · ${r.challengersComErro.length} com erro · champion em ${pnlChampion.toFixed(2)}% · latência ${r.latencia.duracaoTotalCicloMs}ms`);
      for (const l of r.leaderboard.linhas) {
        log(`  ${l.challengerId}: base US$${l.pnlPaperBase.toFixed(3)} · ajustado US$${l.pnlPaperAjustado.toFixed(3)} (${l.retornoPct.toFixed(2)}%) · ${l.trades} trades · incremental ${l.pnlIncremental >= 0 ? '+' : ''}${l.pnlIncremental.toFixed(2)}pp · ${l.nivelEvidencia}`);
      }

      // validação do control a cada ~30min, não todo ciclo (é leitura de
      // arquivo potencialmente grande — barato, mas sem necessidade de
      // repetir a cada 5min)
      if (Date.now() - ultimaValidacao > 30 * 60_000) {
        // janela PERSISTENTE — nunca hb.startedAt (muda a cada reinício).
        // Só reinicia por mudança real de versão do control comparado.
        const janelaValidacao = carregarOuCriarJanelaValidacao(ROOT, CHALLENGER_CONTROL.strategyVersion, CHALLENGER_CONTROL.configVersion);
        ultimaValidacaoResultado = validarControl(ROOT, janelaValidacao.validationStart);
        log(`control_status = ${ultimaValidacaoResultado.status} · fidelidade ${(ultimaValidacaoResultado.fidelidadeDecisoes * 100).toFixed(0)}% (${ultimaValidacaoResultado.decisoesIguais}/${ultimaValidacaoResultado.decisoesComparaveis}) · janela desde ${new Date(janelaValidacao.validationStart).toISOString()} (${janelaValidacao.validationWindowId}) · tipos faltando: ${ultimaValidacaoResultado.tiposDeEventoFaltando.join(', ') || 'nenhum'}`);
        ultimaValidacao = Date.now();
      }

      // Dashboard Aggregator (Parte 22) — o servidor web só lê estes arquivos,
      // nunca recalcula. Recarrega cada estado do disco em vez de plumb-ar o
      // array pelo Orchestrator: mesma leitura barata que o dashboard já fazia
      // pro champion, e mantém o Orchestrator livre de uma responsabilidade
      // que não é dele (rodar challenger != agregar pro dashboard).
      try {
        const estadosAtuais = CHALLENGERS_APROVADOS.map((cfg) => carregarEstado(ROOT, cfg));
        executarAgregacao(ROOT, {
          estados: estadosAtuais, configs: CHALLENGERS_APROVADOS, heartbeat: hb,
          championPnlPct: pnlChampion, validacaoControl: ultimaValidacaoResultado,
        });
      } catch (err) {
        log(`ERRO no dashboard aggregator (ignorado, não afeta os challengers nem o champion): ${(err as Error).message}`);
      }

      const hoje = new Date().toISOString().slice(0, 10);
      if (hoje !== ultimoRelatorio) {
        orch.salvarRelatorioDiario(r.leaderboard);
        ultimoRelatorio = hoje;
        log(`relatório diário salvo em inteligencia/relatorios-diarios/${hoje}.md`);
      }

      if (latenciasTotais.length % 20 === 0 && latenciasTotais.length > 0) {
        const p = percentis(latenciasTotais);
        log(`latência (${latenciasTotais.length} ciclos) — p50=${p.p50}ms p95=${p.p95}ms p99=${p.p99}ms max=${p.max}ms`);
      }
    } catch (err) {
      hb.ciclosComErro++;
      salvarHeartbeat(ROOT, hb);
      log(`ERRO no ciclo do Lab (ignorado, não afeta o champion): ${(err as Error).message}`);
    }

    if (labProvavelmenteParado(hb, INTERVALO_MS)) {
      log('ALERTA: heartbeat indica que o próprio Lab pode estar travado (idade do último ciclo > 3x o intervalo esperado)');
    }
  }

  await ciclo();
  setInterval(ciclo, INTERVALO_MS);
}

main();
