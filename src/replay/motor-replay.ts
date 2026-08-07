/**
 * REPLAY FIEL DO CHAMPION — reconstrói decisões históricas reutilizando as
 * mesmas funções puras que o motor ao vivo usa (`avaliarValor`,
 * `chaveOrdenacao`, `taxaEfetiva`, `consistenciaAjustada`), sobre
 * `vigilancia/historico.jsonl`.
 *
 * ── o que É reutilizado de verdade (mesmo código, importado, não copiado) ──
 *
 *   avaliarValor, chaveOrdenacao     src/funding/valor.ts
 *   taxaEfetiva                       src/funding/custos-reais.ts
 *   consistenciaAjustada, TOLERANCIA_FALTAS   src/funding/vigilancia.ts
 *
 * ── o que NÃO é reutilizado, e por quê ──────────────────────────────────
 *
 * `MotorSpread` (spread-live.ts) é uma classe com estado mutável privado e
 * I/O de rede entrelaçados na mesma função (`ciclo()`, `abrir()`, `gerir()`
 * fazem fetch de ticker/orderbook E decidem, no mesmo método). Extrair só a
 * decisão sem tocar nesses métodos (proibido nesta etapa: "preservar
 * resultados atuais... não alterar decisões") exigiria refatoração real,
 * fora do escopo autorizado aqui. Este replay REIMPLEMENTA a orquestração
 * (laço de abrir/gerenciar/fechar) usando os MESMOS primitivos de decisão —
 * é a diferença entre "mesma matemática" (garantido, mesmas funções) e
 * "mesmo código de orquestração" (não garantido — ver validação abaixo, que
 * existe exatamente para medir o tamanho dessa lacuna, não para escondê-la).
 *
 * Simplificações explícitas, todas na direção CONSERVADORA (o replay abre
 * MENOS, não mais, que o motor real teria aberto):
 *   - sem apara (redimensionar()) e sem reinvestimento pós-abertura
 *   - funding cobrado por janela de ~7,75h com spread médio da janela, não
 *     por timestamp exato de liquidação (dado de calendário não coletado)
 *   - consistência reconstruída por tolerância de gap entre observações
 *     (usa TOLERANCIA_FALTAS real), não pelo Wilson sobre o histórico
 *     completo de ciclos.json (esse arquivo é snapshot vivo, não log
 *     append-only, e não preserva o passado completo para reprocessar)
 *
 * O estágio inicial (abre em 1,0x com FRACAO_ESTAGIO_INICIAL do tamanho, e
 * escalona pra cheio ao cruzar margemPayback) FOI implementado, reusando a
 * constante real exportada de spread-live.ts — era a maior fonte conhecida
 * de sub-reprodução na primeira versão deste replay (ver validação no CLI).
 */
import { avaliarValor, chaveOrdenacao, type EntradaValor } from '../funding/valor.ts';
import { taxaEfetiva } from '../funding/custos-reais.ts';
import { consistenciaAjustada, TOLERANCIA_FALTAS } from '../funding/vigilancia.ts';
import { FRACAO_ESTAGIO_INICIAL } from '../funding/spread-live.ts';

export interface ObservacaoHistorico {
  ts: number;
  /** `symbol|exchangeShort|exchangeLong` — mesmo formato de vigilancia/historico.jsonl */
  k: string;
  spread: number;
  apr: number;
  vol: number;
}

export interface OpcoesReplay {
  exchanges: string[];
  capitalPorExchange: number;
  alavancagem: number;
  reserva: number;
  margemPayback: number;
  maxPosicoes: number;
  notionalMinimo: number;
}

export const OPCOES_REPLAY_PADRAO: OpcoesReplay = {
  exchanges: ['binanceusdm', 'bybit', 'okx', 'gate', 'bitget', 'bingx'],
  capitalPorExchange: 100,
  alavancagem: 5,
  reserva: 0.30,
  margemPayback: 1.5,
  maxPosicoes: 3,
  notionalMinimo: 5,
};

interface VidaChave { primeiraTs: number; ultimaTs: number; contagem: number; }
interface PosicaoReplay {
  chave: string; symbol: string; exShort: string; exLong: string;
  notionalPorPerna: number; taxa: number;
  abertaEm: number; janelaInicioTs: number; spreadsJanela: number[];
  fundingAcumulado: number; faltasSeguidas: number;
  /** 1 = fatia inicial (folga entre 1,0x e margemPayback), 2 = tamanho cheio */
  estagio: 1 | 2;
}

