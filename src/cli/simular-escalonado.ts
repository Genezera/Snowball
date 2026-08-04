/**
 * Roda a simulação de posição escalonada contra os ciclos de vida REAIS já
 * arquivados pelo coletor (vigilancia/arquivo-ciclos.jsonl).
 *
 * NÃO toca no motor ao vivo. É só a conta, pra decidir com número antes de
 * arriscar capital de verdade.
 */
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from '../data/store.ts';
import { compararEstrategias, simularAtual, simularEscalonado, type CicloParaSimular, type ParametrosSimulacao } from '../funding/escalonado.ts';
import { parseArgs, num } from './args.ts';

const a = parseArgs();
const P: ParametrosSimulacao = {
  notional: num(a.notional, 250),
  taxa: num(a.taxa, 0.0005),
  margemPayback: num(a.margem, 1.5),
  fracaoEstagio1: num(a.fracao, 0.25),
};

const ARQ = path.join(ROOT, 'vigilancia', 'arquivo-ciclos.jsonl');

interface CicloArquivado {
  symbol: string; exchangeShort: string; exchangeLong: string;
  abertoEm: number; fechadoEm: number; spreadMedio: number; consistencia: number; observacoes: number;
}

function ler(): CicloArquivado[] {
  if (!fs.existsSync(ARQ)) return [];
  return fs.readFileSync(ARQ, 'utf8').trim().split('\n').filter(Boolean)
    .map((l) => { try { return JSON.parse(l) as CicloArquivado; } catch { return null; } })
    .filter((x): x is CicloArquivado => x !== null);
}

const brutos = ler();
console.log(`\n${'='.repeat(78)}`);
console.log('SIMULAÇÃO: PORTÃO ATUAL × POSIÇÃO ESCALONADA');
console.log(`${'='.repeat(78)}\n`);
console.log(`notional US$ ${P.notional} · taxa ${(P.taxa * 100).toFixed(3)}% · margem atual ${P.margemPayback}x · fatia inicial ${(P.fracaoEstagio1 * 100).toFixed(0)}%\n`);

if (!brutos.length) {
  console.log('Nenhum ciclo arquivado ainda. Deixe o coletor rodar (npm run coletor) e rode de novo.\n');
  process.exit(0);
}

if (brutos.length < 30) {
  console.log(`AVISO: amostra curta - so ${brutos.length} ciclos fechados ate agora. Trate o resultado`);
  console.log('abaixo como "o que o dado ja sugere", nao como conclusao. Quanto mais o coletor');
  console.log('rodar, mais confiavel isso fica.\n');
}

const ciclos: CicloParaSimular[] = brutos.map((c) => ({
  duracaoHoras: (c.fechadoEm - c.abertoEm) / 3_600_000,
  spreadMedio: c.spreadMedio,
  consistencia: c.consistencia,
}));

const cmp = compararEstrategias(ciclos, P);

console.log('-'.repeat(78));
console.log(`RESULTADO AGREGADO - ${cmp.ciclos} ciclos reais testados`);
console.log('-'.repeat(78));
console.log(
  '  '.padEnd(2) + 'estrategia'.padEnd(14) + 'abriu'.padEnd(10) + 'ganhador'.padEnd(12) + 'valor total',
);
console.log(
  '  ' + 'atual (hoje)'.padEnd(14) +
  `${cmp.atual.abriu}/${cmp.ciclos}`.padEnd(10) +
  `${cmp.atual.ganhadores}/${cmp.atual.abriu || 1}`.padEnd(12) +
  `US$ ${cmp.atual.valorTotal.toFixed(3)}`,
);
console.log(
  '  ' + 'escalonado'.padEnd(14) +
  `${cmp.escalonado.abriu}/${cmp.ciclos}`.padEnd(10) +
  `${cmp.escalonado.ganhadores}/${cmp.escalonado.abriu || 1}`.padEnd(12) +
  `US$ ${cmp.escalonado.valorTotal.toFixed(3)}`,
);

const diferenca = cmp.escalonado.valorTotal - cmp.atual.valorTotal;
console.log(`\n  diferenca: ${diferenca >= 0 ? '+' : '-'}US$ ${Math.abs(diferenca).toFixed(3)} ` +
  `(escalonado ${diferenca >= 0 ? 'ganharia mais' : 'perderia mais'} nesta amostra)`);

console.log(`\n${'-'.repeat(78)}`);
console.log('CICLOS ONDE AS ESTRATEGIAS DIVERGEM');
console.log('-'.repeat(78));
let divergiu = 0;
for (let i = 0; i < brutos.length; i++) {
  const c = brutos[i], cc = ciclos[i];
  const ra = simularAtual(cc, P), re = simularEscalonado(cc, P);
  if (ra.abriu !== re.abriu || Math.abs(ra.valor - re.valor) > 0.001) {
    divergiu++;
    if (divergiu <= 15) {
      const nome = c.symbol.replace('/USDT:USDT', '');
      console.log(
        `  ${nome.padEnd(12)} ${c.exchangeShort}->${c.exchangeLong.padEnd(14)} ` +
        `dur ${cc.duracaoHoras.toFixed(1)}h - atual ${ra.abriu ? `US$ ${ra.valor.toFixed(3)}` : '-'} - ` +
        `escalonado ${re.abriu ? `US$ ${re.valor.toFixed(3)}` : '-'}`,
      );
    }
  }
}
if (!divergiu) console.log('  nenhum - nesta amostra as duas estrategias sempre concordaram.');
else if (divergiu > 15) console.log(`  ... e mais ${divergiu - 15} ciclos`);

console.log(`\n${'='.repeat(78)}`);
console.log('Isto e simulacao contra dado ja observado, nao uma promessa sobre o futuro.');
console.log('Nada aqui muda o motor ao vivo - essa decisao e sua.');
console.log(`${'='.repeat(78)}\n`);
