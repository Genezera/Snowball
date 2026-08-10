/**
 * CARTEIRA VIRTUAL — o motor de cada challenger do Paper Profit Lab.
 *
 * Reusa os MESMOS primitivos de decisão do champion (`avaliarValor`,
 * `chaveOrdenacao`, `taxaEfetiva`, `dimensionar`, `avaliarRisco`) — importados
 * de `src/funding/*`, nunca reimplementados — sobre o MESMO feed ao vivo
 * (`lerVigilancia()`, o arquivo que a vigilância grava e o champion lê).
 *
 * v2 desta sessão: adiciona estágio inicial (1,0×–1,5×) + escalonamento —
 * faltavam na v1, e sem eles a comparação com o champion (Parte 1 desta
 * etapa) não seria justa: o champion abre fatia parcial e cresce depois, a
 * v1 deste arquivo só abria cheio ou nada. Reusa `FRACAO_ESTAGIO_INICIAL`
 * real, exportada de `spread-live.ts`.
 *
 * Ainda NÃO implementado (gap conhecido, documentado, não escondido):
 * apara (redimensionar por cota) e reinvestimento automático de funding
 * ocioso. Isso significa que `challenger-control` ainda não é uma réplica
 * perfeita do champion — é a razão pela qual `control_status` deste Lab
 * continua `validacao_em_andamento` até esses dois mecanismos existirem
 * aqui também.
 *
 * ISOLAMENTO, por desenho, não por convenção — ver seção correspondente
 * nesta mesma docstring nas versões anteriores deste arquivo (inalterada):
 * cada challenger tem estado próprio em `inteligencia/challengers/<id>/`,
 * `dimensionar()` roda sobre saldo virtual, única chamada de rede é ticker
 * (read-only), e cada challenger é isolado em try/catch por quem chama.
 */
import fs from 'node:fs';
import path from 'node:path';
import { avaliarValor, chaveOrdenacao, type EntradaValor, type Valor } from '../funding/valor.ts';
import { taxaEfetiva, taxaDaOperacao, ESCORREGAMENTO_PERNA, posicoesSustentaveis } from '../funding/custos-reais.ts';
import { dimensionar, type Saldos } from '../funding/tesouraria.ts';
import { avaliarRisco, mmrDe, LIMIARES_PADRAO, MMR_ALT } from '../funding/protecao.ts';
import { FRACAO_ESTAGIO_INICIAL } from '../funding/spread-live.ts';
import { dimensionarSpread } from '../../../src/funding/spread.ts';
import type { OportunidadeSpread } from '../../../src/funding/spread.ts';

export interface PosicaoVirtual {
  symbol: string;
  exchangeShort: string;
  exchangeLong: string;
  notionalPorPerna: number;
  precoEntrada: number;
  precoUltimo: number;
  margemShort: number;
  margemLong: number;
  abertaEm: number;
  fundingAcumulado: number;
  ultimoFundingTs?: number;
  faltasSeguidas: number;
  taxa: number;
  /** 1 = fatia inicial, 2 = tamanho cheio — mesma semântica do champion */
  estagio: 1 | 2;
  // ── campos exclusivos de captura de settlement (virtual-captura.ts, Parte 2 desta etapa) ──
  /** instante absoluto (ms) da próxima liquidação — só presente em posições de captura */
  proximaLiquidacaoEm?: number;
  intervaloHorasLiquidacao?: number;
  /** spread8h no instante da entrada — usado pra calcular o funding esperado sem reler o feed depois */
  spread8hEntrada?: number;
  /** true assim que a única liquidação da captura foi paga — trava contra pagamento duplicado (Parte 2, teste 11) */
  fundingJaRecebido?: boolean;
  cycleId?: string;
}

/** Componentes de custo, decompostos NA ORIGEM — nunca reconstruídos depois (Parte 4). */
export interface CustosDecompostos {
  taxasEntrada: number;
  taxasSaida: number;
  slippageEntradaModelado: number;
  slippageSaidaModelado: number;
  custoEscalonamento: number;
  custoApara: number;
  custoReinvestimento: number;
  custoEmergencial: number;
}

export function custosVazios(): CustosDecompostos {
  return { taxasEntrada: 0, taxasSaida: 0, slippageEntradaModelado: 0, slippageSaidaModelado: 0, custoEscalonamento: 0, custoApara: 0, custoReinvestimento: 0, custoEmergencial: 0 };
}

