/**
 * O DESAFIO: US$ 200 → a viagem, sem aporte nenhum, só com lucro.
 *
 * Responde a pergunta que importa quando não há aporte para diluir o risco:
 * **com que agressividade é preciso operar, e qual a chance de quebrar antes
 * de chegar?**
 *
 * ── por que esta é a pergunta certa ───────────────────────────────────────
 *
 * Com aporte, risco baixo é obviamente melhor: o dinheiro entra de qualquer
 * jeito e o sistema só precisa não estragar. Sem aporte, existe um dilema real
 * — risco baixo demora décadas, risco alto quebra antes de chegar. O ponto
 * ótimo não é opinião, é uma curva, e ela tem um pico calculável.
 *
 * ── o modelo ──────────────────────────────────────────────────────────────
 *
 * Aposta fracionária: arrisca uma fração fixa `r` do capital ATUAL a cada
 * operação. Ganha `W×r` com probabilidade `p`, perde `r` com probabilidade
 * `1−p`. Os parâmetros vêm do que este projeto MEDIU, não de suposição:
 *
 *   expectancy E = p·W − (1−p)     [em múltiplos de R]
 *
 * Dado E e W, a probabilidade de acerto sai fechada: p = (E+1)/(W+1).
 *
 * ── o piso de ruína, e por que não é zero ─────────────────────────────────
 *
 * Aposta fracionária nunca zera matematicamente (metade de metade de metade
 * nunca é zero). Mas existe um piso PRÁTICO: abaixo de um certo capital, o
 * tamanho mínimo de posição da exchange e o custo fixo por operação tornam
 * impossível continuar. Modelo isso como ruína em US$ 40 — 20% do inicial.
 *
 * Ignorar esse piso é o erro clássico que faz simulação de Kelly parecer
 * segura quando não é.
 */
import { parseArgs, num, str } from './args.ts';

const a = parseArgs();

const CAPITAL = num(a.capital, 200);
const ALVO = num(a.alvo, 2234);          // viagem econômica, ver `npm run meta`
const PISO_RUINA = num(a.piso, 40);
const CAMINHOS = num(a.caminhos, 20_000);
const HORIZONTE_MESES = num(a.horizonte, 60);

/** payoff médio dos vencedores, em múltiplos de R — típico de rompimento */
const W = num(a.payoff, 2);

/**
 * Os dois cenários de vantagem. Ambos vêm de medição deste projeto:
 *
 *  medido    o que sobreviveu a walk-forward em ações (mediana +0,066R,
 *            ~4 operações/mês por ativo, 3 ativos operáveis em paralelo)
 *  otimista  o melhor produto expectancy×frequência achado varrendo 396
 *            combinações (TRX 5m momentum-breakout: 0,095R, 24,5 op/mês) —
 *            mas ESSE número é in-sample, não sobreviveu walk-forward.
 */
const CENARIOS = [
  { nome: 'medido (walk-forward)', E: 0.066, porMes: 12 },
  { nome: 'otimista (in-sample)', E: 0.095, porMes: 24.5 },
  { nome: 'excepcional (hipotético)', E: 0.150, porMes: 30 },
];

/** Gerador determinístico — mesma semente, mesmo resultado, sem Math.random. */
function criarRng(semente: number) {
  let s = semente >>> 0;
  return () => {
    s ^= s << 13; s >>>= 0;
    s ^= s >> 17;
    s ^= s << 5; s >>>= 0;
    return s / 4294967296;
  };
}

interface Resultado {
  pSucesso: number; pRuina: number; pArrastando: number;
  mesesMediano: number; capitalMedianoFinal: number;
}

