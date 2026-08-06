/**
 * MODO AGRESSIVO — ts-momentum ao vivo, papel, multi-ativo.
 *
 * Pedido explícito do usuário: um segundo modo de operação, mais agressivo,
 * rodando em paralelo ao motor delta-neutro (que continua no ar do jeito que
 * está), também só coletando dado (paper), também aparecendo no dashboard.
 *
 * Por que ESTA estratégia e não outra nova inventada na hora: é a única, de
 * sete famílias testadas neste projeto, que sobreviveu a holdout cego com
 * significância real (p=0,008 — ver Resultado 6 e 10 em docs/RESULTADOS.md).
 * "Agressivo" aqui significa "usa a única vantagem estatística real que o
 * projeto mediu, com risco por posição escolhido no ponto que os 20 mil
 * caminhos de bootstrap por blocos mostraram ser o mais defensável" — não
 * "inventar um mecanismo novo sem holdout" (isso seria repetir o erro nº 1
 * que este projeto já cometeu, com o `body-breakout`).
 *
 * NÃO é "lucro diário garantido". A própria estratégia tem frequência real de
 * ~26-34 trades/ano POR ATIVO — o que gera movimento diário aqui não é cada
 * ativo operando toda hora, é o PORTFÓLIO inteiro (até ~57 posições ao mesmo
 * tempo, medido no Resultado 12) tendo curva de equity que se move todo dia
 * porque sempre tem alguma coisa aberta em algum lugar.
 *
 * Modelo de risco: fração PEQUENA e FIXA do capital por posição no momento em
 * que ela abre — não dividida por quantas estão abertas, não recalculada. É o
 * modelo que o bootstrap por blocos (Resultado 12) validou como o real: tratar
 * dezenas de posições correlacionadas como se fossem sorteios independentes
 * (o erro do Resultado 11) infla o resultado de forma otimista.
 *
 * NENHUMA ORDEM É ENVIADA. As exchanges são apenas lidas.
 */
import fs from 'node:fs';
import path from 'node:path';
import ccxt from 'ccxt';
import type { Bar, Side } from '../core/types.ts';
import { tsMomentum } from '../strategies/index.ts';
import { sizePosition } from '../backtest/engine.ts';
import { COSTS } from '../config.ts';
import { ROOT } from '../data/store.ts';
import { UNIVERSO_MOMENTUM, PARAMS_VALIDADOS, MAX_BARS_VALIDADO } from '../data/momentum-universe.ts';

export interface PosicaoMomentum {
  symbol: string;
  side: Side;
  entryPrice: number;
  qty: number;
  notional: number;
  stopPrice: number;
  takePrice: number;
  abertaEm: number;
  abertaBarT: number;
  precoUltimo?: number;
}

export interface EstadoMomentum {
  iniciadoEm: number;
  capital: number;
  capitalInicial: number;
  pico: number;
  posicoes: PosicaoMomentum[];
  fechados: number;
  vitorias: number;
  custosTotal: number;
  pnlAcumulado: number;
  halted: boolean;
  haltReason?: string;
  dayKey: number;
  dayStartEquity: number;
  /** última barra diária (epoch ms do abrir) já processada, por ativo */
  ultimaBarra: Record<string, number>;
}

export interface OpcoesMomentum {
  capital: number;
  riscoPorPosicao: number;
  alavancagemMaxima: number;
  exchange: string;
  costPreset: string;
  dailyLossLimit: number;
  maxDrawdownStop: number;
}

/**
 * Decide se uma posição sai NESTA barra, e por quê. Pura — não mexe em
 * estado, só olha o range da barra contra os níveis da posição. Extraída da
 * classe para poder testar sem precisar de rede (ccxt) nem de um motor
 * inteiro instanciado.
 */
export function avaliarSaida(
  pos: { side: Side; stopPrice: number; takePrice: number; abertaBarT: number },
  bar: Bar, maxBarsInTrade: number, stepMs = 86_400_000,
): { exitPrice: number; reason: 'stop' | 'take' | 'timeout' } | null {
  const barsHeld = Math.round((bar.t - pos.abertaBarT) / stepMs);
  const hitStop = pos.side === 'long' ? bar.l <= pos.stopPrice : bar.h >= pos.stopPrice;
  const hitTake = pos.side === 'long' ? bar.h >= pos.takePrice : bar.l <= pos.takePrice;
  // mesma regra do motor de backtest principal (engine.ts): quando a mesma
  // barra toca stop E alvo, sem dado de tick não dá pra saber a ordem, e o
  // erro otimista (assumir o alvo) é o único que quebra conta de verdade.
  if (hitStop) return { exitPrice: pos.stopPrice, reason: 'stop' };
  if (hitTake) return { exitPrice: pos.takePrice, reason: 'take' };
  if (barsHeld >= maxBarsInTrade) return { exitPrice: bar.c, reason: 'timeout' };
  return null;
}

