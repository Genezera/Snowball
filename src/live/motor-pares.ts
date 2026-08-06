/**
 * MOTOR DE PARES COINTEGRADOS — ao vivo, papel, mercado-neutro.
 *
 * Pedido explícito do usuário depois de eu identificar, na análise do
 * Resultado 14 (docs/RESULTADOS.md), que a mistura momentum+pares é o único
 * resultado do projeto que melhora sucesso E reduz ruína ao mesmo tempo — e
 * que a parte de pares dessa mistura ainda não roda ao vivo, só em backtest.
 *
 * Por que ESTE mecanismo e não outro inventado na hora: pares cointegrados já
 * passou por descoberta separada de holdout cego (`src/pairs/validado.ts`),
 * com o filtro de meia-vida corrigido depois de um resultado inflado ter sido
 * pego e descartado (ver o histórico completo no cabeçalho de validado.ts).
 * A regra de entrada/saída aqui é a MESMA do backtest validado
 * (`passoZScore`, extraída de `backtestPar` sem alterar a lógica) — só
 * avaliada um passo de cada vez, porque um motor ao vivo não tem "a série
 * inteira", tem o que já aconteceu até agora.
 *
 * Mercado-neutro de verdade: cada posição é DUAS pernas de notional igual
 * (comprado num ativo, vendido no outro), dimensionadas para não depender de
 * pra onde o mercado cripto vai — o lucro vem da distância entre os dois
 * ativos reverter, não de nenhum dos dois subir ou cair.
 *
 * Alavancagem fixa em 1x — o Resultado 14 só validou pares "sempre <1x", e
 * `src/pairs/liquidacao.ts` documenta por que: acima disso, uma fração real
 * dos trades históricos (12,7% a 5x) teria liquidado uma perna no meio do
 * caminho, quebrando a neutralidade.
 *
 * NENHUMA ORDEM É ENVIADA. As exchanges são apenas lidas.
 */
import fs from 'node:fs';
import path from 'node:path';
import ccxt from 'ccxt';
import type { Bar } from '../core/types.ts';
import { avaliarPar, type ParCandidato } from '../pairs/cointegracao.ts';
import { selecionarSemSobreposicao } from '../pairs/portfolio.ts';
import { passoZScore, calcularZ, type PosicaoParEmAndamento } from '../pairs/backtest.ts';
import { PARAMS_PARES, MAX_MEIA_VIDA_PARES, MAX_PARES_MONITORADOS } from '../pairs/validado.ts';
import { UNIVERSO_MOMENTUM } from '../data/momentum-universe.ts';
import { indiceUltimaBarraFechada } from './motor-momentum.ts';
import { ROOT } from '../data/store.ts';

/** Barras diárias buscadas por ativo — o suficiente pra formação (cointegração) e pra manter a janela de z rolando. */
const BARRAS_POR_ATIVO = 250;
/** Recalibra os pares (novo hedgeRatio, nova seleção) a cada N dias — não a cada ciclo, pra não reagir a ruído de curto prazo. */
const RECALIBRA_A_CADA_DIAS = 7;
/** Validado como o limite seguro — ver liquidacao.ts. Pares sempre a 1x. */
const ALAVANCAGEM_PARES = 1;

export interface ParSelecionado extends ParCandidato {
  calibradoEm: number;
}

export interface PosicaoPar {
  a: string;
  b: string;
  direcao: 'longA' | 'curtoA';
  hedgeRatio: number;
  intercepto: number;
  residuoEntrada: number;
  precoEntradaA: number;
  precoEntradaB: number;
  notionalPorPerna: number;
  zEntrada: number;
  abertaBarT: number;
  abertaEm: number;
  barrasDentro: number;
}

export interface EstadoPares {
  iniciadoEm: number;
  capital: number;
  capitalInicial: number;
  pico: number;
  pares: ParSelecionado[];
  ultimaCalibracao: number;
  posicoes: PosicaoPar[];
  fechados: number;
  vitorias: number;
  custosTotal: number;
  pnlAcumulado: number;
  halted: boolean;
  haltReason?: string;
  ultimaBarraGlobal: number;
  ultimoCicloTs?: number;
}

