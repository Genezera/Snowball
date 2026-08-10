/**
 * DEFINIÇÕES DE CHALLENGER — configuração aprovada, não código livre.
 *
 * O Profit Experiment Orchestrator (profit-orchestrator.ts) só pode rodar
 * challengers desta lista — "criar livremente uma estratégia e colocar pra
 * rodar sem configuração aprovada" está explicitamente fora do escopo do
 * orquestrador. Adicionar um challenger novo é editar este arquivo, revisado
 * como qualquer mudança de código, não uma decisão em tempo de execução.
 *
 * Implementados nesta sessão (Parte 21, prioridade 1-3 dos "primeiros a
 * implementar"): control, ranking, best-pair. Os demais (batch-rebalancing,
 * capital-allocation, capture-windows, smart-exit, quality-sizing,
 * persistence, combinações) ficam documentados como próximo passo — ver
 * entrega, não implementados às pressas sem teste.
 */
import type { EntradaValor } from '../funding/valor.ts';
import type { ConfigChallenger } from './virtual-portfolio.ts';
import type { OportunidadeSpread } from '../../../src/funding/spread.ts';
import type { Saldos } from '../funding/tesouraria.ts';

const EXCHANGES_6 = ['binanceusdm', 'bybit', 'okx', 'gate', 'bitget', 'bingx'];

/**
 * CHALLENGER-CONTROL — clone do champion, mesmo portão/sizing/alavancagem/
 * reserva, MESMO scorer (chaveOrdenacao real, sem substituto). A única
 * diferença é rodar em carteira virtual separada. Existe pra responder uma
 * pergunta de infraestrutura, não de estratégia: "o Lab paralelo consegue
 * acompanhar o champion com o feed ao vivo?" Se este challenger divergir
 * muito do champion real, o problema é do Lab, não de nenhuma ideia nova.
 */
export const CHALLENGER_CONTROL: ConfigChallenger = {
  challengerId: 'challenger-control',
  strategyVersion: 'v1', configVersion: 'v1',
  exchanges: EXCHANGES_6, capitalPorExchange: 100, alavancagem: 5, reserva: 0.30,
  margemPayback: 1.5, maxPosicoes: 3,
  familia: 'control',
  hipotese: 'réplica fiel do champion — resposta esperada: nenhuma, é a régua de comparação',
  // scorer omitido de propósito — cicloChallenger() usa chaveOrdenacao real por default
};

/**
 * CHALLENGER-RANKING — mesmo portão (só reordena quem já passou), scorer
 * alternativo: `utility = valorEsperado × consistência ÷ margem ÷ vida`.
 * Só entra em jogo quando há mais de uma candidata aprovada no mesmo ciclo —
 * com uma só, a escolha é idêntica ao champion por construção (não tem o que
 * reordenar entre 1 elemento).
 */
export function scorerRanking(e: EntradaValor): number {
  const custo = e.notional * e.taxa * 4;
  const paybackHoras = e.spread > 0 ? custo / (e.notional * e.spread * (3 / 24)) : Infinity;
  const vidaEsperada = Math.max(0, e.duracaoHoras) * Math.min(1, Math.max(0, e.consistencia));
  const valorEsperado = e.notional * e.spread * (3 / 24) * vidaEsperada - custo;
  if (valorEsperado <= 0) return valorEsperado; // mesma régua do champion para não-lucrativas
  // utility = valor esperado × consistência ÷ margem(=notional/alavancagem, mas
  // alavancagem é igual pra todos os candidatos deste ciclo, então notional
  // já é proxy direto) ÷ tempo de exposição esperado
  return (valorEsperado * e.consistencia) / Math.max(1, e.notional) / Math.max(0.1, vidaEsperada);
}
export const CHALLENGER_RANKING: ConfigChallenger = {
  challengerId: 'challenger-ranking',
  strategyVersion: 'v1', configVersion: 'v1',
  exchanges: EXCHANGES_6, capitalPorExchange: 100, alavancagem: 5, reserva: 0.30,
  margemPayback: 1.5, maxPosicoes: 3,
  scorer: scorerRanking,
  familia: 'exploitation',
  hipotese: 'reordenar candidatas aprovadas pelo mesmo portão do champion por utility, não só por spread, aumenta o PnL por dólar alocado',
};