export interface EstadoVirtual {
  challengerId: string;
  strategyVersion: string;
  configVersion: string;
  familia?: 'exploitation' | 'exploration' | 'control' | 'capture' | 'allocation' | 'batch' | 'risk';
  hipotese?: string;
  /** timestamp da versão de config atual — muda de config = reinicia contagem de validação (Parte 14) */
  configDesde: number;
  capitalInicialVirtual: number;
  saldoVirtualPorExchange: Record<string, number>;
  posicoesVirtuais: PosicaoVirtual[];
  pnlRealizado: number;
  /** soma de todos os componentes de `custos` — mantido para compatibilidade com leaderboard v1 */
  custosTotais: number;
  custos: CustosDecompostos;
  fundingBruto: number;
  /** funding recebido ainda não reinvestido — mesma semântica de spread-live.ts */
  caixaOcioso: number;
  trades: number;
  settlements: number;
  bloqueiosPorSaldo: number;
  bloqueiosPorPayback: number;
  pico: number;
  drawdownMaxPct: number;
  // `sequenceNumber` é monotônico por challenger (Parte 2 da validação de
  // integridade) — nunca depende só de `ts`, porque dois eventos no mesmo
  // milissegundo são indistinguíveis por timestamp, e splice() do array de
  // 200 quebraria qualquer diff por índice/posição.
  decisoes: { ts: number; tipo: string; detalhe: string; sequenceNumber: number }[];
  /** próximo número de sequência a atribuir — nunca reinicia, mesmo depois de splice() do array acima */
  proximoSequenceNumber?: number;
  iniciadoEm: number;
  eliminado?: { ts: number; motivo: string };
  /** pausa manual via dashboard (Parte 18) — challenger aprovado, congela decisões sem apagar histórico */
  pausado?: { ts: number; motivo: string; usuario: string };
  /** anotações livres do operador via dashboard — nunca lidas pela lógica de decisão */
  observacoes?: { ts: number; usuario: string; texto: string }[];
  /** estado do experimento (Parte 17 do dashboard) — bookkeeping, nunca influencia a decisão */
  experimentoStatus?: 'planejado' | 'rodando' | 'pausado' | 'concluido' | 'eliminado' | 'inconclusivo';
  /** ajustes econômicos represados por um challenger de batch (Parte 8) — vazio pros demais */
  ajustesPendentes?: { symbol: string; tipo: 'escalona'; notionalAlvo: number; detectadoEm: number }[];
  ajustesEvitados?: number;
  ajustesAgrupados?: number;
  // ── contadores exclusivos de captura de settlement (virtual-captura.ts) — 0/undefined pros demais challengers ──
  candidatasObservadas?: number;
  bloqueiosPorCobertura?: number;
  bloqueiosPorJanela?: number;
  inversoesAntesDoSettlement?: number;
  // ── funil de rejeição mais granular (Parte 4 da etapa de auditoria) —
  // bloqueiosPorSaldo continua existindo e é a SOMA dos três abaixo, mantido
  // por compatibilidade com o que já lê esse campo. reserva/notionalMinimo
  // são sub-causas do mesmo dimensionar() que antes caíam todas no mesmo
  // balde genérico. ──
  bloqueiosPorReserva?: number;
  bloqueiosPorNotionalMinimo?: number;
  bloqueiosPorMaxPosicoes?: number;
  candidatasAvaliadas?: number;
}

export interface ConfigChallenger {
  challengerId: string;
  strategyVersion: string;
  configVersion: string;
  exchanges: string[];
  capitalPorExchange: number;
  /** distribuição inicial explícita, sobrepõe capitalPorExchange×exchanges quando presente (Parte 11) */
  distribuicaoInicial?: Record<string, number>;
  alavancagem: number;
  reserva: number;
  margemPayback: number;
  maxPosicoes: number;
  /** default: chaveOrdenacao real do champion. Challengers de ranking passam a própria. */
  scorer?: (e: EntradaValor) => number;
  /** default: nenhuma penalidade extra. */
  penalidadePar?: (o: OportunidadeSpread, saldos: Saldos) => number;
  /**
   * default 'imediato' (mesmo comportamento do champion: escalona assim que
   * cruza margemPayback). challenger-batch-rebalancing usa 'represado':
   * acumula o ajuste e só executa quando o benefício supera o custo × margem
   * de segurança (Parte 8).
   */
  modoEscalonamento?: 'imediato' | 'represado';
  margemSegurancaBatch?: number;
  /** default: FRACAO_ESTAGIO_INICIAL real (0,25). Grid de estágio inicial varia isto. */
  fracaoEstagioInicial?: number;
  /**
   * Família do challenger (Parte 1 desta etapa) — puramente informativo,
   * nunca influencia a decisão. 'exploitation' reordena/racionaliza dentro
   * do que o champion já aprovaria; 'exploration' testa parâmetro que o
   * champion não está autorizado a usar (payback, reserva, alavancagem,
   * estágio, posições fora dos valores atuais do champion).
   */
  familia?: 'exploitation' | 'exploration' | 'control' | 'capture' | 'allocation' | 'batch' | 'risk';
  hipotese?: string;
  // ── campos exclusivos de captura de settlement (virtual-captura.ts) ──
  /** janela máxima antes da próxima liquidação em que uma entrada é permitida, em ms */
  janelaCapturaMs?: number;
  /** quantas vezes o pagamento da liquidação precisa cobrir o custo de ida e volta — mesma semântica de EntradaCaptura.margem em funding/liquidacao.ts */
  coberturaMinima?: number;
  /** 'isolated' (primeira leva, Parte 3): capital próprio, nunca disputa com o control. 'shared' (Parte 8, condicionado à validação técnica): disputa capital com persistência. */
  modoCapital?: 'isolated' | 'shared';
  /** default 'persistencia' (cicloChallenger, lerVigilancia). 'captura' roda cicloCaptura (virtual-captura.ts) sobre lerCaptura() — feed diferente, máquina de estados diferente. */
  tipo?: 'persistencia' | 'captura';
}