/** PnL líquido de fechar uma posição a `refPrice`, com slippage e taxa de saída. */
export function calcularFechamento(
  pos: { side: Side; entryPrice: number; qty: number },
  refPrice: number, taxaSaida: number, slip = 0.0002,
): { fill: number; pnl: number; exitFee: number } {
  const fill = pos.side === 'long' ? refPrice * (1 - slip) : refPrice * (1 + slip);
  const gross = pos.side === 'long' ? (fill - pos.entryPrice) * pos.qty : (pos.entryPrice - fill) * pos.qty;
  const exitFee = fill * pos.qty * taxaSaida;
  return { fill, pnl: gross - exitFee, exitFee };
}

export const OPCOES_PADRAO: OpcoesMomentum = {
  capital: 200,
  // 0,5% por posição — o ponto que o bootstrap por blocos (Resultado 12,
  // src/backtest/bootstrap-concorrente.ts) mediu como o mais defensável
  // depois de corrigir pela concorrência REAL entre posições (não o 5% do
  // Resultado 11, que ignorava a correlação de +0,13 entre trades abertos ao
  // mesmo tempo e por isso era otimista).
  riscoPorPosicao: 0.005,
  alavancagemMaxima: 2,
  exchange: 'binanceusdm',
  // taker, não maker — a sessão de hoje confirmou (Resultado 16) que o preset
  // maker é otimista sem medição de preenchimento real.
  costPreset: 'binance-futures',
  dailyLossLimit: 0.05,
  maxDrawdownStop: 0.20,
};

export class MotorMomentum {
  private o: OpcoesMomentum;
  private estado: EstadoMomentum;
  private stateFile: string;
  private journalFile: string;
  private ex: any;
  private barsCache = new Map<string, Bar[]>();
  private estrategia = tsMomentum(PARAMS_VALIDADOS);

  constructor(o: Partial<OpcoesMomentum> = {}) {
    this.o = { ...OPCOES_PADRAO, ...o };
    const dir = path.join(ROOT, 'momentum');
    fs.mkdirSync(dir, { recursive: true });
    this.stateFile = path.join(dir, 'estado.json');
    this.journalFile = path.join(dir, 'diario.jsonl');
    this.estado = this.carregar();
  }

  private carregar(): EstadoMomentum {
    if (fs.existsSync(this.stateFile)) {
      const s = JSON.parse(fs.readFileSync(this.stateFile, 'utf8')) as EstadoMomentum;
      this.log(`estado recuperado: US$ ${s.capital.toFixed(2)} · ${s.posicoes.length} posições · ${s.fechados} fechados`);
      return s;
    }
    const agora = Date.now();
    return {
      iniciadoEm: agora, capital: this.o.capital, capitalInicial: this.o.capital,
      pico: this.o.capital, posicoes: [], fechados: 0, vitorias: 0,
      custosTotal: 0, pnlAcumulado: 0, halted: false,
      dayKey: Math.floor(agora / 86_400_000), dayStartEquity: this.o.capital,
      ultimaBarra: {},
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
      `motor momentum pronto · US$ ${this.estado.capital.toFixed(2)} · ${UNIVERSO_MOMENTUM.length} ativos · ` +
      `risco ${(this.o.riscoPorPosicao * 100).toFixed(2)}%/posição · ${this.estrategia.name}`,
    );
    if (!fs.existsSync(this.journalFile)) this.diario('init', { capital: this.estado.capital, opcoes: this.o });
  }

  private async barrasDe(symbol: string): Promise<Bar[] | null> {
    try {
      const need = PARAMS_VALIDADOS.lookback + 30;
      const raw: number[][] = await this.ex.fetchOHLCV(symbol, '1d', undefined, need);
      const bars: Bar[] = raw.map((r) => ({ t: r[0], o: r[1], h: r[2], l: r[3], c: r[4], v: r[5] }));
      this.barsCache.set(symbol, bars);
      return bars;
    } catch (e) {
      this.log(`falha lendo ${symbol}: ${(e as Error).message.slice(0, 80)}`);
      return null;
    }
  }

