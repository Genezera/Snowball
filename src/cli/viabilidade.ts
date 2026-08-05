/**
 * A pergunta que decide o projeto: com que estrutura de custo a conta fecha?
 *
 * Roda contra os ciclos REAIS já arquivados (não simulação sintética) e conta
 * quantos teriam passado no portão de payback sob cada estrutura de custo:
 *
 *   1. taker + constante de pior caso   — o que o motor fazia
 *   2. taker + escorregamento medido    — o que o motor faz agora (livro.ts)
 *   3. maker                            — ordem limite: taxa menor E sem
 *                                         travessia de livro (não paga slip)
 *
 * NENHUMA ORDEM É ENVIADA. É contagem sobre dado já coletado.
 *
 * O filtro de densidade é o mesmo de analise.ts, e existe porque um ciclo com
 * poucas leituras para a duração que aparenta ter está medindo buraco de
 * vigilância, não sobrevivência de spread. Contá-lo infla a vida esperada
 * exatamente onde ela é mais decisiva.
 */
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from '../data/store.ts';
import { vidaEsperada } from '../funding/valor.ts';
import { TAKER, ESCORREGAMENTO_PERNA } from '../funding/custos-reais.ts';
import { parseArgs, num } from './args.ts';

const a = parseArgs();
const MARGEM = num(a.margem, 1.5);
/** mediana medida no livro real em 04/08/2026, 12 pares vivos — ver livro.ts */
const SLIP_MEDIDO = num(a.slip, 0.000298);
/** maker de tabela pública: binance e bybit cobram 0,02% em perpétuos */
const TAXA_MAKER = num(a.maker, 0.0002);
const DENSIDADE_MINIMA = 0.15;
const PAGAMENTOS_POR_HORA = 3 / 24;

const ARQUIVO = path.join(ROOT, 'vigilancia', 'arquivo-ciclos.jsonl');
if (!fs.existsSync(ARQUIVO)) {
  console.log('\nsem ciclos arquivados — o coletor precisa rodar antes.\n');
  process.exit(0);
}

interface Ciclo {
  symbol: string; exchangeShort: string; exchangeLong: string;
  abertoEm: number; fechadoEm: number; observacoes: number;
  spreadMedio: number; consistencia: number;
}

const todos: Ciclo[] = fs.readFileSync(ARQUIVO, 'utf8').trim().split('\n')
  .filter(Boolean)
  .map((l) => { try { return JSON.parse(l); } catch { return null; } })
  .filter((c): c is Ciclo => !!c && !!c.fechadoEm);

const confiaveis = todos.filter((c) => {
  const horas = (c.fechadoEm - c.abertoEm) / 3_600_000;
  return c.observacoes / Math.max(1, horas * 12) >= DENSIDADE_MINIMA;
});

const taxaPar = (c: Ciclo) =>
  ((TAKER[c.exchangeShort] ?? 0.0006) + (TAKER[c.exchangeLong] ?? 0.0006)) / 2;

/** payback em horas — a conta é independente do notional, ele se cancela */
const payback = (spread: number, taxa: number) =>
  spread > 0 ? (taxa * 4) / (spread * PAGAMENTOS_POR_HORA) : Infinity;

const CENARIOS = [
  { nome: 'taker + constante 0,07%', taxa: (c: Ciclo) => taxaPar(c) + ESCORREGAMENTO_PERNA },
  { nome: 'taker + slip medido', taxa: (c: Ciclo) => taxaPar(c) + SLIP_MEDIDO },
  { nome: 'maker (sem travessia)', taxa: (_c: Ciclo) => TAXA_MAKER },
];

console.log(`\n${'='.repeat(94)}`);
console.log('VIABILIDADE POR ESTRUTURA DE CUSTO — contra ciclos reais arquivados');
console.log(`${'='.repeat(94)}\n`);
console.log(`${todos.length} ciclos fechados · ${confiaveis.length} confiáveis (densidade ≥ ${DENSIDADE_MINIMA * 100}%)`);
console.log(`portão: vida esperada ≥ payback × ${MARGEM}\n`);