const MAX_DECISOES_GUARDADAS = 200;

export function novoEstado(cfg: ConfigChallenger): EstadoVirtual {
  const saldoInicial = cfg.distribuicaoInicial ?? Object.fromEntries(cfg.exchanges.map((e) => [e, cfg.capitalPorExchange]));
  const capitalInicial = Object.values(saldoInicial).reduce((a, b) => a + b, 0);
  return {
    challengerId: cfg.challengerId, strategyVersion: cfg.strategyVersion, configVersion: cfg.configVersion,
    familia: cfg.familia, hipotese: cfg.hipotese, configDesde: Date.now(),
    capitalInicialVirtual: capitalInicial,
    saldoVirtualPorExchange: { ...saldoInicial },
    posicoesVirtuais: [], pnlRealizado: 0, custosTotais: 0, custos: custosVazios(), fundingBruto: 0, caixaOcioso: 0,
    trades: 0, settlements: 0, bloqueiosPorSaldo: 0, bloqueiosPorPayback: 0,
    pico: capitalInicial, drawdownMaxPct: 0, decisoes: [], iniciadoEm: Date.now(),
    ajustesPendentes: [], ajustesEvitados: 0, ajustesAgrupados: 0,
  };
}

/** Migração leve: estado salvo por uma versão anterior deste arquivo, sem os campos novos. */
function migrarSeNecessario(e: EstadoVirtual): EstadoVirtual {
  if (!e.custos) e.custos = custosVazios();
  if (e.fundingBruto == null) e.fundingBruto = (e as any).fundingTotal ?? 0;
  if (e.caixaOcioso == null) e.caixaOcioso = 0;
  // decisões salvas por uma versão anterior deste arquivo não tinham
  // sequenceNumber — atribui em ORDEM DE ARRAY (a única ordem que ainda
  // temos pra elas), e continua a contagem dali pra frente sem colidir
  if (e.decisoes?.some((d) => (d as any).sequenceNumber == null)) {
    e.decisoes.forEach((d, i) => { if ((d as any).sequenceNumber == null) (d as any).sequenceNumber = i + 1; });
  }
  if (e.proximoSequenceNumber == null) e.proximoSequenceNumber = e.decisoes?.length ? Math.max(...e.decisoes.map((d) => d.sequenceNumber ?? 0)) : 0;
  if (e.configDesde == null) e.configDesde = e.iniciadoEm ?? Date.now();
  if (!e.posicoesVirtuais) e.posicoesVirtuais = [];
  for (const p of e.posicoesVirtuais) if (p.estagio == null) p.estagio = 2; // posições antigas: trata como cheias
  if (e.ajustesPendentes == null) e.ajustesPendentes = [];
  if (e.ajustesEvitados == null) e.ajustesEvitados = 0;
  if (e.ajustesAgrupados == null) e.ajustesAgrupados = 0;
  if (e.observacoes == null) e.observacoes = [];
  if (e.experimentoStatus == null) e.experimentoStatus = e.eliminado ? 'eliminado' : (e.pausado ? 'pausado' : 'rodando');
  if (e.candidatasObservadas == null) e.candidatasObservadas = 0;
  if (e.bloqueiosPorCobertura == null) e.bloqueiosPorCobertura = 0;
  if (e.bloqueiosPorJanela == null) e.bloqueiosPorJanela = 0;
  if (e.inversoesAntesDoSettlement == null) e.inversoesAntesDoSettlement = 0;
  if (e.bloqueiosPorReserva == null) e.bloqueiosPorReserva = 0;
  if (e.bloqueiosPorNotionalMinimo == null) e.bloqueiosPorNotionalMinimo = 0;
  if (e.bloqueiosPorMaxPosicoes == null) e.bloqueiosPorMaxPosicoes = 0;
  if (e.candidatasAvaliadas == null) e.candidatasAvaliadas = 0;
  return e;
}

/**
 * As funções abaixo (capitalTotal .. cobrarSaida) são a "cola" de
 * contabilidade genérica compartilhada — exportadas de propósito pra
 * `virtual-captura.ts` (Parte 2 do Paper Profit Dashboard, captura de
 * settlement) reusar em vez de duplicar. Nenhuma FÓRMULA econômica mora
 * aqui — essas continuam em `funding/*` (dimensionar, taxaEfetiva,
 * avaliarCaptura etc.), só a mecânica de debitar/creditar/repartir saldo e
 * somar os 8 buckets de custo.
 */
export function capitalTotal(e: EstadoVirtual): number {
  return Object.values(e.saldoVirtualPorExchange).reduce((a, b) => a + b, 0);
}

