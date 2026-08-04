/**
 * COLETA DE LONGO PRAZO — o que sobrevive à poda de 7 dias.
 *
 * A vigilância poda `historico.jsonl` e os ciclos fechados depois de 7 dias
 * (ver `podar()` em vigilancia.ts) — bom pra operar sem o arquivo crescer sem
 * limite, ruim pra quem vai deixar o sistema rodando semanas e quer analisar
 * tudo no final.
 *
 * Este módulo tem só a lógica pura de "o que ainda não foi arquivado" — sem
 * tocar em disco, pra ser testável sem mock de arquivo. Quem lê e escreve é
 * `src/cli/coletor.ts`.
 */

export interface ObservacaoBruta {
  ts: number;
  k: string;
  spread: number;
  apr: number;
  vol: number;
}

/**
 * Filtra observações de `historico.jsonl` que ainda não foram arquivadas.
 *
 * Dedup por timestamp, não por posição/offset no arquivo — porque `podar()`
 * REESCREVE o arquivo inteiro (não só acrescenta), então um offset em bytes
 * fica errado depois de uma poda. Timestamp não muda de posição.
 */
export function observacoesNovas(
  linhas: string[],
  desdeTs: number,
): { novas: ObservacaoBruta[]; maiorTs: number } {
  let maiorTs = desdeTs;
  const novas: ObservacaoBruta[] = [];
  for (const l of linhas) {
    let o: ObservacaoBruta;
    try { o = JSON.parse(l); } catch { continue; }
    if (typeof o?.ts !== 'number') continue;
    if (o.ts > desdeTs) {
      novas.push(o);
      if (o.ts > maiorTs) maiorTs = o.ts;
    }
  }
  return { novas, maiorTs };
}

/**
 * Quais ciclos de vida em `ciclos.json` fecharam e ainda não foram
 * arquivados — comparando `fechadoEm` contra o maior já visto para a mesma
 * chave. Cobre o caso de uma chave reabrir e fechar de novo depois.
 */
export function ciclosParaArquivar(
  ciclos: Record<string, { fechadoEm?: number }>,
  jaArquivados: Record<string, number>,
): string[] {
  const out: string[] = [];
  for (const [k, c] of Object.entries(ciclos)) {
    if (!c.fechadoEm) continue;
    if ((jaArquivados[k] ?? 0) < c.fechadoEm) out.push(k);
  }
  return out;
}

/** Uma amostra de custódia só vale arquivar se for mais nova que a última. */
export function custodiaEhNova(verificadoEm: number, ultimaArquivadaEm: number): boolean {
  return typeof verificadoEm === 'number' && verificadoEm > ultimaArquivadaEm;
}
