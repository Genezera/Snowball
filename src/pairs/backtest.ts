/**
 * BACKTEST DE PARES — mercado-neutro, spread z-score.
 *
 * O motor de src/backtest/engine.ts é de UM instrumento por vez; pares
 * precisam de duas pernas simultâneas com uma posição conjunta, então este é
 * um loop dedicado. Reaproveita a mesma disciplina de custo do resto do
 * projeto: taxa taker + slippage nos dois lados, sem otimismo.
 *
 * ── a regra de entrada e saída ─────────────────────────────────────────────
 *
 * z-score do resíduo (spread menos a média móvel, sobre o desvio padrão
 * móvel), numa janela ROLANTE — não a janela inteira do treino, porque isso
 * seria usar informação futura. Entra quando |z| cruza `zEntrada`: comprado
 * na perna barata, vendido na cara (o resíduo positivo = A caro demais →
 * vende A, compra B; negativo = o oposto). Sai quando |z| volta a
 * `zSaida` (reversão parcial já validou a aposta) ou por tempo máximo
 * (`maxBarras` — se não reverteu, a hipótese de cointegração falhou PARA
 * ESTA JANELA, sair é mais barato que esperar).
 *
 * hedgeRatio e desvioResiduo vêm do PERÍODO DE FORMAÇÃO (passado, fixo
 * durante o teste) — recalcular a cada barra usando dado futuro seria
 * lookahead. Isso é fiel ao que se faria ao vivo: calibra o par periodicamente,
 * opera com a calibração até a próxima recalibração.
 */
import type { Bar } from '../core/types.ts';

export interface ParametrosPar {
  zEntrada: number;
  zSaida: number;
  maxBarras: number;
  /** janela rolante para média/desvio do z-score, em barras */
  janelaZ: number;
  taxaTaker: number;
  slippage: number;
  /**
   * Stop de divergência: se |z| for além disto, sai IMEDIATAMENTE, sem
   * esperar `maxBarras`. Sem isto, um par que diverge e nunca reverte fica
   * acumulando perda até o timeout — a cauda gorda clássica de
   * mean-reversion sem stop ("pegar moedinha na frente do trator"). Padrão
   * Infinity preserva o comportamento antigo (sem stop) para comparação.
   */
  zStop: number;
}

export const PARAMETROS_PADRAO: ParametrosPar = {
  zEntrada: 2.0, zSaida: 0.5, maxBarras: 20, janelaZ: 30,
  taxaTaker: 0.0005, slippage: 0.0005, zStop: Infinity,
};

export interface TradePar {
  entradaIdx: number;
  saidaIdx: number;
  /** 'longA' = comprado em A vendido em B (A estava barato); 'curtoA' = o oposto */
  direcao: 'longA' | 'curtoA';
  zEntrada: number;
  zSaida: number;
  /** retorno líquido do par, em fração do notional total das duas pernas */
  retorno: number;
  motivo: 'reversao' | 'timeout' | 'fim-dado' | 'stop-divergencia';
}

/**
 * Roda o backtest de UM par sobre `barsA`/`barsB` já alinhadas por índice.
 * `hedgeRatio` e `intercepto` vêm da formação (calculados fora, sobre uma
 * janela ANTERIOR ao início destas barras) — este loop só opera, não calibra.
 */
export function backtestPar(
  barsA: Bar[], barsB: Bar[],
  hedgeRatio: number, intercepto: number,
  p: ParametrosPar = PARAMETROS_PADRAO,
): TradePar[] {
  const n = Math.min(barsA.length, barsB.length);
  const logA = barsA.slice(0, n).map((b) => Math.log(b.c));
  const logB = barsB.slice(0, n).map((b) => Math.log(b.c));
  const residuo = logA.map((v, i) => v - (hedgeRatio * logB[i] + intercepto));

  const trades: TradePar[] = [];
  let emPosicao: { idx: number; direcao: 'longA' | 'curtoA'; z: number } | null = null;

  for (let i = p.janelaZ; i < n; i++) {
    const janela = residuo.slice(i - p.janelaZ, i);
    const media = janela.reduce((a, b) => a + b, 0) / janela.length;
    const variancia = janela.reduce((a, b) => a + (b - media) ** 2, 0) / janela.length;
    const desvio = Math.sqrt(variancia);
    // A janela pode ficar sem variância (spread quieto, ou o resíduo travou
    // num platô). z não é computável — mas se HÁ posição aberta, o tempo e o
    // fim dos dados continuam valendo: pular a barra inteira aqui deixava a
    // posição PRESA para sempre, sem nunca gerar o trade de saída (bug real,
    // achado pelo teste de stop de divergência). Sem posição, não há o que
    // fechar, então só pular mesmo é seguro.
    const zIndefinido = desvio <= 1e-12;
    const z = zIndefinido ? 0 : (residuo[i] - media) / desvio;

    if (!emPosicao) {
      if (zIndefinido) continue;
      if (z >= p.zEntrada) emPosicao = { idx: i, direcao: 'curtoA', z };
      else if (z <= -p.zEntrada) emPosicao = { idx: i, direcao: 'longA', z };
      continue;
    }

    const barrasDentro = i - emPosicao.idx;
    const reverteu = !zIndefinido && Math.abs(z) <= p.zSaida;
    // diverge MAIS na mesma direção que abriu a posição (não o lado oposto —
    // z passando de +3 para -3 seria reversão forte, não divergência)
    const divergiu = !zIndefinido && (emPosicao.direcao === 'curtoA' ? z >= p.zStop : z <= -p.zStop);
    const estourouTempo = barrasDentro >= p.maxBarras;
    const fimDado = i === n - 1;

    if (reverteu || divergiu || estourouTempo || fimDado) {
      // retorno = variação do LOG-SPREAD na direção apostada, menos custo de
      // 2 pernas × entrada+saída (o mesmo formato de custo do resto do projeto)
      const deltaSpread = residuo[i] - residuo[emPosicao.idx];
      const bruto = emPosicao.direcao === 'longA' ? deltaSpread : -deltaSpread;
      const custo = (p.taxaTaker + p.slippage) * 4;
      trades.push({
        entradaIdx: emPosicao.idx, saidaIdx: i, direcao: emPosicao.direcao,
        zEntrada: emPosicao.z, zSaida: z, retorno: bruto - custo,
        motivo: reverteu ? 'reversao' : divergiu ? 'stop-divergencia' : fimDado ? 'fim-dado' : 'timeout',
      });
      emPosicao = null;
    }
  }
  return trades;
}
