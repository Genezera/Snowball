/**
 * WATERFALL RECONCILIADO (Parte 8, formalizado) — a fonte AUTORITATIVA dos
 * totais vitalícios é sempre `spread/estado.json` (fundingTotal, custosTotal,
 * capital, capitalInicial) — o MESMO arquivo que o motor real usa pra
 * decidir, nunca uma reconstrução. A identidade
 * `fundingTotalLifetime − custosTotalLifetime = pnlRealizadoLifetime` é
 * garantida por CONSTRUÇÃO (os três vêm da mesma leitura atômica), com
 * tolerância de arredondamento explícita.
 *
 * A decomposição POR BUCKET (entrada/saída/escalonamento/apara/...) só
 * existe reconstruída a partir do diário, e o diário é lido com um teto de
 * linhas — por isso tem `escopo` honesto ('complete' | 'partial'; este
 * módulo nunca produz 'common-window'/'rolling-window' — essas classificações
 * são de comparação entre motores, não de leitura de um único diário).
 *
 * Achado auditando os eventos reais do diário (não suposição): o motor NÃO
 * separa "slippage" como custo monetário próprio — `escorregamento`/
 * `escorregamentoMedido` nos eventos `abre`/`bloqueado`/`abre-captura` são
 * a métrica de spread medido usada na decisão, não uma fatia de `custo`.
 * `slippageEntrada`/`slippageSaida` portanto voltam `null` com nota
 * explícita — nunca um número fabricado. Da mesma forma, não existe evento
 * "emergencial" no motor atual (o mais próximo, `socorre`, já é
 * corretamente excluído do custo — é transferência de capital entre
 * exchanges, não perda) — `emergencial` fica em 0 com nota, nunca
 * apresentado como se fosse uma categoria populada.
 */
import fs from 'node:fs';
import path from 'node:path';
import { lerJsonlComNumeroDeLinha, lerJsonSeguro } from '../readers/arquivos.ts';

const TOLERANCIA = 0.01; // US$0,01 — só ponto flutuante, nunca mais que isso
const TETO_LINHAS_DECOMPOSICAO = 4000;

export interface TotaisVitalicios {
  fundingTotalLifetime: number;
  custosTotalLifetime: number;
  pnlRealizadoLifetime: number;
  reconciliado: boolean;
  diferenca: number;
  tolerancia: number;
  origemFunding: string;
  origemCustos: string;
  origemPnL: string;
  atualizadoEm: number;
}

export function lerTotaisAutoritativos(root: string): TotaisVitalicios | null {
  try {
    const p = path.join(root, 'spread', 'estado.json');
    if (!fs.existsSync(p)) return null;
    const st = fs.statSync(p);
    const e = JSON.parse(fs.readFileSync(p, 'utf8'));
    const fundingTotalLifetime = e.fundingTotal ?? 0;
    const custosTotalLifetime = e.custosTotal ?? 0;
    const pnlRealizadoLifetime = (e.capital ?? 0) - (e.capitalInicial ?? 0);
    // A identidade fechada funding-custos=pnl NÃO é garantida por fórmula —
    // existem eventos de capital que não são nem ganho nem custo (`socorre`,
    // transferência entre exchanges). A "reconciliação" real aqui é: os três
    // valores vieram do MESMO snapshot atômico do arquivo (nunca combinados
    // de leituras em momentos diferentes) — a diferença abaixo é só
    // ponto-flutuante/eventos de capital não classificados, documentada, não
    // escondida.
    const diferenca = pnlRealizadoLifetime - (fundingTotalLifetime - custosTotalLifetime);
    return {
      fundingTotalLifetime, custosTotalLifetime, pnlRealizadoLifetime,
      reconciliado: Math.abs(diferenca) <= TOLERANCIA,
      diferenca, tolerancia: TOLERANCIA,
      origemFunding: 'spread/estado.json#fundingTotal',
      origemCustos: 'spread/estado.json#custosTotal',
      origemPnL: 'spread/estado.json#capital-capitalInicial',
      atualizadoEm: st.mtimeMs,
    };
  } catch { return null; }
}

export type EscopoDecomposicao = 'complete' | 'partial';

/**
 * Bucket NÃO instrumentado pelo motor atual — achado explícito, não
 * suposição: nem `slippageEntrada`/`slippageSaida` (o motor nunca separou
 * slippage do custo de entrada/saída como valor monetário próprio) nem
 * `emergencial` (não existe evento "emergencial" no motor atual) têm de
 * onde vir um número de verdade. `valor: 0` seria uma MENTIRA — diria "essa
 * categoria existe e totalizou zero", quando na verdade a categoria nunca
 * foi medida. `valor: null` + `tracked: false` é o único jeito honesto de
 * representar "não sei", distinto de "sei e é zero".
 */
export interface BucketNaoRastreado { valor: null; tracked: false; motivo: string }
export interface BucketRastreado { valor: number; tracked: true }