export interface OpcoesPares {
  capital: number;
  riscoPorPosicao: number;
  exchange: string;
  maxDrawdownStop: number;
}

export const OPCOES_PADRAO: OpcoesPares = {
  capital: 200,
  // 5% — o ponto que o Resultado 14 (portfólio misto, bootstrap por bloco de
  // calendário) validou pra pares: corta a chance de ruína do portfólio
  // combinado de 46% pra 15% mantendo a chance de sucesso quase igual.
  riscoPorPosicao: 0.05,
  exchange: 'binanceusdm',
  maxDrawdownStop: 0.20,
};

/**
 * Calcula o resíduo (log A − log B ajustado) de uma barra, dado o
 * hedgeRatio/intercepto FIXOS da última calibração — nunca recalculados a
 * cada barra, pelo mesmo motivo documentado em backtest.ts: recalibrar com
 * dado que ainda não existia na hora seria olhar o futuro.
 */
function residuoDaBarra(precoA: number, precoB: number, hedgeRatio: number, intercepto: number): number {
  return Math.log(precoA) - (hedgeRatio * Math.log(precoB) + intercepto);
}

export class MotorPares {
  private o: OpcoesPares;
  private estado: EstadoPares;
  private stateFile: string;
  private journalFile: string;
  private ex: any;
  private barsCache = new Map<string, Bar[]>();

  constructor(o: Partial<OpcoesPares> = {}) {
    this.o = { ...OPCOES_PADRAO, ...o };
    const dir = path.join(ROOT, 'pares');
    fs.mkdirSync(dir, { recursive: true });
    this.stateFile = path.join(dir, 'estado.json');
    this.journalFile = path.join(dir, 'diario.jsonl');
    this.estado = this.carregar();
  }

  private carregar(): EstadoPares {
    if (fs.existsSync(this.stateFile)) {
      const s = JSON.parse(fs.readFileSync(this.stateFile, 'utf8')) as EstadoPares;
      this.log(`estado recuperado: US$ ${s.capital.toFixed(2)} · ${s.pares.length} pares · ${s.posicoes.length} posições abertas · ${s.fechados} fechados`);
      return s;
    }
    const agora = Date.now();
    return {
      iniciadoEm: agora, capital: this.o.capital, capitalInicial: this.o.capital,
      pico: this.o.capital, pares: [], ultimaCalibracao: 0, posicoes: [],
      fechados: 0, vitorias: 0, custosTotal: 0, pnlAcumulado: 0, halted: false,
      ultimaBarraGlobal: 0,
    };
  }

  private salvar() { fs.writeFileSync(this.stateFile, JSON.stringify(this.estado, null, 2)); }
  private log(m: string) { console.log(`[${new Date().toISOString().slice(0, 19)}] ${m}`); }
  private diario(evento: string, extra: Record<string, unknown> = {}) {
    fs.appendFileSync(this.journalFile, JSON.stringify({ ts: Date.now(), evento, ...extra }) + '\n');
  }

  async init() {
    const Ex = (ccxt as any)[this.o.exchange];
    this.ex = new Ex({ enableRateLimit: true });
    await this.ex.loadMarkets();
    this.log(
      `motor de pares pronto · US$ ${this.estado.capital.toFixed(2)} · ${UNIVERSO_MOMENTUM.length} ativos no universo · ` +
      `risco ${(this.o.riscoPorPosicao * 100).toFixed(1)}%/posição · alavancagem ${ALAVANCAGEM_PARES}x`,
    );
    if (!fs.existsSync(this.journalFile)) this.diario('init', { capital: this.estado.capital, opcoes: this.o });
  }

  private async barrasDe(symbol: string): Promise<Bar[] | null> {
    try {
      const raw: number[][] = await this.ex.fetchOHLCV(symbol, '1d', undefined, BARRAS_POR_ATIVO);
      const bars: Bar[] = raw.map((r) => ({ t: r[0], o: r[1], h: r[2], l: r[3], c: r[4], v: r[5] }));
      this.barsCache.set(symbol, bars);
      return bars;
    } catch (e) {
      this.log(`falha lendo ${symbol}: ${(e as Error).message.slice(0, 80)}`);
      return null;
    }
  }

