/**
 * NÚCLEO VIRTUAL DE CAPTURA DE SETTLEMENT (Parte 2 do "Paper Profit Dashboard
 * — Captura", 6ª etapa desta sessão).
 *
 * Reusa as fórmulas econômicas REAIS, nunca reimplementadas:
 *   - `avaliarCaptura`, `msAteProximaLiquidacao`, `fundingPorLiquidacao`,
 *     `cruzarParaCaptura` — `funding/liquidacao.ts`
 *   - `lerCaptura()` — `funding/ponte-captura.ts` (mesmo feed que a
 *     vigilância já grava em `vigilancia/captura.json`, lido também pelo
 *     motor real quando modo captura está ligado)
 *   - `dimensionar`, `taxaEfetiva`, `taxaDaOperacao`, `ESCORREGAMENTO_PERNA`
 *   - `marcarPosicao`/`resumirMarcacao` para mark-to-market
 *   - toda a "cola" de contabilidade (capitalTotal, debitar, creditar,
 *     repartir, cobrarEntrada, cobrarSaida, somarCustos, registrar,
 *     exposicaoPorExchange, atualizarPnl) — exportada de
 *     `virtual-portfolio.ts` de propósito, pra não duplicar bookkeeping.
 *
 * Diferença estrutural do `cicloChallenger()` de persistência: captura não
 * tem "vida útil estimada" nem apara/reinvestimento — é uma máquina de
 * estados de UMA liquidação só: candidata dentro da janela → cobre custo →
 * entra → aguarda o settlement → recebe (uma vez, nunca duas) → fecha. Por
 * isso vive em arquivo próprio em vez de virar mais um `if` dentro de
 * `cicloChallenger()`.
 *
 * `EstadoVirtual`/`ConfigChallenger`/`PosicaoVirtual` são REUSADOS sem
 * subclasse — os campos exclusivos de captura (`proximaLiquidacaoEm`,
 * `spread8hEntrada`, `fundingJaRecebido`, `janelaCapturaMs`,
 * `coberturaMinima`, contadores de funil) já foram adicionados a esses tipos
 * como campos opcionais. Isso significa que leaderboard.ts,
 * dashboard-aggregator.ts, controle.ts e o dashboard funcionam para
 * challengers de captura SEM NENHUMA mudança adicional.
 *
 * LIMITAÇÃO HONESTA, documentada e não escondida: `fundingRecebido` usa o
 * `spread8h` medido NA ENTRADA (`spread8hEntrada`), não uma leitura ao vivo
 * da taxa de funding no instante exato do settlement — não existe, hoje,
 * feed de funding-rate-no-settlement de alta frequência disponível pro
 * Lab. Isso é uma aproximação, mesma classe de aproximação que todo o resto
 * do Lab já assume (preço marcado a cada ciclo de ~5min, não tick a tick).
 */
import fs from 'node:fs';
import path from 'node:path';
import { avaliarCaptura, fundingPorLiquidacao, type CandidatoCaptura } from '../funding/liquidacao.ts';
import { taxaEfetiva, taxaDaOperacao, ESCORREGAMENTO_PERNA } from '../funding/custos-reais.ts';
import { dimensionar } from '../funding/tesouraria.ts';
import { novoCycleId } from './registro-oportunidades.ts';
import {
  type EstadoVirtual, type ConfigChallenger, type PosicaoVirtual, type BuscarPreco,
  capitalTotal, exposicaoPorExchange, debitar, repartir, cobrarEntrada, cobrarSaida,
  registrar, atualizarPnl,
} from './virtual-portfolio.ts';

const DEFAULT_COBERTURA_MINIMA = 1.5;

/** Registro estruturado de UMA operação de captura completa (Parte 4) — nunca reconstruído depois, gravado no fechamento. */
export interface EventoCapturaCompleta {
  challengerId: string;
  cycleId: string;
  symbol: string;
  exchangeShort: string;
  exchangeLong: string;
  timestampEntrada: number;
  timestampSettlement: number;
  timestampSaida: number;
  tempoAteSettlementMs: number;
  fundingEsperado: number;
  fundingRecebido: number;
  taxas: number;
  slippage: number;
  pnlRealizado: number;
  pnlNaoRealizado: number;
  equityLiquidacao: number;
  motivoSaida: 'fechamento_apos_settlement' | 'inversao_antes_do_settlement' | 'emergencial';
}

function caminhoCapturas(root: string, challengerId: string): string {
  return path.join(root, 'inteligencia', 'challengers', challengerId, 'capturas.jsonl');
}

/** Nunca lança — falha de escrita é engolida, mesma disciplina de registro-oportunidades.ts. */
export function registrarEventoCaptura(root: string, ev: EventoCapturaCompleta): void {
  try {
    const p = caminhoCapturas(root, ev.challengerId);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.appendFileSync(p, JSON.stringify(ev) + '\n');
  } catch { /* nunca bloqueia o ciclo por causa de log */ }
}