export function somarCustos(c: CustosDecompostos): number {
  return c.taxasEntrada + c.taxasSaida + c.slippageEntradaModelado + c.slippageSaidaModelado + c.custoEscalonamento + c.custoApara + c.custoReinvestimento + c.custoEmergencial;
}

export function registrar(e: EstadoVirtual, tipo: string, detalhe: string) {
  e.proximoSequenceNumber = (e.proximoSequenceNumber ?? 0) + 1;
  e.decisoes.push({ ts: Date.now(), tipo, detalhe, sequenceNumber: e.proximoSequenceNumber });
  if (e.decisoes.length > MAX_DECISOES_GUARDADAS) e.decisoes.splice(0, e.decisoes.length - MAX_DECISOES_GUARDADAS);
}

export interface DecisaoRegistrada { ts: number; tipo: string; detalhe: string; sequenceNumber: number }
export interface LinhaDiario {
  eventId: string; sequenceNumber: number; cycleId: string; challengerId: string;
  ts: number; evento: string; motivo: string; capital: number;
}

/**
 * Filtro PURO usado pelo orquestrador pra achar o que é novo desde o último
 * ciclo — extraído de propósito pra ser testável sem instanciar
 * `ProfitOrchestrator` (que precisa de ccxt/rede). NUNCA usa `ts`, só
 * `sequenceNumber` (Parte 2 da validação de integridade — dois eventos no
 * mesmo milissegundo têm sequenceNumber diferente, timestamp não).
 */
export function novosEventosParaDiario(decisoes: DecisaoRegistrada[], ultimoSequenceAntes: number): DecisaoRegistrada[] {
  return decisoes.filter((d) => d.sequenceNumber > ultimoSequenceAntes);
}

/** Formata o lote de eventos novos em linhas JSONL — pura, sem I/O. */
export function formatarLinhasDiario(novas: DecisaoRegistrada[], challengerId: string, cycleId: string, capitalAtual: number): LinhaDiario[] {
  return novas.map((d) => ({
    eventId: `${challengerId}-${d.sequenceNumber}`, sequenceNumber: d.sequenceNumber, cycleId, challengerId,
    ts: d.ts, evento: d.tipo, motivo: d.detalhe, capital: capitalAtual,
  }));
}

export function debitar(e: EstadoVirtual, exchange: string, valor: number) {
  e.saldoVirtualPorExchange[exchange] = (e.saldoVirtualPorExchange[exchange] ?? 0) - valor;
}
export function creditar(e: EstadoVirtual, exchange: string, valor: number) { debitar(e, exchange, -valor); }
export function repartir(e: EstadoVirtual, pos: PosicaoVirtual, valor: number) {
  creditar(e, pos.exchangeShort, valor / 2);
  creditar(e, pos.exchangeLong, valor / 2);
}

/**
 * Debita a ENTRADA de uma operação (notional novo, seja abertura ou
 * escalonamento) separando taxa pura de slippage modelado — nunca soma um
 * custo genérico. `bucket` decide em qual dos 8 componentes ele cai.
 */
export function cobrarEntrada(e: EstadoVirtual, exShort: string, exLong: string, notional: number, bucket: 'trade' | 'escalona') {
  const taxaPura = taxaDaOperacao(exShort, exLong);
  const custoTaxa = notional * taxaPura * 2; // duas pernas
  const custoSlippage = notional * ESCORREGAMENTO_PERNA * 2;
  if (bucket === 'trade') { e.custos.taxasEntrada += custoTaxa; e.custos.slippageEntradaModelado += custoSlippage; }
  else { e.custos.custoEscalonamento += custoTaxa + custoSlippage; }
  e.custosTotais = somarCustos(e.custos);
  return custoTaxa + custoSlippage;
}
export function cobrarSaida(e: EstadoVirtual, exShort: string, exLong: string, notional: number, bucket: 'trade' | 'emergencial' = 'trade') {
  const taxaPura = taxaDaOperacao(exShort, exLong);
  const custoTaxa = notional * taxaPura * 2;
  const custoSlippage = notional * ESCORREGAMENTO_PERNA * 2;
  if (bucket === 'trade') { e.custos.taxasSaida += custoTaxa; e.custos.slippageSaidaModelado += custoSlippage; }
  else { e.custos.custoEmergencial += custoTaxa + custoSlippage; }
  e.custosTotais = somarCustos(e.custos);
  return custoTaxa + custoSlippage;
}

/** Busca preço via ccxt — read-only, mesma chamada que qualquer leitor de mercado faz. */
export type BuscarPreco = (exchange: string, symbol: string) => Promise<number>;

/**
 * Um ciclo de decisão. Recebe as MESMAS oportunidades que o champion recebeu
 * neste ciclo (`ops`, vindo de `lerVigilancia()` — chamado uma vez fora
 * daqui, e compartilhado entre todos os challengers do Lab).
 */