const duracoes = confiaveis.map((c) => (c.fechadoEm - c.abertoEm) / 3_600_000).sort((x, y) => x - y);
const q = (p: number) => duracoes[Math.min(duracoes.length - 1, Math.floor(p * duracoes.length))];
console.log(
  `vida real observada — mediana ${(q(0.5) * 60).toFixed(0)}min · p90 ${q(0.9).toFixed(1)}h · ` +
  `p99 ${q(0.99).toFixed(1)}h · máxima ${duracoes[duracoes.length - 1].toFixed(1)}h\n`,
);

console.log('estrutura'.padEnd(28) + 'passam'.padEnd(16) + 'payback mediano'.padEnd(20) + 'melhor caso');
console.log('-'.repeat(94));

for (const cen of CENARIOS) {
  let passam = 0;
  const paybacks: number[] = [];
  let melhorFolga = 0, melhorNome = '';
  for (const c of confiaveis) {
    const horas = (c.fechadoEm - c.abertoEm) / 3_600_000;
    const vida = vidaEsperada(horas, c.consistencia);
    const pb = payback(c.spreadMedio, cen.taxa(c));
    if (isFinite(pb)) paybacks.push(pb);
    const folga = pb > 0 && isFinite(pb) ? vida / pb : 0;
    if (folga >= MARGEM) passam++;
    if (folga > melhorFolga) { melhorFolga = folga; melhorNome = c.symbol.replace('/USDT:USDT', ''); }
  }
  paybacks.sort((x, y) => x - y);
  const pbMediano = paybacks.length ? paybacks[Math.floor(paybacks.length / 2)] : Infinity;
  console.log(
    cen.nome.padEnd(28) +
    (passam + ' de ' + confiaveis.length + ' (' + (passam / confiaveis.length * 100).toFixed(1) + '%)').padEnd(16) +
    (isFinite(pbMediano) ? pbMediano.toFixed(0) + 'h' : '—').padEnd(20) +
    (melhorNome ? `${melhorNome} a ${melhorFolga.toFixed(2)}x` : '—'),
  );
}

// ── o que seria preciso ───────────────────────────────────────────────────
//
// Inverte a pergunta: em vez de "quantos passam", "qual spread precisaria ter
// para passar dado o tempo que os spreads REALMENTE vivem". Isso não depende
// de opinião — sai da distribuição observada.
console.log(`\n${'-'.repeat(94)}`);
console.log('SPREAD NECESSÁRIO — dado o tempo que os spreads realmente vivem\n');
console.log('se o par viver'.padEnd(20) + 'taker+slip exige'.padEnd(22) + 'maker exige'.padEnd(22) + 'já observado?');
const taxaTakerTipica = 0.000525 + SLIP_MEDIDO;
const spreadsObservados = confiaveis.map((c) => c.spreadMedio).sort((x, y) => x - y);
const maxSpread = spreadsObservados[spreadsObservados.length - 1] ?? 0;
for (const [rotulo, vidaH] of [['30min (mediana)', 0.5], ['2h', 2], ['6h', 6], ['24h (máx. visto)', 24]] as [string, number][]) {
  // vida ≥ payback × margem  ⟹  spread ≥ 32 × taxa × margem / vida
  const exigeTaker = (32 * taxaTakerTipica * MARGEM) / vidaH;
  const exigeMaker = (32 * TAXA_MAKER * MARGEM) / vidaH;
  const quantosTem = spreadsObservados.filter((s) => s >= exigeMaker).length;
  console.log(
    rotulo.padEnd(20) +
    ((exigeTaker * 100).toFixed(3) + '%').padEnd(22) +
    ((exigeMaker * 100).toFixed(3) + '%').padEnd(22) +
    (exigeMaker > maxSpread
      ? 'nenhum ciclo chegou lá'
      : `${quantosTem} ciclo(s) tinham spread suficiente p/ maker`),
  );
}

console.log(`\n${'='.repeat(94)}`);
console.log('Payback é independente do notional — aumentar capital ou alavancagem NÃO move');
console.log('nenhuma linha desta tabela. Só taxa, spread e tempo de vida movem.');
console.log(`${'='.repeat(94)}\n`);
