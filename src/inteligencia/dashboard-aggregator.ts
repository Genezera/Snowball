/**
 * DASHBOARD AGGREGATOR (Parte 22 do "Paper Profit Dashboard") — o ÚNICO
 * lugar onde o Paper Profit Lab CALCULA o que o dashboard vai mostrar.
 *
 * Regra central do pedido: "Nenhum cálculo pesado deverá ocorrer dentro de
 * dashboard/server.ts." Este arquivo roda dentro do processo do Lab
 * (chamado por paper-profit-lab.ts, uma vez por ciclo, ~5min), grava 6
 * arquivos JSON pequenos e já prontos em `inteligencia/dashboard/`, e o
 * servidor web só lê e serve — nunca recalcula.
 *
 * Dividido em duas camadas de propósito:
 *   - funções PURAS (`construir*`) — recebem dados já carregados, sem tocar
 *     disco, testáveis sem fixture de arquivo;
 *   - `executarAgregacao(root)` — a única função com I/O, que lê tudo (numa
 *     janela limitada, nunca o histórico inteiro) e grava os 6 arquivos.
 *
 * Isolamento do champion, igual ao resto do Lab: só LÊ `spread/estado.json`,
 * `spread/marcacao.json` e `spread/diario.jsonl` — nunca escreve neles, nunca
 * importa `MotorSpread`.
 */
import fs from 'node:fs';
import path from 'node:path';
import type { EstadoVirtual, ConfigChallenger } from './virtual-portfolio.ts';
import type { HeartbeatLab } from './supervisao.ts';
import { errosNaJanela } from './supervisao.ts';
import type { RelatorioValidacao } from './validacao-control.ts';
import { montarLeaderboard, type Leaderboard } from './leaderboard.ts';
import { decompor, type DecomposicaoCusto, type EventoCusto } from '../funding/decomposicao-custo.ts';
import type { ResumoMarcacao } from '../funding/marcacao.ts';
import { percentis } from './profit-orchestrator.ts';
import {
  carregarOuCriarJanelaComum, calcularDeltasChampion, calcularDeltasHeartbeat, calcularDeltasChallengers,
  classificarPosicoesAbertas, fechamentosNaJanela,
} from './janela-comum.ts';

// ── resumo.json ──────────────────────────────────────────────────────────

export interface ResumoChampion {
  pnlRealizado: number;
  pnlNaoRealizadoMark: number;
  pnlNaoRealizadoExecutavel: number;
  equityMark: number;
  equityLiquidacao: number;
  fundingBruto: number;
  custosTotais: number;
  capitalInicial: number;
  capitalAtual: number;
  pnlPct: number;
  marcacaoDisponivel: boolean;
}

export interface CardMelhor { challengerId: string | null; valor: number }

export interface ResumoDashboard {
  geradoEm: number;
  champion: ResumoChampion;
  control: { pnlBase: number; pnlAjustado: number; retornoPct: number; trades: number } | null;
  melhorPnlBase: CardMelhor;
  melhorPnlAjustado: CardMelhor;
  melhorRetornoPorMargem: CardMelhor;
  menorDrawdown: CardMelhor;
  maiorFrequencia: CardMelhor;
  menorCusto: CardMelhor;
  capitalVirtualTotal: number;
  tradesTotaisPaper: number;
  settlementsTotaisPaper: number;
  numeroChallengers: number;
  numeroAtivos: number;
  numeroPausados: number;
  numeroEliminados: number;
}

function melhorPor(lb: Leaderboard, chave: (l: Leaderboard['linhas'][number]) => number, desc = true): CardMelhor {
  const candidatas = lb.linhas.filter((l) => !l.eliminado);
  if (!candidatas.length) return { challengerId: null, valor: 0 };
  const ordenadas = [...candidatas].sort((a, b) => desc ? chave(b) - chave(a) : chave(a) - chave(b));
  return { challengerId: ordenadas[0].challengerId, valor: chave(ordenadas[0]) };
}