  /** Um ciclo: para cada ativo do universo, processa barra fechada nova, se houver. */
  async ciclo() {
    if (this.estado.halted) { this.log(`parado: ${this.estado.haltReason}`); return; }

    const agora = Date.now();
    const dk = Math.floor(agora / 86_400_000);
    if (dk !== this.estado.dayKey) {
      this.estado.dayKey = dk;
      this.estado.dayStartEquity = this.estado.capital;
    }

    let processados = 0, abertas = 0, fechadas = 0, bloqueadas = 0;

    for (const symbol of UNIVERSO_MOMENTUM) {
      const bars = await this.barrasDe(symbol);
      if (!bars || bars.length < this.estrategia.warmup + 1) continue;

      const step = 86_400_000;
      // só processa a última barra se ela já FECHOU (o abrir dela + 1 dia <= agora)
      const i = bars.length - 1;
      const bar = bars[i];
      if (bar.t + step > agora) continue; // barra de hoje ainda em formação
      if (bar.t <= (this.estado.ultimaBarra[symbol] ?? 0)) continue; // já processada
      this.estado.ultimaBarra[symbol] = bar.t;
      processados++;

      // 1. gerencia posição aberta neste ativo, se houver
      const idxPos = this.estado.posicoes.findIndex((p) => p.symbol === symbol);
      if (idxPos >= 0) {
        const saida = avaliarSaida(this.estado.posicoes[idxPos], bar, MAX_BARS_VALIDADO);
        if (saida) {
          this.fecharPosicao(idxPos, saida.exitPrice, saida.reason);
          fechadas++;
        }
      }

      // 2. circuit breakers de portfólio, checados antes de qualquer entrada nova
      const ddPico = (this.estado.pico - this.estado.capital) / this.estado.pico;
      if (ddPico >= this.o.maxDrawdownStop) {
        this.estado.halted = true;
        this.estado.haltReason = `drawdown ${(ddPico * 100).toFixed(1)}% atingiu o limite de ${(this.o.maxDrawdownStop * 100).toFixed(0)}%`;
        this.log(`### MODO AGRESSIVO DESLIGADO: ${this.estado.haltReason}`);
        this.diario('halted', { motivo: this.estado.haltReason });
        this.salvar();
        return;
      }
      const perdaDia = (this.estado.dayStartEquity - this.estado.capital) / this.estado.dayStartEquity;
      if (perdaDia >= this.o.dailyLossLimit) { bloqueadas++; continue; }

      // 3. sinal de entrada — só se este ativo não tiver posição aberta
      if (this.estado.posicoes.some((p) => p.symbol === symbol)) continue;
      const sig = this.estrategia.onBar(bars, i);
      if (!sig) continue;

      const cost = COSTS[this.o.costPreset];
      const sized = sizePosition(this.estado.capital, sig.stopPct, cost, {
        riskPerTrade: this.o.riscoPorPosicao,
        maxLeverage: this.o.alavancagemMaxima,
        minNotional: 5,
      });
      if (sized.notional <= 0) { bloqueadas++; continue; }

      this.abrirPosicao(symbol, sig.side, bar.c, sized.notional, sig.stopPct, sig.takePct, bar.t, cost.takerFee);
      abertas++;
    }

    this.estado.ultimoCicloTs = agora;
    this.salvar();
    this.log(
      `ciclo · ${processados} ativos com barra nova · ${abertas} abertas · ${fechadas} fechadas` +
      (bloqueadas ? ` · ${bloqueadas} bloqueadas` : '') +
      ` · capital US$ ${this.estado.capital.toFixed(2)} · ${this.estado.posicoes.length} posições abertas`,
    );
  }

  private abrirPosicao(
    symbol: string, side: Side, refPrice: number, notional: number,
    stopPct: number, takePct: number, barT: number, taxa: number,
  ) {
    const slip = 0.0002;
    const entryPrice = side === 'long' ? refPrice * (1 + slip) : refPrice * (1 - slip);
    const qty = notional / entryPrice;
    const custo = notional * taxa;
    const pos: PosicaoMomentum = {
      symbol, side, entryPrice, qty, notional,
      stopPrice: side === 'long' ? entryPrice * (1 - stopPct) : entryPrice * (1 + stopPct),
      takePrice: side === 'long' ? entryPrice * (1 + takePct) : entryPrice * (1 - takePct),
      abertaEm: Date.now(), abertaBarT: barT,
    };
    this.estado.posicoes.push(pos);
    this.estado.capital -= custo;
    this.estado.custosTotal += custo;
    this.log(
      `ABRE ${symbol.replace('/USDT:USDT', '')} ${side} @ ${entryPrice.toFixed(4)} · ` +
      `notional US$ ${notional.toFixed(2)} · stop ${pos.stopPrice.toFixed(4)} · alvo ${pos.takePrice.toFixed(4)}`,
    );
    this.diario('abre', { symbol, side, entryPrice, notional, stopPrice: pos.stopPrice, takePrice: pos.takePrice });
  }

  private fecharPosicao(idx: number, refPrice: number, reason: string) {
    const pos = this.estado.posicoes[idx];
    const cost = COSTS[this.o.costPreset];
    const { fill, pnl, exitFee } = calcularFechamento(pos, refPrice, cost.takerFee);

    this.estado.capital += pnl;
    this.estado.custosTotal += exitFee;
    this.estado.pnlAcumulado += pnl;
    this.estado.pico = Math.max(this.estado.pico, this.estado.capital);
    this.estado.fechados++;
    if (pnl > 0) this.estado.vitorias++;
    this.estado.posicoes.splice(idx, 1);

    this.log(
      `FECHA ${pos.symbol.replace('/USDT:USDT', '')} (${reason}) @ ${fill.toFixed(4)} · ` +
      `pnl US$ ${pnl.toFixed(3)} · capital US$ ${this.estado.capital.toFixed(2)} · ` +
      `${this.estado.fechados} trades · ${((this.estado.vitorias / this.estado.fechados) * 100).toFixed(1)}% vitórias`,
    );
    this.diario('fecha', { symbol: pos.symbol, side: pos.side, exitPrice: fill, reason, pnl, capital: this.estado.capital });
  }

  getEstado(): EstadoMomentum { return { ...this.estado, posicoes: [...this.estado.posicoes] }; }
}
