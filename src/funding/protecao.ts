/**
 * PROTEÇÃO CONTRA RUÍNA no motor delta-neutro.
 *
 * O motor eliminava o risco de preço e deixava o risco operacional descoberto.
 * A diferença importa: numa estrutura de duas pernas, o patrimônio não some
 * porque o mercado andou — some porque UMA das exchanges liquidou a perna dela
 * antes de a margem chegar.
 *
 * O desenho aqui parte de uma assimetria de custo que decide tudo:
 *
 *   transferir margem     ~US$ 0,01   (transferido × 0,05%)
 *   rotacionar de par      US$ 0,50   (duas montagens)
 *   ser liquidado         ~US$ 50     (a margem inteira de uma perna)
 *
 * Transferir é MIL vezes mais barato que ser liquidado. Então a política certa
 * não é economizar transferência — é transferir cedo e com frequência. Isso não
 * remove nenhum trade lucrativo: o dinheiro só muda de exchange, a posição
 * continua montada e o funding continua entrando.
 *
 * Fechar por emergência é o último recurso, e só existe porque transferência
 * entre exchanges leva minutos. Se o movimento for rápido demais, não adianta
 * ter dinheiro do outro lado.
 */

/**
 * Margem de manutenção por perna.
 *
 * Não é uniforme: majors têm mmr menor que alts, e a faixa aperta com o
 * notional. Nas escalas deste projeto (notional abaixo de US$ 10 mil) a faixa
 * inicial é a que vale, mas uso o valor de ALT como padrão porque a vigilância
 * varre o mercado inteiro e a maioria dos pares que ela encontra são alts.
 */
export const MMR_ALT = 0.01;
export const MMR_MAJOR = 0.004;

const MAJORS = ['BTC', 'ETH', 'SOL', 'BNB', 'XRP'];

export function mmrDe(symbol: string): number {
  const base = symbol.split('/')[0];
  return MAJORS.includes(base) ? MMR_MAJOR : MMR_ALT;
}

/**
 * A que distância de movimento contrário esta perna é liquidada.
 *
 * A perna morre quando a perda consome a margem ATÉ a margem de manutenção —
 * não a margem inteira. Ignorar o mmr superestima o fôlego, que é o erro
 * perigoso a se cometer aqui.
 */
export function distanciaLiquidacao(margem: number, notional: number, mmr: number): number {
  if (notional <= 0) return Infinity;
  return margem / notional - mmr;
}

export interface EstadoRisco {
  /** margem restante na perna vendida, depois do movimento de preço */
  margemShort: number;
  /** margem restante na perna comprada */
  margemLong: number;
  /** distância de liquidação da perna mais apertada, em fração */
  distanciaMinima: number;
  /** qual perna está mais perto de morrer */
  pernaEmRisco: 'short' | 'long';
  nivel: 'ok' | 'alerta' | 'critico';
}

export interface LimiaresRisco {
  /** abaixo desta distância, transferir margem */
  alerta: number;
  /** abaixo desta distância, fechar — não dá tempo de transferir */
  critico: number;
}

/**
 * Os limiares padrão saem do tempo, não de uma preferência.
 *
 * Transferência entre exchanges leva de 2 a 10 minutos (saque + confirmação +
 * crédito). O motor acorda a cada 20 minutos. No pior caso, entre detectar e ter
 * a margem creditada podem passar 30 minutos.
 *
 * Um alt líquido move 10% em 30 minutos com alguma regularidade em dias de
 * stress. Então `alerta` em 12% dá margem para o ciclo seguinte agir, e
 * `critico` em 6% é o ponto onde esperar já é aposta.
 */
export const LIMIARES_PADRAO: LimiaresRisco = { alerta: 0.12, critico: 0.06 };

/**
 * Onde a posição está, agora, em relação à liquidação.
 *
 * `variacao` é o movimento do preço desde a entrada, em fração. A perna vendida
 * perde quando o preço sobe; a comprada perde quando cai. As duas somadas dão
 * zero em patrimônio — mas cada uma tem sua própria margem, na sua própria
 * exchange, e é isso que pode morrer.
 */