export function construirResumo(
  estados: EstadoVirtual[], leaderboard: Leaderboard, championEstado: any, championMarcacao: ResumoMarcacao | null,
): ResumoDashboard {
  const capitalInicial = championEstado?.capitalInicial ?? 0;
  const capitalAtual = championEstado?.capital ?? 0;
  const champion: ResumoChampion = {
    pnlRealizado: capitalAtual - capitalInicial,
    pnlNaoRealizadoMark: championMarcacao?.pnlNaoRealizadoMark ?? 0,
    pnlNaoRealizadoExecutavel: championMarcacao?.pnlNaoRealizadoExecutavel ?? 0,
    equityMark: championMarcacao?.equityMark ?? capitalAtual,
    equityLiquidacao: championMarcacao?.equityLiquidacao ?? capitalAtual,
    fundingBruto: championEstado?.fundingTotal ?? 0,
    custosTotais: championEstado?.custosTotal ?? 0,
    capitalInicial, capitalAtual,
    pnlPct: capitalInicial > 0 ? ((capitalAtual - capitalInicial) / capitalInicial) * 100 : 0,
    marcacaoDisponivel: championMarcacao != null,
  };

  const linhaControl = leaderboard.linhas.find((l) => l.challengerId === 'challenger-control');
  const control = linhaControl
    ? { pnlBase: linhaControl.pnlPaperBase, pnlAjustado: linhaControl.pnlPaperAjustado, retornoPct: linhaControl.retornoPct, trades: linhaControl.trades }
    : null;

  const ativos = estados.filter((e) => !e.eliminado && !e.pausado);
  const pausados = estados.filter((e) => e.pausado);
  const eliminados = estados.filter((e) => e.eliminado);

  return {
    geradoEm: Date.now(),
    champion, control,
    melhorPnlBase: melhorPor(leaderboard, (l) => l.pnlPaperBase),
    melhorPnlAjustado: melhorPor(leaderboard, (l) => l.pnlPaperAjustado),
    melhorRetornoPorMargem: melhorPor(leaderboard, (l) => l.retornoPorMargem),
    menorDrawdown: melhorPor(leaderboard, (l) => l.drawdownMaxPct, false),
    maiorFrequencia: melhorPor(leaderboard, (l) => l.trades + l.settlements),
    menorCusto: melhorPor(leaderboard, (l) => l.custosTotais, false),
    capitalVirtualTotal: estados.reduce((s, e) => s + e.capitalInicialVirtual + e.pnlRealizado, 0),
    tradesTotaisPaper: estados.reduce((s, e) => s + e.trades, 0),
    settlementsTotaisPaper: estados.reduce((s, e) => s + e.settlements, 0),
    numeroChallengers: estados.length,
    numeroAtivos: ativos.length, numeroPausados: pausados.length, numeroEliminados: eliminados.length,
  };
}

// ── frequencia.json ──────────────────────────────────────────────────────

export interface LinhaFrequencia {
  challengerId: string; familia?: string;
  trades: number; settlements: number;
  bloqueiosPorPayback: number; bloqueiosPorSaldo: number;
  fecharamComLucro: number | null; // não instrumentado por trade individual nesta versão — null é honesto, não 0
}

export interface LinhaPaybackGrid {
  challengerId: string; margemPayback: number;
  trades: number; funding: number; custosTotais: number; pnlBase: number; feeToGross: number; drawdownMaxPct: number;
}

export interface FrequenciaDashboard {
  geradoEm: number;
  global: {
    ciclosProcessados: number; ciclosComCandidata: number; ciclosSemCandidata: number;
    observadasAcumuladas: number;
  };
  funilGlobal: {
    observadas: number;
    avaliadas: number; // = observadas (todo candidata passa por avaliarValor); mantido separado pro rótulo do funil
    aprovadasPeloPortao: number; // trades + bloqueios seria "avaliadas" — aprovadas é trades reais somados
    abertas: number;
    chegaramAoSettlement: number;
  };
  motivosRejeicao: {
    paybackInsuficiente: number;
    saldo: number;
    liquidez: null; conCusto: null; consistencia: null; reserva: null; concentracao: null; risco: null; foraDaJanelaDeCaptura: null;
    nota: string;
  };
  porChallenger: LinhaFrequencia[];
  paybackGrid: LinhaPaybackGrid[];
}

