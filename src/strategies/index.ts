/**
 * As cinco estrategias do video, portadas e parametrizadas.
 *
 * Tres coisas foram adicionadas em relacao ao original, e valem a pena saber:
 *
 * - Todos os indicadores sao pre-calculados uma vez e a `onBar` so le a posicao
 *   `i`. Isso e o que permite varrer 100k barras rapido no otimizador.
 * - Cada estrategia grava `features` no sinal. Sao as mesmas features que o
 *   modelo de ML usa depois para decidir quais sinais valem a pena tomar.
 * - Filtro de volatilidade por ATR normalizado: o alvo de 3% so faz sentido se
 *   o ativo tipicamente anda 3% na janela do trade. Sem isso, a estrategia
 *   passa a maior parte do tempo pagando taxa em mercado morto.
 */
import type { Bar, Signal, Strategy } from '../core/types.ts';
import {
  atr,
  bodyFraction,
  closes,
  dmi,
  ema,
  supertrend,
  priorCloseExtremes,
  ranges,
  rollingStd,
  rsi,
  sma,
  vwma,
  zscore,
} from '../core/indicators.ts';

export interface StratParams {
  [k: string]: number | boolean | undefined;
}

/** Features comuns gravadas em todo sinal, para o ML consumir depois. */
function commonFeatures(
  bars: Bar[],
  i: number,
  ctx: { atrPct: number[]; rsi14: number[]; z20: number[]; bodyF: number[] },
): Record<string, number> {
  const b = bars[i];
  const ret1 = i >= 1 ? b.c / bars[i - 1].c - 1 : 0;
  const ret5 = i >= 5 ? b.c / bars[i - 5].c - 1 : 0;
  const ret20 = i >= 20 ? b.c / bars[i - 20].c - 1 : 0;
  const volMean = i >= 20 ? bars.slice(i - 20, i).reduce((a, x) => a + x.v, 0) / 20 : b.v;
  const hour = new Date(b.t).getUTCHours();
  return {
    atrPct: ctx.atrPct[i] || 0,
    rsi14: ctx.rsi14[i] || 50,
    z20: isFinite(ctx.z20[i]) ? ctx.z20[i] : 0,
    bodyFrac: ctx.bodyF[i] || 0,
    ret1,
    ret5,
    ret20,
    volRatio: volMean > 0 ? b.v / volMean : 1,
    hourSin: Math.sin((2 * Math.PI * hour) / 24),
    hourCos: Math.cos((2 * Math.PI * hour) / 24),
    dow: new Date(b.t).getUTCDay(),
  };
}

function buildCtx(bars: Bar[]) {
  const c = closes(bars);
  const a = atr(bars, 14);
  return {
    atrPct: a.map((v, i) => (isFinite(v) && c[i] > 0 ? v / c[i] : 0)),
    rsi14: rsi(c, 14),
    z20: zscore(c, 20),
    bodyF: bodyFraction(bars),
  };
}

/**
 * 1) "Momentum + breakout com filtro de volatilidade" (F, NYSE). Regras exatas:
 *
 *   SMA(range, 10) > SMA(range, 50)     -> volatilidade expandindo
 *   close > close 20 barras atras
 *   close > maior fechamento das ultimas 20 barras
 *   candle verde (close > open)
 *   short = espelho
 *   stop -1.5%, take +3%
 */
export function momentumBreakout(p: StratParams = {}): Strategy {
  const fast = (p.fast as number) ?? 10;
  const slow = (p.slow as number) ?? 50;
  const lookback = (p.lookback as number) ?? 20;
  const stopPct = (p.stopPct as number) ?? 0.015;
  const takePct = (p.takePct as number) ?? 0.03;
  const allowShort = (p.allowShort as boolean) ?? true;

  const cache = new WeakMap<Bar[], any>();
  const prep = (bars: Bar[]) => {
    let v = cache.get(bars);
    if (!v) {
      const r = ranges(bars);
      v = {
        f: sma(r, fast),
        s: sma(r, slow),
        ext: priorCloseExtremes(bars, lookback),
        ctx: buildCtx(bars),
      };
      cache.set(bars, v);
    }
    return v;
  };

  return {
    name: `momentum-breakout(range ${fast}>${slow}/hc${lookback})`,
    warmup: Math.max(fast, slow, lookback, 20) + 1,
    onBar(bars, i): Signal | null {
      const v = prep(bars);
      const b = bars[i];
      if (!isFinite(v.f[i]) || !isFinite(v.s[i]) || !isFinite(v.ext.hc[i])) return null;
      if (v.f[i] <= v.s[i]) return null; // volatilidade nao esta expandindo
      if (i < lookback) return null;

      const past = bars[i - lookback].c;
      if (b.c > b.o && b.c > past && b.c > v.ext.hc[i]) {
        return { side: 'long', stopPct, takePct, features: commonFeatures(bars, i, v.ctx) };
      }
      if (allowShort && b.c < b.o && b.c < past && b.c < v.ext.lc[i]) {
        return { side: 'short', stopPct, takePct, features: commonFeatures(bars, i, v.ctx) };
      }
      return null;
    },
  };
}