export interface DecomposicaoBuckets {
  escopo: EscopoDecomposicao;
  linhasLidas: number;
  linhasTotaisNoArquivo: number;
  buckets: {
    entrada: number;
    saida: number;
    slippageEntrada: BucketNaoRastreado;
    slippageSaida: BucketNaoRastreado;
    escalonamento: number;
    apara: number;
    reinvestimento: number;
    emergencial: BucketNaoRastreado;
    /** ESTIMATIVA de custo de fechar as posições abertas agora (spread/marcacao.json) — nunca somado ao custosTotalLifetime, que é só realizado */
    fechamentoEstimado: number | null;
    outros: number;
  };
  notas: { slippage: string; emergencial: string; fechamentoEstimado: string };
  fundingBrutoNoEscopo: number;
  custoTotalNoEscopo: number;
  decomposicaoCompleta: boolean;
  /** quando escopo='partial', o quanto do custosTotalLifetime os buckets acima NÃO conseguem explicar — nunca escondido */
  custosNaoClassificados: number | null;
}

export function construirDecomposicao(root: string, autoritativo: TotaisVitalicios | null): DecomposicaoBuckets | null {
  const p = path.join(root, 'spread', 'diario.jsonl');
  if (!fs.existsSync(p)) return null;
  const todasAsLinhas = lerJsonlComNumeroDeLinha(p);
  const linhasUsadas = todasAsLinhas.slice(-TETO_LINHAS_DECOMPOSICAO);
  const completa = todasAsLinhas.length <= TETO_LINHAS_DECOMPOSICAO;

  let entrada = 0, saida = 0, escalonamento = 0, apara = 0, reinvestimento = 0, fundingBrutoNoEscopo = 0;
  for (const { linha } of linhasUsadas) {
    const ev = linha as any;
    const custo = ev.custo ?? 0;
    if (ev.evento === 'abre' || ev.evento === 'abre-captura') entrada += custo;
    else if (ev.evento === 'fecha') saida += custo;
    else if (ev.evento === 'escalona') escalonamento += custo;
    else if (ev.evento === 'apara') apara += custo;
    else if (ev.evento === 'reinveste') reinvestimento += custo;
    // 'socorre' nunca é custo — move dinheiro entre exchanges, não gera nem consome
    if (ev.evento === 'funding') fundingBrutoNoEscopo += ev.ganho ?? 0;
  }
  const custoTotalNoEscopo = entrada + saida + escalonamento + apara + reinvestimento;

  const marcacao = lerJsonSeguro<any>(path.join(root, 'spread', 'marcacao.json'), null);
  const fechamentoEstimado = marcacao?.custoEstimadoFechamentoTotal ?? null;

  // custosNaoClassificados: só faz sentido quando o escopo é a leitura
  // INTEIRA do diário mas os buckets ainda assim não batem com o autoritativo
  // (partial nunca teria como bater — a diferença ali já é esperada, não é
  // "não classificado", é "fora da janela lida")
  let custosNaoClassificados: number | null = null;
  if (completa && autoritativo) {
    const diff = autoritativo.custosTotalLifetime - custoTotalNoEscopo;
    if (Math.abs(diff) > TOLERANCIA) custosNaoClassificados = diff;
  }

  return {
    escopo: completa ? 'complete' : 'partial',
    linhasLidas: linhasUsadas.length, linhasTotaisNoArquivo: todasAsLinhas.length,
    buckets: {
      entrada, saida,
      slippageEntrada: { valor: null, tracked: false, motivo: 'categoria não instrumentada — motor não separa slippage do custo de entrada como valor monetário próprio' },
      slippageSaida: { valor: null, tracked: false, motivo: 'categoria não instrumentada — motor não separa slippage do custo de saída como valor monetário próprio' },
      escalonamento, apara, reinvestimento,
      emergencial: { valor: null, tracked: false, motivo: 'categoria não instrumentada — não existe evento "emergencial" no motor atual' },
      fechamentoEstimado,
      outros: custosNaoClassificados ?? 0,
    },
    notas: {
      slippage: 'motor não separa slippage do custo de entrada/saída como bucket monetário próprio — escorregamentoMedido no diário é a métrica de spread usada na decisão, não um valor em US$ isolado',
      emergencial: 'não existe evento "emergencial" no motor atual — socorre (transferência de capital entre exchanges) já é excluído do custo corretamente, não é substituto desta categoria',
      fechamentoEstimado: fechamentoEstimado == null ? 'spread/marcacao.json indisponível' : 'ESTIMATIVA de custo se as posições abertas fechassem agora — nunca incluído em custosTotalLifetime, que é só o realizado',
    },
    fundingBrutoNoEscopo, custoTotalNoEscopo,
    decomposicaoCompleta: completa && custosNaoClassificados == null,
    custosNaoClassificados,
  };
}
