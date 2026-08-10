/**
 * MANIFESTO FORMAL DOS 47 CHALLENGERS (Parte 3, formalizado) — nunca resume
 * a um "44/47" sem explicar exatamente quem falta e por quê. Sempre lista
 * TODOS os declarados, mesmo os sem nenhum evento ainda.
 */
import fs from 'node:fs';
import { caminhoEstadoChallenger, caminhoDiarioChallenger, lerJsonlComNumeroDeLinha } from '../readers/arquivos.ts';

export type MotivoSemEventos =
  | 'nao_possui_diario' | 'diario_vazio' | 'eventos_fora_da_janela'
  | 'possui_eventos_mas_nenhum_no_resultado_atual' | null;

export interface LinhaCobertura {
  challengerId: string;
  declarado: true;
  ativo: boolean;
  possuiEstado: boolean;
  possuiDiario: boolean;
  diarioVazio: boolean;
  possuiEventos: boolean;
  /** quantos eventos NOVOS (desde o cursor recebido) esta fonte tinha disponíveis antes da seleção justa cortar */
  eventosDepoisDoCursor: number;
  /** quantos de fato couberam nesta página */
  eventosEntregues: number;
  ultimoEvento: number | null;
  motivoSemEventos: MotivoSemEventos;
  erro: string | null;
}

export interface ManifestoCobertura {
  challengersDeclarados: number;
  challengersComEstado: number;
  challengersComDiario: number;
  challengersComEventosNaJanela: number;
  challengersSemEventosNaJanela: number;
  challengersComErroDeLeitura: number;
  linhas: LinhaCobertura[];
}

export function montarManifestoCobertura(
  root: string, aprovados: { challengerId: string; tipo?: string }[],
  disponivelPorFonte: Record<string, number>, entreguePorFonte: Record<string, number>,
  janelaMs: number,
): ManifestoCobertura {
  const agora = Date.now();
  const linhas: LinhaCobertura[] = aprovados.map((c) => {
    let possuiEstado = false, possuiDiario = false, erro: string | null = null;
    try { possuiEstado = fs.existsSync(caminhoEstadoChallenger(root, c.challengerId)); } catch (e) { erro = `estado.json: ${(e as Error).message}`; }
    try { possuiDiario = fs.existsSync(caminhoDiarioChallenger(root, c.challengerId)); } catch (e) { erro = `diario.jsonl: ${(e as Error).message}`; }

    let diarioVazio = false, possuiEventos = false, ultimoEvento: number | null = null, motivoSemEventos: MotivoSemEventos = null;
    const eventosDepoisDoCursor = disponivelPorFonte[c.challengerId] ?? 0;
    const eventosEntregues = entreguePorFonte[c.challengerId] ?? 0;

    if (erro == null) {
      if (!possuiDiario) motivoSemEventos = 'nao_possui_diario';
      else {
        try {
          const linhasDiario = lerJsonlComNumeroDeLinha(caminhoDiarioChallenger(root, c.challengerId));
          if (!linhasDiario.length) { diarioVazio = true; motivoSemEventos = 'diario_vazio'; }
          else {
            const ultima = linhasDiario[linhasDiario.length - 1].linha as any;
            ultimoEvento = ultima?.ts ?? null;
            possuiEventos = linhasDiario.some((l: any) => agora - (l.linha as any).ts <= janelaMs);
            if (!possuiEventos) motivoSemEventos = 'eventos_fora_da_janela';
            else if (eventosEntregues === 0) motivoSemEventos = 'possui_eventos_mas_nenhum_no_resultado_atual';
          }
        } catch (e) { erro = `leitura do diário: ${(e as Error).message}`; }
      }
    }

    return {
      challengerId: c.challengerId, declarado: true as const, ativo: true,
      possuiEstado, possuiDiario, diarioVazio, possuiEventos,
      eventosDepoisDoCursor, eventosEntregues, ultimoEvento, motivoSemEventos, erro,
    };
  });

  return {
    challengersDeclarados: linhas.length,
    challengersComEstado: linhas.filter((l) => l.possuiEstado).length,
    challengersComDiario: linhas.filter((l) => l.possuiDiario).length,
    challengersComEventosNaJanela: linhas.filter((l) => l.possuiEventos).length,
    challengersSemEventosNaJanela: linhas.filter((l) => !l.possuiEventos).length,
    challengersComErroDeLeitura: linhas.filter((l) => l.erro != null).length,
    linhas,
  };
}