  /**
   * Recalibra a lista de pares: busca as séries de todo o universo, roda a
   * descoberta de cointegração (mesma lógica de `varrerPares`, mas usando o
   * cache já buscado neste ciclo em vez de reler do zero) e seleciona sem
   * sobreposição de perna, exatamente como `validado.ts` faz em backtest.
   *
   * As posições já ABERTAS continuam com o hedgeRatio/intercepto que tinham
   * na entrada — recalibrar não muda posição em andamento, só a lista de
   * pares candidatos a novas entradas.
   */
  private recalibrar() {
    const candidatos: ParCandidato[] = [];
    const nomes = [...this.barsCache.keys()];
    for (let i = 0; i < nomes.length; i++) {
      for (let j = i + 1; j < nomes.length; j++) {
        const a = nomes[i], b = nomes[j];
        const barsA = this.barsCache.get(a)!, barsB = this.barsCache.get(b)!;
        const c = avaliarPar(a, barsA, b, barsB);
        if (c && c.meiaVidaBarras <= MAX_MEIA_VIDA_PARES) candidatos.push(c);
      }
    }
    candidatos.sort((x, y) => x.meiaVidaBarras - y.meiaVidaBarras);
    const selecionados = selecionarSemSobreposicao(candidatos, MAX_PARES_MONITORADOS);
    const agora = Date.now();
    this.estado.pares = selecionados.map((c) => ({ ...c, calibradoEm: agora }));
    this.estado.ultimaCalibracao = agora;
    this.log(`recalibrado: ${candidatos.length} candidatos → ${selecionados.length} pares selecionados (sem sobreposição de ativo)`);
    this.diario('recalibra', { candidatos: candidatos.length, selecionados: selecionados.map((p) => `${p.a}|${p.b}`) });
  }