export async function cicloChallenger(
  cfg: ConfigChallenger, eIn: EstadoVirtual, ops: OportunidadeSpread[], buscarPreco: BuscarPreco,
): Promise<void> {
  const e = migrarSeNecessario(eIn);
  if (e.eliminado || e.pausado) return;

  const cap = capitalTotal(e);
  e.pico = Math.max(e.pico, cap);
  const dd = e.pico > 0 ? (e.pico - cap) / e.pico : 0;
  e.drawdownMaxPct = Math.max(e.drawdownMaxPct, dd * 100);

  // ── gerenciar posições abertas ──────────────────────────────────────────
  for (const pos of [...e.posicoesVirtuais]) {
    const atual = ops.find((o) => o.symbol === pos.symbol);
    let preco: number;
    try { preco = await buscarPreco(pos.exchangeShort, pos.symbol); } catch { continue; }
    const delta = pos.precoUltimo ? preco / pos.precoUltimo - 1 : 0;
    pos.margemShort -= pos.notionalPorPerna * delta;
    pos.margemLong += pos.notionalPorPerna * delta;
    pos.precoUltimo = preco;

    if (!atual) {
      pos.faltasSeguidas++;
      if (pos.faltasSeguidas >= 2) {
        const custo = cobrarSaida(e, pos.exchangeShort, pos.exchangeLong, pos.notionalPorPerna);
        repartir(e, pos, -custo);
        e.posicoesVirtuais.splice(e.posicoesVirtuais.indexOf(pos), 1);
        registrar(e, 'fecha', `${pos.symbol} — spread ausente/invertido, custo US$${custo.toFixed(3)}`);
      }
      continue;
    }
    pos.faltasSeguidas = 0;

    // ── escalonamento: fatia inicial que já provou o payback cheio ────────
    if (pos.estagio === 1) {
      const dEsc = dimensionar(e.saldoVirtualPorExchange, exposicaoPorExchange(e), pos.exchangeShort, pos.exchangeLong, cfg.alavancagem, cfg.reserva);
      const vEsc = avaliarValor({ spread: atual.spread, consistencia: atual.consistencia, duracaoHoras: atual.duracaoHoras ?? 0, notional: pos.notionalPorPerna, taxa: pos.taxa });
      if (dEsc.possivel && vEsc.folga >= cfg.margemPayback && dEsc.notionalPorPerna > pos.notionalPorPerna) {
        const notionalAdicionado = dEsc.notionalPorPerna - pos.notionalPorPerna;
        if (cfg.modoEscalonamento === 'represado') {
          // beneficio esperado ~ receita adicional projetada por hora restante de vida vs custo do ajuste
          const custoAjuste = cobrarEntradaSimulado(pos.exchangeShort, pos.exchangeLong, notionalAdicionado);
          const beneficioEsperado = notionalAdicionado * atual.spread * (3 / 24) * Math.max(1, vEsc.vidaEsperadaHoras);
          const margemSeguranca = cfg.margemSegurancaBatch ?? 2;
          if (beneficioEsperado < custoAjuste * margemSeguranca) {
            e.ajustesPendentes!.push({ symbol: pos.symbol, tipo: 'escalona', notionalAlvo: dEsc.notionalPorPerna, detectadoEm: Date.now() });
            e.ajustesEvitados = (e.ajustesEvitados ?? 0) + 1;
            registrar(e, 'escalona-represado', `${pos.symbol} adiado — benefício US$${beneficioEsperado.toFixed(4)} < custo×margem US$${(custoAjuste * margemSeguranca).toFixed(4)}`);
          } else {
            executarEscalonamento(e, pos, dEsc.notionalPorPerna, notionalAdicionado);
          }
        } else {
          executarEscalonamento(e, pos, dEsc.notionalPorPerna, notionalAdicionado);
        }
      }
    }

    // risco de liquidação — CRÍTICO nunca é adiado, nem no modo represado
    const risco = avaliarRisco(pos.margemShort, pos.margemLong, pos.notionalPorPerna, 0, mmrDe(pos.symbol), LIMIARES_PADRAO);
    if (risco.nivel === 'critico') {
      const custo = cobrarSaida(e, pos.exchangeShort, pos.exchangeLong, pos.notionalPorPerna, 'emergencial');
      repartir(e, pos, -custo);
      e.posicoesVirtuais.splice(e.posicoesVirtuais.indexOf(pos), 1);
      registrar(e, 'fecha', `${pos.symbol} — EMERGÊNCIA distância ${(risco.distanciaMinima * 100).toFixed(1)}%`);
      continue;
    }

    // funding a cada ~7,75h
    const agora = Date.now();
    const ultimo = pos.ultimoFundingTs ?? 0;
    if (ultimo === 0 || (agora - ultimo) / 3_600_000 >= 7.75) {
      const ganho = pos.notionalPorPerna * atual.spread;
      pos.fundingAcumulado += ganho;
      pos.ultimoFundingTs = agora;
      repartir(e, pos, ganho);
      e.fundingBruto += ganho;
      e.settlements++;
      e.caixaOcioso += ganho;
      registrar(e, 'funding', `${pos.symbol} +US$${ganho.toFixed(4)}`);
    }

    // ── reinvestimento: funding vira notional novo, só se pagar em ≤3 dias ──
    // mesma regra do champion (spread-live.ts) — dimensionarSpread() real
    if (e.caixaOcioso > 0) {
      const extra = dimensionarSpread(e.caixaOcioso, cfg.alavancagem, taxaDaOperacao(pos.exchangeShort, pos.exchangeLong) + ESCORREGAMENTO_PERNA);
      const ganhoDia = extra.notionalPorPerna * atual.spread * 3;
      const diasPagar = ganhoDia > 0 ? extra.custoMontagem / ganhoDia : Infinity;
      if (diasPagar <= 3) {
        pos.notionalPorPerna += extra.notionalPorPerna;
        pos.margemShort += extra.margemPorPerna; pos.margemLong += extra.margemPorPerna;
        repartir(e, pos, -extra.custoMontagem);
        e.custos.custoReinvestimento += extra.custoMontagem;
        e.custosTotais = somarCustos(e.custos);
        e.caixaOcioso = 0;
        registrar(e, 'reinveste', `${pos.symbol} +US$${extra.notionalPorPerna.toFixed(3)}/perna, se paga em ${diasPagar.toFixed(1)}d`);
      }
    }
  }

  // ── apara: nenhuma posição pode passar 25% acima da cota sustentável ────
  // mesma regra do champion (redimensionar() em spread-live.ts), reusando
  // posicoesSustentaveis() real — cota = capital / posições que o capital
  // atual sustenta com segurança, não cfg.maxPosicoes fixo
  {
    const capAtual = capitalTotal(e);
    // mesma chamada exata do champion (redimensionar() em spread-live.ts): MMR_ALT fixo, não por símbolo
    const sust = posicoesSustentaveis(capAtual, cfg.alavancagem, LIMIARES_PADRAO.alerta, MMR_ALT, cfg.maxPosicoes);
    const cota = capAtual / Math.max(1, sust.posicoes);
    for (const pos of e.posicoesVirtuais) {
      const atualMargem = pos.margemShort + pos.margemLong;
      if (atualMargem <= cota * 1.25) continue;
      const fracaoManter = cota / atualMargem;
      const notionalFechado = pos.notionalPorPerna * (1 - fracaoManter);
      const custo = notionalFechado * pos.taxa * 2;
      pos.notionalPorPerna *= fracaoManter;
      pos.margemShort *= fracaoManter; pos.margemLong *= fracaoManter;
      repartir(e, pos, -custo);
      e.custos.custoApara += custo;
      e.custosTotais = somarCustos(e.custos);
      registrar(e, 'apara', `${pos.symbol} — ocupava US$${atualMargem.toFixed(2)} de cota US$${cota.toFixed(2)}, custo US$${custo.toFixed(3)}`);
    }
  }

  function executarEscalonamento(e2: EstadoVirtual, pos: PosicaoVirtual, notionalNovo: number, notionalAdicionado: number) {
    const custo = cobrarEntrada(e2, pos.exchangeShort, pos.exchangeLong, notionalAdicionado, 'escalona');
    debitar(e2, pos.exchangeShort, custo / 2); debitar(e2, pos.exchangeLong, custo / 2);
    const fracaoCrescer = notionalNovo / pos.notionalPorPerna;
    pos.margemShort *= fracaoCrescer; pos.margemLong *= fracaoCrescer;
    pos.notionalPorPerna = notionalNovo; pos.estagio = 2;
    e2.ajustesAgrupados = (e2.ajustesAgrupados ?? 0) + (cfg.modoEscalonamento === 'represado' ? 1 : 0);
    registrar(e2, 'escalona', `${pos.symbol} → notional US$${notionalNovo.toFixed(2)}/perna, custo US$${custo.toFixed(3)}`);
  }
  function cobrarEntradaSimulado(exShort: string, exLong: string, notional: number): number {
    return notional * (taxaDaOperacao(exShort, exLong) + ESCORREGAMENTO_PERNA) * 2;
  }

  if (e.posicoesVirtuais.length >= cfg.maxPosicoes) {
    // conta o ciclo (não candidata a candidata — maxPosicoes bloqueia o
    // ciclo inteiro de uma vez, antes de sequer olhar as candidatas)
    e.bloqueiosPorMaxPosicoes = (e.bloqueiosPorMaxPosicoes ?? 0) + 1;
    atualizarPnl(e); return;
  }

  // ── candidatas ───────────────────────────────────────────────────────────
  const jaTenho = new Set(e.posicoesVirtuais.map((p) => p.symbol));
  const scorer = cfg.scorer ?? chaveOrdenacao;
  const candidatas = ops
    .filter((o) => !jaTenho.has(o.symbol))
    .filter((o) => cfg.exchanges.includes(o.exchangeShort) && cfg.exchanges.includes(o.exchangeLong));

  let melhor: { o: OportunidadeSpread; d: ReturnType<typeof dimensionar>; v: Valor; taxa: number; estagio: 1 | 2 } | null = null;
  let melhorScore = -Infinity;
  // funil desta rodada, só pra decidir o QUE registrar no diário no final —
  // os contadores acumulados em `e` já são incrementados dentro do loop
  let bloqueiosSaldoRodada = 0, bloqueiosReservaRodada = 0, bloqueiosNotionalRodada = 0, bloqueiosPaybackRodada = 0;

  e.candidatasAvaliadas = (e.candidatasAvaliadas ?? 0) + candidatas.length;

  for (const o of candidatas) {
    const d = dimensionar(e.saldoVirtualPorExchange, exposicaoPorExchange(e), o.exchangeShort, o.exchangeLong, cfg.alavancagem, cfg.reserva);
    if (!d.possivel) {
      // sub-classifica a MESMA rejeição de dimensionar() em vez de um balde
      // genérico só — a string de motivo já diferencia as 3 causas, só
      // nunca tinha sido lida por quem chama (Parte 4 da auditoria)
      if (d.motivo.startsWith('sem margem livre acima da reserva')) { e.bloqueiosPorReserva = (e.bloqueiosPorReserva ?? 0) + 1; bloqueiosReservaRodada++; }
      else if (d.motivo.includes('abaixo do mínimo')) { e.bloqueiosPorNotionalMinimo = (e.bloqueiosPorNotionalMinimo ?? 0) + 1; bloqueiosNotionalRodada++; }
      else { bloqueiosSaldoRodada++; }
      e.bloqueiosPorSaldo++; // mantido como SOMA das três — compatibilidade com quem já lê este campo
      continue;
    }
    const taxa = taxaEfetiva(o.exchangeShort, o.exchangeLong);
    const entradaCheia: EntradaValor = { spread: o.spread, consistencia: o.consistencia, duracaoHoras: o.duracaoHoras ?? 0, notional: d.notionalPorPerna, taxa };
    const v = avaliarValor(entradaCheia);
    if (v.folga < 1.0) { e.bloqueiosPorPayback++; bloqueiosPaybackRodada++; continue; }
    const estagio: 1 | 2 = v.folga >= cfg.margemPayback ? 2 : 1;
    let score = scorer(entradaCheia);
    if (cfg.penalidadePar) score -= cfg.penalidadePar(o, e.saldoVirtualPorExchange);
    if (score > melhorScore) { melhorScore = score; melhor = { o, d, v, taxa, estagio }; }
  }

  // UM evento por ciclo resumindo o funil desta rodada — não um por
  // candidata (o champion real também agrega assim, ver spread-live.ts).
  // Vocabulário e prefixo "saldo insuficiente" combinam de propósito com o
  // classificador de validacao-control.ts, pra o control ficar comparável
  // ao champion em vez de sempre cair em "sem equivalente".
  if (!melhor && candidatas.length > 0) {
    const totalBloqueiosSaldo = bloqueiosSaldoRodada + bloqueiosReservaRodada + bloqueiosNotionalRodada;
    if (totalBloqueiosSaldo > 0 && totalBloqueiosSaldo >= bloqueiosPaybackRodada) {
      registrar(e, 'bloqueado', `saldo insuficiente · ${totalBloqueiosSaldo} candidatas (reserva ${bloqueiosReservaRodada}, notional mínimo ${bloqueiosNotionalRodada}, sem saldo ${bloqueiosSaldoRodada})`);
    } else if (bloqueiosPaybackRodada > 0) {
      registrar(e, 'bloqueado', `valor esperado barrou ${bloqueiosPaybackRodada} candidatas`);
    }
  } else if (candidatas.length === 0) {
    registrar(e, 'leitura', 'ciclo sem candidata no universo deste challenger');
  }

  if (melhor) {
    const fracao = melhor.estagio === 2 ? 1 : (cfg.fracaoEstagioInicial ?? FRACAO_ESTAGIO_INICIAL);
    const notionalAbertura = melhor.d.notionalPorPerna * fracao;
    const margemAbertura = melhor.d.margemPorPerna * fracao;
    const custo = cobrarEntrada(e, melhor.o.exchangeShort, melhor.o.exchangeLong, notionalAbertura, 'trade');
    debitar(e, melhor.o.exchangeShort, custo / 2);
    debitar(e, melhor.o.exchangeLong, custo / 2);
    e.trades++;
    let preco = 0;
    try { preco = await buscarPreco(melhor.o.exchangeShort, melhor.o.symbol); } catch { /* usa 0 — marcação corrige no próximo ciclo */ }
    e.posicoesVirtuais.push({
      symbol: melhor.o.symbol, exchangeShort: melhor.o.exchangeShort, exchangeLong: melhor.o.exchangeLong,
      notionalPorPerna: notionalAbertura, precoEntrada: preco, precoUltimo: preco,
      margemShort: margemAbertura, margemLong: margemAbertura,
      abertaEm: Date.now(), fundingAcumulado: 0, faltasSeguidas: 0, taxa: melhor.taxa, estagio: melhor.estagio,
    });
    registrar(e, 'abre', `${melhor.o.symbol} ${melhor.o.exchangeShort}/${melhor.o.exchangeLong} notional US$${notionalAbertura.toFixed(2)} folga ${melhor.v.folga.toFixed(2)}x estagio ${melhor.estagio}`);
  }

  atualizarPnl(e);
}

