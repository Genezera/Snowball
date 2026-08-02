/**
 * BARBELL — volatilidade com piso garantido.
 *
 * O pedido é "pode ser muito volátil, mas não pode perder tudo". A resposta
 * NÃO é escolher um risco intermediário — risco médio dá resultado médio e
 * ainda pode zerar numa cauda ruim.
 *
 * A resposta é separação estrutural. Duas pontas que não se contaminam:
 *
 *   NÚCLEO (delta-neutro, funding)
 *     Comprado no spot, vendido no perpétuo, mesma quantidade. Exposição a
 *     preço = ZERO. Se o ativo cai 40%, perde no spot e ganha igual no short.
 *     O que sobra é o funding, que pinga a cada 8 horas.
 *     Ele não pode perder muito porque não aposta em nada.
 *
 *   SATÉLITE (direcional, agressivo)
 *     Pode multiplicar ou ir a zero. É a ponta que dá a volatilidade pedida.
 *
 * O piso não vem de calibragem — vem de aritmética. Se o satélite zerar
 * inteiro, o que sobra é o núcleo. Perder TUDO exigiria que a estratégia
 * delta-neutra também zerasse, e para isso o spot e o short teriam que perder
 * ao mesmo tempo, o que a construção impede.
 *
 * O que PODE machucar o núcleo, e está modelado:
 *   · funding negativo prolongado — corrói devagar, não zera
 *   · liquidação da perna vendida se houver alavancagem
 *   · deslistagem do ativo — o risco real dos perpétuos obscuros
 */

export interface Barbell {
  /** fração do capital no núcleo delta-neutro */
  fracaoNucleo: number;
  /** fração no satélite direcional */
  fracaoSatelite: number;
  /** o satélite só é recomposto com LUCRO do núcleo, nunca com capital novo */
  recomporSateliteComLucro: boolean;
  /** abaixo deste equity total, o satélite é desligado e tudo vai para o núcleo */
  pisoDeProtecao: number;
}

/**
 * Perfis. A diferença entre eles é quanto da conta pode evaporar.
 *
 * O piso garantido é `fracaoNucleo` menos a erosão possível do núcleo — que é
 * pequena porque ele não tem exposição direcional.
 */
export const PERFIS: Record<string, Barbell> = {
  /** Conservador: 85% protegido. O satélite é quase simbólico. */
  fortaleza: { fracaoNucleo: 0.85, fracaoSatelite: 0.15, recomporSateliteComLucro: true, pisoDeProtecao: 0.6 },
  /** Equilibrado: perde no máximo ~30% se o satélite evaporar. */
  equilibrado: { fracaoNucleo: 0.70, fracaoSatelite: 0.30, recomporSateliteComLucro: true, pisoDeProtecao: 0.5 },
  /** Agressivo: metade exposta. Volatilidade alta, piso ainda existe. */
  agressivo: { fracaoNucleo: 0.50, fracaoSatelite: 0.50, recomporSateliteComLucro: true, pisoDeProtecao: 0.4 },
};

export interface EstadoBarbell {
  nucleo: number;
  satelite: number;
  /** lucro acumulado do núcleo ainda não realocado */
  lucroNucleoAcumulado: number;
  satelliteDesligado: boolean;
}

export function alocar(capital: number, perfil: Barbell): EstadoBarbell {
  return {
    nucleo: capital * perfil.fracaoNucleo,
    satelite: capital * perfil.fracaoSatelite,
    lucroNucleoAcumulado: 0,
    satelliteDesligado: false,
  };
}

export const total = (e: EstadoBarbell) => e.nucleo + e.satelite;

/**
 * Aplica o funding recebido no núcleo.
 *
 * O notional delta-neutro é ~metade do capital do núcleo: metade compra o spot,
 * metade sustenta a margem do short. É a razão pela qual o APR sobre o capital
 * total é sempre menor que o APR do funding.
 */
export function receberFunding(e: EstadoBarbell, taxaPor8h: number): EstadoBarbell {
  const notionalNeutro = e.nucleo / 2;
  const ganho = notionalNeutro * taxaPor8h;
  return { ...e, nucleo: e.nucleo + ganho, lucroNucleoAcumulado: e.lucroNucleoAcumulado + ganho };
}

/** Aplica o resultado de um trade direcional no satélite. */
export function resultadoSatelite(e: EstadoBarbell, retorno: number, risco: number): EstadoBarbell {
  if (e.satelliteDesligado || e.satelite <= 0) return e;
  const delta = Math.max(-e.satelite, retorno * e.satelite * risco);
  return { ...e, satelite: e.satelite + delta };
}

/**
 * Rebalanceamento — onde a proteção realmente acontece.
 *
 * Três regras, e cada uma existe por um motivo:
 *
 *  1. Se o total cair abaixo do piso, o satélite é DESLIGADO e o que sobrar
 *     dele vai para o núcleo. Impede a espiral de tentar recuperar apostando.
 *
 *  2. O satélite só é recomposto com LUCRO do núcleo, nunca com o principal.
 *     Isso é o que garante que uma sequência ruim no satélite não consome a
 *     parte protegida.
 *
 *  3. Se o satélite crescer muito além da fração alvo, o excedente é
 *     transferido para o núcleo. Trava o ganho em vez de deixá-lo cavalgar.
 */
export function rebalancear(e: EstadoBarbell, perfil: Barbell, capitalInicial: number): {
  estado: EstadoBarbell;
  acao: string | null;
} {
  const t = total(e);

  if (!e.satelliteDesligado && t < capitalInicial * perfil.pisoDeProtecao) {
    return {
      estado: { ...e, nucleo: e.nucleo + e.satelite, satelite: 0, satelliteDesligado: true },
      acao: `PISO ATINGIDO (US$ ${t.toFixed(2)}) — satélite desligado, tudo para o núcleo`,
    };
  }

  // recompõe o satélite com lucro do núcleo, se ele encolheu
  const alvoSatelite = t * perfil.fracaoSatelite;
  if (
    perfil.recomporSateliteComLucro && !e.satelliteDesligado &&
    e.satelite < alvoSatelite * 0.5 && e.lucroNucleoAcumulado > 0
  ) {
    const transferir = Math.min(e.lucroNucleoAcumulado, alvoSatelite - e.satelite);
    return {
      estado: {
        ...e, nucleo: e.nucleo - transferir, satelite: e.satelite + transferir,
        lucroNucleoAcumulado: e.lucroNucleoAcumulado - transferir,
      },
      acao: `satélite recomposto com US$ ${transferir.toFixed(2)} de lucro do núcleo`,
    };
  }

  // trava ganho: excedente do satélite migra para a parte protegida
  if (!e.satelliteDesligado && e.satelite > alvoSatelite * 1.6) {
    const excedente = e.satelite - alvoSatelite;
    return {
      estado: { ...e, satelite: e.satelite - excedente, nucleo: e.nucleo + excedente },
      acao: `LUCRO TRAVADO: US$ ${excedente.toFixed(2)} do satélite para o núcleo`,
    };
  }

  return { estado: e, acao: null };
}

/**
 * O piso teórico: quanto sobra se o satélite evaporar por completo.
 *
 * Não é uma promessa — o núcleo pode erodir com funding negativo. Mas é o
 * limite inferior estrutural, e ele existe porque a perna delta-neutra não
 * tem como perder por movimento de preço.
 */
export function pisoEstrutural(capital: number, perfil: Barbell, erosaoNucleo = 0.05): number {
  return capital * perfil.fracaoNucleo * (1 - erosaoNucleo);
}