/**
 * CHALLENGER-CONCENTRATION-AWARE-RANKING (renomeado nesta sessão — era
 * "challenger-best-pair", nome errado desde o início).
 *
 * O motivo da renomeação: `lerVigilancia()` já devolve o ranking por SÍMBOLO
 * com o melhor par já escolhido pela própria vigilância — não há, no feed
 * atual, múltiplos pares concorrentes para o MESMO símbolo chegando ao
 * motor. Chamar isto de "best pair" prometia uma comparação de pares
 * alternativos que ele nunca fez — ele só desempata ENTRE símbolos
 * diferentes por concentração, nunca compara exchange A vs. B pro mesmo
 * ativo. O verdadeiro `challenger-best-pair` só pode existir depois do feed
 * de pares alternativos (Parte 3 desta etapa, `vigilancia/pares-
 * alternativos.json`) — ver esse challenger separado, mais abaixo.
 *
 * Estado e histórico já coletados sob o nome antigo foram migrados via
 * `migrarChallenger()`, não descartados — ver `paper-profit-lab.ts`.
 */
export function penalidadeConcentracao(o: OportunidadeSpread, saldos: Saldos): number {
  const total = Object.values(saldos).reduce((a, b) => a + b, 0);
  if (total <= 0) return 0;
  const fracaoShort = (saldos[o.exchangeShort] ?? 0) / total;
  const fracaoLong = (saldos[o.exchangeLong] ?? 0) / total;
  // quanto MENOS saldo livre sobra numa exchange, mais concentrada ela já
  // está de posições anteriores — penaliza abrir mais ali
  const concentracaoMedia = 1 - (fracaoShort + fracaoLong) / 2;
  return concentracaoMedia * 0.1; // peso pequeno — desempate, não filtro (mesmo espírito de equilibrio.ts)
}
export const CHALLENGER_CONCENTRATION_AWARE_RANKING: ConfigChallenger = {
  challengerId: 'challenger-concentration-aware-ranking',
  strategyVersion: 'v1', configVersion: 'v1',
  exchanges: EXCHANGES_6, capitalPorExchange: 100, alavancagem: 5, reserva: 0.30,
  margemPayback: 1.5, maxPosicoes: 3,
  penalidadePar: penalidadeConcentracao,
  familia: 'exploitation',
  hipotese: 'desempatar candidatas por concentração de saldo evita travar capital numa exchange só, liberando mais entradas futuras',
};

/**
 * BATCH-REBALANCING — mesmas proteções do control (crítico nunca é adiado),
 * mas escalonamento não-crítico é represado até o benefício esperado superar
 * o custo × margem de segurança (Parte 8). Três configurações, variando só a
 * margem de segurança exigida.
 *
 * Renomeados nesta sessão (Parte 21) de conservador/moderado/agressivo pra
 * nomes que descrevem o COMPORTAMENTO observável (quanto tempo o ajuste fica
 * represado), não uma escala de risco genérica que não dizia nada sobre o
 * que o challenger realmente faz. IDs antigos migrados via `MIGRACOES`.
 */
