/**
 * FRAÇÃO DE RISCO ADAPTATIVA — quanto arriscar por operação depende de
 * quanto capital você tem e quanto tempo resta, não é um número fixo.
 *
 * `simularBootstrap` usa uma fração de risco CONSTANTE em toda a trajetória.
 * Isso é uma política válida, mas não é a ótima: um apostador com muito tempo
 * de sobra e capital baixo não está na mesma situação que um com pouco tempo
 * restante e quase na meta — tratá-los igual desperdiça informação.
 *
 * Aqui resolvemos a fração ótima por indução reversa (programação dinâmica)
 * sobre uma grade discretizada de (capital × tempo), maximizando a
 * probabilidade de atingir o alvo antes do piso de ruína dentro do horizonte.
 * A distribuição de retorno usada na DP é um histograma quantílico dos
 * R-múltiplos reais (não uma forma assumida) — mas por ser uma aproximação
 * discretizada, SEMPRE avalie a política resultante com bootstrap dos trades
 * reais (não bucketizados), nunca reporte o valor que a própria DP calculou
 * para si mesma.
 */
import type { ResultadoBootstrap } from './bootstrap.ts';

/** Gerador determinístico — mesma semente, mesmo resultado (mesmo PRNG usado em bootstrap.ts). */
function criarRng(semente: number) {
  let s = semente >>> 0;
  return () => {
    s ^= s << 13; s >>>= 0;
    s ^= s >> 17;
    s ^= s << 5; s >>>= 0;
    return s / 4294967296;
  };
}

export interface PoliticaRisco {
  capGrid: Float64Array;
  logPiso: number;
  logAlvo: number;
  nCBins: number;
  totalOps: number;
  riscosCandidatos: number[];
  tabela: Uint8Array; // tabela[t * nCBins + binDeCapital] -> índice em riscosCandidatos
}

function histogramaQuantilico(valores: number[], nBuckets: number): number[] {
  const s = [...valores].sort((a, b) => a - b);
  const buckets: number[] = [];
  for (let k = 0; k < nBuckets; k++) {
    const lo = Math.floor((k / nBuckets) * s.length);
    const hi = Math.floor(((k + 1) / nBuckets) * s.length);
    const fatia = s.slice(lo, Math.max(hi, lo + 1));
    buckets.push(fatia.reduce((a, b) => a + b, 0) / fatia.length);
  }
  return buckets;
}

function binDeCapital(c: number, logPiso: number, logAlvo: number, nCBins: number, alvo: number, pisoRuina: number): number {
  if (c >= alvo) return -1; // sucesso
  if (c <= pisoRuina) return -2; // ruína
  let frac = (Math.log(c) - logPiso) / (logAlvo - logPiso);
  let idx = Math.floor(frac * nCBins);
  if (idx < 0) idx = 0;
  if (idx >= nCBins) idx = nCBins - 1;
  return idx;
}

/**
 * Resolve a política ótima de risco por indução reversa. Custo:
 * O(totalOps × nBinsCapital × riscosCandidatos.length × nBinsR) — com os
 * padrões (250×250×30×1200) leva poucos segundos.
 */
