/**
 * Vigilância contínua do mercado inteiro.
 *
 * Varre, registra o ciclo de vida de cada oportunidade e ranqueia por
 * qualidade sustentada em vez de spread instantâneo.
 */
import { observar, ranking, estatisticasCiclo, podar } from '../funding/vigilancia.ts';
import { dimensionarSpread } from '../funding/spread.ts';
import { parseArgs, num, bool } from './args.ts';

const a = parseArgs();
const CAPITAL = num(a.equity, 100);
const LEV = num(a.alavancagem, 5);
const VOL_MIN = num(a.volumeMinimo, 10e6);
const INTERVALO = num(a.intervalo, 5) * 60_000;
const CONTINUO = bool(a.continuo, true);

const d = dimensionarSpread(CAPITAL, LEV);

console.log(`\n${'='.repeat(94)}`);
console.log(`VIGILÂNCIA DO MERCADO · US$ ${CAPITAL} a ${LEV}x · notional US$ ${d.notionalPorPerna.toFixed(0)}/perna`);
console.log(`${'='.repeat(94)}`);
console.log(`\nvarredura a cada ${INTERVALO / 60000} min · liquidez mínima US$ ${(VOL_MIN / 1e6).toFixed(0)}M nas duas pontas`);
console.log(`NENHUMA ORDEM É ENVIADA — as exchanges são apenas lidas.\n`);

let ciclo = 0;