export const CHALLENGER_BATCH_ALTA_RETENCAO: ConfigChallenger = {
  challengerId: 'challenger-batch-alta-retencao',
  strategyVersion: 'v1', configVersion: 'v1',
  exchanges: EXCHANGES_6, capitalPorExchange: 100, alavancagem: 5, reserva: 0.30,
  margemPayback: 1.5, maxPosicoes: 3,
  modoEscalonamento: 'represado', margemSegurancaBatch: 3, // exige 3x de folga — represa quase tudo
  familia: 'exploitation',
  hipotese: 'represar quase todo escalonamento até 3x de folga evita custo de ajuste frequente, mesmo perdendo alguma janela de spread',
};
export const CHALLENGER_BATCH_MEDIA_RETENCAO: ConfigChallenger = {
  challengerId: 'challenger-batch-media-retencao',
  strategyVersion: 'v1', configVersion: 'v1',
  exchanges: EXCHANGES_6, capitalPorExchange: 100, alavancagem: 5, reserva: 0.30,
  margemPayback: 1.5, maxPosicoes: 3,
  modoEscalonamento: 'represado', margemSegurancaBatch: 2,
  familia: 'exploitation',
  hipotese: 'margem de segurança intermediária (2x) equilibra custo de ajuste e velocidade de captura da folga',
};
export const CHALLENGER_BATCH_BAIXA_RETENCAO: ConfigChallenger = {
  challengerId: 'challenger-batch-baixa-retencao',
  strategyVersion: 'v1', configVersion: 'v1',
  exchanges: EXCHANGES_6, capitalPorExchange: 100, alavancagem: 5, reserva: 0.30,
  margemPayback: 1.5, maxPosicoes: 3,
  modoEscalonamento: 'represado', margemSegurancaBatch: 1.2, // quase não represa — mais perto do imediato
  familia: 'exploitation',
  hipotese: 'represar pouco (1,2x) fica quase idêntico ao escalonamento imediato do champion — controle de que represar exige margem real',
};

/**
 * CAPITAL ALLOCATION (Parte 11) — carteiras virtuais com distribuições
 * iniciais diferentes, MESMA lógica de decisão do control. Os pesos
 * "produtivos" usam o PnL/dólar REAL medido na auditoria desta sessão
 * (bybit +1,44%, bitget +0,90%, bingx +0,60%, gate +0,26%, okx +0,16%,
 * binanceusdm −0,08% — ver docs da auditoria), não um chute — mas é uma
 * amostra de 85h, então isto é um EXPERIMENTO, não uma recomendação.
 */
const EXCHANGES_TODAS = EXCHANGES_6;
function distribuir(pesos: Record<string, number>, total = 600): Record<string, number> {
  const somaPesos = Object.values(pesos).reduce((a, b) => a + b, 0);
  return Object.fromEntries(Object.entries(pesos).map(([ex, w]) => [ex, (w / somaPesos) * total]));
}
export const CHALLENGER_ALLOC_EQUAL: ConfigChallenger = {
  challengerId: 'challenger-alloc-equal-6', strategyVersion: 'v1', configVersion: 'v1',
  exchanges: EXCHANGES_TODAS, capitalPorExchange: 100, alavancagem: 5, reserva: 0.30, margemPayback: 1.5, maxPosicoes: 3,
  familia: 'exploitation',
  hipotese: 'distribuição igual entre as 6 exchanges é a régua neutra de alocação',
};
export const CHALLENGER_ALLOC_PRODUCTIVE: ConfigChallenger = {
  challengerId: 'challenger-alloc-productive-weighted-6', strategyVersion: 'v1', configVersion: 'v1',
  exchanges: EXCHANGES_TODAS, capitalPorExchange: 100, alavancagem: 5, reserva: 0.30, margemPayback: 1.5, maxPosicoes: 3,
  distribuicaoInicial: distribuir({ bybit: 1.44, bitget: 0.90, bingx: 0.60, gate: 0.26, okx: 0.16, binanceusdm: 0.01 }),
  familia: 'exploitation',
  hipotese: 'concentrar capital inicial nas exchanges com PnL/dólar historicamente melhor aumenta o retorno sem mudar a lógica de decisão',
};
export const CHALLENGER_ALLOC_BEST2: ConfigChallenger = {
  challengerId: 'challenger-alloc-best-2-dynamic', strategyVersion: 'v1', configVersion: 'v1',
  exchanges: ['bybit', 'bitget'], capitalPorExchange: 100, alavancagem: 5, reserva: 0.30, margemPayback: 1.5, maxPosicoes: 1,
  familia: 'exploitation',
  hipotese: 'restringir o universo às 2 exchanges mais produtivas concentra frequência onde já sabemos que funciona',
};
export const CHALLENGER_ALLOC_BEST3: ConfigChallenger = {
  challengerId: 'challenger-alloc-best-3-dynamic', strategyVersion: 'v1', configVersion: 'v1',
  exchanges: ['bybit', 'bitget', 'bingx'], capitalPorExchange: 100, alavancagem: 5, reserva: 0.30, margemPayback: 1.5, maxPosicoes: 2,
  familia: 'exploitation',
  hipotese: 'universo de 3 exchanges produtivas equilibra concentração e diversificação de oportunidade',
};

