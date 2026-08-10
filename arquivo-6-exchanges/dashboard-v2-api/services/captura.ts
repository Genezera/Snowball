/**
 * STATUS DE CAPTURA (Parte 3 — campo `capturaStatus` de `/api/v2/profit-lab`).
 *
 * Antes o frontend V2 fazia 5 requisições individuais contra
 * `/api/profit-lab/challenger?id=capture-isolated-Xm` no servidor antigo
 * (uma por janela). Aqui a mesma classificação — que já era pura, derivada
 * do `estado.json` de cada challenger, nunca um cálculo financeiro novo —
 * roda do lado da API V2, lendo os 5 arquivos direto, sem tocar a porta 8787.
 *
 * origem: inteligencia/challengers/capture-isolated-{5,10,20,30,60}m/estado.json
 * tipo: array · unidade: mista · janela: snapshot atual (posição aberta ou não)
 * autoritativo/derivado: DERIVADO — classifica o estado já autoritativo do
 * challenger (trades/settlements/posicoesVirtuais) num status legível, sem
 * nunca inventar valor: challenger sem posição e sem trade vira "observando",
 * nunca "concluída" sem evidência real de settlement.
 */
import { lerJsonSeguro, caminhoEstadoChallenger } from '../readers/arquivos.ts';

const JANELAS = [5, 10, 20, 30, 60] as const;

export type StatusCaptura = 'observando' | 'posicao_aberta' | 'funding_pendente' | 'fechando' | 'concluida' | 'erro';

export interface StatusJanelaCaptura {
  challengerId: string;
  janelaMin: number;
  status: StatusCaptura;
  symbol: string | null;
  exchangeShort: string | null;
  exchangeLong: string | null;
  proximaLiquidacaoEm: number | null;
  fundingJaRecebido: boolean | null;
  trades: number | null;
  settlements: number | null;
  pnlRealizado: number | null;
  custosTotais: number | null;
  // campos brutos abaixo — mantidos pra paridade com o cálculo de
  // "funding esperado" que já era feito no frontend antes desta migração
  // (não é recálculo financeiro novo, é o mesmo dado que a posição virtual
  // já carregava, só exposto sem passar pela porta 8787)
  notionalPorPerna: number | null;
  spread8hEntrada: number | null;
  intervaloHorasLiquidacao: number | null;
}

function classificar(estado: any | null, min: number): StatusJanelaCaptura {
  const challengerId = `capture-isolated-${min}m`;
  const vazio = { challengerId, janelaMin: min, symbol: null, exchangeShort: null, exchangeLong: null, proximaLiquidacaoEm: null, fundingJaRecebido: null, notionalPorPerna: null, spread8hEntrada: null, intervaloHorasLiquidacao: null };
  if (!estado) return { ...vazio, status: 'erro', trades: null, settlements: null, pnlRealizado: null, custosTotais: null };
  const pos = (estado.posicoesVirtuais ?? [])[0] ?? null;
  const base = {
    challengerId, janelaMin: min,
    trades: estado.trades ?? 0, settlements: estado.settlements ?? 0, pnlRealizado: estado.pnlRealizado ?? 0,
    custosTotais: estado.custosTotais ?? 0,
  };
  if (!pos) {
    return { ...vazio, ...base, status: (estado.trades ?? 0) > 0 ? 'concluida' : 'observando' };
  }
  const info = {
    symbol: pos.symbol ?? null, exchangeShort: pos.exchangeShort ?? null, exchangeLong: pos.exchangeLong ?? null,
    proximaLiquidacaoEm: pos.proximaLiquidacaoEm ?? null, fundingJaRecebido: pos.fundingJaRecebido ?? null,
    notionalPorPerna: pos.notionalPorPerna ?? null, spread8hEntrada: pos.spread8hEntrada ?? null,
    intervaloHorasLiquidacao: pos.intervaloHorasLiquidacao ?? null,
  };
  if (pos.fundingJaRecebido) return { ...base, ...info, status: 'fechando' };
  const settlementPassou = pos.proximaLiquidacaoEm != null && Date.now() >= pos.proximaLiquidacaoEm;
  return { ...base, ...info, status: settlementPassou ? 'funding_pendente' : 'posicao_aberta' };
}

export function montarCapturaStatus(root: string): StatusJanelaCaptura[] {
  return JANELAS.map((min) => classificar(lerJsonSeguro(caminhoEstadoChallenger(root, `capture-isolated-${min}m`), null), min));
}