export function construirFrequencia(estados: EstadoVirtual[], leaderboard: Leaderboard, heartbeat: HeartbeatLab): FrequenciaDashboard {
  const porChallenger: LinhaFrequencia[] = estados.map((e) => ({
    challengerId: e.challengerId, familia: e.familia,
    trades: e.trades, settlements: e.settlements,
    bloqueiosPorPayback: e.bloqueiosPorPayback, bloqueiosPorSaldo: e.bloqueiosPorSaldo,
    fecharamComLucro: null,
  }));

  const paybackGrid: LinhaPaybackGrid[] = estados
    .filter((e) => e.challengerId.startsWith('challenger-payback-'))
    .map((e) => {
      const linha = leaderboard.linhas.find((l) => l.challengerId === e.challengerId);
      const margemPayback = Number(e.challengerId.replace('challenger-payback-', '').replace('-controle', '')) / 100;
      return {
        challengerId: e.challengerId, margemPayback,
        trades: e.trades, funding: e.fundingBruto, custosTotais: e.custosTotais,
        pnlBase: linha?.pnlPaperBase ?? 0, feeToGross: linha?.feeToGross ?? Infinity, drawdownMaxPct: e.drawdownMaxPct,
      };
    })
    .sort((a, b) => a.margemPayback - b.margemPayback);

  const totalTrades = estados.reduce((s, e) => s + e.trades, 0);
  const totalSettlements = estados.reduce((s, e) => s + e.settlements, 0);
  const totalBloqueiosPayback = estados.reduce((s, e) => s + e.bloqueiosPorPayback, 0);
  const totalBloqueiosSaldo = estados.reduce((s, e) => s + e.bloqueiosPorSaldo, 0);

  return {
    geradoEm: Date.now(),
    global: {
      ciclosProcessados: heartbeat.ciclosProcessados,
      ciclosComCandidata: heartbeat.ciclosComCandidata, ciclosSemCandidata: heartbeat.ciclosSemCandidata,
      observadasAcumuladas: heartbeat.observadasAcumuladas,
    },
    funilGlobal: {
      observadas: heartbeat.observadasAcumuladas,
      avaliadas: heartbeat.observadasAcumuladas,
      aprovadasPeloPortao: totalTrades + totalBloqueiosPayback, // candidatas que passaram do bloqueio de saldo e chegaram no portão de payback
      abertas: totalTrades,
      chegaramAoSettlement: totalSettlements,
    },
    motivosRejeicao: {
      paybackInsuficiente: totalBloqueiosPayback, saldo: totalBloqueiosSaldo,
      liquidez: null, conCusto: null, consistencia: null, reserva: null, concentracao: null, risco: null, foraDaJanelaDeCaptura: null,
      nota: 'só payback e saldo são instrumentados por motivo hoje — os demais exigiriam classificar o motivo de rejeição na origem (valor.ts/tesouraria.ts), não implementado nesta versão',
    },
    porChallenger, paybackGrid,
  };
}

// ── custos.json ──────────────────────────────────────────────────────────

export interface LinhaCustos {
  challengerId: string;
  taxasEntrada: number; taxasSaida: number;
  slippageEntradaModelado: number; slippageSaidaModelado: number;
  custoEscalonamento: number; custoApara: number; custoReinvestimento: number; custoEmergencial: number;
  custoTradingPuro: number; custoGerenciamento: number; custoTotal: number;
  feeToGrossTrading: number; feeToGrossTotal: number;
}