async function passada() {
  ciclo++;
  const t0 = Date.now();
  const tempos: string[] = [];

  const { estado, ops, novas, fechadas } = await observar({
    volumeMinimo: VOL_MIN,
    onProgresso: (ex, n, ms) => tempos.push(`${ex} ${n}p/${(ms / 1000).toFixed(1)}s`),
  });

  const st = estatisticasCiclo(estado);
  // O mínimo de observações usa `estado.varreduras`, que é PERSISTIDO, e não o
  // contador local `ciclo`, que zera a cada reinício do processo. Com o
  // contador local, reiniciar a vigilância fazia pares de uma única observação
  // voltarem ao ranking — exatamente o erro que o ajuste de Wilson existe para
  // evitar.
  const rk = ranking(estado, estado.varreduras >= 3 ? 3 : 1);
  const hora = new Date().toLocaleTimeString('pt-BR');

  console.log(`${'─'.repeat(94)}`);
  console.log(
    `[${hora}] varredura ${ciclo} desta sessão · ${estado.varreduras} no total · ` +
    `${((Date.now() - t0) / 1000).toFixed(1)}s · ` +
    `${ops.length} oportunidades vivas · ${st.totalObservadas} já observadas`,
  );
  console.log(`  ${tempos.join(' · ')}`);

  // eventos: o que abriu e o que fechou desde a última passada
  for (const n of novas.slice(0, 6)) {
    console.log(
      `  ▲ ABRIU  ${n.symbol.replace('/USDT:USDT', '').padEnd(10)} ` +
      `${n.exchangeShort}→${n.exchangeLong} · ${(n.aprSpread * 100).toFixed(0)}% APR · ` +
      `$${(n.volumeMinimo / 1e6).toFixed(0)}M`,
    );
  }
  for (const f of fechadas.slice(0, 6)) {
    const dur = ((f.fechadoEm! - f.abertoEm) / 3_600_000).toFixed(1);
    console.log(
      `  ▼ FECHOU ${f.symbol.replace('/USDT:USDT', '').padEnd(10)} ` +
      `${f.exchangeShort}→${f.exchangeLong} · durou ${dur}h · ${f.observacoes} obs`,
    );
  }

  // ranking por qualidade sustentada
  if (rk.length) {
    console.log(`\n  MELHORES POR QUALIDADE SUSTENTADA · ordenado por spread × consistência ajustada²\n`);
    // A coluna "ajust" é a consistência corrigida por tamanho de amostra
    // (Wilson). Exibir só a bruta enganava: um par de 2 observações aparecia
    // com "100%" ao lado de um par de 30 observações com 64%, como se fossem
    // afirmações da mesma força. São 34% e 51% depois do ajuste.
    console.log(
      '  ' + 'ativo'.padEnd(12) + 'pernas'.padEnd(26) + 'APR médio'.padEnd(12) +
      'bruta'.padEnd(8) + 'ajust'.padEnd(8) + 'obs'.padEnd(6) + 'viva há'.padEnd(11) +
      'payback'.padEnd(11) + 'renda/sem',
    );
    for (const r of rk.slice(0, 10)) {
      const renda = d.notionalPorPerna * r.spreadMedio * 21;
      // mesma conta do portão do motor: taxa × 4 / spread, em horas
      const payback = r.spreadMedio > 0 ? (0.0005 * 4 / r.spreadMedio) * 8 : Infinity;
      const vida = r.duracaoHoras * r.consistenciaAjustada;
      const passa = vida >= payback * 1.5;
      console.log(
        '  ' + r.symbol.replace('/USDT:USDT', '').slice(0, 10).padEnd(12) +
        `${r.exchangeShort}→${r.exchangeLong}`.padEnd(26) +
        ((r.aprMedio * 100).toFixed(1) + '%').padEnd(12) +
        ((r.consistencia * 100).toFixed(0) + '%').padEnd(8) +
        ((r.consistenciaAjustada * 100).toFixed(0) + '%').padEnd(8) +
        String(r.observacoes).padEnd(6) +
        (r.duracaoHoras < 1 ? (r.duracaoHoras * 60).toFixed(0) + 'min' : r.duracaoHoras.toFixed(1) + 'h').padEnd(11) +
        ((payback < 1000 ? payback.toFixed(0) + 'h' : '—') + (passa ? ' ✓' : '')).padEnd(11) +
        '$' + renda.toFixed(3),
      );
    }
    console.log(`\n  ✓ = já viveu o suficiente para o motor montar. Sem ✓, o portão barra.`);
  }

  // ── ciclo de vida ────────────────────────────────────────────────────────
  //
  // Esta estatística já mentiu uma vez, e vale registrar como.
  //
  // Antes da tolerância a faltas, um ciclo era fechado na PRIMEIRA varredura em
  // que o par não aparecia. Como os pares piscam (KAITO apareceu em 38 de 44
  // varreduras, com buracos de uma e duas), o número reportado era "duração
  // mediana 0,1h · 100% duraram menos de 2h · perseguir não paga o custo".
  //
  // Isso media o bug, não o mercado. E eu apresentei como se fosse mercado.
  //
  // Agora a contagem só fecha após TOLERANCIA_FALTAS ausências seguidas, mas a
  // amostra ainda é curta — por isso o aviso abaixo exige 10 fechamentos e diz
  // quantas varreduras existem, para que ninguém (inclusive eu) leia uma
  // conclusão forte a partir de meia hora de dado.
  if (st.fechadas >= 10) {
    const amostraFina = estado.varreduras < 100;
    console.log(
      `\n  CICLO DE VIDA · ${st.vivas} vivas · ${st.fechadas} já fecharam · ${estado.varreduras} varreduras\n` +
      `    duração mediana ${st.duracaoMedianaHoras.toFixed(1)}h · máxima ${st.duracaoMaxHoras.toFixed(1)}h\n` +
      `    ${(st.fracaoCurtas * 100).toFixed(0)}% duraram menos de 2h` +
      (amostraFina
        ? `\n    ⚠ amostra curta — não tire conclusão sobre o mercado com menos de 100 varreduras`
        : st.fracaoCurtas > 0.6
          ? ' — a maioria é transitória, e o portão de valor esperado vai barrar quase tudo'
          : ' — há spreads que se sustentam'),
    );
  }

  if (ciclo % 50 === 0) {
    const p = podar(7);
    console.log(`\n  histórico podado: ${p.antes} → ${p.depois} observações`);
  }

  if (CONTINUO) setTimeout(passada, INTERVALO);
}

process.on('SIGINT', () => { console.log('\nvigilância encerrada. Estado salvo.'); process.exit(0); });

await passada();