export interface EventoReplay {
  ts: number; tipo: 'abre' | 'fecha' | 'funding' | 'bloqueado';
  symbol?: string; exShort?: string; exLong?: string;
  notional?: number; custo?: number; ganho?: number; motivo?: string;
}

export interface ResultadoReplay {
  exchanges: string[];
  ciclosObservados: number;
  trades: number;
  bloqueios: number;
  fundingTotal: number;
  custosTotais: number;
  pnlLiquido: number;
  drawdownMaxPct: number;
  equityFinal: number;
  janelaHoras: number;
  eventos: EventoReplay[];
}

const CICLO_MS = 5 * 60_000;

/**
 * Roda o replay sobre uma janela de observações já filtrada (por exchange,
 * por ativo, o que for) — filtrar ANTES de chamar é responsabilidade de
 * quem chama, esta função só orquestra decisão sobre o que recebe.
 */
export function rodarReplay(observacoes: ObservacaoHistorico[], opts: Partial<OpcoesReplay> = {}): ResultadoReplay {
  const o = { ...OPCOES_REPLAY_PADRAO, ...opts };
  const toleranciaGapMs = (TOLERANCIA_FALTAS + 1) * CICLO_MS;
  const eventos: EventoReplay[] = [];

  if (!observacoes.length) {
    return {
      exchanges: o.exchanges, ciclosObservados: 0, trades: 0, bloqueios: 0,
      fundingTotal: 0, custosTotais: 0, pnlLiquido: 0, drawdownMaxPct: 0,
      equityFinal: o.capitalPorExchange * o.exchanges.length, janelaHoras: 0, eventos,
    };
  }

  const obs = [...observacoes].sort((a, b) => a.ts - b.ts);
  const porChave = new Map<string, ObservacaoHistorico[]>();
  for (const ob of obs) {
    if (!porChave.has(ob.k)) porChave.set(ob.k, []);
    porChave.get(ob.k)!.push(ob);
  }

  // reconstrói vida por chave (tolerância de gap == produção)
  const vidaPorChaveETs = new Map<string, { obs: ObservacaoHistorico; vida: VidaChave }[]>();
  for (const [chave, serie] of porChave) {
    let atual: VidaChave | null = null;
    const linha: { obs: ObservacaoHistorico; vida: VidaChave }[] = [];
    for (const ob of serie) {
      if (atual && ob.ts - atual.ultimaTs <= toleranciaGapMs) {
        atual = { primeiraTs: atual.primeiraTs, ultimaTs: ob.ts, contagem: atual.contagem + 1 };
      } else {
        atual = { primeiraTs: ob.ts, ultimaTs: ob.ts, contagem: 1 };
      }
      linha.push({ obs: ob, vida: atual });
    }
    vidaPorChaveETs.set(chave, linha);
  }

  const ciclos = [...new Set(obs.map((x) => x.ts))].sort((a, b) => a - b);
  const totalCapital = o.capitalPorExchange * o.exchanges.length;
  const saldos: Record<string, number> = Object.fromEntries(o.exchanges.map((e) => [e, o.capitalPorExchange]));
  const posicoes: PosicaoReplay[] = [];
  let bloqueios = 0, custosTotais = 0, fundingTotal = 0;
  let pico = totalCapital, drawdownMax = 0;

  const ponteiro = new Map([...porChave.keys()].map((k) => [k, 0]));
  const conhecido = new Map<string, { obs: ObservacaoHistorico; vida: VidaChave }>();
  function atualizarConhecido(ts: number) {
    for (const [chave, linha] of vidaPorChaveETs) {
      let idx = ponteiro.get(chave)!;
      while (idx < linha.length && linha[idx].obs.ts <= ts) { conhecido.set(chave, linha[idx]); idx++; }
      ponteiro.set(chave, idx);
    }
  }
  /**
   * `desde` opcional: quando informado (posição já aberta), exige que a vida
   * atual seja a MESMA que estava em curso quando a posição abriu — não
   * basta existir observação recente. Sem isso, um gap grande demais (que
   * reinicia `vida.primeiraTs`) passava despercebido: `conhecido` já teria
   * avançado pro registro pós-gap antes desta checagem rodar no mesmo
   * ciclo, e "há observação agora" ficava indistinguível de "esta é a
   * mesma vida que a posição estava seguindo". Achado escrevendo o teste de
   * gap, não em produção — mas o bug era só deste replay, não do champion.
   */
  function vivaAgora(chave: string, ts: number, desde?: number) {
    const c = conhecido.get(chave);
    if (!c) return null;
    if (ts - c.vida.ultimaTs > toleranciaGapMs) return null;
    if (desde != null && c.vida.primeiraTs > desde) return null; // vida reiniciada depois que a posição abriu
    return c;
  }

  const JANELA_FUNDING_H = 7.75;

  for (const ts of ciclos) {
    atualizarConhecido(ts);
    const capitalAtual = Object.values(saldos).reduce((a, b) => a + b, 0);
    pico = Math.max(pico, capitalAtual);
    drawdownMax = Math.max(drawdownMax, (pico - capitalAtual) / pico);

    // gerenciar posições abertas
    for (const pos of [...posicoes]) {
      const viva = vivaAgora(pos.chave, ts, pos.abertaEm);
      if (!viva) {
        pos.faltasSeguidas++;
        if (pos.faltasSeguidas >= 2) {
          const custoSaida = pos.notionalPorPerna * pos.taxa * 2;
          saldos[pos.exShort] -= custoSaida / 2; saldos[pos.exLong] -= custoSaida / 2;
          custosTotais += custoSaida;
          eventos.push({ ts, tipo: 'fecha', symbol: pos.symbol, exShort: pos.exShort, exLong: pos.exLong, custo: custoSaida, motivo: 'spread ausente/invertido' });
          posicoes.splice(posicoes.indexOf(pos), 1);
        }
        continue;
      }
      pos.faltasSeguidas = 0;

      // escalona pra tamanho cheio se a fatia inicial já provou payback×margem
      if (pos.estagio === 1) {
        const duracaoHoras = (ts - viva.vida.primeiraTs) / 3_600_000;
        const esperadasPos = Math.max(1, Math.round((duracaoHoras * 60) / 5));
        const consistPos = consistenciaAjustada(Math.min(1, viva.vida.contagem / esperadasPos), viva.vida.contagem);
        const valPos = avaliarValor({ spread: viva.obs.spread, consistencia: consistPos, duracaoHoras, notional: pos.notionalPorPerna, taxa: pos.taxa });
        if (valPos.folga >= o.margemPayback) {
          // tamanho cheio recalculado com o saldo livre AGORA (mesmo padrão
          // do escalonamento real em spread-live.ts: dimensiona de novo, não
          // reconstrói o alvo original da abertura)
          const livre = Math.min(saldos[pos.exShort], saldos[pos.exLong]) * (1 - o.reserva);
          const notionalPossivel = pos.notionalPorPerna + livre * o.alavancagem;
          const notionalNovo = Math.max(pos.notionalPorPerna, notionalPossivel);
          if (notionalNovo > pos.notionalPorPerna) {
            const notionalAdicionado = notionalNovo - pos.notionalPorPerna;
            const custoEscalonamento = notionalAdicionado * pos.taxa * 2;
            saldos[pos.exShort] -= custoEscalonamento / 2; saldos[pos.exLong] -= custoEscalonamento / 2;
            custosTotais += custoEscalonamento;
            pos.notionalPorPerna = notionalNovo;
            pos.estagio = 2;
            eventos.push({ ts, tipo: 'abre', symbol: pos.symbol, notional: notionalAdicionado, custo: custoEscalonamento, motivo: 'escalonamento' });
          }
        }
      }

      pos.spreadsJanela.push(viva.obs.spread);
      if ((ts - pos.janelaInicioTs) / 3_600_000 >= JANELA_FUNDING_H) {
        const spreadMedio = pos.spreadsJanela.reduce((s, x) => s + x, 0) / pos.spreadsJanela.length;
        const ganho = pos.notionalPorPerna * spreadMedio;
        pos.fundingAcumulado += ganho;
        fundingTotal += ganho;
        saldos[pos.exShort] += ganho / 2; saldos[pos.exLong] += ganho / 2;
        pos.janelaInicioTs = ts; pos.spreadsJanela = [];
        eventos.push({ ts, tipo: 'funding', symbol: pos.symbol, ganho });
      }
    }

    if (posicoes.length >= o.maxPosicoes) continue;

    // candidatas viáveis neste ciclo
    const candidatas: { chave: string; symbol: string; exShort: string; exLong: string; obs: ObservacaoHistorico; vida: VidaChave }[] = [];
    for (const [chave, c] of conhecido) {
      const viva = vivaAgora(chave, ts);
      if (!viva || viva.obs.spread <= 0) continue;
      if (posicoes.some((p) => p.chave === chave)) continue;
      const [symbol, exShort, exLong] = chave.split('|');
      if (!o.exchanges.includes(exShort) || !o.exchanges.includes(exLong)) continue;
      candidatas.push({ chave, symbol, exShort, exLong, obs: viva.obs, vida: viva.vida });
    }

    let melhor: { chave: string; symbol: string; exShort: string; exLong: string; notionalPorPerna: number; taxa: number; estagio: 1 | 2 } | null = null;
    let melhorScore = -Infinity;
    for (const cand of candidatas) {
      if (cand.vida.contagem < 3) continue;
      const duracaoHoras = (ts - cand.vida.primeiraTs) / 3_600_000;
      const esperadas = Math.max(1, Math.round((duracaoHoras * 60) / 5));
      const consistBruta = Math.min(1, cand.vida.contagem / esperadas);
      const consist = consistenciaAjustada(consistBruta, cand.vida.contagem);
      const livre = Math.min(saldos[cand.exShort], saldos[cand.exLong]) * (1 - o.reserva);
      const notionalPorPernaCheio = livre * o.alavancagem;
      const taxa = taxaEfetiva(cand.exShort, cand.exLong);
      const entradaCheia: EntradaValor = { spread: cand.obs.spread, consistencia: consist, duracaoHoras, notional: notionalPorPernaCheio, taxa };
      const val = avaliarValor(entradaCheia);
      // portão escalonado: abaixo de 1,0x nunca abre; entre 1,0x e margemPayback
      // abre uma fatia (FRACAO_ESTAGIO_INICIAL); acima, abre cheio — mesma
      // regra de spread-live.ts, reusando FRACAO_ESTAGIO_INICIAL importado
      if (val.folga < 1.0) { bloqueios++; continue; }
      const estagio: 1 | 2 = val.folga >= o.margemPayback ? 2 : 1;
      const fracao = estagio === 2 ? 1 : FRACAO_ESTAGIO_INICIAL;
      const notionalPorPerna = notionalPorPernaCheio * fracao;
      if (notionalPorPerna < o.notionalMinimo) continue;
      const score = chaveOrdenacao(entradaCheia);
      if (score > melhorScore) { melhorScore = score; melhor = { chave: cand.chave, symbol: cand.symbol, exShort: cand.exShort, exLong: cand.exLong, notionalPorPerna, taxa, estagio }; }
    }

    if (melhor) {
      const custoAbertura = melhor.notionalPorPerna * melhor.taxa * 2;
      saldos[melhor.exShort] -= custoAbertura / 2; saldos[melhor.exLong] -= custoAbertura / 2;
      custosTotais += custoAbertura;
      posicoes.push({
        chave: melhor.chave, symbol: melhor.symbol, exShort: melhor.exShort, exLong: melhor.exLong,
        notionalPorPerna: melhor.notionalPorPerna, taxa: melhor.taxa, estagio: melhor.estagio,
        abertaEm: ts, janelaInicioTs: ts, spreadsJanela: [], fundingAcumulado: 0, faltasSeguidas: 0,
      });
      eventos.push({ ts, tipo: 'abre', symbol: melhor.symbol, exShort: melhor.exShort, exLong: melhor.exLong, notional: melhor.notionalPorPerna, custo: custoAbertura });
    }
  }

  for (const pos of posicoes) {
    const custoSaida = pos.notionalPorPerna * pos.taxa * 2;
    saldos[pos.exShort] -= custoSaida / 2; saldos[pos.exLong] -= custoSaida / 2;
    custosTotais += custoSaida;
    eventos.push({ ts: ciclos[ciclos.length - 1], tipo: 'fecha', symbol: pos.symbol, custo: custoSaida, motivo: 'fim da janela do replay' });
  }

  const equityFinal = Object.values(saldos).reduce((a, b) => a + b, 0);
  return {
    exchanges: o.exchanges, ciclosObservados: ciclos.length,
    trades: eventos.filter((e) => e.tipo === 'abre').length, bloqueios,
    fundingTotal, custosTotais, pnlLiquido: fundingTotal - custosTotais,
    drawdownMaxPct: drawdownMax * 100, equityFinal,
    janelaHoras: (ciclos[ciclos.length - 1] - ciclos[0]) / 3_600_000,
    eventos,
  };
}