/**
 * GRID DE margemPayback (Parte 4 desta etapa) — 7 configurações, do portão
 * mais apertado (exige menos folga, abre mais vezes, arrisca mais falso-
 * positivo) ao mais largo (exige mais folga, abre menos, mais seletivo).
 * `payback-150-controle` replica o valor real do champion — é o ponto de
 * referência do grid, não um challenger a mais competindo às cegas.
 * `familia: 'exploration'` porque testa um parâmetro fora do que o champion
 * está autorizado a usar.
 */
function gridPayback(id: string, margemPayback: number, hipotese: string): ConfigChallenger {
  return {
    challengerId: id, strategyVersion: 'v1', configVersion: 'v1',
    exchanges: EXCHANGES_6, capitalPorExchange: 100, alavancagem: 5, reserva: 0.30,
    margemPayback, maxPosicoes: 3,
    familia: margemPayback === 1.5 ? 'control' : 'exploration',
    hipotese,
  };
}
export const CHALLENGER_PAYBACK_110 = gridPayback('challenger-payback-110', 1.10, 'portão quase no limiar mínimo (1,10x) — mais entradas, mais risco de folga que não se sustenta');
export const CHALLENGER_PAYBACK_120 = gridPayback('challenger-payback-120', 1.20, 'portão levemente mais apertado que o champion — mede o ganho de frequência perto da borda');
export const CHALLENGER_PAYBACK_130 = gridPayback('challenger-payback-130', 1.30, 'meio caminho entre o mínimo de estágio (1,0x) e o full-size do champion (1,5x)');
export const CHALLENGER_PAYBACK_140 = gridPayback('challenger-payback-140', 1.40, 'levemente abaixo do champion — testa se 1,5x tem folga desperdiçada');
export const CHALLENGER_PAYBACK_150_CONTROLE = gridPayback('challenger-payback-150-controle', 1.50, 'réplica exata do valor real do champion — ponto de referência do grid');
export const CHALLENGER_PAYBACK_175 = gridPayback('challenger-payback-175', 1.75, 'mais seletivo que o champion — menos trades, testa se qualidade compensa frequência perdida');
export const CHALLENGER_PAYBACK_200 = gridPayback('challenger-payback-200', 2.00, 'portão bem mais exigente (2,0x) — extremo conservador do grid');
export const GRID_PAYBACK: ConfigChallenger[] = [
  CHALLENGER_PAYBACK_110, CHALLENGER_PAYBACK_120, CHALLENGER_PAYBACK_130, CHALLENGER_PAYBACK_140,
  CHALLENGER_PAYBACK_150_CONTROLE, CHALLENGER_PAYBACK_175, CHALLENGER_PAYBACK_200,
];

/**
 * GRID DE ESTÁGIO INICIAL (Parte 4) — 6 configurações da fração usada na
 * entrada parcial (folga 1,0x–1,5x) antes do escalonamento. `stage-25-
 * controle` replica o valor real do champion (`FRACAO_ESTAGIO_INICIAL`=0,25).
 */
