/**
 * A ponte entre a vigilância e o motor, para CAPTURA DE LIQUIDAÇÃO.
 *
 * Mesmo padrão de ponte.ts (que serve o ranking de persistência): a vigilância
 * escreve, o motor lê, nenhum dos dois chama o outro.
 *
 * Mas com uma diferença que é o ponto inteiro da estratégia: aqui o dado NÃO
 * pode ser média histórica. `ponte.ts` entrega `spreadMedio` — a média das
 * observações do ciclo de vida — porque o que ela responde é "esse par se
 * sustenta?". A captura pergunta outra coisa: "o que a PRÓXIMA liquidação
 * paga?". Isso é o funding de agora, do retrato mais recente, sem suavização.
 *
 * Por isso este arquivo é reescrito inteiro a cada varredura, em vez de
 * acumular estado como ciclos.json. O passado não ajuda a responder a pergunta.
 *
 * IDADE_MAXIMA é curta pelo mesmo motivo do motor: decidir captura com retrato
 * velho é decidir sobre um funding que já mudou.
 */
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from '../data/store.ts';
import { cruzarParaCaptura, type CandidatoCaptura, type PernaCaptura } from './liquidacao.ts';

const ARQUIVO = path.join(ROOT, 'vigilancia', 'captura.json');

/** Quantos candidatos gravar. O motor mede o livro de cada um, e isso custa. */
const GUARDAR_TOP = 25;

/** Retrato mais velho que isto não serve para decidir captura. */
export const IDADE_MAXIMA_CAPTURA_MS = 12 * 60_000;

export interface RetratoCaptura {
  geradoEm: number;
  volumeMinimo: number;
  /** quantos pares alinhados e líquidos existiam, antes do corte do top */
  totalAlinhados: number;
  candidatos: CandidatoCaptura[];
}

/**
 * Calcula e grava o retrato. Chamado pela vigilância com os `pares` que ela
 * já buscou — não custa uma segunda leitura de mercado.
 */
export function gravarCaptura(pares: PernaCaptura[], volumeMinimo: number): RetratoCaptura {
  const agora = Date.now();
  const todos = cruzarParaCaptura(pares, { agora, volumeMinimo });
  const retrato: RetratoCaptura = {
    geradoEm: agora,
    volumeMinimo,
    totalAlinhados: todos.length,
    candidatos: todos.slice(0, GUARDAR_TOP),
  };
  fs.mkdirSync(path.dirname(ARQUIVO), { recursive: true });
  fs.writeFileSync(ARQUIVO, JSON.stringify(retrato, null, 2));
  return retrato;
}

export interface LeituraCaptura {
  disponivel: boolean;
  idadeMinutos: number;
  candidatos: CandidatoCaptura[];
  motivo: string;
}

/** Lê o retrato. Recusa dado velho — melhor não operar que operar às cegas. */
export function lerCaptura(): LeituraCaptura {
  if (!fs.existsSync(ARQUIVO)) {
    return { disponivel: false, idadeMinutos: -1, candidatos: [], motivo: 'vigilância ainda não gravou captura' };
  }
  let r: RetratoCaptura;
  try { r = JSON.parse(fs.readFileSync(ARQUIVO, 'utf8')); }
  catch { return { disponivel: false, idadeMinutos: -1, candidatos: [], motivo: 'retrato de captura ilegível' }; }

  const idade = Date.now() - (r.geradoEm || 0);
  const idadeMinutos = idade / 60_000;
  if (idade > IDADE_MAXIMA_CAPTURA_MS) {
    return {
      disponivel: false, idadeMinutos, candidatos: [],
      motivo: `retrato com ${idadeMinutos.toFixed(0)} min — velho demais para decidir captura`,
    };
  }
  return {
    disponivel: true, idadeMinutos, candidatos: r.candidatos ?? [],
    motivo: `${r.candidatos?.length ?? 0} candidatos de ${r.totalAlinhados} alinhados`,
  };
}