export interface CustosDashboard {
  geradoEm: number;
  champion: (DecomposicaoCusto & { feeToGrossTrading: number; feeToGrossTotal: number; fundingBruto: number }) | null;
  porChallenger: LinhaCustos[];
}

export function construirCustos(estados: EstadoVirtual[]): CustosDashboard['porChallenger'] {
  return estados.map((e) => {
    const c = e.custos;
    const custoTradingPuro = c.taxasEntrada + c.taxasSaida + c.slippageEntradaModelado + c.slippageSaidaModelado;
    const custoGerenciamento = c.custoEscalonamento + c.custoApara + c.custoReinvestimento;
    const custoTotal = custoTradingPuro + custoGerenciamento + c.custoEmergencial;
    return {
      challengerId: e.challengerId,
      taxasEntrada: c.taxasEntrada, taxasSaida: c.taxasSaida,
      slippageEntradaModelado: c.slippageEntradaModelado, slippageSaidaModelado: c.slippageSaidaModelado,
      custoEscalonamento: c.custoEscalonamento, custoApara: c.custoApara, custoReinvestimento: c.custoReinvestimento, custoEmergencial: c.custoEmergencial,
      custoTradingPuro, custoGerenciamento, custoTotal,
      feeToGrossTrading: e.fundingBruto > 0 ? custoTradingPuro / e.fundingBruto : Infinity,
      feeToGrossTotal: e.fundingBruto > 0 ? custoTotal / e.fundingBruto : Infinity,
    };
  });
}

// ── riscos.json ─────────────────────────────────────────────────────────

export interface LinhaRisco {
  challengerId: string; familia?: string;
  drawdownMaxPct: number; concentracaoMaxima: number; altoRiscoAlavancagem: boolean;
  posicoesAbertas: number; capitalOcioso: number;
}

export function construirRiscos(estados: EstadoVirtual[], configs: ConfigChallenger[]): LinhaRisco[] {
  const cfgPorId = new Map(configs.map((c) => [c.challengerId, c]));
  return estados.map((e) => {
    const cfg = cfgPorId.get(e.challengerId);
    const capitalTotal = Object.values(e.saldoVirtualPorExchange).reduce((a, b) => a + b, 0);
    const exposicao: Record<string, number> = {};
    for (const p of e.posicoesVirtuais) {
      exposicao[p.exchangeShort] = (exposicao[p.exchangeShort] ?? 0) + p.margemShort;
      exposicao[p.exchangeLong] = (exposicao[p.exchangeLong] ?? 0) + p.margemLong;
    }
    const concentracaoMaxima = e.capitalInicialVirtual > 0
      ? Math.max(0, ...Object.values(exposicao)) / e.capitalInicialVirtual : 0;
    return {
      challengerId: e.challengerId, familia: e.familia,
      drawdownMaxPct: e.drawdownMaxPct, concentracaoMaxima,
      altoRiscoAlavancagem: (cfg?.alavancagem ?? 0) > 5,
      posicoesAbertas: e.posicoesVirtuais.length, capitalOcioso: capitalTotal,
    };
  });
}

// ── telemetria.json ─────────────────────────────────────────────────────

export interface TelemetriaDashboard {
  geradoEm: number;
  pid: number; startedAt: number; uptimeMs: number;
  ultimoCiclo: number; idadeUltimoCicloMs: number;
  ciclosProcessados: number; ciclosComErro: number; reinicios: number;
  latencia: { p50: number; p95: number; p99: number; max: number };
  errosUltimas24h: number;
  statusPorChallenger: Record<string, 'ok' | 'erro' | 'eliminado'>;
}