/**
 * 2) Cruzamento duplo de medias (ALTR). Regras exatas:
 *
 *   SMA(close, 50) > SMA(close, 100)  -> Long
 *   SMA(close, 50) < SMA(close, 100)  -> Short
 *   stop -1%, take +2%
 *
 * Repare: a regra e um ESTADO, nao um evento de cruzamento. Enquanto a rapida
 * estiver acima da lenta a estrategia reentra assim que a posicao anterior
 * fecha. E o que explica os 534 trades do backtest do video. `useCross=true`
 * troca para o comportamento de evento, que negocia muito menos e paga muito
 * menos taxa.
 */
export function maCross(p: StratParams = {}): Strategy {
  const fast = (p.fast as number) ?? 50;
  const slow = (p.slow as number) ?? 100;
  const stopPct = (p.stopPct as number) ?? 0.01;
  const takePct = (p.takePct as number) ?? 0.02;
  const useCross = (p.useCross as boolean) ?? false;
  const allowShort = (p.allowShort as boolean) ?? true;

  const cache = new WeakMap<Bar[], any>();
  const prep = (bars: Bar[]) => {
    let v = cache.get(bars);
    if (!v) {
      const c = closes(bars);
      v = { f: sma(c, fast), s: sma(c, slow), ctx: buildCtx(bars) };
      cache.set(bars, v);
    }
    return v;
  };

  return {
    name: `ma-cross(${fast}/${slow}${useCross ? '/evento' : '/estado'})`,
    warmup: Math.max(fast, slow) + 1,
    onBar(bars, i): Signal | null {
      const v = prep(bars);
      if (!isFinite(v.f[i]) || !isFinite(v.s[i]) || !isFinite(v.f[i - 1])) return null;
      const up = useCross ? v.f[i] > v.s[i] && v.f[i - 1] <= v.s[i - 1] : v.f[i] > v.s[i];
      const down = useCross ? v.f[i] < v.s[i] && v.f[i - 1] >= v.s[i - 1] : v.f[i] < v.s[i];
      if (up) return { side: 'long', stopPct, takePct, features: commonFeatures(bars, i, v.ctx) };
      if (allowShort && down)
        return { side: 'short', stopPct, takePct, features: commonFeatures(bars, i, v.ctx) };
      return null;
    },
  };
}

/**
 * 3) "Buy the dip in uptrend" (DOTUSDT.P). Regras exatas publicadas:
 *
 *   EMA(range, 10) > SMA(range, 50)   -> volatilidade EXPANDINDO
 *   close > close 20 barras atras     -> tendencia de alta
 *   z-score <= -2                      -> preco caiu forte abaixo da media
 *   short: espelho, com close < close[20] e z >= +2
 *   stop -1.7%, take +3%
 *
 * Atencao ao detalhe que muda o carater da estrategia: o filtro de volatilidade
 * usa o RANGE do candle (high - low), nao o close. E a entrada e por z-score
 * NEGATIVO, ou seja, isto e reversao a media dentro de tendencia, nao rompimento.
 */
