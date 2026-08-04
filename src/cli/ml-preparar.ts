/**
 * PREPARAÇÃO DE DADO PARA ML — extrai features dos ciclos arquivados e
 * checa se já tem amostra suficiente pra treinar algo confiável.
 *
 * A pergunta que motiva isto: dá pra prever, com o que se sabe de um spread
 * NO MOMENTO em que ele está vivo (consistência, spread médio, volume,
 * quantas observações), se ele vai sobreviver até pagar o próprio custo?
 * A literatura (order flow imbalance, meta-labeling) diz que sim, em
 * princípio — mas isso não dispensa medir com O NOSSO dado antes de confiar.
 *
 * NÃO treina modelo nenhum. Só prepara o dado e reporta se já dá pra
 * treinar sem cair no mesmo erro que o projeto já cometeu uma vez (Fase 2
 * da cronologia: expectancy positiva 6 de 6 in-sample, negativa 6 de 6
 * out-of-sample — overfitting em amostra pequena que parecia grande o
 * bastante e não era).
 */
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from '../data/store.ts';

const ARQ = path.join(ROOT, 'vigilancia', 'arquivo-ciclos.jsonl');
const TAXA = 0.0005, NOTIONAL = 250, PAGAMENTOS_HORA = 3 / 24, MARGEM_PAYBACK = 1.5;

interface CicloArquivado {
  symbol: string; exchangeShort: string; exchangeLong: string;
  abertoEm: number; fechadoEm: number; observacoes: number;
  spreadMedio: number; consistencia: number; volumeMedio: number;
}

function ler(): CicloArquivado[] {
  if (!fs.existsSync(ARQ)) return [];
  return fs.readFileSync(ARQ, 'utf8').trim().split('\n').filter(Boolean)
    .map((l) => { try { return JSON.parse(l) as CicloArquivado; } catch { return null; } })
    .filter((x): x is CicloArquivado => x !== null);
}

const brutos = ler();
console.log(`\n${'='.repeat(78)}`);
console.log('PREPARAÇÃO DE DADO PARA ML — previsão de sobrevivência de spread');
console.log(`${'='.repeat(78)}\n`);

if (!brutos.length) {
  console.log('Nada arquivado ainda. Deixe o coletor rodar e rode de novo.\n');
  process.exit(0);
}

// mesmo filtro de densidade do analise.ts — não treina em cima de buraco de medição
const confiaveis = brutos.map((c) => {
  const duracaoHoras = (c.fechadoEm - c.abertoEm) / 3_600_000;
  const esperadas = Math.max(1, duracaoHoras * 12);
  return { ...c, duracaoHoras, densidade: c.observacoes / esperadas };
}).filter((c) => c.densidade >= 0.15);

// label: sobreviveu até cruzar 1,5x o payback (o mesmo portão que decide ao vivo)?
const linhas = confiaveis.map((c) => {
  const custo = NOTIONAL * TAXA * 4;
  const paybackHoras = c.spreadMedio > 0 ? custo / (NOTIONAL * c.spreadMedio * PAGAMENTOS_HORA) : Infinity;
  const vidaEsperada = c.duracaoHoras * c.consistencia;
  const sobreviveu = vidaEsperada >= paybackHoras * MARGEM_PAYBACK;
  return {
    // features disponíveis EM TEMPO REAL, antes de saber o resultado
    consistencia: c.consistencia, spreadMedio: c.spreadMedio, volumeMedio: c.volumeMedio,
    observacoes: c.observacoes, exchangeShort: c.exchangeShort, exchangeLong: c.exchangeLong,
    // label — só existe depois que o ciclo fechou
    sobreviveu,
  };
});

const positivos = linhas.filter((l) => l.sobreviveu).length;
const negativos = linhas.length - positivos;

console.log(`amostra confiável: ${linhas.length} ciclos`);
console.log(`  classe positiva (sobreviveu ao portão): ${positivos}`);
console.log(`  classe negativa (não sobreviveu): ${negativos}\n`);

const MINIMO_POSITIVOS_PARA_TREINAR = 30;
if (positivos < MINIMO_POSITIVOS_PARA_TREINAR) {
  console.log(`⚠ VEREDITO: NÃO treinar nada ainda.`);
  console.log(`  Com ${positivos} exemplo(s) positivo(s), qualquer modelo treinado agora estaria`);
  console.log(`  decorando o(s) caso(s) específico(s), não aprendendo um padrão — é o mesmo erro`);
  console.log(`  de overfitting que a Fase 2 do projeto já cometeu uma vez (docs/CRONOLOGIA.md),`);
  console.log(`  só que com um nome mais bonito. O limiar de ${MINIMO_POSITIVOS_PARA_TREINAR} positivos é`);
  console.log(`  arbitrário mas conservador — nem isso garante generalização, só é o piso abaixo`);
  console.log(`  do qual nem vale tentar.\n`);
  console.log(`  Continue rodando o coletor. Rode este comando de novo daqui a uns dias.\n`);
} else {
  console.log(`VEREDITO: amostra suficiente pra uma primeira tentativa de treino, com walk-forward`);
  console.log(`(nunca validar no mesmo período que treinou — é a regra que já existe em`);
  console.log(`src/validate/walkforward.ts, reaproveitável aqui).\n`);
}

// correlação univariada simples entre cada feature numérica e o label —
// não é o modelo, é só "vale a pena tentar", sem esperar treino nenhum
function correlacao(xs: number[], ys: number[]): number {
  const n = xs.length;
  const mx = xs.reduce((a, b) => a + b, 0) / n, my = ys.reduce((a, b) => a + b, 0) / n;
  let cov = 0, vx = 0, vy = 0;
  for (let i = 0; i < n; i++) { cov += (xs[i] - mx) * (ys[i] - my); vx += (xs[i] - mx) ** 2; vy += (ys[i] - my) ** 2; }
  return vx && vy ? cov / Math.sqrt(vx * vy) : 0;
}

const ys = linhas.map((l) => (l.sobreviveu ? 1 : 0));
console.log('correlação univariada com sobrevivência (não é causal, é só um indício):');
console.log(`  consistência:  ${correlacao(linhas.map((l) => l.consistencia), ys).toFixed(3)}`);
console.log(`  spread médio:  ${correlacao(linhas.map((l) => l.spreadMedio), ys).toFixed(3)}`);
console.log(`  volume médio:  ${correlacao(linhas.map((l) => l.volumeMedio), ys).toFixed(3)}`);
console.log(`  observações:   ${correlacao(linhas.map((l) => l.observacoes), ys).toFixed(3)}`);

console.log(`\n${'='.repeat(78)}\n`);