export function resolverPoliticaOtima(opts: {
  rMultiplos: number[];
  capitalInicial: number;
  alvo: number;
  pisoRuina: number;
  totalOps: number;
  riscosCandidatos?: number[];
  nBinsCapital?: number;
  nBinsR?: number;
}): PoliticaRisco {
  const { rMultiplos, alvo, pisoRuina, totalOps } = opts;
  if (!rMultiplos.length) throw new Error('pool de R-múltiplos vazio');
  const riscosCandidatos = opts.riscosCandidatos ?? Array.from({ length: 30 }, (_, i) => (i + 1) / 100);
  const nCBins = opts.nBinsCapital ?? 250;
  const nRBuckets = opts.nBinsR ?? 250;

  const logPiso = Math.log(pisoRuina), logAlvo = Math.log(alvo);
  const capGrid = new Float64Array(nCBins);
  for (let i = 0; i < nCBins; i++) {
    const frac = (i + 0.5) / nCBins;
    capGrid[i] = Math.exp(logPiso + frac * (logAlvo - logPiso));
  }
  const rBuckets = histogramaQuantilico(rMultiplos, nRBuckets);
  const bin = (c: number) => binDeCapital(c, logPiso, logAlvo, nCBins, alvo, pisoRuina);

  // pré-computa, para cada (risco, binCapital), o bin resultante por bucket-R
  const transicoes: Int16Array[] = riscosCandidatos.map((risco) => {
    const t = new Int16Array(nCBins * nRBuckets);
    for (let ci = 0; ci < nCBins; ci++) {
      const c = capGrid[ci];
      for (let bi = 0; bi < nRBuckets; bi++) t[ci * nRBuckets + bi] = bin(c * (1 + risco * rBuckets[bi]));
    }
    return t;
  });

  let vAtual = new Float64Array(nCBins); // V(., totalOps) = 0 em toda parte (não chegou)
  const tabela = new Uint8Array(nCBins * totalOps);

  for (let t = totalOps - 1; t >= 0; t--) {
    const vProximo = vAtual;
    const vNovo = new Float64Array(nCBins);
    for (let ci = 0; ci < nCBins; ci++) {
      let melhorV = -1, melhorRi = 0;
      for (let ri = 0; ri < riscosCandidatos.length; ri++) {
        const transicao = transicoes[ri];
        let soma = 0;
        const base = ci * nRBuckets;
        for (let bi = 0; bi < nRBuckets; bi++) {
          const nb = transicao[base + bi];
          soma += nb === -1 ? 1 : nb === -2 ? 0 : vProximo[nb];
        }
        const media = soma / nRBuckets;
        if (media > melhorV) { melhorV = media; melhorRi = ri; }
      }
      vNovo[ci] = melhorV;
      tabela[t * nCBins + ci] = melhorRi;
    }
    vAtual = vNovo;
  }

  return { capGrid, logPiso, logAlvo, nCBins, totalOps, riscosCandidatos, tabela };
}

/** Risco recomendado pela política num dado capital e passo — útil para inspeção/relatório. */
export function riscoNaPolitica(politica: PoliticaRisco, capital: number, passo: number): number {
  const { logPiso, logAlvo, nCBins, tabela, riscosCandidatos } = politica;
  const t = Math.min(passo, politica.totalOps - 1);
  const cbin = binDeCapital(capital, logPiso, logAlvo, nCBins, Math.exp(logAlvo), Math.exp(logPiso));
  if (cbin < 0) return riscosCandidatos[0];
  return riscosCandidatos[tabela[t * nCBins + cbin]];
}

/**
 * Avalia uma política com bootstrap dos trades REAIS (não bucketizados) —
 * mesma disciplina de `simularBootstrap`, mas escolhendo o risco por passo
 * segundo a política em vez de uma fração constante.
 */
export function simularComPolitica(opts: {
  politica: PoliticaRisco;
  rMultiplos: number[];
  capitalInicial: number;
  alvo: number;
  pisoRuina: number;
  opsPorMes: number;
  horizonteMeses: number;
  caminhos?: number;
  semente?: number;
}): ResultadoBootstrap {
  const { politica, rMultiplos, capitalInicial, alvo, pisoRuina, opsPorMes, horizonteMeses } = opts;
  if (!rMultiplos.length) throw new Error('pool de R-múltiplos vazio');
  const caminhos = opts.caminhos ?? 20_000;
  const totalOps = Math.round(opsPorMes * horizonteMeses);
  const logPiso = Math.log(pisoRuina), logAlvo = Math.log(alvo);
  const bin = (c: number) => binDeCapital(c, logPiso, logAlvo, politica.nCBins, alvo, pisoRuina);

  const rng = criarRng(opts.semente ?? 777);
  const n = rMultiplos.length;
  let sucessos = 0, ruinas = 0;
  const mesesAteSucesso: number[] = [];
  const finais: number[] = [];

  for (let c = 0; c < caminhos; c++) {
    let v = capitalInicial;
    let terminou = false;
    for (let i = 0; i < totalOps; i++) {
      const cbin = bin(v);
      if (cbin === -1) { sucessos++; mesesAteSucesso.push(i / opsPorMes); finais.push(v); terminou = true; break; }
      if (cbin === -2) { ruinas++; finais.push(v); terminou = true; break; }
      const risco = politica.riscosCandidatos[politica.tabela[i * politica.nCBins + cbin]];
      const r = rMultiplos[Math.floor(rng() * n)];
      v += v * risco * r;
      if (v >= alvo) { sucessos++; mesesAteSucesso.push((i + 1) / opsPorMes); finais.push(v); terminou = true; break; }
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
