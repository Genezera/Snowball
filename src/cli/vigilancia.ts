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
  const rk = ranking(estado, ciclo >= 3 ? 3 : 1);
  const hora = new Date().toLocaleTimeString('pt-BR');

  console.log(`${'─'.repeat(94)}`);
  console.log(
    `[${hora}] varredura ${ciclo} · ${((Date.now() - t0) / 1000).toFixed(1)}s · ` +
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
    console.log(`\n  MELHORES POR QUALIDADE SUSTENTADA (spread médio × consistência²)\n`);
    console.log(
      '  ' + 'ativo'.padEnd(12) + 'pernas'.padEnd(26) + 'APR médio'.padEnd(12) +
      'consist'.padEnd(10) + 'obs'.padEnd(7) + 'viva há'.padEnd(11) + 'renda/sem',
    );
    for (const r of rk.slice(0, 10)) {
      const renda = d.notionalPorPerna * r.spreadMedio * 21;
      console.log(
        '  ' + r.symbol.replace('/USDT:USDT', '').slice(0, 10).padEnd(12) +
        `${r.exchangeShort}→${r.exchangeLong}`.padEnd(26) +
        ((r.aprMedio * 100).toFixed(1) + '%').padEnd(12) +
        ((r.consistencia * 100).toFixed(0) + '%').padEnd(10) +
        String(r.observacoes).padEnd(7) +
        (r.duracaoHoras < 1 ? (r.duracaoHoras * 60).toFixed(0) + 'min' : r.duracaoHoras.toFixed(1) + 'h').padEnd(11) +
        '$' + renda.toFixed(3),
      );
    }
  }

  // ciclo de vida: responde se vale perseguir spread transitório
  if (st.fechadas >= 3) {
    console.log(
      `\n  CICLO DE VIDA · ${st.vivas} vivas · ${st.fechadas} já fecharam\n` +
      `    duração mediana ${st.duracaoMedianaHoras.toFixed(1)}h · máxima ${st.duracaoMaxHoras.toFixed(1)}h\n` +
      `    ${(st.fracaoCurtas * 100).toFixed(0)}% duraram menos de 2h` +
      (st.fracaoCurtas > 0.6
        ? ' — a maioria é transitória, perseguir não paga o custo de montagem'
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
