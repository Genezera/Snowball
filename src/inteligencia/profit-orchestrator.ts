/**
 * PROFIT EXPERIMENT ORCHESTRATOR — roda os challengers aprovados, um ciclo
 * por vez, sobre o MESMO feed e o MESMO snapshot de preço (Parte 7: "todos
 * os challengers deverão utilizar o mesmo snapshot de preço por ciclo").
 *
 * Isolamento do champion, inalterado desde a v1:
 *   - lê `lerVigilancia()` (mesmo arquivo que o champion lê) — READ ONLY
 *   - nunca importa nem toca `MotorSpread`, nunca abre `spread/estado.json`
 *     para escrita
 *   - preço vem de `fetchTicker` via ccxt — mesma classe de chamada que
 *     qualquer leitor de mercado faz, nunca uma ordem
 *   - cada challenger roda dentro do próprio try/catch
 */
import ccxt from 'ccxt';
import { lerVigilancia } from '../funding/ponte.ts';
import { lerCaptura } from '../funding/ponte-captura.ts';
import {
  cicloChallenger, carregarEstado, salvarEstado, caminhoDiario,
  novosEventosParaDiario, formatarLinhasDiario, type EstadoVirtual, type ConfigChallenger,
} from './virtual-portfolio.ts';
import { cicloCaptura } from './virtual-captura.ts';
import { montarLeaderboard, salvarLeaderboard, type Leaderboard } from './leaderboard.ts';
import { gerarRelatorioDiario, formatarMarkdown } from './llm-profit-analyst.ts';
import { CHALLENGERS_APROVADOS } from './challengers.ts';
import {
  BASELINES_APROVADOS, cicloBaseline, resumirBaseline, carregarEstadoBaseline, salvarEstadoBaseline,
  type ResumoBaseline,
} from './baselines.ts';
import { lerMomentumAdaptado, lerParesAdaptado } from './adaptador-motores-existentes.ts';
import { montarLeaderboardMulti, salvarLeaderboardMulti } from './leaderboard-multi.ts';
import fs from 'node:fs';
import path from 'node:path';

export interface LatenciaCiclo {
  duracaoTotalCicloMs: number;
  duracaoLeituraFeedMs: number;
  duracaoFetchPrecosMs: number;
  duracaoPorChallengerMs: Record<string, number>;
  duracaoLeaderboardMs: number;
  duracaoEscritaMs: number;
  precoSnapshotTs: number;
  idadePrecoMs: number;
}

export interface ResultadoCiclo {
  ts: number;
  challengersRodados: string[];
  challengersComErro: { id: string; erro: string }[];
  leaderboard: Leaderboard;
  latencia: LatenciaCiclo;
  /** funil deste ciclo (Parte 9/22 do dashboard) — quem chama acumula no heartbeat, este objeto é só o incremento */
  funilCiclo: { teveCandidata: boolean; observadas: number };
}

export class ProfitOrchestrator {
  private exs = new Map<string, any>();
  private root: string;
  private configs: ConfigChallenger[];
  constructor(root: string, configs: ConfigChallenger[] = CHALLENGERS_APROVADOS) {
    this.root = root;
    this.configs = configs;
  }

  private async ex(id: string) {
    if (!this.exs.has(id)) {
      const e = new (ccxt as any)[id]({ enableRateLimit: true });
      await e.loadMarkets();
      this.exs.set(id, e);
    }
    return this.exs.get(id);
  }

  // ── mesmo snapshot de preço pra todos os challengers do ciclo (Parte 7) ──
  private snapshotPreco = new Map<string, number>();
  private snapshotTs = 0;
  private async precoSnapshot(exchange: string, symbol: string): Promise<number> {
    const chave = `${exchange}|${symbol}`;
    if (this.snapshotPreco.has(chave)) return this.snapshotPreco.get(chave)!;
    const e = await this.ex(exchange);
    const t = await e.fetchTicker(symbol);
    const valor = t.last ?? t.close;
    this.snapshotPreco.set(chave, valor);
    return valor;
  }

