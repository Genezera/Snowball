/**
 * READERS — toda leitura de disco do Snowball passa por aqui. Regra
 * absoluta desta API: SÓ LEITURA. Nenhuma função neste arquivo (nem em
 * nenhum outro do `dashboard-v2/api/`) chama `fs.writeFileSync`,
 * `fs.appendFileSync` ou qualquer variante de escrita — a garantia de
 * isolamento não é só "eu não pretendo escrever", é "o código fisicamente
 * não tem a chamada".
 */
import fs from 'node:fs';
import path from 'node:path';

export function lerJsonSeguro<T>(caminho: string, vazio: T): T {
  try {
    if (!fs.existsSync(caminho)) return vazio;
    return JSON.parse(fs.readFileSync(caminho, 'utf8')) as T;
  } catch { return vazio; }
}

export interface LinhaComOffset {
  linha: unknown;
  numeroDaLinha: number; // 1-indexado, estável entre reinícios — mesma técnica de line-number citada como aceitável
  byteOffset: number; // posição (em bytes, UTF-8) do PRIMEIRO byte da linha no arquivo — preferido ao número de linha pro cursor (Parte 6)
}

/** Lê um .jsonl inteiro com o número de linha e o byte-offset de cada registro — nunca usa índice da resposta, usa posição real no arquivo. */
export function lerJsonlComNumeroDeLinha(caminho: string): LinhaComOffset[] {
  if (!fs.existsSync(caminho)) return [];
  try {
    const bruto = fs.readFileSync(caminho, 'utf8');
    const linhasTexto = bruto.split('\n');
    const saida: LinhaComOffset[] = [];
    let offsetAtual = 0;
    for (let i = 0; i < linhasTexto.length; i++) {
      const texto = linhasTexto[i];
      const bytesLinha = Buffer.byteLength(texto, 'utf8') + 1; // +1 pelo '\n' removido no split
      if (texto.trim()) {
        try { saida.push({ linha: JSON.parse(texto), numeroDaLinha: i + 1, byteOffset: offsetAtual }); }
        catch { /* linha corrompida — pulada, não derruba a leitura inteira */ }
      }
      offsetAtual += bytesLinha;
    }
    return saida;
  } catch { return []; }
}

export interface IdentidadeArquivo {
  existe: boolean;
  tamanhoBytes: number;
  criadoEmMs: number | null;
  hashCabecalho: string; // fingerprint da PRIMEIRA LINHA — nunca muda com append normal (jsonl é append-only), só se o arquivo for recriado com outro conteúdo inicial
}

/**
 * Fingerprint barato de um arquivo pra detectar rotação/truncamento/
 * recriação (Parte 6) sem precisar de inode (não confiável no NTFS via
 * Node em todas as versões) — combina data de criação + hash da PRIMEIRA
 * LINHA do arquivo, nunca dos primeiros N bytes brutos.
 *
 * Achado ao vivo (bug real, pego pelos próprios testes): hashear
 * `min(256, tamanhoAtual)` bytes fazia o fingerprint de um arquivo pequeno
 * mudar a cada append legítimo — a janela de 256 bytes crescia junto com o
 * arquivo até ele passar de 256 bytes, disparando "rotação" falsa em
 * qualquer diário novo/pequeno. A primeira linha de um jsonl append-only
 * nunca é reescrita em uso normal, então hasheá-la sozinha resolve: só
 * muda quando o arquivo é de fato substituído/recriado.
 */
export function identidadeArquivo(caminho: string): IdentidadeArquivo {
  try {
    if (!fs.existsSync(caminho)) return { existe: false, tamanhoBytes: 0, criadoEmMs: null, hashCabecalho: '' };
    const st = fs.statSync(caminho);
    const fd = fs.openSync(caminho, 'r');
    const buf = Buffer.alloc(Math.min(4096, st.size)); // teto generoso pra achar o '\n' da primeira linha mesmo em registros grandes
    const lidos = fs.readSync(fd, buf, 0, buf.length, 0);
    fs.closeSync(fd);
    const fimPrimeiraLinha = buf.subarray(0, lidos).indexOf(10); // '\n'
    const primeiraLinha = fimPrimeiraLinha === -1 ? buf.subarray(0, lidos) : buf.subarray(0, fimPrimeiraLinha);
    let hash = 0;
    for (const b of primeiraLinha) hash = (hash * 31 + b) >>> 0;
    return { existe: true, tamanhoBytes: st.size, criadoEmMs: st.birthtimeMs || null, hashCabecalho: hash.toString(16) };
  } catch { return { existe: false, tamanhoBytes: 0, criadoEmMs: null, hashCabecalho: '' }; }
}

export function caminhoEstadoChallenger(root: string, challengerId: string): string {
  return path.join(root, 'inteligencia', 'challengers', challengerId, 'estado.json');
}
export function caminhoDiarioChallenger(root: string, challengerId: string): string {
  return path.join(root, 'inteligencia', 'challengers', challengerId, 'diario.jsonl');
}
export function caminhoAgregadoLab(root: string, nome: string): string {
  return path.join(root, 'inteligencia', 'dashboard', nome);
}