export function zscoreDip(p: StratParams = {}): Strategy {
  const emaLen = (p.emaLen as number) ?? 10;
  const smaLen = (p.smaLen as number) ?? 50;
  const lookback = (p.lookback as number) ?? 20;
  const zLen = (p.zLen as number) ?? 20;
  const zEntry = (p.zEntry as number) ?? -2;
  const stopPct = (p.stopPct as number) ?? 0.017;
  const takePct = (p.takePct as number) ?? 0.03;
  const allowShort = (p.allowShort as boolean) ?? true;

  const cache = new WeakMap<Bar[], any>();
  const prep = (bars: Bar[]) => {
    let v = cache.get(bars);
    if (!v) {
      const c = closes(bars);
      const r = ranges(bars);
      v = { er: ema(r, emaLen), sr: sma(r, smaLen), z: zscore(c, zLen), ctx: buildCtx(bars) };
      cache.set(bars, v);
    }
    return v;
  };

  return {
    name: `zscore-dip(range ${emaLen}>${smaLen}/z<=${zEntry})`,
    warmup: Math.max(emaLen, smaLen, lookback, zLen) + 1,
    onBar(bars, i): Signal | null {
      const v = prep(bars);
      if (!isFinite(v.er[i]) || !isFinite(v.sr[i]) || !isFinite(v.z[i])) return null;
      if (i < lookback) return null;
      if (v.er[i] <= v.sr[i]) return null; // volatilidade nao esta expandindo

      const b = bars[i];
      const past = bars[i - lookback].c;
      if (b.c > past && v.z[i] <= zEntry) {
        return { side: 'long', stopPct, takePct, features: commonFeatures(bars, i, v.ctx) };
      }
      if (allowShort && b.c < past && v.z[i] >= -zEntry) {
        return { side: 'short', stopPct, takePct, features: commonFeatures(bars, i, v.ctx) };
      }
      return null;
    },
  };
}

/**
 * 4) Trend following por "corpo de candle".
 * Exige que os candles recentes tenham corpo grande em relacao ao pavio, ou
 * seja, movimento com convicao em vez de serrote lateral.
 */
export function bodyBreakout(p: StratParams = {}): Strategy {
  const bodyLen = (p.bodyLen as number) ?? 10;
  // 0.5, nao 0.1. A transcricao do video diz 0.1, mas a regra escrita na tela
  // e SMA(body fraction, 10) > 0.5. A diferenca e enorme: 0.1 aceita quase todo
  // candle, 0.5 exige que metade do range seja corpo.
  const minBody = (p.minBody as number) ?? 0.5;
  const trendLen = (p.trendLen as number) ?? 100;
  const lookback = (p.lookback as number) ?? 20;
  const stopPct = (p.stopPct as number) ?? 0.015;
  const takePct = (p.takePct as number) ?? 0.03;
  const allowShort = (p.allowShort as boolean) ?? true;

  const cache = new WeakMap<Bar[], any>();
  const prep = (bars: Bar[]) => {
    let v = cache.get(bars);
    if (!v) {
      const c = closes(bars);
      v = {
        bf: sma(bodyFraction(bars), bodyLen),
        trend: sma(c, trendLen),
        ext: priorCloseExtremes(bars, lookback),
        ctx: buildCtx(bars),
      };
      cache.set(bars, v);
    }
    return v;
  };

  return {
    name: `body-breakout(${bodyLen}>${minBody}/${trendLen})`,
    warmup: Math.max(bodyLen, trendLen, lookback) + 1,
    onBar(bars, i): Signal | null {
      const v = prep(bars);
      if (!isFinite(v.bf[i]) || !isFinite(v.trend[i]) || !isFinite(v.ext.hc[i])) return null;
      if (v.bf[i] < minBody) return null;
      const b = bars[i];
      if (b.c > v.trend[i] && b.c > v.ext.hc[i])
        return { side: 'long', stopPct, takePct, features: commonFeatures(bars, i, v.ctx) };
      if (allowShort && b.c < v.trend[i] && b.c < v.ext.lc[i])
        return { side: 'short', stopPct, takePct, features: commonFeatures(bars, i, v.ctx) };
      return null;
    },
  };
}

/**
 * 5) "VWAP Buy The Dip" — long only, reversao a media com filtro de tendencia.
 *
 * Esta e a transcricao literal das regras publicadas para a estrategia de
 * 5381% em TRXUSDT.P:
 *
 *   VWMA(body fraction, 10) > 0.5   -> candles recentes sao decididos
 *   close > VWMA(close, 100)        -> acima da linha de tendencia ponderada
 *   z-score <= -2, z = (close - SMA(close,20)) / stdev(close,20)
 *   short desabilitado
 *   stop -1%, take +2%
 *
 * Note o perfil: stop apertado com alvo maior EM REVERSAO A MEDIA. Isso exige
 * win rate alto para fechar a conta, e e por isso que ela e a mais fragil das
 * cinco a qualquer aumento de custo.
 */