  /**
   * Grava em `inteligencia/challengers/<id>/diario.jsonl` só as decisões
   * NOVAS deste ciclo — identificadas por `sequenceNumber` (monotônico por
   * challenger), NUNCA só por `ts`. Dois eventos no mesmo milissegundo têm
   * `ts` igual mas `sequenceNumber` diferente, então nunca colidem; e
   * `sequenceNumber` sobrevive ao splice() do array de 200 decisões, porque
   * é atribuído uma vez em `registrar()` e nunca reatribuído depois.
   *
   * `eventId` = "<challengerId>-<sequenceNumber>" — determinístico,
   * suficiente pra deduplicar do lado de quem lê sem precisar de UUID.
   * `cycleId` identifica de qual chamada de `ciclo()` do orquestrador este
   * lote de eventos veio (mesmo cycleId pra todo challenger processado no
   * mesmo ciclo) — não é o cycleId interno de cada decisão individual
   * (aquele não existe hoje dentro de cicloChallenger/cicloCaptura), é o
   * cycleId do ORQUESTRADOR, que é o nível em que esta função já opera.
   *
   * Nunca lança: falha de disco aqui não pode derrubar o ciclo do
   * challenger, que já rodou e já foi salvo em estado.json.
   */
  private gravarNovasDecisoesNoDiario(challengerId: string, estado: EstadoVirtual, ultimoSequenceAntes: number, cycleId: string): void {
    try {
      const novas = novosEventosParaDiario(estado.decisoes, ultimoSequenceAntes);
      if (!novas.length) return;
      const linhasObj = formatarLinhasDiario(novas, challengerId, cycleId, estado.capitalInicialVirtual + estado.pnlRealizado);
      const p = caminhoDiario(this.root, challengerId);
      fs.mkdirSync(path.dirname(p), { recursive: true });
      fs.appendFileSync(p, linhasObj.map((l) => JSON.stringify(l)).join('\n') + '\n');
    } catch { /* nunca bloqueia o ciclo por causa de log */ }
  }