  /** Um ciclo: garante calibração, processa barra fechada nova de cada par (posições + novas entradas). */
  async ciclo() {
    if (this.estado.halted) { this.log(`parado: ${this.estado.haltReason}`); return; }

    const agora = Date.now();

    // 1. garante que todo símbolo relevante (universo inteiro, pra achar novos pares) tem barra fresca
    let processadosUniverso = 0;
    for (const symbol of UNIVERSO_MOMENTUM) {
      const bars = await this.barrasDe(symbol);
      if (bars && bars.length >= 70) processadosUniverso++;
    }
    if (processadosUniverso < 2) { this.log('universo insuficiente neste ciclo — pulando'); return; }

    // 2. recalibra periodicamente, ou na primeira vez
    const diasDesdeCalibracao = (agora - this.estado.ultimaCalibracao) / 86_400_000;
    if (this.estado.pares.length === 0 || diasDesdeCalibracao >= RECALIBRA_A_CADA_DIAS) {
      this.recalibrar();
    }

    // 3. verifica se há barra fechada NOVA (mesmo bug de bar-close do momentum se aplicaria aqui)
    const referencia = this.barsCache.get(this.estado.pares[0]?.a) ?? this.barsCache.get(UNIVERSO_MOMENTUM[0]);
    if (!referencia) return;
    const step = 86_400_000;
    const iRef = indiceUltimaBarraFechada(referencia, agora, step);
    if (iRef < 0) { this.log('nenhuma barra fechada ainda'); return; }
    const tBarraFechada = referencia[iRef].t;
    if (tBarraFechada <= this.estado.ultimaBarraGlobal) { this.log('ciclo · sem barra nova'); return; }
    this.estado.ultimaBarraGlobal = tBarraFechada;

    let abertas = 0, fechadas = 0, bloqueadas = 0;

    // 4. circuit breaker de portfólio
    const ddPico = (this.estado.pico - this.estado.capital) / this.estado.pico;
    if (ddPico >= this.o.maxDrawdownStop) {
      this.estado.halted = true;
      this.estado.haltReason = `drawdown ${(ddPico * 100).toFixed(1)}% atingiu o limite de ${(this.o.maxDrawdownStop * 100).toFixed(0)}%`;
      this.log(`### MOTOR DE PARES DESLIGADO: ${this.estado.haltReason}`);
      this.diario('halted', { motivo: this.estado.haltReason });
      this.salvar();
      return;
    }

    // 5. gerencia posições abertas
    for (let idx = this.estado.posicoes.length - 1; idx >= 0; idx--) {
      const pos = this.estado.posicoes[idx];
      const barsA = this.barsCache.get(pos.a), barsB = this.barsCache.get(pos.b);
      if (!barsA || !barsB) continue;
      const iA = indiceUltimaBarraFechada(barsA, agora, step), iB = indiceUltimaBarraFechada(barsB, agora, step);
      if (iA < 0 || iB < 0) continue;

      const janela = this.janelaResiduo(barsA, iA, barsB, iB, pos.hedgeRatio, pos.intercepto);
      pos.barrasDentro++;
      const emAndamento: PosicaoParEmAndamento = { direcao: pos.direcao, barrasDentro: pos.barrasDentro };
      const decisao = passoZScore(janela, emAndamento, PARAMS_PARES);
      if (decisao.acao === 'fechar') {
        this.fecharPosicao(idx, barsA[iA].c, barsB[iB].c, decisao.motivo);
        fechadas++;
      }
    }

    // 6. avalia novas entradas nos pares calibrados que ainda não têm posição
    for (const par of this.estado.pares) {
      if (this.estado.posicoes.some((p) => p.a === par.a && p.b === par.b)) continue;
      const barsA = this.barsCache.get(par.a), barsB = this.barsCache.get(par.b);
      if (!barsA || !barsB) continue;
      const iA = indiceUltimaBarraFechada(barsA, agora, step), iB = indiceUltimaBarraFechada(barsB, agora, step);
      if (iA < 0 || iB < 0) continue;

      const janela = this.janelaResiduo(barsA, iA, barsB, iB, par.hedgeRatio, par.intercepto);
      const decisao = passoZScore(janela, null, PARAMS_PARES);
      if (decisao.acao !== 'abrir') continue;

      const notionalPorPerna = (this.estado.capital * this.o.riscoPorPosicao) / 2 * ALAVANCAGEM_PARES;
      if (notionalPorPerna * 2 < 10) { bloqueadas++; continue; } // abaixo de qualquer noção de tamanho mínimo operável

      this.abrirPosicao(par, decisao.direcao, barsA[iA], barsB[iB], notionalPorPerna, janela[janela.length - 1]);
      abertas++;
    }

    this.estado.ultimoCicloTs = agora;
    this.salvar();
    this.log(
      `ciclo · ${this.estado.pares.length} pares calibrados · ${abertas} abertas · ${fechadas} fechadas` +
      (bloqueadas ? ` · ${bloqueadas} bloqueadas` : '') +
      ` · capital US$ ${this.estado.capital.toFixed(2)} · ${this.estado.posicoes.length} posições abertas`,
    );
  }

  /** Janela rolante de resíduo (janelaZ+1 pontos, terminando na barra fechada mais recente) pro par A/B com hedge fixo. */
  private janelaResiduo(barsA: Bar[], iA: number, barsB: Bar[], iB: number, hedgeRatio: number, intercepto: number): number[] {
    const n = PARAMS_PARES.janelaZ;
    const out: number[] = [];
    for (let k = n; k >= 0; k--) {
      const ia = iA - k, ib = iB - k;
      if (ia < 0 || ib < 0) continue;
      out.push(residuoDaBarra(barsA[ia].c, barsB[ib].c, hedgeRatio, intercepto));
    }
    return out;
  }

