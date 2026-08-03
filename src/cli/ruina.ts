/**
 * Teste de ruína: existe um caminho em que eu perco tudo?
 *
 * Uma projeção de renda não responde isso, porque ela assume que a posição
 * sobrevive. Aqui a pergunta é a sobrevivência.
 *
 * ── duas premissas que a primeira versão errou ────────────────────────────
 *
 * A versão inicial deste arquivo concluiu que 5x e 8x eram igualmente seguros
 * (0,00% de liquidação nos dois). Isso é falso, e as duas causas eram premissas
 * escondidas:
 *
 * 1. TRANSFERÊNCIA INSTANTÂNEA. O modelo creditava a margem no mesmo ciclo em
 *    que detectava o problema. Na realidade, saque + confirmação em rede +
 *    crédito na outra exchange levam de 2 a 10 minutos, e podem falhar. Com
 *    latência zero, nenhuma alavancagem é perigosa — o que é exatamente o
 *    contrário da verdade.
 *
 * 2. RETORNO GAUSSIANO. Cripto tem saltos. Numa normal, o movimento de 3,25%
 *    em vinte minutos necessário para pular do alerta direto para a liquidação
 *    é um evento de 5,5 sigma — nunca acontece. Na prática acontece várias
 *    vezes por ano, e é precisamente o cenário que mata uma perna.
 *
 * Com as duas corrigidas o teste passa a distinguir alavancagens, que é a única
 * razão de ele existir.
 */
import { avaliarRisco, quantoTransferir, LIMIARES_PADRAO, MMR_ALT } from '../funding/protecao.ts';
import { parseArgs, num } from './args.ts';

const a = parseArgs();
const CAPITAL = num(a.equity, 100);
const LEV = num(a.alavancagem, 5);
const APR = num(a.apr, 0.20);
const DIAS = num(a.dias, 90);
const SIMS = num(a.sims, 20_000);
/** volatilidade diária de um alt líquido: 5% é regime normal, não stress */
const VOL_DIA = num(a.vol, 0.05);
/** ciclos até a margem transferida ser creditada (20 min por ciclo) */
const LATENCIA = num(a.latencia, 1);
/** probabilidade de salto por ciclo, e tamanho típico do salto */
const P_SALTO = num(a.pSalto, 0.0004);
const SALTO_MIN = num(a.saltoMin, 0.02);
const SALTO_MAX = num(a.saltoMax, 0.12);
const TAXA = 0.0005;

const CICLOS_DIA = 72;
const VOL_CICLO = VOL_DIA / Math.sqrt(CICLOS_DIA);

/**
 * `soFechamento` existe por uma restrição física, não por escolha de desenho.
 *
 * A bitget exige saque mínimo de US$ 10. Com US$ 100 divididos em 3 posições, a
 * margem por perna é US$ 16,67 e a transferência necessária no alerta é US$
 * 5,83 — **abaixo do mínimo**. A transferência simplesmente não pode ser feita.
 *
 * Capital mínimo para transferência viável: US$ 57 com 1 posição, US$ 171 com 3.
 *
 * Então a pergunta que este cenário responde é: **fechar sozinho basta?** Se
 * sim, a diluição em três posições é aceitável a US$ 100. Se não, é preciso
 * escolher entre diluir e poder reequilibrar.
 */
type Politica = 'nenhuma' | 'transferencia' | 'soFechamento' | 'completa';

/** Gerador determinístico: um teste de ruína que muda de resposta não decide nada. */
function rng(semente: number) {
  let s = semente >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}