  async ciclo(championPnlPct: number): Promise<ResultadoCiclo> {
    const t0 = Date.now();
    // cycleId do ORQUESTRADOR — mesmo valor pra todo challenger processado
    // nesta chamada de ciclo(), grava junto de cada evento no diário
    const cycleId = `orch-${t0}`;
    this.snapshotPreco.clear();
    this.snapshotTs = Date.now();

    const tFeed0 = Date.now();
    const v = lerVigilancia(3);
    const ops = v.disponivel ? v.oportunidades : [];
    // feed de captura (Parte 2/3 desta etapa) — arquivo PRÓPRIO
    // (vigilancia/captura.json), lido uma vez por ciclo e compartilhado só
    // entre os challengers com tipo:'captura', igual `ops` acima é
    // compartilhado só entre os de persistência
    const capturaFeed = lerCaptura();
    const candidatosCaptura = capturaFeed.disponivel ? capturaFeed.candidatos : [];
    const duracaoLeituraFeedMs = Date.now() - tFeed0;

    const challengersRodados: string[] = [];
    const challengersComErro: { id: string; erro: string }[] = [];
    const estados: EstadoVirtual[] = [];
    const duracaoPorChallengerMs: Record<string, number> = {};
    let duracaoFetchPrecosMs = 0;

    for (const cfg of this.configs) {
      const tC0 = Date.now();
      const estado = carregarEstado(this.root, cfg);
      // sequenceNumber do ÚLTIMO evento já existente antes deste ciclo —
      // usado pra achar o que é novo depois. NUNCA `ts`: dois eventos no
      // mesmo milissegundo (comum quando funding+fecha disparam juntos, ver
      // virtual-captura.ts) são indistinguíveis por timestamp, e o cap de
      // 200 no array (splice()) quebraria qualquer diff por índice.
      const ultimoSequenceAntes = estado.decisoes.length ? estado.decisoes[estado.decisoes.length - 1].sequenceNumber : 0;
      try {
        const buscarPrecoContado = async (ex: string, sym: string) => {
          const tP0 = Date.now();
          const p = await this.precoSnapshot(ex, sym);
          duracaoFetchPrecosMs += Date.now() - tP0;
          return p;
        };
        if (cfg.tipo === 'captura') {
          await cicloCaptura(this.root, cfg, estado, candidatosCaptura, buscarPrecoContado);
        } else {
          await cicloChallenger(cfg, estado, ops, buscarPrecoContado);
        }
        challengersRodados.push(cfg.challengerId);
        // CORREÇÃO (achada auditando fidelidade 0% de validarControl — o
        // arquivo que ela lê nunca era escrito): `registrar()` só empilha em
        // `e.decisoes` (array em memória, cap de 200, persistido dentro de
        // estado.json). `caminhoDiario()` sempre existiu mas nada gravava
        // nele — `validarControl()` comparava o champion contra um arquivo
        // que nunca tinha uma linha sequer, garantindo 0% de fidelidade
        // independente da qualidade real das decisões do control. Aqui só
        // grava o INCREMENTO desta rodada (decisões novas desde antes deste
        // ciclo), sem duplicar o que `e.decisoes` já mostra internamente.
        this.gravarNovasDecisoesNoDiario(cfg.challengerId, estado, ultimoSequenceAntes, cycleId);
      } catch (err) {
        estado.eliminado = { ts: Date.now(), motivo: `erro não tratado: ${(err as Error).message}` };
        challengersComErro.push({ id: cfg.challengerId, erro: (err as Error).message });
      }
      const tEsc0 = Date.now();
      salvarEstado(this.root, estado);
      duracaoPorChallengerMs[cfg.challengerId] = Date.now() - tC0 - (Date.now() - tEsc0); // exclui escrita, contada à parte
      estados.push(estado);
    }

    const tLb0 = Date.now();
    const leaderboard = montarLeaderboard(estados, championPnlPct, this.configs);
    const duracaoLeaderboardMs = Date.now() - tLb0;

    const tEsc0 = Date.now();
    salvarLeaderboard(this.root, leaderboard);
    const duracaoEscritaMs = Date.now() - tEsc0;

    // ── baselines (Parte 5 da auditoria) — mesmo snapshot de preço do
    // ciclo, contabilidade PRÓPRIA (não é EstadoVirtual, ver baselines.ts) ──
    const resumosBaseline: ResumoBaseline[] = [];
    for (const cfgB of BASELINES_APROVADOS) {
      const eB = carregarEstadoBaseline(this.root, cfgB);
      try {
        await cicloBaseline(cfgB, eB, (ex, sym) => this.precoSnapshot(ex, sym));
      } catch { /* preço indisponível neste ciclo — tenta de novo no próximo */ }
      const precos: Record<string, number> = {};
      for (const ativo of cfgB.ativos) {
        const v = this.snapshotPreco.get(`${ativo.exchange}|${ativo.symbol}`);
        if (v != null) precos[`${ativo.exchange}|${ativo.symbol}`] = v;
      }
      resumosBaseline.push(resumirBaseline(cfgB, eB, precos));
      salvarEstadoBaseline(this.root, eB);
    }

    // ── leaderboard multi-strategy (Parte 1/9) — junta champion, Lab,
    // baselines e os adaptadores read-only de momentum/pares ──
    let championEstadoAtual: { iniciadoEm?: number; capital?: number; capitalInicial?: number } | null = null;
    try {
      championEstadoAtual = JSON.parse(fs.readFileSync(path.join(this.root, 'spread', 'estado.json'), 'utf8'));
    } catch { /* champion ainda não escreveu, ou arquivo momentaneamente ilegível — sem fallback fabricado */ }
    const leaderboardMulti = montarLeaderboardMulti(
      championEstadoAtual, leaderboard, resumosBaseline,
      lerMomentumAdaptado(this.root), lerParesAdaptado(this.root),
    );
    salvarLeaderboardMulti(this.root, leaderboardMulti);

    const latencia: LatenciaCiclo = {
      duracaoTotalCicloMs: Date.now() - t0,
      duracaoLeituraFeedMs, duracaoFetchPrecosMs, duracaoPorChallengerMs,
      duracaoLeaderboardMs, duracaoEscritaMs,
      precoSnapshotTs: this.snapshotTs, idadePrecoMs: Date.now() - this.snapshotTs,
    };

    return {
      ts: Date.now(), challengersRodados, challengersComErro, leaderboard, latencia,
      // soma os dois feeds — persistência e captura são funis distintos, mas
      // "observadas" no heartbeat é uma contagem agregada de todo o Lab
      funilCiclo: { teveCandidata: ops.length > 0 || candidatosCaptura.length > 0, observadas: ops.length + candidatosCaptura.length },
    };
  }

  salvarRelatorioDiario(lb: Leaderboard) {
    const r = gerarRelatorioDiario(lb);
    const dir = path.join(this.root, 'inteligencia', 'relatorios-diarios');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `${r.data}.md`), formatarMarkdown(r));
    return r;
  }
}

/** Percentis simples sobre uma amostra de latências acumuladas — p50/p95/p99/max (Parte 7). */
export function percentis(amostra: number[]): { p50: number; p95: number; p99: number; max: number } {
  if (!amostra.length) return { p50: 0, p95: 0, p99: 0, max: 0 };
  const s = [...amostra].sort((a, b) => a - b);
  const at = (p: number) => s[Math.min(s.length - 1, Math.floor(p * s.length))];
  return { p50: at(0.5), p95: at(0.95), p99: at(0.99), max: s[s.length - 1] };
}