export function avaliarRisco(
  margemShort: number,
  margemLong: number,
  notional: number,
  variacao: number,
  mmr: number,
  lim: LimiaresRisco = LIMIARES_PADRAO,
): EstadoRisco {
  const perdaShort = notional * variacao;
  const msAtual = margemShort - perdaShort;
  const mlAtual = margemLong + perdaShort;

  const dShort = distanciaLiquidacao(msAtual, notional, mmr);
  const dLong = distanciaLiquidacao(mlAtual, notional, mmr);
  const dMin = Math.min(dShort, dLong);

  return {
    margemShort: msAtual,
    margemLong: mlAtual,
    distanciaMinima: dMin,
    pernaEmRisco: dShort <= dLong ? 'short' : 'long',
    nivel: dMin <= lim.critico ? 'critico' : dMin <= lim.alerta ? 'alerta' : 'ok',
  };
}

/**
 * Quanto transferir para reequilibrar.
 *
 * Iguala as duas margens, que é o estado de máxima distância de liquidação para
 * um dado capital. Não faz sentido transferir menos: o custo é proporcional ao
 * valor transferido e desprezível, então transferir "só o necessário" economiza
 * centavos e deixa a posição no limiar de novo no ciclo seguinte.
 */
export function quantoTransferir(margemShort: number, margemLong: number): {
  valor: number; de: 'short' | 'long';
} {
  const diff = margemShort - margemLong;
  return { valor: Math.abs(diff) / 2, de: diff > 0 ? 'short' : 'long' };
}

// ── piso de capital ────────────────────────────────────────────────────────

export interface EstadoPiso {
  /** maior capital já alcançado */
  pico: number;
  /** piso absoluto definido pelo usuário — nunca desce abaixo disto */
  pisoAbsoluto: number;
  /** fração do pico que o piso móvel acompanha */
  fracaoPico: number;
}

/**
 * Piso móvel: trava ganho sem limitar ganho.
 *
 * A ideia é de catraca. O piso sobe quando o capital sobe e NUNCA desce. Isso
 * é deliberadamente assimétrico: limitar o lado de baixo não custa nada no lado
 * de cima, porque o motor continua livre para compor enquanto estiver acima.
 *
 * `fracaoPico` a 0,85 significa: aceito devolver até 15% do melhor momento
 * antes de parar. Abaixo disso, alguma premissa quebrou e continuar operando é
 * torcer, não decidir.
 */
export function pisoAtual(e: EstadoPiso): number {
  return Math.max(e.pisoAbsoluto, e.pico * e.fracaoPico);
}

export function atualizarPico(e: EstadoPiso, capital: number): EstadoPiso {
  return capital > e.pico ? { ...e, pico: capital } : e;
}

export interface VeredictoPiso {
  parar: boolean;
  piso: number;
  folga: number;
  motivo: string;
}

export function verificarPiso(e: EstadoPiso, capital: number): VeredictoPiso {
  const piso = pisoAtual(e);
  const folga = capital - piso;
  return {
    parar: capital <= piso,
    piso,
    folga,
    motivo: capital <= piso
      ? `capital US$ ${capital.toFixed(2)} tocou o piso US$ ${piso.toFixed(2)} ` +
        `(pico US$ ${e.pico.toFixed(2)})`
      : `US$ ${folga.toFixed(2)} acima do piso US$ ${piso.toFixed(2)}`,
  };
}

// ── alavancagem sustentável ────────────────────────────────────────────────

/**
 * A maior alavancagem cuja distância de liquidação inicial ainda respeita o
 * limiar de alerta.
 *
 * Serve para responder "5x é demais?" com uma conta em vez de uma opinião. Com
 * margem igual nas duas pernas, a distância inicial é `1/(2L) ... ` — não: a
 * margem por perna é capital/2 e o notional por perna é (capital/2)×L, então a
 * razão margem/notional é exatamente 1/L. A distância inicial é 1/L − mmr.
 *
 * Para que a posição NASÇA fora do alerta, é preciso 1/L − mmr > alerta, ou
 * seja L < 1/(alerta + mmr).
 */
export function alavancagemMaxima(lim: LimiaresRisco = LIMIARES_PADRAO, mmr = MMR_ALT): number {
  return 1 / (lim.alerta + mmr);
}