export function vwmaDip(p: StratParams = {}): Strategy {
  const bodyLen = (p.bodyLen as number) ?? 10;
  const minBody = (p.minBody as number) ?? 0.5;
  const trendLen = (p.trendLen as number) ?? 100;
  const zLen = (p.zLen as number) ?? 20;
  const zEntry = (p.zEntry as number) ?? -2;
  const stopPct = (p.stopPct as number) ?? 0.01;
  const takePct = (p.takePct as number) ?? 0.02;

  const cache = new WeakMap<Bar[], any>();
  const prep = (bars: Bar[]) => {
    let v = cache.get(bars);
    if (!v) {
      const c = closes(bars);
      // VWMA da body fraction: media da "decisao" dos candles, ponderada por volume.
      const bf = bodyFraction(bars);
      const bfVw = new Array<number>(bars.length).fill(NaN);
      let pv = 0, vv = 0;
      for (let i = 0; i < bars.length; i++) {
        pv += bf[i] * bars[i].v;
        vv += bars[i].v;
        if (i >= bodyLen) {
          pv -= bf[i - bodyLen] * bars[i - bodyLen].v;
          vv -= bars[i - bodyLen].v;
        }
        if (i >= bodyLen - 1 && vv > 0) bfVw[i] = pv / vv;
      }
      v = {
        bfVw,
        trend: vwma(bars, trendLen),
        z: zscore(c, zLen),
        ctx: buildCtx(bars),
      };
      cache.set(bars, v);
    }
    return v;
  };

  return {
    name: `vwma-dip(body${bodyLen}>${minBody}/trend${trendLen}/z<=${zEntry})`,
    warmup: Math.max(bodyLen, trendLen, zLen) + 1,
    onBar(bars, i): Signal | null {
      const v = prep(bars);
      if (!isFinite(v.bfVw[i]) || !isFinite(v.trend[i]) || !isFinite(v.z[i])) return null;
      const b = bars[i];
      if (v.bfVw[i] > minBody && b.c > v.trend[i] && v.z[i] <= zEntry) {
        return { side: 'long', stopPct, takePct, features: commonFeatures(bars, i, v.ctx) };
      }
      return null;
    },
  };
}

/**
 * 6) "Trend Rider" -- portada do trader.dev (autor: Yoink), a de melhor Calmar
 * (2,17) e melhor Sharpe (1,48) da varredura de estrategias publicas.
 *
 * Confluencia de quatro filtros, todos precisam concordar:
 *   SuperTrend(3.0, 10) apontando na direcao do trade
 *   ADX(14,14) > 20            -> a tendencia tem FORCA, nao so direcao
 *   EMA 50 vs EMA 200 alinhadas
 *   RSI(14) do lado certo de 50
 *   entrada so na virada fresca do regime, nao a cada barra
 *   stop 2.0 x ATR(14), alvo 4.0 x ATR(14)
 *
 * O QUE A TORNA DIFERENTE DAS OUTRAS CINCO, e a razao de porta-la: o stop e
 * baseado em ATR, nao em porcentagem fixa. Todas as 5 do video usam stop
 * percentual, o que significa que em mercado calmo o stop fica longe demais e
 * em mercado agitado, perto demais. Um stop em ATR se adapta sozinho. Isso e
 * diversificacao estrutural de verdade, nao mais uma variacao do mesmo tema.
 *
 * DIFERENCA CONHECIDA em relacao ao original: a versao publicada usa trailing
 * stop de 2.5 x ATR, que o motor deste projeto ainda nao suporta. Esta porta
 * usa apenas o stop e o alvo fixos em ATR. Portanto os numeros NAO devem bater
 * com os de la, e a diferenca esta documentada em vez de escondida.
 */
