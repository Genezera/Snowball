/**
 * Horário de pregão dos EUA.
 *
 * Existe porque o orquestrador foi escrito para cripto, que negocia 24/7. Ação
 * fecha às 16h ET e reabre às 9h30 do dia seguinte num preço diferente, sem que
 * nada tenha sido negociado no meio.
 *
 * Sem isto, duas coisas quebram silenciosamente:
 *
 *   1. O sistema interpreta "sem barra nova" como falha de rede e fica pedindo
 *      dados à toa a noite inteira e no fim de semana.
 *   2. Pior: ele pode tratar a barra de abertura como continuação da barra de
 *      fechamento anterior, o que apaga o gap justamente onde ele importa.
 *
 * Nota sobre precisão: os feriados abaixo cobrem 2026. Um feriado não listado
 * significa apenas que o sistema vai procurar barras que não existem naquele
 * dia — desperdício, não erro de negociação.
 */

/** Feriados da NYSE/NASDAQ em 2026 (mercado fechado o dia inteiro). */
const FERIADOS_2026 = new Set([
  '2026-01-01', // Ano Novo
  '2026-01-19', // Martin Luther King Jr.
  '2026-02-16', // Presidents' Day
  '2026-04-03', // Sexta-feira Santa
  '2026-05-25', // Memorial Day
  '2026-06-19', // Juneteenth
  '2026-07-03', // Independence Day (observado)
  '2026-09-07', // Labor Day
  '2026-11-26', // Thanksgiving
  '2026-12-25', // Natal
]);

/**
 * Nova York está em UTC-4 (horário de verão) ou UTC-5 (padrão).
 * O horário de verão nos EUA vai do 2º domingo de março ao 1º domingo de
 * novembro. Calculado em vez de tabelado para não expirar.
 */
function offsetNovaYork(d: Date): number {
  const ano = d.getUTCFullYear();
  const marco = new Date(Date.UTC(ano, 2, 1));
  const inicio = new Date(Date.UTC(ano, 2, 1 + ((14 - marco.getUTCDay()) % 7) + 7, 7));
  const nov = new Date(Date.UTC(ano, 10, 1));
  const fim = new Date(Date.UTC(ano, 10, 1 + ((7 - nov.getUTCDay()) % 7), 6));
  return d >= inicio && d < fim ? -4 : -5;
}

export interface EstadoMercado {
  aberto: boolean;
  motivo: string;
  /** ms até a próxima abertura, quando fechado */
  msAteAbrir: number;
}

/** O pregão regular vai de 9h30 às 16h, horário de Nova York. */
export function estadoMercado(agora = new Date()): EstadoMercado {
  const off = offsetNovaYork(agora);
  const ny = new Date(agora.getTime() + off * 3_600_000);
  const dia = ny.getUTCDay();
  const data = ny.toISOString().slice(0, 10);
  const minutos = ny.getUTCHours() * 60 + ny.getUTCMinutes();

  const ABRE = 9 * 60 + 30;
  const FECHA = 16 * 60;

  const proximaAbertura = (): number => {
    // avança dia a dia até achar um pregão válido
    for (let i = 0; i <= 7; i++) {
      const cand = new Date(ny.getTime() + i * 86_400_000);
      const d = cand.getUTCDay();
      const iso = cand.toISOString().slice(0, 10);
      if (d === 0 || d === 6 || FERIADOS_2026.has(iso)) continue;
      const abertura = new Date(cand);
      abertura.setUTCHours(9, 30, 0, 0);
      if (abertura.getTime() > ny.getTime()) return abertura.getTime() - ny.getTime();
    }
    return 86_400_000;
  };

  if (dia === 0 || dia === 6) {
    return { aberto: false, motivo: 'fim de semana', msAteAbrir: proximaAbertura() };
  }
  if (FERIADOS_2026.has(data)) {
    return { aberto: false, motivo: 'feriado', msAteAbrir: proximaAbertura() };
  }
  if (minutos < ABRE) {
    return { aberto: false, motivo: 'antes da abertura', msAteAbrir: (ABRE - minutos) * 60_000 };
  }
  if (minutos >= FECHA) {
    return { aberto: false, motivo: 'após o fechamento', msAteAbrir: proximaAbertura() };
  }
  return { aberto: true, motivo: 'pregão aberto', msAteAbrir: 0 };
}

/** Minutos restantes até o fechamento, para decidir se dá tempo de abrir posição. */
export function minutosAteFechar(agora = new Date()): number {
  const ny = new Date(agora.getTime() + offsetNovaYork(agora) * 3_600_000);
  return 16 * 60 - (ny.getUTCHours() * 60 + ny.getUTCMinutes());
}