  private abrirPosicao(
    par: ParSelecionado, direcao: 'longA' | 'curtoA',
    barA: Bar, barB: Bar, notionalPorPerna: number, residuoAtual: number,
  ) {
    const slip = 0.0002;
    const precoEntradaA = direcao === 'curtoA' ? barA.c * (1 - slip) : barA.c * (1 + slip);
    const precoEntradaB = direcao === 'curtoA' ? barB.c * (1 + slip) : barB.c * (1 - slip);
    const custo = notionalPorPerna * 2 * PARAMS_PARES.taxaTaker;

    const pos: PosicaoPar = {
      a: par.a, b: par.b, direcao, hedgeRatio: par.hedgeRatio, intercepto: par.intercepto,
      residuoEntrada: residuoAtual, precoEntradaA, precoEntradaB, notionalPorPerna,
      zEntrada: calcularZ(this.janelaResiduo(
        this.barsCache.get(par.a)!, indiceUltimaBarraFechada(this.barsCache.get(par.a)!, Date.now()),
        this.barsCache.get(par.b)!, indiceUltimaBarraFechada(this.barsCache.get(par.b)!, Date.now()),
        par.hedgeRatio, par.intercepto,
      )).z,
      abertaBarT: barA.t, abertaEm: Date.now(), barrasDentro: 0,
    };
    this.estado.posicoes.push(pos);
    this.estado.capital -= custo;
    this.estado.custosTotal += custo;

    const nomeA = par.a.replace('/USDT:USDT', ''), nomeB = par.b.replace('/USDT:USDT', '');
    this.log(
      `ABRE ${direcao === 'curtoA' ? `venda ${nomeA} / compra ${nomeB}` : `compra ${nomeA} / venda ${nomeB}`} · ` +
      `notional US$ ${notionalPorPerna.toFixed(2)}/perna · z entrada ${pos.zEntrada.toFixed(2)} · meia-vida ${par.meiaVidaBarras.toFixed(1)}d`,
    );
    this.diario('abre', {
      a: par.a, b: par.b, direcao, notionalPorPerna, zEntrada: pos.zEntrada, meiaVidaBarras: par.meiaVidaBarras,
    });
  }

  private fecharPosicao(idx: number, precoAtualA: number, precoAtualB: number, motivo: string) {
    const pos = this.estado.posicoes[idx];
    const slip = 0.0002;
    const fillA = pos.direcao === 'curtoA' ? precoAtualA * (1 + slip) : precoAtualA * (1 - slip);
    const fillB = pos.direcao === 'curtoA' ? precoAtualB * (1 - slip) : precoAtualB * (1 + slip);

    const residuoSaida = residuoDaBarra(fillA, fillB, pos.hedgeRatio, pos.intercepto);
    const deltaSpread = residuoSaida - pos.residuoEntrada;
    // longA: apostou que A subiria em relação a B (resíduo subindo é bom); curtoA: o oposto
    const brutoFracao = pos.direcao === 'longA' ? deltaSpread : -deltaSpread;
    const custoSaida = pos.notionalPorPerna * 2 * PARAMS_PARES.taxaTaker;
    const pnl = brutoFracao * (pos.notionalPorPerna * 2) - custoSaida;

    this.estado.capital += pnl;
    this.estado.custosTotal += custoSaida;
    this.estado.pnlAcumulado += pnl;
    this.estado.pico = Math.max(this.estado.pico, this.estado.capital);
    this.estado.fechados++;
    if (pnl > 0) this.estado.vitorias++;
    this.estado.posicoes.splice(idx, 1);

    const nomeA = pos.a.replace('/USDT:USDT', ''), nomeB = pos.b.replace('/USDT:USDT', '');
    this.log(
      `FECHA ${nomeA}/${nomeB} (${motivo}) · pnl US$ ${pnl.toFixed(3)} · capital US$ ${this.estado.capital.toFixed(2)} · ` +
      `${this.estado.fechados} trades · ${((this.estado.vitorias / this.estado.fechados) * 100).toFixed(1)}% vitórias`,
    );
    this.diario('fecha', { a: pos.a, b: pos.b, direcao: pos.direcao, motivo, pnl, capital: this.estado.capital });
  }

  getEstado(): EstadoPares { return { ...this.estado, posicoes: [...this.estado.posicoes], pares: [...this.estado.pares] }; }
}