export function exposicaoPorExchange(e: EstadoVirtual): Record<string, number> {
  const exp: Record<string, number> = {};
  for (const p of e.posicoesVirtuais) {
    exp[p.exchangeShort] = (exp[p.exchangeShort] ?? 0) + p.margemShort;
    exp[p.exchangeLong] = (exp[p.exchangeLong] ?? 0) + p.margemLong;
  }
  return exp;
}

export function atualizarPnl(e: EstadoVirtual) {
  e.pnlRealizado = capitalTotal(e) - e.capitalInicialVirtual;
}

/** Critérios de eliminação (Parte 16) — puro, testável, nunca decide sozinho sobre o champion. */
export interface CriterioEliminacao { motivo: string; }
export function avaliarEliminacao(e: EstadoVirtual, championPnlPct: number): CriterioEliminacao | null {
  const idadeDias = (Date.now() - e.iniciadoEm) / 86_400_000;
  if (idadeDias < 3) return null;
  const pnlPct = e.capitalInicialVirtual > 0 ? (e.pnlRealizado / e.capitalInicialVirtual) * 100 : 0;
  if (e.trades >= 10 && pnlPct < championPnlPct - 5) {
    return { motivo: `PnL ${pnlPct.toFixed(2)}% claramente abaixo do champion (${championPnlPct.toFixed(2)}%) após ${e.trades} trades` };
  }
  if (e.drawdownMaxPct > 25) {
    return { motivo: `drawdown de ${e.drawdownMaxPct.toFixed(1)}% excede o limite de eliminação (25%)` };
  }
  if (e.custosTotais > 0 && e.fundingBruto > 0 && e.custosTotais > e.fundingBruto * 2 && e.trades >= 10) {
    return { motivo: `custo (US$${e.custosTotais.toFixed(2)}) mais que o dobro do funding bruto (US$${e.fundingBruto.toFixed(2)}) após ${e.trades} trades` };
  }
  return null;
}

