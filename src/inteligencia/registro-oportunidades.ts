/**
 * REGISTRO DE OPORTUNIDADES CONCORRENTES — read-only, nunca bloqueia o champion.
 *
 * A cada ciclo, o motor avalia várias candidatas e escolhe (no máximo) uma.
 * Até aqui só a escolhida (ou o resumo agregado de bloqueio) ficava no
 * diário — as outras aprovadas-mas-não-escolhidas simplesmente desapareciam.
 * Sem esse registro não dá para medir se a escolha foi a melhor disponível
 * (Ideia A/C do plano de Intelligence Layer) nem alimentar o Profit
 * Acceleration Observer (Etapa 6).
 *
 * Contrato: `registrarCiclo` NUNCA lança. Qualquer falha de escrita
 * (disco cheio, diretório ausente, permissão) é engolida silenciosamente —
 * o motor precisa continuar decidindo mesmo se este arquivo não puder ser
 * gravado. Mesmo padrão de "read-only não pode derrubar o caminho crítico"
 * já usado no resto do projeto (ex.: `enviarTelegram`).
 */
import fs from 'node:fs';
import path from 'node:path';

export interface CandidataRegistrada {
  symbol: string;
  exchangeShort: string;
  exchangeLong: string;
  spread: number;
  consistencia: number;
  duracaoHoras: number;
  valorEsperado: number;
  valorPorHora: number;
  folga: number;
  custo: number;
  escorregamento: number;
  escorregamentoMedido: boolean;
  capitalNecessario: number;
  saldoDisponivel: number;
  score: number;
  aprovada: boolean;
  motivoRejeicao?: string;
}

export interface CicloOportunidades {
  cycleId: string;
  ts: number;
  /** 'persistencia' | 'captura' — de qual laço de decisão este ciclo veio */
  modo: 'persistencia' | 'captura';
  candidatas: CandidataRegistrada[];
  escolhida?: string;
  aprovadasNaoEscolhidas: string[];
}

export function novoCycleId(ts: number, modo: string): string {
  return `${modo}-${ts}`;
}

/** Nunca lança. Falha de escrita é engolida — ver docstring do arquivo. */
export function registrarCiclo(dirBase: string, ciclo: CicloOportunidades): boolean {
  try {
    const dir = path.join(dirBase, 'inteligencia', 'oportunidades');
    fs.mkdirSync(dir, { recursive: true });
    const dia = new Date(ciclo.ts).toISOString().slice(0, 10);
    const arquivo = path.join(dir, `${dia}.jsonl`);
    fs.appendFileSync(arquivo, JSON.stringify(ciclo) + '\n');
    return true;
  } catch {
    return false;
  }
}

/** Leitura, para o Observer (Etapa 6) e para replay/auditoria — também nunca lança. */
export function lerCiclos(dirBase: string, dia: string): CicloOportunidades[] {
  try {
    const arquivo = path.join(dirBase, 'inteligencia', 'oportunidades', `${dia}.jsonl`);
    if (!fs.existsSync(arquivo)) return [];
    return fs.readFileSync(arquivo, 'utf8').trim().split('\n').filter(Boolean)
      .map((l) => { try { return JSON.parse(l) as CicloOportunidades; } catch { return null; } })
      .filter((x): x is CicloOportunidades => x !== null);
  } catch {
    return [];
  }
}