function gridEstagio(id: string, fracaoEstagioInicial: number, hipotese: string): ConfigChallenger {
  return {
    challengerId: id, strategyVersion: 'v1', configVersion: 'v1',
    exchanges: EXCHANGES_6, capitalPorExchange: 100, alavancagem: 5, reserva: 0.30,
    margemPayback: 1.5, maxPosicoes: 3, fracaoEstagioInicial,
    familia: fracaoEstagioInicial === 0.25 ? 'control' : 'exploration',
    hipotese,
  };
}
export const CHALLENGER_STAGE_10 = gridEstagio('challenger-stage-10', 0.10, 'fatia inicial minúscula (10%) — testa exposição mínima antes de provar o payback cheio');
export const CHALLENGER_STAGE_25_CONTROLE = gridEstagio('challenger-stage-25-controle', 0.25, 'réplica exata do valor real do champion (FRACAO_ESTAGIO_INICIAL)');
export const CHALLENGER_STAGE_40 = gridEstagio('challenger-stage-40', 0.40, 'fatia inicial maior que o champion — mais exposição antes de confirmar o payback cheio');
export const CHALLENGER_STAGE_50 = gridEstagio('challenger-stage-50', 0.50, 'metade do notional na entrada — meio caminho até tamanho cheio');
export const CHALLENGER_STAGE_75 = gridEstagio('challenger-stage-75', 0.75, 'fatia inicial grande — quase full-size desde a primeira entrada');
export const CHALLENGER_STAGE_100 = gridEstagio('challenger-stage-100', 1.00, 'sem estágio nenhum — sempre abre full-size, elimina o degrau intermediário do champion');
export const GRID_ESTAGIO: ConfigChallenger[] = [
  CHALLENGER_STAGE_10, CHALLENGER_STAGE_25_CONTROLE, CHALLENGER_STAGE_40,
  CHALLENGER_STAGE_50, CHALLENGER_STAGE_75, CHALLENGER_STAGE_100,
];

/**
 * GRID DE RESERVA (Parte 6) — 6 configurações da fração de saldo mantida
 * fora de operação. `reserve-30-controle` replica o valor real do champion.
 */
function gridReserva(id: string, reserva: number, hipotese: string): ConfigChallenger {
  return {
    challengerId: id, strategyVersion: 'v1', configVersion: 'v1',
    exchanges: EXCHANGES_6, capitalPorExchange: 100, alavancagem: 5, reserva,
    margemPayback: 1.5, maxPosicoes: 3,
    familia: reserva === 0.30 ? 'control' : 'exploration',
    hipotese,
  };
}
export const CHALLENGER_RESERVE_15 = gridReserva('challenger-reserve-15', 0.15, 'reserva reduzida (15%) — mais capital de giro, menos colchão pra escalonamento/apara');
export const CHALLENGER_RESERVE_20 = gridReserva('challenger-reserve-20', 0.20, 'reserva abaixo do champion — mede se 30% deixa capital ocioso demais');
export const CHALLENGER_RESERVE_25 = gridReserva('challenger-reserve-25', 0.25, 'levemente abaixo do champion — passo intermediário até 15%');
export const CHALLENGER_RESERVE_30_CONTROLE = gridReserva('challenger-reserve-30-controle', 0.30, 'réplica exata do valor real do champion');
export const CHALLENGER_RESERVE_35 = gridReserva('challenger-reserve-35', 0.35, 'reserva acima do champion — mais colchão de segurança, menos capital de giro');
export const CHALLENGER_RESERVE_40 = gridReserva('challenger-reserve-40', 0.40, 'reserva bem acima do champion — extremo conservador do grid');
export const GRID_RESERVA: ConfigChallenger[] = [
  CHALLENGER_RESERVE_15, CHALLENGER_RESERVE_20, CHALLENGER_RESERVE_25,
  CHALLENGER_RESERVE_30_CONTROLE, CHALLENGER_RESERVE_35, CHALLENGER_RESERVE_40,
];

/**
 * GRID DE POSIÇÕES SIMULTÂNEAS (Parte 7) — 6 configurações de `maxPosicoes`.
 * `positions-3-controle` replica o valor real do champion.
 */