export function construirTelemetria(hb: HeartbeatLab): TelemetriaDashboard {
  return {
    geradoEm: Date.now(),
    pid: hb.pid, startedAt: hb.startedAt, uptimeMs: Date.now() - hb.startedAt,
    ultimoCiclo: hb.ultimoCiclo, idadeUltimoCicloMs: hb.ultimoCiclo > 0 ? Date.now() - hb.ultimoCiclo : Infinity,
    ciclosProcessados: hb.ciclosProcessados, ciclosComErro: hb.ciclosComErro, reinicios: hb.reinicios,
    latencia: percentis(hb.latenciasRecentesMs),
    errosUltimas24h: errosNaJanela(hb),
    statusPorChallenger: hb.statusPorChallenger,
  };
}

// ── I/O: a única função que toca disco ─────────────────────────────────

function dirDashboard(root: string): string {
  return path.join(root, 'inteligencia', 'dashboard');
}

function lerJsonSeguro<T>(p: string, vazio: T): T {
  try {
    if (!fs.existsSync(p)) return vazio;
    return JSON.parse(fs.readFileSync(p, 'utf8')) as T;
  } catch { return vazio; }
}

function lerDiarioLimitado(p: string, limiteLinhas = 4000): EventoCusto[] {
  if (!fs.existsSync(p)) return [];
  const linhas = fs.readFileSync(p, 'utf8').trim().split('\n').filter(Boolean).slice(-limiteLinhas);
  return linhas.map((l) => { try { return JSON.parse(l) as EventoCusto; } catch { return null; } }).filter((x): x is EventoCusto => x !== null);
}

export interface EntradaAgregacao {
  estados: EstadoVirtual[];
  configs: ConfigChallenger[];
  heartbeat: HeartbeatLab;
  championPnlPct: number;
  validacaoControl: RelatorioValidacao | null;
}

/**
 * Executa a agregação completa e grava os 6 arquivos. Chamado de dentro do
 * processo do Lab (paper-profit-lab.ts), nunca do dashboard/server.ts.
 */
