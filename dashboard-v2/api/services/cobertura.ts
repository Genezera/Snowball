/**
 * COBERTURA DOS 47 CHALLENGERS (Parte 7) — nunca resume a um "40/47".
 * Separa os conceitos exatamente como pedido: declarados, com estado, com
 * diário, com evento NA JANELA atual, sem evento na janela — e, pros sem
 * evento, distingue as 5 causas possíveis em vez de uma frase genérica.
 */
import fs from 'node:fs';
import { caminhoEstadoChallenger, caminhoDiarioChallenger, lerJsonlComNumeroDeLinha } from '../readers/arquivos.ts';

export type MotivoAusencia =
  | 'nao_possui_diario' | 'diario_vazio' | 'eventos_fora_da_janela'
  | 'possui_eventos_mas_nenhum_no_resultado_atual' | 'erro_de_leitura' | null;

export interface LinhaCobertura {
  challengerId: string;
  ativo: boolean;
  tipo: string;
  possuiEstado: boolean;
  possuiDiario: boolean;
  possuiEventosNaJanela: boolean;
  motivoAusencia: MotivoAusencia;
}

export interface ManifestoCobertura {
  challengersDeclarados: number;
  challengersComEstado: number;
  challengersComDiario: number;
  challengersComEventosNaJanela: number;
  challengersSemEventosNaJanela: number;
  linhas: LinhaCobertura[];
}

/**
 * `idsComEventoNaJanela` vem de fora (o resultado real do endpoint de
 * eventos, já lido uma vez) — usado só pra distinguir o MOTIVO mais
 * específico ('possui_eventos_mas_nenhum_no_resultado_atual' — o
 * challenger tem evento na janela, mas não coube nesta página paginada).
 *
 * Achado ao vivo: `possuiEventosNaJanela` do manifesto NÃO pode depender só
 * de "apareceu nesta página" — com transporte incremental paginado (300
 * eventos por vez, não mais os ~4000 de antes), qualquer poll depois do
 * catch-up inicial só traz o que é NOVO desde o cursor, então a maioria dos
 * challengers (que não tiveram evento novo neste tick específico) sumia da
 * cobertura mesmo tendo dezenas de eventos reais dentro da janela de 6h —
 * o dashboard mostrava "cobertura: 0/47" com o feed cheio de eventos reais
 * de 30+ challengers. Por isso este serviço sempre CONFERE a janela
 * completa de cada challenger direto no diário, independente do que veio
 * nesta página — `idsComEventoNaJanela` só refina o motivo, nunca decide
 * sozinho o boolean principal.
 */
export function montarManifestoCobertura(
  root: string, aprovados: { challengerId: string; tipo?: string }[], idsComEventoNaJanela: Set<string>, janelaMs: number,
): ManifestoCobertura {
  const agora = Date.now();
  const linhas: LinhaCobertura[] = aprovados.map((c) => {
    let possuiEstado = false, possuiDiario = false, motivoAusencia: MotivoAusencia = null;
    try { possuiEstado = fs.existsSync(caminhoEstadoChallenger(root, c.challengerId)); } catch { motivoAusencia = 'erro_de_leitura'; }
    try { possuiDiario = fs.existsSync(caminhoDiarioChallenger(root, c.challengerId)); } catch { motivoAusencia = 'erro_de_leitura'; }

    let possuiEventosNaJanela = false;
    if (motivoAusencia == null) {
      if (!possuiDiario) motivoAusencia = 'nao_possui_diario';
      else {
        const linhasDiario = lerJsonlComNumeroDeLinha(caminhoDiarioChallenger(root, c.challengerId));
        if (!linhasDiario.length) motivoAusencia = 'diario_vazio';
        else {
          possuiEventosNaJanela = linhasDiario.some((l: any) => agora - (l.linha as any).ts <= janelaMs);
          if (!possuiEventosNaJanela) motivoAusencia = 'eventos_fora_da_janela';
          else if (!idsComEventoNaJanela.has(c.challengerId)) motivoAusencia = 'possui_eventos_mas_nenhum_no_resultado_atual';
        }
      }
    }

    return {
      challengerId: c.challengerId, ativo: true, tipo: c.tipo ?? 'persistencia',
      possuiEstado, possuiDiario, possuiEventosNaJanela, motivoAusencia,
    };
  });

  return {
    challengersDeclarados: linhas.length,
    challengersComEstado: linhas.filter((l) => l.possuiEstado).length,
    challengersComDiario: linhas.filter((l) => l.possuiDiario).length,
    challengersComEventosNaJanela: linhas.filter((l) => l.possuiEventosNaJanela).length,
    challengersSemEventosNaJanela: linhas.filter((l) => !l.possuiEventosNaJanela).length,
    linhas,
  };
}