function gridPosicoes(id: string, maxPosicoes: number, hipotese: string): ConfigChallenger {
  return {
    challengerId: id, strategyVersion: 'v1', configVersion: 'v1',
    exchanges: EXCHANGES_6, capitalPorExchange: 100, alavancagem: 5, reserva: 0.30,
    margemPayback: 1.5, maxPosicoes,
    familia: maxPosicoes === 3 ? 'control' : 'exploration',
    hipotese,
  };
}
export const CHALLENGER_POSITIONS_1 = gridPosicoes('challenger-positions-1', 1, 'concentração máxima — uma posição só, sem diluir capital, mais exposto a um símbolo específico');
export const CHALLENGER_POSITIONS_2 = gridPosicoes('challenger-positions-2', 2, 'diversificação mínima — 2 posições simultâneas');
export const CHALLENGER_POSITIONS_3_CONTROLE = gridPosicoes('challenger-positions-3-controle', 3, 'réplica exata do valor real do champion');
export const CHALLENGER_POSITIONS_4 = gridPosicoes('challenger-positions-4', 4, 'mais diversificado que o champion — testa se mais posições simultâneas aumenta frequência sem diluir demais o notional por posição');
export const CHALLENGER_POSITIONS_5 = gridPosicoes('challenger-positions-5', 5, 'diversificação alta — 5 posições simultâneas');
export const CHALLENGER_POSITIONS_6 = gridPosicoes('challenger-positions-6', 6, 'uma posição por exchange do universo — diversificação máxima possível com 6 exchanges');
export const GRID_POSICOES: ConfigChallenger[] = [
  CHALLENGER_POSITIONS_1, CHALLENGER_POSITIONS_2, CHALLENGER_POSITIONS_3_CONTROLE,
  CHALLENGER_POSITIONS_4, CHALLENGER_POSITIONS_5, CHALLENGER_POSITIONS_6,
];

/**
 * GRID DE ALAVANCAGEM (Parte 8) — 7 configurações. `leverage-5-controle`
 * replica o valor real do champion. Qualquer alavancagem >5x carrega
 * `hipotese` explicitamente marcada como alto risco — NUNCA promovível
 * automaticamente, mesmo com PnL bom, porque alavancagem alta muda o perfil
 * de liquidação de um jeito que nenhuma métrica de PnL paper captura
 * sozinha. O leaderboard deve exibir essa tag, não escondê-la.
 */
function gridAlavancagem(id: string, alavancagem: number, hipotese: string): ConfigChallenger {
  return {
    challengerId: id, strategyVersion: 'v1', configVersion: 'v1',
    exchanges: EXCHANGES_6, capitalPorExchange: 100, alavancagem, reserva: 0.30,
    margemPayback: 1.5, maxPosicoes: 3,
    familia: alavancagem === 5 ? 'control' : 'exploration',
    hipotese,
  };
}
export const CHALLENGER_LEVERAGE_2 = gridAlavancagem('challenger-leverage-2', 2, 'alavancagem bem abaixo do champion — menos risco de liquidação, menos notional por dólar de margem');
export const CHALLENGER_LEVERAGE_3 = gridAlavancagem('challenger-leverage-3', 3, 'alavancagem reduzida — passo intermediário até 2x');
export const CHALLENGER_LEVERAGE_4 = gridAlavancagem('challenger-leverage-4', 4, 'levemente abaixo do champion — mede se 5x já é o ponto ótimo');
export const CHALLENGER_LEVERAGE_5_CONTROLE = gridAlavancagem('challenger-leverage-5-controle', 5, 'réplica exata do valor real do champion');
export const CHALLENGER_LEVERAGE_6 = gridAlavancagem('challenger-leverage-6', 6, '[exploracao_paper_alto_risco] alavancagem acima do champion — NUNCA promovível automaticamente, mesmo com PnL bom');
export const CHALLENGER_LEVERAGE_7 = gridAlavancagem('challenger-leverage-7', 7, '[exploracao_paper_alto_risco] alavancagem alta — risco de liquidação que PnL paper não captura sozinho');
export const CHALLENGER_LEVERAGE_8 = gridAlavancagem('challenger-leverage-8', 8, '[exploracao_paper_alto_risco] extremo do grid — existe só pra medir onde o risco deixa de compensar, não pra ser usado');
export const GRID_ALAVANCAGEM: ConfigChallenger[] = [
  CHALLENGER_LEVERAGE_2, CHALLENGER_LEVERAGE_3, CHALLENGER_LEVERAGE_4, CHALLENGER_LEVERAGE_5_CONTROLE,
  CHALLENGER_LEVERAGE_6, CHALLENGER_LEVERAGE_7, CHALLENGER_LEVERAGE_8,
];
/** alavancagem > 5x (a do champion) é sempre alto risco — usado pelo leaderboard pra nunca recomendar promoção automática. */
export function ehAltoRiscoAlavancagem(cfg: ConfigChallenger): boolean {
  return cfg.alavancagem > 5;
}

