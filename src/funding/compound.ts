/**
 * COMPOSIÇÃO — o lucro vira notional, que gera mais lucro.
 *
 * Sem isto, o funding só acumula parado no caixa e a renda semanal fica
 * constante. Com isto, cada pagamento aumenta o tamanho da posição, que
 * aumenta o pagamento seguinte. É a bola de neve aplicada a uma fonte de renda
 * em vez de a uma aposta direcional.
 *
 * A mecânica: o capital total é sempre redividido em 75% spot + 25% margem,
 * sustentando um notional igual ao spot. Quando o capital cresce, os três
 * crescem juntos.
 *
 * A restrição que decide quando reinvestir: aumentar a posição custa taxa. Com
 * capital pequeno, reinvestir a cada pagamento gasta mais em taxa do que o
 * pagamento vale. O reinvestimento acontece por LIMIAR — só quando o acréscimo
 * de notional gera funding suficiente para pagar o custo de montá-lo em poucos
 * dias.
 */
import type { ConfigMotor } from './engine.ts';
import { dimensionar } from './engine.ts';

export interface EstadoComposicao {
  capital: number;
  /** notional atualmente montado */
  notionalAtual: number;
  /** lucro acumulado ainda não reinvestido */
  caixaOcioso: number;
  reinvestimentos: number;
  custoReinvestimentos: number;
}

export function iniciar(capital: number, cfg: ConfigMotor): EstadoComposicao {
  const d = dimensionar(capital, cfg);
  return {
    capital, notionalAtual: d.notional, caixaOcioso: 0,
    reinvestimentos: 0, custoReinvestimentos: 0,
  };
}

/**
 * Decide se vale aumentar a posição agora.
 *
 * O acréscimo de notional gera `delta × funding × 3` por dia. Montá-lo custa
 * `delta × (taxaSpot + taxaPerp)`. Só compensa se o custo se pagar rápido —
 * caso contrário o caixa espera acumular mais.
 */
export function valeReinvestir(
  caixaOcioso: number, fundingPor8h: number, cfg: ConfigMotor, diasParaPagarMax = 3,
): { reinvestir: boolean; notionalExtra: number; custo: number; diasParaPagar: number } {
  // o caixa vira spot + margem na mesma proporção
  const d = dimensionar(caixaOcioso, cfg);
  const notionalExtra = d.notional;
  const custo = notionalExtra * (cfg.taxaSpot + cfg.taxaPerp);
  const ganhoDia = notionalExtra * fundingPor8h * 3;
  const dias = ganhoDia > 0 ? custo / ganhoDia : Infinity;
  return { reinvestir: dias <= diasParaPagarMax && notionalExtra > 0, notionalExtra, custo, diasParaPagar: dias };
}

/** Recebe funding e guarda no caixa ocioso até valer a pena reinvestir. */
export function receber(e: EstadoComposicao, taxa: number): EstadoComposicao {
  const ganho = e.notionalAtual * taxa;
  return { ...e, capital: e.capital + ganho, caixaOcioso: e.caixaOcioso + ganho };
}

/** Converte o caixa ocioso em notional novo. */
export function reinvestir(e: EstadoComposicao, cfg: ConfigMotor, fundingPor8h: number): {
  estado: EstadoComposicao; aplicado: boolean; detalhe: string;
} {
  const v = valeReinvestir(e.caixaOcioso, fundingPor8h, cfg);
  if (!v.reinvestir) {
    return {
      estado: e, aplicado: false,
      detalhe: `caixa US$ ${e.caixaOcioso.toFixed(4)} — custo se pagaria em ${v.diasParaPagar.toFixed(1)} dias, esperando`,
    };
  }
  return {
    estado: {
      ...e,
      capital: e.capital - v.custo,
      notionalAtual: e.notionalAtual + v.notionalExtra,
      caixaOcioso: 0,
      reinvestimentos: e.reinvestimentos + 1,
      custoReinvestimentos: e.custoReinvestimentos + v.custo,
    },
    aplicado: true,
    detalhe: `+US$ ${v.notionalExtra.toFixed(2)} de notional · custo US$ ${v.custo.toFixed(4)} · se paga em ${v.diasParaPagar.toFixed(1)} dias`,
  };
}

/**
 * Projeta a renda semanal ao longo do tempo, com composição.
 *
 * O ponto: a renda da semana 52 é maior que a da semana 1, porque o notional
 * cresceu. É isso que separa renda composta de renda simples.
 */
export function projetar(opts: {
  capitalInicial: number;
  fundingPor8h: number;
  semanas: number;
  cfg: ConfigMotor;
}): { semana: number; capital: number; notional: number; rendaSemana: number; acumulado: number }[] {
  const { capitalInicial, fundingPor8h, semanas, cfg } = opts;
  let e = iniciar(capitalInicial, cfg);
  const saida: { semana: number; capital: number; notional: number; rendaSemana: number; acumulado: number }[] = [];

  for (let w = 1; w <= semanas; w++) {
    const antes = e.capital;
    // 21 pagamentos por semana
    for (let k = 0; k < 21; k++) e = receber(e, fundingPor8h);
    const r = reinvestir(e, cfg, fundingPor8h);
    e = r.estado;
    saida.push({
      semana: w, capital: e.capital, notional: e.notionalAtual,
      rendaSemana: e.capital - antes, acumulado: e.capital - capitalInicial,
    });
  }
  return saida;
}