export function trendRider(p: StratParams = {}): Strategy {
  const factor = (p.factor as number) ?? 3.0;
  const stAtrLen = (p.stAtrLen as number) ?? 10;
  const adxLen = (p.adxLen as number) ?? 14;
  const adxSmooth = (p.adxSmooth as number) ?? 14;
  const adxThresh = (p.adxThresh as number) ?? 20;
  const emaFast = (p.emaFast as number) ?? 50;
  const emaSlow = (p.emaSlow as number) ?? 200;
  const rsiLen = (p.rsiLen as number) ?? 14;
  const rsiMid = (p.rsiMid as number) ?? 50;
  const riskAtrLen = (p.riskAtrLen as number) ?? 14;
  const slAtr = (p.slAtr as number) ?? 2.0;
  const tpAtr = (p.tpAtr as number) ?? 4.0;
  // Trailing de 2,5xATR — o parâmetro do autor original, agora que o motor
  // suporta. Era a diferença conhecida entre esta porta e o resultado dele.
  const trailAtr = (p.trailAtr as number) ?? 2.5;
  const useTrail = (p.useTrail as boolean) ?? true;
  const allowShort = (p.allowShort as boolean) ?? true;

  const cache = new WeakMap<Bar[], any>();
  const prep = (bars: Bar[]) => {
    let v = cache.get(bars);
    if (!v) {
      const c = closes(bars);
      v = {
        st: supertrend(bars, factor, stAtrLen),
        d: dmi(bars, adxLen, adxSmooth),
        ef: ema(c, emaFast),
        es: ema(c, emaSlow),
        r: rsi(c, rsiLen),
        a: atr(bars, riskAtrLen),
        ctx: buildCtx(bars),
      };
      cache.set(bars, v);
    }
    return v;
  };

  /** As quatro condicoes na barra i, ou null se algum indicador ainda nao existe. */
  const regime = (v: any, bars: Bar[], i: number): 'long' | 'short' | null => {
    if (!isFinite(v.st.dir[i]) || !isFinite(v.d.adx[i]) || !isFinite(v.es[i]) || !isFinite(v.r[i])) return null;
    if (v.d.adx[i] <= adxThresh) return null;
    const c = bars[i].c;
    const bull = v.st.dir[i] < 0;
    if (bull && v.ef[i] > v.es[i] && v.r[i] > rsiMid) return 'long';
    if (!bull && v.ef[i] < v.es[i] && v.r[i] < rsiMid) return 'short';
    return null;
  };

  return {
    name: `trend-rider(ST${factor}/${stAtrLen} ADX>${adxThresh} EMA${emaFast}/${emaSlow})`,
    warmup: Math.max(emaSlow, stAtrLen, adxLen + adxSmooth, riskAtrLen) + 2,
    onBar(bars, i): Signal | null {
      const v = prep(bars);
      if (i < 1) return null;
      const now = regime(v, bars, i);
      if (!now) return null;
      // Entrada so na virada fresca: se o regime ja valia na barra anterior,
      // a oportunidade nao e nova.
      if (regime(v, bars, i - 1) === now) return null;
      if (now === 'short' && !allowShort) return null;
      if (!isFinite(v.a[i]) || bars[i].c <= 0) return null;

      // Converte o stop em ATR para fracao do preco, que e o que o motor usa.
      const stopPct = (slAtr * v.a[i]) / bars[i].c;
      const takePct = (tpAtr * v.a[i]) / bars[i].c;
      if (!isFinite(stopPct) || stopPct <= 0.0005 || stopPct > 0.25) return null;

      return {
        side: now, stopPct, takePct,
        ...(useTrail ? {
          trailPct: (trailAtr * v.a[i]) / bars[i].c,
          // arma o trailing só depois de 1xATR a favor, para o stop móvel não
          // sufocar o trade no ruído logo após a entrada
          trailArmPct: v.a[i] / bars[i].c,
        } : {}),
        features: commonFeatures(bars, i, v.ctx),
      };
    },
  };
}

/**
 * TIME-SERIES MOMENTUM (Moskowitz/Ooi/Pedersen, "Time Series Momentum", 2012).
 *
 * Classe de estratégia DIFERENTE de tudo o mais neste arquivo. As outras cinco
 * leem padrão de VELA (corpo, rompimento, zscore de curtíssimo prazo) e saem
 * por stop/alvo fixo em minutos a horas. Esta lê só o RETORNO acumulado num
 * lookback longo, entra na direção dele, e sai por TEMPO (`maxBarsInTrade`),
 * não por preço — o stop/alvo aqui são rede de segurança, não o mecanismo.
 *
 * O paper mede o efeito em 58 contratos futuros — ações, câmbio, commodities,
 * juros — ao longo de 25+ anos, positivo em TODOS os 58, robusto a
 * sub-amostra, lookback e período de manutenção. É o resultado mais replicado
 * da literatura de factor investing, e ninguém neste projeto tinha testado.
 *
 * A pergunta que decide se serve aqui: ele sobrevive em cripto de 4h/1d, com
 * os custos reais deste projeto, fora da amostra? Só o walk-forward responde.
 */