function simular(E: number, porMes: number, risco: number, semente = 12345): Resultado {
  const p = (E + 1) / (W + 1);           // prob. de acerto implícita
  const totalOps = Math.round(porMes * HORIZONTE_MESES);
  const rng = criarRng(semente);
  let sucessos = 0, ruinas = 0;
  const mesesAteSucesso: number[] = [];
  const finais: number[] = [];

  for (let c = 0; c < CAMINHOS; c++) {
    let v = CAPITAL, terminou = false;
    for (let i = 1; i <= totalOps; i++) {
      v += rng() < p ? v * risco * W : -v * risco;
      if (v >= ALVO) {
        sucessos++; mesesAteSucesso.push(i / porMes); finais.push(v); terminou = true; break;
      }
      if (v <= PISO_RUINA) { ruinas++; finais.push(v); terminou = true; break; }
    }
    if (!terminou) finais.push(v);
  }

  mesesAteSucesso.sort((x, y) => x - y);
  finais.sort((x, y) => x - y);
  return {
    pSucesso: sucessos / CAMINHOS,
    pRuina: ruinas / CAMINHOS,
    pArrastando: (CAMINHOS - sucessos - ruinas) / CAMINHOS,
    mesesMediano: mesesAteSucesso.length ? mesesAteSucesso[Math.floor(mesesAteSucesso.length / 2)] : Infinity,
    capitalMedianoFinal: finais[Math.floor(finais.length / 2)],
  };
}

console.log(`\n${'='.repeat(100)}`);
console.log(`DESAFIO · US$ ${CAPITAL} → US$ ${ALVO} sem aporte, só com lucro · ${(ALVO / CAPITAL).toFixed(1)}x`);
console.log(`${'='.repeat(100)}\n`);
console.log(
  `${CAMINHOS.toLocaleString('pt-BR')} caminhos simulados · horizonte ${HORIZONTE_MESES} meses · ` +
  `payoff ${W}:1 · ruína abaixo de US$ ${PISO_RUINA}\n`,
);

const RISCOS = [0.01, 0.02, 0.05, 0.10, 0.15, 0.20, 0.30];

for (const cen of CENARIOS) {
  const p = (cen.E + 1) / (W + 1);
  console.log('─'.repeat(100));
  console.log(
    `CENÁRIO: ${cen.nome} · expectancy ${cen.E.toFixed(3)}R · ` +
    `${cen.porMes} operações/mês · acerto implícito ${(p * 100).toFixed(1)}%\n`,
  );
  console.log(
    'risco/op'.padEnd(11) + 'chega na meta'.padEnd(16) + 'QUEBRA'.padEnd(11) +
    'ainda tentando'.padEnd(17) + 'tempo mediano'.padEnd(16) + 'capital mediano',
  );
  console.log('-'.repeat(100));
  for (const r of RISCOS) {
    const s = simular(cen.E, cen.porMes, r);
    const tempo = isFinite(s.mesesMediano)
      ? (s.mesesMediano < 24 ? `${s.mesesMediano.toFixed(0)} meses` : `${(s.mesesMediano / 12).toFixed(1)} anos`)
      : '—';
    console.log(
      ((r * 100).toFixed(0) + '%').padEnd(11) +
      ((s.pSucesso * 100).toFixed(1) + '%').padEnd(16) +
      ((s.pRuina * 100).toFixed(1) + '%').padEnd(11) +
      ((s.pArrastando * 100).toFixed(1) + '%').padEnd(17) +
      tempo.padEnd(16) +
      'US$ ' + s.capitalMedianoFinal.toFixed(0),
    );
  }
  // o melhor risco por chance de sucesso
  let melhor = { r: 0, s: 0 };
  for (const r of RISCOS) {
    const s = simular(cen.E, cen.porMes, r);
    if (s.pSucesso > melhor.s) melhor = { r, s: s.pSucesso };
  }
  console.log(`\n  melhor chance de sucesso: risco ${(melhor.r * 100).toFixed(0)}% por operação → ${(melhor.s * 100).toFixed(1)}%\n`);
}

console.log('='.repeat(100));
console.log('COMO LER ISTO\n');
console.log('A coluna que decide não é "chega na meta" — é ela ao lado de "QUEBRA".');
console.log('Risco alto aumenta as duas ao mesmo tempo, e existe um ponto onde a chance');
console.log('de quebrar cresce mais rápido que a de chegar. Passar desse ponto não é');
console.log('ousadia, é pagar mais para ter menos.');
console.log();
console.log('"Ainda tentando" no fim do horizonte não é neutro: é o capital preso por');
console.log(`${HORIZONTE_MESES} meses sem ter chegado nem quebrado — o desfecho mais comum quando o`);
console.log('risco é baixo demais para a meta.');
console.log('='.repeat(100) + '\n');