export function lerEventosCaptura(root: string, challengerId: string, limite = 200): EventoCapturaCompleta[] {
  const p = caminhoCapturas(root, challengerId);
  if (!fs.existsSync(p)) return [];
  const linhas = fs.readFileSync(p, 'utf8').trim().split('\n').filter(Boolean).slice(-limite);
  return linhas.map((l) => { try { return JSON.parse(l) as EventoCapturaCompleta; } catch { return null; } })
    .filter((x): x is EventoCapturaCompleta => x !== null).reverse();
}

/**
 * Um ciclo de decisão de captura. Recebe os MESMOS candidatos que
 * `lerCaptura()` devolveu neste ciclo (compartilhado entre todos os
 * challengers de captura do Lab, igual ao `ops` de `cicloChallenger`).
 *
 * `root` é necessário aqui (diferente de `cicloChallenger`) só pra gravar o
 * evento estruturado de captura completa no fechamento — nunca lê nem
 * escreve nada do champion.
 */
export async function cicloCaptura(
  root: string, cfg: ConfigChallenger, eIn: EstadoVirtual, candidatos: CandidatoCaptura[], buscarPreco: BuscarPreco,
): Promise<void> {
  const e = eIn;
  if (e.eliminado || e.pausado) return;

  const agora = Date.now();
  const cap = capitalTotal(e);
  e.pico = Math.max(e.pico, cap);
  const dd = e.pico > 0 ? (e.pico - cap) / e.pico : 0;
  e.drawdownMaxPct = Math.max(e.drawdownMaxPct, dd * 100);
  e.candidatasObservadas = (e.candidatasObservadas ?? 0) + candidatos.length;

  const janelaMs = cfg.janelaCapturaMs ?? 10 * 60_000;
  const coberturaMinima = cfg.coberturaMinima ?? DEFAULT_COBERTURA_MINIMA;

  // ── gerenciar posições abertas ──────────────────────────────────────────
  for (const pos of [...e.posicoesVirtuais]) {
    let preco: number;
    try { preco = await buscarPreco(pos.exchangeShort, pos.symbol); } catch { continue; }
    const delta = pos.precoUltimo ? preco / pos.precoUltimo - 1 : 0;
    pos.margemShort -= pos.notionalPorPerna * delta;
    pos.margemLong += pos.notionalPorPerna * delta;
    pos.precoUltimo = preco;

    const proximaLiquidacaoEm = pos.proximaLiquidacaoEm ?? 0;
    const settlementPassou = agora >= proximaLiquidacaoEm;

    // ── inversão antes do settlement: candidata sumiu ou spread não é mais positivo ──
    if (!settlementPassou) {
      const atual = candidatos.find((c) => c.symbol === pos.symbol && c.exchangeShort === pos.exchangeShort && c.exchangeLong === pos.exchangeLong);
      const invertida = !atual || atual.spread8h <= 0;
      if (invertida) {
        const custo = cobrarSaida(e, pos.exchangeShort, pos.exchangeLong, pos.notionalPorPerna);
        repartir(e, pos, -custo);
        e.posicoesVirtuais.splice(e.posicoesVirtuais.indexOf(pos), 1);
        e.inversoesAntesDoSettlement = (e.inversoesAntesDoSettlement ?? 0) + 1;
        registrar(e, 'fecha', `${pos.symbol} — captura invertida antes do settlement, custo US$${custo.toFixed(3)}`);
        registrarEventoCaptura(root, {
          challengerId: e.challengerId, cycleId: pos.cycleId ?? '', symbol: pos.symbol,
          exchangeShort: pos.exchangeShort, exchangeLong: pos.exchangeLong,
          timestampEntrada: pos.abertaEm, timestampSettlement: proximaLiquidacaoEm, timestampSaida: agora,
          tempoAteSettlementMs: proximaLiquidacaoEm - pos.abertaEm,
          fundingEsperado: pos.notionalPorPerna * (pos.spread8hEntrada != null ? fundingPorLiquidacao(pos.spread8hEntrada, pos.intervaloHorasLiquidacao ?? 8) : 0),
          fundingRecebido: 0, taxas: custo, slippage: 0,
          pnlRealizado: -custo, pnlNaoRealizado: 0, equityLiquidacao: capitalTotal(e),
          motivoSaida: 'inversao_antes_do_settlement',
        });
        continue;
      }
    }

    // ── settlement passou e funding ainda não foi pago: paga UMA VEZ ────────
    if (settlementPassou && !pos.fundingJaRecebido) {
      const pagamentoFracao = fundingPorLiquidacao(pos.spread8hEntrada ?? 0, pos.intervaloHorasLiquidacao ?? 8);
      const ganho = pos.notionalPorPerna * pagamentoFracao;
      pos.fundingAcumulado += ganho;
      pos.fundingJaRecebido = true;
      repartir(e, pos, ganho);
      e.fundingBruto += ganho;
      e.settlements++;
      registrar(e, 'funding', `${pos.symbol} — captura +US$${ganho.toFixed(4)}`);
    }

    // ── settlement passou e funding já foi pago: fecha (mesma checagem em
    // ciclo seguinte se algo impediu o fechamento no mesmo ciclo — idempotente) ──
    if (settlementPassou && pos.fundingJaRecebido) {
      const custo = cobrarSaida(e, pos.exchangeShort, pos.exchangeLong, pos.notionalPorPerna);
      repartir(e, pos, -custo);
      const ganhoRecebido = pos.notionalPorPerna * fundingPorLiquidacao(pos.spread8hEntrada ?? 0, pos.intervaloHorasLiquidacao ?? 8);
      e.posicoesVirtuais.splice(e.posicoesVirtuais.indexOf(pos), 1);
      registrar(e, 'fecha', `${pos.symbol} — captura concluída após settlement, custo US$${custo.toFixed(3)}`);
      registrarEventoCaptura(root, {
        challengerId: e.challengerId, cycleId: pos.cycleId ?? '', symbol: pos.symbol,
        exchangeShort: pos.exchangeShort, exchangeLong: pos.exchangeLong,
        timestampEntrada: pos.abertaEm, timestampSettlement: proximaLiquidacaoEm, timestampSaida: agora,
        tempoAteSettlementMs: proximaLiquidacaoEm - pos.abertaEm,
        fundingEsperado: ganhoRecebido, fundingRecebido: ganhoRecebido,
        taxas: custo, slippage: 0,
        pnlRealizado: ganhoRecebido - custo, pnlNaoRealizado: 0, equityLiquidacao: capitalTotal(e),
        motivoSaida: 'fechamento_apos_settlement',
      });
    }
  }

  if (e.posicoesVirtuais.length >= cfg.maxPosicoes) { atualizarPnl(e); return; }

  // ── avaliar candidatas ───────────────────────────────────────────────────
  const jaTenho = new Set(e.posicoesVirtuais.map((p) => p.symbol));
  let melhor: { c: CandidatoCaptura; notional: number; margem: number; taxa: number; cobertura: number; tempoAteSettlement: number } | null = null;
  let melhorCobertura = -Infinity;

  for (const c of candidatos) {
    if (jaTenho.has(c.symbol)) continue;
    if (!cfg.exchanges.includes(c.exchangeShort) || !cfg.exchanges.includes(c.exchangeLong)) continue;

    const tempoAteSettlement = c.proximaLiquidacaoEm - agora;
    if (tempoAteSettlement <= 0 || tempoAteSettlement > janelaMs) { e.bloqueiosPorJanela = (e.bloqueiosPorJanela ?? 0) + 1; continue; }

    const taxa = taxaEfetiva(c.exchangeShort, c.exchangeLong);
    const av = avaliarCaptura({ spread8h: c.spread8h, intervaloHoras: c.intervaloHoras, taxaEfetiva: taxa, margem: coberturaMinima });
    if (!av.vale) { e.bloqueiosPorCobertura = (e.bloqueiosPorCobertura ?? 0) + 1; continue; }

    const d = dimensionar(e.saldoVirtualPorExchange, exposicaoPorExchange(e), c.exchangeShort, c.exchangeLong, cfg.alavancagem, cfg.reserva);
    if (!d.possivel) { e.bloqueiosPorSaldo++; continue; }

    if (av.cobertura > melhorCobertura) {
      melhorCobertura = av.cobertura;
      melhor = { c, notional: d.notionalPorPerna, margem: d.margemPorPerna, taxa, cobertura: av.cobertura, tempoAteSettlement };
    }
  }

  if (melhor) {
    const custo = cobrarEntrada(e, melhor.c.exchangeShort, melhor.c.exchangeLong, melhor.notional, 'trade');
    debitar(e, melhor.c.exchangeShort, custo / 2);
    debitar(e, melhor.c.exchangeLong, custo / 2);
    e.trades++;
    let preco = 0;
    try { preco = await buscarPreco(melhor.c.exchangeShort, melhor.c.symbol); } catch { /* marcação corrige no próximo ciclo */ }
    const cycleId = novoCycleId(agora, 'captura');
    e.posicoesVirtuais.push({
      symbol: melhor.c.symbol, exchangeShort: melhor.c.exchangeShort, exchangeLong: melhor.c.exchangeLong,
      notionalPorPerna: melhor.notional, precoEntrada: preco, precoUltimo: preco,
      margemShort: melhor.margem, margemLong: melhor.margem,
      abertaEm: agora, fundingAcumulado: 0, faltasSeguidas: 0, taxa: melhor.taxa, estagio: 2,
      proximaLiquidacaoEm: melhor.c.proximaLiquidacaoEm, intervaloHorasLiquidacao: melhor.c.intervaloHoras,
      spread8hEntrada: melhor.c.spread8h, fundingJaRecebido: false, cycleId,
    });
    registrar(e, 'abre', `${melhor.c.symbol} ${melhor.c.exchangeShort}/${melhor.c.exchangeLong} captura notional US$${melhor.notional.toFixed(2)} cobertura ${melhor.cobertura.toFixed(2)}x, settlement em ${(melhor.tempoAteSettlement / 60000).toFixed(1)}min`);
  }

  atualizarPnl(e);
}