/** Nível de evidência (Parte 17) — puro. */
export type NivelEvidencia = 'amostra_insuficiente' | 'sinal_inicial' | 'evidencia_intermediaria' | 'candidato_a_promocao';
export function nivelEvidencia(e: EstadoVirtual): NivelEvidencia {
  const dias = (Date.now() - e.iniciadoEm) / 86_400_000;
  if (e.trades >= 50 && dias >= 30) return 'candidato_a_promocao';
  if (e.trades >= 25 || dias >= 30) return 'evidencia_intermediaria';
  if (e.trades >= 10 || dias >= 7) return 'sinal_inicial';
  return 'amostra_insuficiente';
}

// ── persistência — cada challenger no seu próprio diretório, nunca em spread/ ──
export function caminhoEstado(root: string, challengerId: string): string {
  return path.join(root, 'inteligencia', 'challengers', challengerId, 'estado.json');
}
export function caminhoDiario(root: string, challengerId: string): string {
  return path.join(root, 'inteligencia', 'challengers', challengerId, 'diario.jsonl');
}
export function salvarEstado(root: string, e: EstadoVirtual): void {
  const p = caminhoEstado(root, e.challengerId);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(e, null, 2));
}
export function carregarEstado(root: string, cfg: ConfigChallenger): EstadoVirtual {
  const p = caminhoEstado(root, cfg.challengerId);
  if (fs.existsSync(p)) return migrarSeNecessario(JSON.parse(fs.readFileSync(p, 'utf8')) as EstadoVirtual);
  return novoEstado(cfg);
}

/**
 * Migra o estado de um challengerId antigo para um novo, preservando todo o
 * histórico (Parte 2 — renomear challenger-best-pair sem perder dado). Copia
 * o arquivo, ajusta o campo `challengerId` interno, nunca apaga o original
 * (quem chama decide se remove depois de confirmar a cópia).
 */
export function migrarChallenger(root: string, idAntigo: string, idNovo: string): boolean {
  const origem = caminhoEstado(root, idAntigo);
  if (!fs.existsSync(origem)) return false;
  const estado = JSON.parse(fs.readFileSync(origem, 'utf8')) as EstadoVirtual;
  estado.challengerId = idNovo;
  salvarEstado(root, estado);
  const diarioOrigem = caminhoDiario(root, idAntigo);
  if (fs.existsSync(diarioOrigem)) {
    const destino = caminhoDiario(root, idNovo);
    fs.mkdirSync(path.dirname(destino), { recursive: true });
    fs.copyFileSync(diarioOrigem, destino);
  }
  return true;
}
