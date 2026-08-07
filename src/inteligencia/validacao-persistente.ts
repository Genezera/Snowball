/**
 * JANELA PERSISTENTE DE VALIDAÇÃO DO CONTROL (correção pedida depois da
 * aprovação da integridade da coleta) — `hb.startedAt` (heartbeat) muda todo
 * reinício do processo, então usar isso como início da validação reiniciava
 * a contagem de fidelidade a cada `Stop-Process`, mesmo sem NADA mudar na
 * lógica comparada. `validationStart` vive num arquivo PRÓPRIO, separado do
 * heartbeat, e só é substituído quando a Parte 1 desta correção manda:
 * mudança de versão do control, do champion, da config comparada, ou
 * migração incompatível de eventos — nunca por PID novo.
 */
import fs from 'node:fs';
import path from 'node:path';

export interface JanelaValidacao {
  validationWindowId: string;
  validationStart: number;
  strategyVersion: string;
  configVersion: string;
  motivoDoReset: string;
}

function caminho(root: string): string {
  return path.join(root, 'inteligencia', 'dashboard', 'validation-window.json');
}

function novoId(agora: number): string {
  return `validation-${agora}`;
}

/**
 * Devolve a janela de validação atual. Cria uma nova SÓ quando não existe
 * ainda, ou quando `strategyVersion`/`configVersion` do control divergem do
 * que está gravado (as únicas razões válidas pra reiniciar, por desenho —
 * nunca reinício de processo).
 */
export function carregarOuCriarJanelaValidacao(
  root: string, strategyVersionAtual: string, configVersionAtual: string,
): JanelaValidacao {
  const p = caminho(root);
  if (fs.existsSync(p)) {
    try {
      const existente = JSON.parse(fs.readFileSync(p, 'utf8')) as JanelaValidacao;
      if (existente.strategyVersion === strategyVersionAtual && existente.configVersion === configVersionAtual) {
        return existente; // nada mudou — PID novo, reinício, redeploy sem versão nova: mantém a mesma janela
      }
      const agora = Date.now();
      const reiniciada: JanelaValidacao = {
        validationWindowId: novoId(agora), validationStart: agora,
        strategyVersion: strategyVersionAtual, configVersion: configVersionAtual,
        motivoDoReset: `versão mudou: strategyVersion ${existente.strategyVersion}→${strategyVersionAtual}, configVersion ${existente.configVersion}→${configVersionAtual}`,
      };
      salvarJanelaValidacao(root, reiniciada);
      return reiniciada;
    } catch { /* arquivo corrompido — trata como se nunca tivesse existido, cria abaixo */ }
  }
  const agora = Date.now();
  const nova: JanelaValidacao = {
    validationWindowId: novoId(agora), validationStart: agora,
    strategyVersion: strategyVersionAtual, configVersion: configVersionAtual,
    motivoDoReset: 'primeira janela de validação — nenhum arquivo anterior encontrado',
  };
  salvarJanelaValidacao(root, nova);
  return nova;
}

export function salvarJanelaValidacao(root: string, janela: JanelaValidacao): void {
  const p = caminho(root);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const tmp = p + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(janela, null, 2));
  fs.renameSync(tmp, p);
}