export function executarAgregacao(root: string, entrada: EntradaAgregacao): void {
  const { estados, configs, heartbeat } = entrada;
  const leaderboard = montarLeaderboard(estados, entrada.championPnlPct, configs);

  const championEstado = lerJsonSeguro<any>(path.join(root, 'spread', 'estado.json'), null);
  const championMarcacao = lerJsonSeguro<ResumoMarcacao | null>(path.join(root, 'spread', 'marcacao.json'), null);
  const resumo = construirResumo(estados, leaderboard, championEstado, championMarcacao);

  const frequencia = construirFrequencia(estados, leaderboard, heartbeat);

  const eventosChampion = lerDiarioLimitado(path.join(root, 'spread', 'diario.jsonl'));
  const decompChampion = eventosChampion.length ? decompor(eventosChampion) : null;
  const fundingChampionRecente = eventosChampion.filter((e) => e.evento === 'funding').reduce((s, e) => s + ((e as any).ganho ?? 0), 0);
  const custos: CustosDashboard = {
    geradoEm: Date.now(),
    champion: decompChampion ? {
      ...decompChampion,
      feeToGrossTrading: fundingChampionRecente > 0 ? decompChampion.custoTradingPuro / fundingChampionRecente : Infinity,
      feeToGrossTotal: fundingChampionRecente > 0 ? decompChampion.custoTotal / fundingChampionRecente : Infinity,
      fundingBruto: fundingChampionRecente,
    } : null,
    porChallenger: construirCustos(estados),
  };

  const riscos = { geradoEm: Date.now(), porChallenger: construirRiscos(estados, configs) };
  const telemetria = construirTelemetria(heartbeat);

  // ── janela comum (Partes 3-5 da validação de integridade) — nunca mostra
  // o total histórico bruto como se tivesse acontecido dentro da janela ──
  const snapshotChampion = championEstado ? {
    capital: championEstado.capital ?? 0, fundingTotal: championEstado.fundingTotal ?? 0,
    custosTotal: championEstado.custosTotal ?? 0, pagamentos: championEstado.pagamentos ?? 0,
    equityMark: championMarcacao?.equityMark ?? null, equityLiquidacao: championMarcacao?.equityLiquidacao ?? null,
  } : null;
  const snapshotHeartbeat = { reinicios: heartbeat.reinicios, ciclosComErro: heartbeat.ciclosComErro };
  const janela = carregarOuCriarJanelaComum(root, estados, snapshotChampion, snapshotHeartbeat);
  const janelaComumDeltas = {
    geradoEm: Date.now(),
    commonWindowStart: janela.commonWindowStart, commonWindowEnd: janela.commonWindowEnd,
    duracaoJanelaMinutos: (janela.commonWindowEnd - janela.commonWindowStart) / 60_000,
    champion: calcularDeltasChampion(janela, snapshotChampion),
    heartbeat: calcularDeltasHeartbeat(janela, snapshotHeartbeat),
    porChallenger: calcularDeltasChallengers(janela, estados),
    // Parte 3 da correção: nenhuma posição herdada de antes da janela pode
    // ter seu custo de entrada (que já aconteceu) recontado como se fosse
    // desta janela — a classificação abaixo é o que permite quem lê saber
    // qual posição é qual, sem escrever nenhuma conta nova aqui.
    posicoesPorChallenger: Object.fromEntries(estados.map((e) => [
      e.challengerId,
      classificarPosicoesAbertas(e.posicoesVirtuais, janela.commonWindowStart),
    ])),
    fechamentosPorChallenger: Object.fromEntries(estados.map((e) => [
      e.challengerId,
      fechamentosNaJanela(root, e.challengerId, janela.commonWindowStart),
    ])),
    // Parte 4 da correção: challenger de captura com posição ainda aberta
    // nunca é "resultado concluído" — status explícito em vez de deixar o
    // PnL negativo do custo de entrada parecer uma operação perdedora final.
    capturaStatus: estados.filter((e) => e.posicoesVirtuais.some((p) => p.fundingJaRecebido === false || p.fundingJaRecebido === undefined) && e.posicoesVirtuais.length > 0 && e.challengerId.startsWith('capture-'))
      .flatMap((e) => e.posicoesVirtuais.map((p) => ({
        challengerId: e.challengerId, symbol: p.symbol,
        entradaAntesOuDentroDaJanela: p.abertaEm < janela.commonWindowStart ? 'antes' : 'dentro',
        timestampEntrada: p.abertaEm, timestampSettlement: p.proximaLiquidacaoEm ?? null,
        fundingEsperado: p.notionalPorPerna * (p.spread8hEntrada ?? 0) * ((p.intervaloHorasLiquidacao ?? 8) / 8),
        fundingRecebido: p.fundingJaRecebido ? (p.notionalPorPerna * (p.spread8hEntrada ?? 0) * ((p.intervaloHorasLiquidacao ?? 8) / 8)) : 0,
        status: p.fundingJaRecebido ? 'aguardando fechamento' : 'posição aberta · funding pendente · PnL ainda não concluído',
      }))),
    aviso: 'toda métrica acumulada aqui é deltaNaJanela (valorNoFim - valorNoInicio) — nunca o total histórico bruto do challenger/champion',
  };

  const dir = dirDashboard(root);
  fs.mkdirSync(dir, { recursive: true });
  const escrever = (nome: string, dados: unknown) => {
    // grava em arquivo temporário e renomeia — leitura concorrente do
    // servidor web nunca vê um JSON pela metade
    const alvo = path.join(dir, nome);
    const tmp = alvo + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(dados, null, 2));
    fs.renameSync(tmp, alvo);
  };
  escrever('resumo.json', resumo);
  escrever('leaderboard.json', leaderboard);
  escrever('frequencia.json', frequencia);
  escrever('custos.json', custos);
  escrever('riscos.json', riscos);
  escrever('telemetria.json', telemetria);
  escrever('janela-comum.json', janelaComumDeltas);
  if (entrada.validacaoControl) escrever('champion-vs-control.json', { geradoEm: Date.now(), validacao: entrada.validacaoControl });
}