/**
 * CAPTURA DE SETTLEMENT — primeira leva, ISOLADA (Parte 3 desta etapa).
 *
 * Config comum aos 5, por pedido explícito: mesma alavancagem/reserva/custos/
 * proteções do control, `modoCapital: 'isolated'` (capital 100% próprio,
 * nunca disputa com o control nem com a persistência), `coberturaMinima: 1.5`
 * (mesma régua de margem de segurança do resto do Lab). A ÚNICA variável
 * entre os cinco é a janela antes do settlement.
 *
 * Deliberadamente NÃO incluído nesta leva (ver Parte 8/9 do pedido — só
 * depois de validação técnica): capital compartilhado, grid de cobertura,
 * combinações com payback, sizing alternativo, smart exit, janelas 3m/8m/
 * 15m/45m.
 */
function gridCaptureIsolated(id: string, janelaMinutos: number): ConfigChallenger {
  return {
    challengerId: id, strategyVersion: 'v1', configVersion: 'v1',
    exchanges: EXCHANGES_6, capitalPorExchange: 100, alavancagem: 5, reserva: 0.30,
    margemPayback: 1.5, maxPosicoes: 3,
    tipo: 'captura', familia: 'capture', modoCapital: 'isolated',
    janelaCapturaMs: janelaMinutos * 60_000, coberturaMinima: 1.5,
    hipotese: `captura da liquidação mais próxima dentro de uma janela de ${janelaMinutos}min antes do settlement — capital isolado, nunca disputa com o control`,
  };
}
export const CHALLENGER_CAPTURE_ISOLATED_5M = gridCaptureIsolated('capture-isolated-5m', 5);
export const CHALLENGER_CAPTURE_ISOLATED_10M = gridCaptureIsolated('capture-isolated-10m', 10);
export const CHALLENGER_CAPTURE_ISOLATED_20M = gridCaptureIsolated('capture-isolated-20m', 20);
export const CHALLENGER_CAPTURE_ISOLATED_30M = gridCaptureIsolated('capture-isolated-30m', 30);
export const CHALLENGER_CAPTURE_ISOLATED_60M = gridCaptureIsolated('capture-isolated-60m', 60);
export const GRID_CAPTURE_ISOLATED: ConfigChallenger[] = [
  CHALLENGER_CAPTURE_ISOLATED_5M, CHALLENGER_CAPTURE_ISOLATED_10M, CHALLENGER_CAPTURE_ISOLATED_20M,
  CHALLENGER_CAPTURE_ISOLATED_30M, CHALLENGER_CAPTURE_ISOLATED_60M,
];

/** Lista aprovada — o orquestrador só itera sobre isto. */
export const CHALLENGERS_APROVADOS: ConfigChallenger[] = [
  CHALLENGER_CONTROL, CHALLENGER_RANKING, CHALLENGER_CONCENTRATION_AWARE_RANKING,
  CHALLENGER_BATCH_ALTA_RETENCAO, CHALLENGER_BATCH_MEDIA_RETENCAO, CHALLENGER_BATCH_BAIXA_RETENCAO,
  CHALLENGER_ALLOC_EQUAL, CHALLENGER_ALLOC_PRODUCTIVE, CHALLENGER_ALLOC_BEST2, CHALLENGER_ALLOC_BEST3,
  ...GRID_PAYBACK, ...GRID_ESTAGIO, ...GRID_RESERVA, ...GRID_POSICOES, ...GRID_ALAVANCAGEM,
  ...GRID_CAPTURE_ISOLATED,
];

/** IDs antigos → novos, pra migração automática na primeira subida (Parte 2). */
export const MIGRACOES: [string, string][] = [
  ['challenger-best-pair', 'challenger-concentration-aware-ranking'],
  ['challenger-batch-conservador', 'challenger-batch-alta-retencao'],
  ['challenger-batch-moderado', 'challenger-batch-media-retencao'],
  ['challenger-batch-agressivo', 'challenger-batch-baixa-retencao'],
];
