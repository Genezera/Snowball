/**
 * BOOTSTRAP DE TRADES REAIS — projeta capital sem inventar distribuição.
 *
 * `desafio.ts` original assumia uma aposta BINÁRIA (ganha W×r com prob. p,
 * perde r com prob. 1−p). Isso serve para estratégia de stop/alvo fixo, mas
 * mente para `ts-momentum`: a saída dela é principalmente por TEMPO
 * (maxBarsInTrade), o retorno é contínuo, e a distribuição real tem cauda
 * direita gorda (poucos trades grandes carregam o resultado) — o oposto de
 * uma moeda com dois desfechos.
 *
 * A correção: em vez de assumir uma forma, REAMOSTRA os R-múltiplos que os
 * trades de verdade produziram. Isso é bootstrap — nenhuma suposição sobre a
 * forma da distribuição, só a garantia de que ela é a que aconteceu.
 */
import type { Trade } from '../core/types.ts';

/**
 * Converte trades em R-múltiplos, dado o risco fracionário usado no backtest
 * que os gerou. `rEquity` já é a fração de equity ganha/perdida por trade;
 * dividir pelo risco planejado normaliza para "quantas vezes o risco".
 */
export function paraRMultiplos(trades: Trade[], riscoDoBacktest: number): number[] {
  if (riscoDoBacktest <= 0) throw new Error('riscoDoBacktest precisa ser positivo');
  return trades.map((t) => t.rEquity / riscoDoBacktest);
}

export interface ResultadoBootstrap {
  pSucesso: number;
  pRuina: number;
  pArrastando: number;
  mesesMediano: number;
  capitalMediano: number;
}

/** Gerador determinístico — mesma semente, mesmo resultado. */
function criarRng(semente: number) {
  let s = semente >>> 0;
  return () => {
    s ^= s << 13; s >>>= 0;
    s ^= s >> 17;
    s ^= s << 5; s >>>= 0;
    return s / 4294967296;
  };
}

/**
 * Simula `caminhos` trajetórias de capital, reamostrando `rMultiplos` a cada
 * operação (com reposição — é o que bootstrap significa) e compondo pela
 * fração de risco `riscoFracao` do capital ATUAL.
 *
 * Cada operação: capital += capital × riscoFracao × R, onde R é um trade real
 * sorteado do pool. Isso preserva a forma real da distribuição (cauda gorda,
 * assimetria, o que for) em vez de impor W:1 fixo.
 */
export function simularBootstrap(opts: {
  rMultiplos: number[];
  capitalInicial: number;
  alvo: number;
  pisoRuina: number;
  opsPorMes: number;
  horizonteMeses: number;
  riscoFracao: number;
  caminhos?: number;
  semente?: number;
}): ResultadoBootstrap {
  const { rMultiplos, capitalInicial, alvo, pisoRuina, opsPorMes, horizonteMeses } = opts;
  const caminhos = opts.caminhos ?? 20_000;
  if (!rMultiplos.length) throw new Error('pool de R-múltiplos vazio');

  const rng = criarRng(opts.semente ?? 777);
  const n = rMultiplos.length;
  const totalOps = Math.round(opsPorMes * horizonteMeses);

  let sucessos = 0, ruinas = 0;
  const mesesAteSucesso: number[] = [];
  const finais: number[] = [];

  for (let c = 0; c < caminhos; c++) {
    let v = capitalInicial;
    let terminou = false;
    for (let i = 1; i <= totalOps; i++) {
      const r = rMultiplos[Math.floor(rng() * n)];
      v += v * opts.riscoFracao * r;
      if (v >= alvo) { sucessos++; mesesAteSucesso.push(i / opsPorMes); finais.push(v); terminou = true; break; }
      if (v <= pisoRuina) { ruinas++; finais.push(v); terminou = true; break; }
    }
    if (!terminou) finais.push(v);
  }

  mesesAteSucesso.sort((a, b) => a - b);
  finais.sort((a, b) => a - b);
  return {
    pSucesso: sucessos / caminhos,
    pRuina: ruinas / caminhos,
    pArrastando: (caminhos - sucessos - ruinas) / caminhos,
    mesesMediano: mesesAteSucesso.length ? mesesAteSucesso[Math.floor(mesesAteSucesso.length / 2)] : Infinity,
    capitalMediano: finais[Math.floor(finais.length / 2)],
  };
}
