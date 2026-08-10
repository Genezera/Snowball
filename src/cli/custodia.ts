/**
 * Saúde de custódia das exchanges — sinal de evacuação.
 *
 * Roda sozinho ou em laço. NENHUMA ORDEM É ENVIADA.
 */
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from '../data/store.ts';
import { verificarTodas, pesoDe, riscoDaOperacao, type SaudeExchange } from '../funding/custodia.ts';
import { EXCHANGES_MASSA } from '../funding/universo.ts';
import { parseArgs, num, bool } from './args.ts';

const a = parseArgs();
const INTERVALO = num(a.intervalo, 15) * 60_000;
const CONTINUO = bool(a.continuo, true);
const DIR = path.join(ROOT, 'vigilancia');
const ARQ = path.join(DIR, 'custodia.json');

const SIMBOLO: Record<string, string> = {
  ok: '●', degradado: '▲', evacuar: '■', desconhecido: '○',
};

async function passada() {
  const saude = await verificarTodas(EXCHANGES_MASSA);

  fs.mkdirSync(DIR, { recursive: true });
  fs.writeFileSync(ARQ, JSON.stringify({ verificadoEm: Date.now(), saude }, null, 2));

  const hora = new Date().toLocaleTimeString('pt-BR');
  console.log(`\n${'─'.repeat(92)}`);
  console.log(`[${hora}] saúde de custódia`);
  console.log(
    '  ' + 'exchange'.padEnd(16) + 'nível'.padEnd(16) + 'peso'.padEnd(8) + 'sinais',
  );
  for (const s of Object.values(saude) as SaudeExchange[]) {
    console.log(
      '  ' + s.id.padEnd(16) +
      `${SIMBOLO[s.nivel]} ${s.nivel}`.padEnd(16) +
      pesoDe(s.id).toFixed(2).padEnd(8) +
      s.sinais.join(' · '),
    );
  }

  const evacuar = (Object.values(saude) as SaudeExchange[]).filter((s) => s.nivel === 'evacuar');
  if (evacuar.length) {
    console.log(`\n  ■ EVACUAR: ${evacuar.map((s) => `${s.id} (${s.detalhe})`).join(', ')}`);
  }

  const desc = (Object.values(saude) as SaudeExchange[]).filter((s) => s.nivel === 'desconhecido');
  if (desc.length) {
    console.log(
      `\n  ○ sem sinal: ${desc.map((s) => s.id).join(', ')} — não é "ok", é falta de informação.` +
      `\n    Estas exchanges só expõem o estado do saque com chave de API.`,
    );
  }

  if (CONTINUO) setTimeout(passada, INTERVALO);
}

console.log(`\n${'='.repeat(92)}`);
console.log('SAÚDE DE CUSTÓDIA — o risco que a estrutura delta-neutra NÃO cobre');
console.log(`${'='.repeat(92)}`);
console.log(`\nverificação a cada ${INTERVALO / 60000} min · ${EXCHANGES_MASSA.length} exchanges`);
console.log('Saque suspenso é o sinal de evacuação: aparece nos dados antes da notícia.');
console.log('NENHUMA ORDEM É ENVIADA.\n');

await passada();
