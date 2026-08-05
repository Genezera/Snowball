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
}

export const PARAMETROS_PADRAO: ParametrosPar = {
  zEntrada: 2.0, zSaida: 0.5, maxBarras: 20, janelaZ: 30,
  taxaTaker: 0.0005, slippage: 0.0005,
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
  motivo: 'reversao' | 'timeout' | 'fim-dado';
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
    if (desvio <= 1e-12) continue;
    const z = (residuo[i] - media) / desvio;

    if (!emPosicao) {
      if (z >= p.zEntrada) emPosicao = { idx: i, direcao: 'curtoA', z };
      else if (z <= -p.zEntrada) emPosicao = { idx: i, direcao: 'longA', z };
      continue;
    }

    const barrasDentro = i - emPosicao.idx;
    const reverteu = Math.abs(z) <= p.zSaida;
    const estourouTempo = barrasDentro >= p.maxBarras;
    const fimDado = i === n - 1;

    if (reverteu || estourouTempo || fimDado) {
      // retorno = variação do LOG-SPREAD na direção apostada, menos custo de
      // 2 pernas × entrada+saída (o mesmo formato de custo do resto do projeto)
      const deltaSpread = residuo[i] - residuo[emPosicao.idx];
      const bruto = emPosicao.direcao === 'longA' ? deltaSpread : -deltaSpread;
      const custo = (p.taxaTaker + p.slippage) * 4;
      trades.push({
        entradaIdx: emPosicao.idx, saidaIdx: i, direcao: emPosicao.direcao,
        zEntrada: emPosicao.z, zSaida: z, retorno: bruto - custo,
        motivo: reverteu ? 'reversao' : fimDado ? 'fim-dado' : 'timeout',
      });
      emPosicao = null;
    }
  }
  return trades;
}
