/**
 * SIMULAÇÃO: posição escalonada por confiança, contra o portão atual (tudo ou nada).
 *
 * O portão hoje (`valor.ts`) é binário: 0% do tamanho até a vida esperada
 * cobrir 1,5× o payback, depois 100%. Isso é seguro — foi construído
 * exatamente para não repetir o prejuízo de US$ 2,30 — mas é conservador no
 * outro extremo: um candidato que já provou o suficiente pra cobrir o PRÓPRIO
 * custo (1,0×) mas não a margem de segurança inteira (1,5×) fica de fora por
 * completo, mesmo que estatisticamente já valha a pena.
 *
 * A proposta: abrir uma fatia pequena em 1,0× (sem margem) e escalar para o
 * tamanho cheio só quando cruzar 1,5× — como hoje. Ousado (age mais cedo) e
 * analítico (o tamanho é proporcional à evidência, não um chute).
 *
 * Este módulo simula os dois contra ciclos de vida REAIS já arquivados
 * (`vigilancia/arquivo-ciclos.jsonl`), usando a mesma fórmula de valor
 * esperado que o motor já confia (`valor.ts`). Não toca no motor ao vivo —
 * é só a conta, pra decidir com número antes de arriscar capital de verdade.
 *
 * Simplificação assumida, e documentada porque importa pro resultado:
 * consistência é tratada como CONSTANTE ao longo da vida do ciclo (a média
 * final que temos arquivada). Na vida real ela varia — normalmente sobe com
 * o tempo, o que faria os gatilhos disparar um pouco mais cedo do que esta
 * simulação prevê. É um viés conservador, na mesma direção que o resto do
 * projeto já prefere errar.
 */
export const PAGAMENTOS_POR_HORA = 3 / 24;

export interface CicloParaSimular {
  duracaoHoras: number;
  spreadMedio: number;
  consistencia: number;
}

export interface ParametrosSimulacao {
  notional: number;
  taxa: number;
  margemPayback: number;
  /** fração do tamanho normal na primeira fatia, ex.: 0.25 = 25% */
  fracaoEstagio1: number;
}

export interface ResultadoCiclo {
  abriu: boolean;
  tHoraDaAbertura?: number;
  receita: number;
  custo: number;
  valor: number;
}

/** Em que hora de vida a vida-esperada cruza um múltiplo do payback. */
function horaDoGatilho(paybackHoras: number, consistencia: number, margem: number): number {
  if (consistencia <= 0) return Infinity;
  // vidaEsperada(t) = t * consistencia  ⇒  t = payback*margem / consistencia
  return (paybackHoras * margem) / consistencia;
}

function paybackDoCiclo(c: CicloParaSimular, p: ParametrosSimulacao): number {
  const custoIdaEVolta = p.notional * p.taxa * 4;
  return c.spreadMedio > 0 ? custoIdaEVolta / (p.notional * c.spreadMedio * PAGAMENTOS_POR_HORA) : Infinity;
}

/** Portão atual: tudo ou nada em 1,5× o payback. */
export function simularAtual(c: CicloParaSimular, p: ParametrosSimulacao): ResultadoCiclo {
  const payback = paybackDoCiclo(c, p);
  const tAbre = horaDoGatilho(payback, c.consistencia, p.margemPayback);
  if (tAbre >= c.duracaoHoras) {
    return { abriu: false, receita: 0, custo: 0, valor: 0 };
  }
  const vidaRestante = c.duracaoHoras - tAbre;
  const receita = p.notional * c.spreadMedio * PAGAMENTOS_POR_HORA * vidaRestante;
  const custo = p.notional * p.taxa * 4;
  return { abriu: true, tHoraDaAbertura: tAbre, receita, custo, valor: receita - custo };
}

/** Escalonado: fatia pequena em 1,0×, escala pro tamanho cheio em 1,5×. */
export function simularEscalonado(c: CicloParaSimular, p: ParametrosSimulacao): ResultadoCiclo {
  const payback = paybackDoCiclo(c, p);
  const tEstagio1 = horaDoGatilho(payback, c.consistencia, 1.0);
  if (tEstagio1 >= c.duracaoHoras) {
    return { abriu: false, receita: 0, custo: 0, valor: 0 };
  }
  const tEstagio2 = horaDoGatilho(payback, c.consistencia, p.margemPayback);
  const notionalFatia = p.notional * p.fracaoEstagio1;
  const custoFatia = notionalFatia * p.taxa * 4;

  if (tEstagio2 >= c.duracaoHoras) {
    // nunca escala — fica só na fatia pequena até fechar
    const vidaRestante = c.duracaoHoras - tEstagio1;
    const receita = notionalFatia * c.spreadMedio * PAGAMENTOS_POR_HORA * vidaRestante;
    return { abriu: true, tHoraDaAbertura: tEstagio1, receita, custo: custoFatia, valor: receita - custoFatia };
  }

  // fatia pequena de tEstagio1 até tEstagio2, tamanho cheio de tEstagio2 até fechar
  const vidaNaFatia = tEstagio2 - tEstagio1;
  const vidaNoCheio = c.duracaoHoras - tEstagio2;
  const notionalExtra = p.notional - notionalFatia;
  const custoExtra = notionalExtra * p.taxa * 4;

  const receitaFatia = notionalFatia * c.spreadMedio * PAGAMENTOS_POR_HORA * vidaNaFatia;
  const receitaCheia = p.notional * c.spreadMedio * PAGAMENTOS_POR_HORA * vidaNoCheio;
  const receita = receitaFatia + receitaCheia;
  const custo = custoFatia + custoExtra;
  return { abriu: true, tHoraDaAbertura: tEstagio1, receita, custo, valor: receita - custo };
}

export interface ComparacaoAgregada {
  ciclos: number;
  atual: { abriu: number; valorTotal: number; ganhadores: number };
  escalonado: { abriu: number; valorTotal: number; ganhadores: number };
}

export function compararEstrategias(ciclos: CicloParaSimular[], p: ParametrosSimulacao): ComparacaoAgregada {
  const atual = ciclos.map((c) => simularAtual(c, p));
  const esc = ciclos.map((c) => simularEscalonado(c, p));
  return {
    ciclos: ciclos.length,
    atual: {
      abriu: atual.filter((r) => r.abriu).length,
      valorTotal: atual.reduce((s, r) => s + r.valor, 0),
      ganhadores: atual.filter((r) => r.abriu && r.valor > 0).length,
    },
    escalonado: {
      abriu: esc.filter((r) => r.abriu).length,
      valorTotal: esc.reduce((s, r) => s + r.valor, 0),
      ganhadores: esc.filter((r) => r.abriu && r.valor > 0).length,
    },
  };
}