function normal(r: () => number): number {
  const u = Math.max(1e-12, r()), v = r();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/**
 * Retorno de um ciclo: difusão normal mais um componente de salto raro.
 *
 * P_SALTO de 0,0004 por ciclo dá ~10 saltos por ano (72 ciclos/dia × 365 ×
 * 0,0004 ≈ 10,5), com magnitude entre 2% e 12%. É a ordem de grandeza do que
 * um alt líquido faz em notícia, listagem ou cascata de liquidação.
 */
function retornoCiclo(r: () => number): number {
  const difusao = normal(r) * VOL_CICLO;
  if (r() >= P_SALTO) return difusao;
  const tamanho = SALTO_MIN + r() * (SALTO_MAX - SALTO_MIN);
  return difusao + (r() < 0.5 ? -tamanho : tamanho);
}

interface Resultado {
  capitalFinal: number; liquidado: boolean;
  fechamentos: number; transferencias: number;
}

interface Config { politica: Politica; alavancagem: number; latencia: number }

function simular(cfg: Config, semente: number): Resultado {
  const r = rng(semente);
  let capital = CAPITAL;
  let margemShort = 0, margemLong = 0, notional = 0, preco = 1;
  let montada = false, liquidado = false, fechamentos = 0, transferencias = 0;
  /** transferência em trânsito: chega em `chegaEm`, com `valor` para a perna `para` */
  let emTransito: { chegaEm: number; valor: number; para: 'short' | 'long' } | null = null;
  const por8h = APR / (3 * 365);

  const montar = () => {
    const margem = capital / 2;
    notional = margem * cfg.alavancagem;
    capital -= notional * TAXA * 2;
    margemShort = margem; margemLong = margem;
    montada = true; emTransito = null;
  };
  montar();

  for (let c = 0; c < DIAS * CICLOS_DIA && !liquidado; c++) {
    const delta = retornoCiclo(r);
    preco *= 1 + delta;

    if (!montada) { if (capital > 1) montar(); continue; }

    // ── contabilidade INCREMENTAL de margem ──────────────────────────────
    //
    // A versão anterior guardava um `precoRef` e recalculava a variação
    // acumulada desde ele. O problema: toda transferência resetava o precoRef,
    // e quando o valor transferido era zero (o que acontece quando a posição
    // NASCE em alerta, a 8x ou mais) o reset apagava a deriva sem mover nada.
    //
    // O efeito era uma posição imortal: 8x e 10x apareciam com 0,00% de
    // liquidação e mediana MAIOR que 5x, o oposto da física. Aplicar o
    // movimento de cada ciclo direto na margem elimina a classe inteira de erro.
    const perdaShort = notional * delta;
    margemShort -= perdaShort;
    margemLong += perdaShort;

    // a margem em trânsito só protege depois de creditada
    if (emTransito && c >= emTransito.chegaEm) {
      if (emTransito.para === 'short') { margemShort += emTransito.valor; margemLong -= emTransito.valor; }
      else { margemLong += emTransito.valor; margemShort -= emTransito.valor; }
      emTransito = null;
    }

    const risco = avaliarRisco(margemShort, margemLong, notional, 0, MMR_ALT);

    // liquidação: a distância chegou a zero antes de a proteção conseguir agir
    if (risco.distanciaMinima <= 0) {
      // a perna morta leva a margem dela; sobra a margem da outra perna
      const sobra = Math.max(risco.margemShort, risco.margemLong);
      capital = Math.max(0, sobra - notional * MMR_ALT);
      liquidado = true;
      break;
    }

    // FECHAR NUNCA ESPERA A TRANSFERÊNCIA.
    //
    // A primeira versão exigia `!emTransito` para qualquer ação, e o resultado
    // foi um degrau absurdo: 0,08% de liquidação com 20 min de latência e
    // 42,27% com 40 min. O motivo não era a latência — era a posição ficar
    // paralisada esperando um saque enquanto o preço corria.
    //
    // Fechar é uma ordem local em cada exchange. Não depende de dinheiro
    // chegar. Bloquear isso seria um defeito de projeto, não só de modelo.
    // sem transferência viável, o fechamento tem de acontecer mais cedo — no
    // ALERTA, não no crítico, porque não há reequilíbrio para ganhar tempo
    if (cfg.politica === 'soFechamento' && risco.nivel !== 'ok') {
      margemShort = risco.margemShort; margemLong = risco.margemLong;
      capital = margemShort + margemLong - notional * TAXA * 2;
      montada = false; fechamentos++;
      continue;
    }

    if (cfg.politica === 'completa' && risco.nivel === 'critico') {
      margemShort = risco.margemShort; margemLong = risco.margemLong;
      capital = margemShort + margemLong - notional * TAXA * 2;
      montada = false; fechamentos++;
      continue;
    }

    if (cfg.politica !== 'nenhuma' && risco.nivel === 'alerta' && !emTransito) {
      const t = quantoTransferir(margemShort, margemLong);
      // transferir centavos custa taxa e não move a distância de liquidação
      if (t.valor > notional * 0.001) {
        capital -= t.valor * TAXA;
        const para = t.de === 'long' ? 'short' : 'long';
        if (cfg.latencia <= 0) {
          // sem latência a margem já está lá — modelar como "chega no próximo
          // ciclo" faria latência 0 e 20 min darem exatamente o mesmo número,
          // que foi o que escondeu o degrau na primeira leitura
          if (para === 'short') { margemShort += t.valor; margemLong -= t.valor; }
          else { margemLong += t.valor; margemShort -= t.valor; }
        } else {
          emTransito = { chegaEm: c + cfg.latencia, valor: t.valor, para };
        }
        transferencias++;
      }
    }

    if (c % 24 === 0) capital += notional * por8h;
  }

  return { capitalFinal: Math.max(0, capital), liquidado, fechamentos, transferencias };
}

function rodar(cfg: Config, n: number) {
  const fins: number[] = [];
  let liq = 0, fe = 0, tr = 0;
  for (let i = 0; i < n; i++) {
    const res = simular(cfg, i + 1);
    fins.push(res.capitalFinal);
    if (res.liquidado) liq++;
    fe += res.fechamentos; tr += res.transferencias;
  }
  return { fins, liq: liq / n, fechamentos: fe / n, transferencias: tr / n };
}

function percentil(v: number[], p: number): number {
  const s = [...v].sort((x, y) => x - y);
  return s[Math.min(s.length - 1, Math.floor(p * s.length))];
}

const saltosAno = (P_SALTO * CICLOS_DIA * 365).toFixed(1);

console.log(`\n${'='.repeat(98)}`);
console.log(`TESTE DE RUÍNA · US$ ${CAPITAL} · ${LEV}x · APR ${(APR * 100).toFixed(0)}% · ${DIAS} dias · ${SIMS.toLocaleString('pt-BR')} simulações`);
console.log(
  `vol diária ${(VOL_DIA * 100).toFixed(0)}% · ~${saltosAno} saltos/ano de ${(SALTO_MIN * 100).toFixed(0)}–${(SALTO_MAX * 100).toFixed(0)}% · ` +
  `latência de transferência ${LATENCIA * 20} min · distância inicial ${((1 / LEV - MMR_ALT) * 100).toFixed(1)}%`,
);
console.log(`${'='.repeat(98)}\n`);

console.log(
  'política'.padEnd(18) + 'liquidado'.padEnd(13) + 'mediana'.padEnd(12) +
  'p5'.padEnd(12) + 'p95'.padEnd(12) + 'fecha'.padEnd(9) + 'transf',
);

const guardado: Record<string, number[]> = {};
for (const p of ['nenhuma', 'transferencia', 'soFechamento', 'completa'] as Politica[]) {
  const res = rodar({ politica: p, alavancagem: LEV, latencia: LATENCIA }, SIMS);
  guardado[p] = res.fins;
  console.log(
    p.padEnd(18) +
    ((res.liq * 100).toFixed(2) + '%').padEnd(13) +
    ('$' + percentil(res.fins, 0.5).toFixed(2)).padEnd(12) +
    ('$' + percentil(res.fins, 0.05).toFixed(2)).padEnd(12) +
    ('$' + percentil(res.fins, 0.95).toFixed(2)).padEnd(12) +
    res.fechamentos.toFixed(1).padEnd(9) +
    res.transferencias.toFixed(1),
  );
}

console.log(`\n${'─'.repeat(98)}`);
console.log('O QUE A PROTEÇÃO COMPRA\n');
const sem = guardado['nenhuma'], com = guardado['completa'];
const metadeSem = sem.filter((x) => x < CAPITAL * 0.5).length / SIMS;
const metadeCom = com.filter((x) => x < CAPITAL * 0.5).length / SIMS;
const dMediana = percentil(com, 0.5) - percentil(sem, 0.5);
console.log(
  `  terminar com menos da metade do capital\n` +
  `    sem proteção   ${(metadeSem * 100).toFixed(2)}%\n` +
  `    com proteção   ${(metadeCom * 100).toFixed(2)}%\n` +
  `\n  diferença na mediana: ${dMediana >= 0 ? '+' : '−'}$${Math.abs(dMediana).toFixed(2)}` +
  (dMediana >= 0 ? '  — a proteção não custou renda, pagou' : '  — preço pago pela trava'),
);

console.log(`\n${'─'.repeat(98)}`);
console.log('SENSIBILIDADE À ALAVANCAGEM — política completa\n');
console.log(
  'alav'.padEnd(8) + 'dist. inicial'.padEnd(16) + 'liquidado'.padEnd(13) +
  'mediana'.padEnd(12) + 'p5'.padEnd(12) + 'renda/sem',
);
const N_SENS = Math.min(SIMS, 10_000);
for (const L of [3, 4, 5, 6, 8, 10]) {
  const res = rodar({ politica: 'completa', alavancagem: L, latencia: LATENCIA }, N_SENS);
  const rendaSem = (CAPITAL / 2) * L * (APR / 1095) * 21;
  console.log(
    (L + 'x').padEnd(8) +
    (((1 / L - MMR_ALT) * 100).toFixed(1) + '%').padEnd(16) +
    ((res.liq * 100).toFixed(2) + '%').padEnd(13) +
    ('$' + percentil(res.fins, 0.5).toFixed(2)).padEnd(12) +
    ('$' + percentil(res.fins, 0.05).toFixed(2)).padEnd(12) +
    '$' + rendaSem.toFixed(2),
  );
}

console.log(`\n${'─'.repeat(98)}`);
console.log('SENSIBILIDADE À LATÊNCIA DE TRANSFERÊNCIA — política completa\n');
console.log('latência'.padEnd(14) + 'liquidado'.padEnd(13) + 'mediana'.padEnd(12) + 'p5');
for (const lat of [0, 1, 2, 3, 6]) {
  const res = rodar({ politica: 'completa', alavancagem: LEV, latencia: lat }, N_SENS);
  console.log(
    (lat * 20 + ' min').padEnd(14) +
    ((res.liq * 100).toFixed(2) + '%').padEnd(13) +
    ('$' + percentil(res.fins, 0.5).toFixed(2)).padEnd(12) +
    '$' + percentil(res.fins, 0.05).toFixed(2),
  );
}

console.log(
  `\n${'='.repeat(98)}\n` +
  `Limiares: transfere a ${(LIMIARES_PADRAO.alerta * 100).toFixed(0)}% de distância, fecha a ${(LIMIARES_PADRAO.critico * 100).toFixed(0)}%.\n` +
  `\nO modelo NÃO cobre: falência de exchange, congelamento de saque, gap sem\n` +
  `negociação e falha de API. Esses não têm trava no código. O único mitigante\n` +
  `do primeiro é dividir capital entre mais exchanges.\n`,
);