export function tsMomentum(p: StratParams = {}): Strategy {
  const lookback = (p.lookback as number) ?? 60;
  const minRet = (p.minRet as number) ?? 0.05;
  const stopPct = (p.stopPct as number) ?? 0.15;
  const takePct = (p.takePct as number) ?? 0.40;
  const allowShort = (p.allowShort as boolean) ?? true;

  const cache = new WeakMap<Bar[], any>();
  const prep = (bars: Bar[]) => {
    let v = cache.get(bars);
    if (!v) v = { ctx: buildCtx(bars) };
    cache.set(bars, v);
    return v;
  };

  return {
    name: `ts-momentum(lb${lookback} min${minRet})`,
    warmup: lookback + 2,
    onBar(bars, i): Signal | null {
      if (i < lookback) return null;
      const c = bars[i].c, cPrev = bars[i - lookback].c;
      if (!(c > 0) || !(cPrev > 0)) return null;
      const ret = c / cPrev - 1;
      if (Math.abs(ret) < minRet) return null;
      const side: Side = ret > 0 ? 'long' : 'short';
      if (side === 'short' && !allowShort) return null;
      const v = prep(bars);
      return { side, stopPct, takePct, features: commonFeatures(bars, i, v.ctx) };
    },
  };
}

/**
 * MOMENTUM CROSS-SECTIONAL — formação 30d / manutenção 7d.
 *
 * Documentado especificamente em cripto: o quintil que mais subiu num período
 * de formação tende a superar o que mais caiu no período de manutenção
 * seguinte. Diferente do time-series momentum: aqui o sinal é o RANKING entre
 * ativos, não o sinal absoluto de um só.
 *
 * Implementado como sinal de UM ativo, parametrizado pelo período de formação
 * e manutenção — a parte cross-sectional (ranquear vários ativos e operar só
 * os extremos) fica no CLI de scan, que decide QUAL ativo alimentar aqui. Esta
 * função decide SE o ativo (dado que já foi selecionado por estar no extremo)
 * ainda vale abrir agora, ou se o momentum de formação já esfriou.
 */
export function xsMomentum(p: StratParams = {}): Strategy {
  const formacao = (p.formacao as number) ?? 180; // ~30 dias em barras de 4h
  const manutencao = (p.manutencao as number) ?? 42; // ~7 dias em barras de 4h
  const minRet = (p.minRet as number) ?? 0.10;
  const stopPct = (p.stopPct as number) ?? 0.12;
  const takePct = (p.takePct as number) ?? 0.30;
  const allowShort = (p.allowShort as boolean) ?? true;

  const cache = new WeakMap<Bar[], any>();
  const prep = (bars: Bar[]) => {
    let v = cache.get(bars);
    if (!v) v = { ctx: buildCtx(bars) };
    cache.set(bars, v);
    return v;
  };

  return {
    name: `xs-momentum(form${formacao}/manu${manutencao})`,
    warmup: formacao + 2,
    onBar(bars, i): Signal | null {
      if (i < formacao) return null;
      const c = bars[i].c, cForm = bars[i - formacao].c;
      if (!(c > 0) || !(cForm > 0)) return null;
      const retFormacao = c / cForm - 1;
      if (Math.abs(retFormacao) < minRet) return null;
      const side: Side = retFormacao > 0 ? 'long' : 'short';
      if (side === 'short' && !allowShort) return null;
      const v = prep(bars);
      return { side, stopPct, takePct, features: { ...commonFeatures(bars, i, v.ctx), retFormacao, manutencao } };
    },
  };
}

export const REGISTRY: Record<string, (p?: StratParams) => Strategy> = {
  'momentum-breakout': momentumBreakout,
  'ma-cross': maCross,
  'zscore-dip': zscoreDip,
  'body-breakout': bodyBreakout,
  'vwma-dip': vwmaDip,
  'trend-rider': trendRider,
  'ts-momentum': tsMomentum,
  'xs-momentum': xsMomentum,
};

export function buildStrategy(name: string, params: StratParams = {}): Strategy {
  const f = REGISTRY[name];
  if (!f) throw new Error(`estrategia desconhecida: ${name}. Disponiveis: ${Object.keys(REGISTRY).join(', ')}`);
  return f(params);
}
