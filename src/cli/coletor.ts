/**
 * COLETOR DE LONGO PRAZO — arquiva o que a poda de 7 dias apagaria.
 *
 * A vigilância mantém `historico.jsonl` e os ciclos fechados só por 7 dias —
 * decisão certa pra operar (arquivo não cresce sem limite), errada pra quem
 * vai deixar o sistema rodando semanas e quer uma análise completa no final.
 *
 * Este processo não decide nada e não consulta exchange nenhuma — só lê três
 * arquivos que a vigilância e a custódia já escrevem, e acrescenta o que for
 * novo em arquivos separados que ninguém poda:
 *
 *   vigilancia/arquivo-observacoes.jsonl   toda observação de todo par
 *   vigilancia/arquivo-ciclos.jsonl        todo ciclo de vida que fechou
 *   vigilancia/arquivo-custodia.jsonl      amostra periódica de saúde de exchange
 *
 * `spread/diario.jsonl` (decisões do motor, incluindo os `bloqueado` com os
 * campos numéricos) já é permanente por conta própria — o motor nunca poda.
 * Não precisa duplicar aqui.
 *
 * NENHUMA ORDEM É ENVIADA — só leitura de arquivo local.
 */
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from '../data/store.ts';
import { observacoesNovas, ciclosParaArquivar, custodiaEhNova } from '../funding/coleta.ts';
import { avaliarProntidao, construirDataset, treinarEavaliar, MINIMO_POSITIVOS_TREINO } from '../ml/prontidao-vigilancia.ts';
import { parseArgs, num } from './args.ts';

const a = parseArgs();
const INTERVALO_MIN = num(a.intervalo, 5);

const DIR = path.join(ROOT, 'vigilancia');
const HISTORICO = path.join(DIR, 'historico.jsonl');
const CICLOS = path.join(DIR, 'ciclos.json');
const CUSTODIA = path.join(DIR, 'custodia.json');
const ARQ_OBS = path.join(DIR, 'arquivo-observacoes.jsonl');
const ARQ_CICLOS = path.join(DIR, 'arquivo-ciclos.jsonl');
const ARQ_CUSTODIA = path.join(DIR, 'arquivo-custodia.jsonl');
const ML_TREINO = path.join(DIR, 'ml-treino.jsonl');
const ESTADO = path.join(DIR, 'coletor-estado.json');

/** só retreina depois que os positivos crescerem por pelo menos isso — 5 min
 * é frequente demais pra algo que muda pouco entre ciclos de vigilância. */
const CRESCIMENTO_MINIMO_PARA_RETREINAR = 10;

interface EstadoColetor {
  ultimoTsHistorico: number;
  ciclosArquivados: Record<string, number>;
  ultimaCustodiaArquivadaEm: number;
  totalObservacoes: number;
  totalCiclos: number;
  totalCustodia: number;
  iniciadoEm: number;
  positivosNoUltimoTreinoML?: number;
}

function carregarEstado(): EstadoColetor {
  if (fs.existsSync(ESTADO)) {
    try { return JSON.parse(fs.readFileSync(ESTADO, 'utf8')); } catch { /* recomeça do zero */ }
  }
  return {
    ultimoTsHistorico: 0, ciclosArquivados: {}, ultimaCustodiaArquivadaEm: 0,
    totalObservacoes: 0, totalCiclos: 0, totalCustodia: 0, iniciadoEm: Date.now(),
  };
}

function salvarEstado(e: EstadoColetor) {
  fs.writeFileSync(ESTADO, JSON.stringify(e, null, 2));
}

function coletar() {
  const estado = carregarEstado();
  let novasObs = 0, novosCiclos = 0, novaCustodia = false;

  // ── observações brutas de todo par ──────────────────────────────────────
  if (fs.existsSync(HISTORICO)) {
    const linhas = fs.readFileSync(HISTORICO, 'utf8').trim().split('\n').filter(Boolean);
    const { novas, maiorTs } = observacoesNovas(linhas, estado.ultimoTsHistorico);
    if (novas.length) {
      fs.appendFileSync(ARQ_OBS, novas.map((o) => JSON.stringify(o)).join('\n') + '\n');
      estado.ultimoTsHistorico = maiorTs;
      estado.totalObservacoes += novas.length;
      novasObs = novas.length;
    }
  }

  // ── ciclos de vida que fecharam ─────────────────────────────────────────
  if (fs.existsSync(CICLOS)) {
    try {
      const c = JSON.parse(fs.readFileSync(CICLOS, 'utf8'));
      const chaves = ciclosParaArquivar(c.ciclos ?? {}, estado.ciclosArquivados);
      if (chaves.length) {
        const linhas = chaves.map((k) => JSON.stringify({ arquivadoEm: Date.now(), ...c.ciclos[k] }));
        fs.appendFileSync(ARQ_CICLOS, linhas.join('\n') + '\n');
        for (const k of chaves) estado.ciclosArquivados[k] = c.ciclos[k].fechadoEm;
        estado.totalCiclos += chaves.length;
        novosCiclos = chaves.length;
      }
    } catch { /* arquivo sendo escrito pela vigilância nesse instante; tenta no próximo ciclo */ }
  }

  // ── saúde de custódia, amostrada ────────────────────────────────────────
  if (fs.existsSync(CUSTODIA)) {
    try {
      const c = JSON.parse(fs.readFileSync(CUSTODIA, 'utf8'));
      if (custodiaEhNova(c.verificadoEm, estado.ultimaCustodiaArquivadaEm)) {
        fs.appendFileSync(ARQ_CUSTODIA, JSON.stringify(c) + '\n');
        estado.ultimaCustodiaArquivadaEm = c.verificadoEm;
        estado.totalCustodia++;
        novaCustodia = true;
      }
    } catch { /* idem */ }
  }

  // ── treino real de ML, só quando há dado novo o bastante pra valer ──────
  //
  // Não treina a cada ciclo (5 min é frequente demais pra algo que muda pouco)
  // nem antes do mínimo de positivos exigido. Quando treina, o resultado vai
  // pro diário de treino — nunca fabrica um número quando a amostra não
  // sustenta (ver treinarEavaliar em prontidao-vigilancia.ts).
  let treinouML = false;
  if (novosCiclos > 0 || !estado.positivosNoUltimoTreinoML) {
    try {
      const ciclos = fs.existsSync(ARQ_CICLOS)
        ? fs.readFileSync(ARQ_CICLOS, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l))
        : [];
      const prontidao = avaliarProntidao(ciclos);
      const crescimento = prontidao.positivos - (estado.positivosNoUltimoTreinoML ?? 0);
      if (prontidao.pronto && crescimento >= CRESCIMENTO_MINIMO_PARA_RETREINAR) {
        const observacoes = fs.existsSync(ARQ_OBS)
          ? fs.readFileSync(ARQ_OBS, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l))
          : [];
        const dataset = construirDataset(ciclos, observacoes);
        const resultado = treinarEavaliar(dataset);
        fs.appendFileSync(ML_TREINO, JSON.stringify(resultado) + '\n');
        estado.positivosNoUltimoTreinoML = prontidao.positivos;
        treinouML = true;
      }
    } catch (e) {
      console.error(`[ml] erro ao tentar treinar: ${(e as Error).message}`);
    }
  }

  salvarEstado(estado);
  const dias = ((Date.now() - estado.iniciadoEm) / 86_400_000).toFixed(2);
  const hora = new Date().toLocaleTimeString('pt-BR');
  console.log(
    `[${hora}] +${novasObs} observações · +${novosCiclos} ciclos fechados` +
    `${novaCustodia ? ' · +1 amostra de custódia' : ''}${treinouML ? ' · ML retreinado' : ''} · ` +
    `acumulado: ${estado.totalObservacoes} obs · ${estado.totalCiclos} ciclos · ` +
    `${estado.totalCustodia} custódia · coletando há ${dias} dias`,
  );
}

console.log(`\n${'='.repeat(78)}`);
console.log('COLETOR DE LONGO PRAZO — arquiva o que a poda de 7 dias apagaria');
console.log(`${'='.repeat(78)}\n`);
console.log(`  a cada ${INTERVALO_MIN} min · só leitura de arquivo local, nenhuma exchange, nenhuma ordem\n`);
console.log(`  vigilancia/arquivo-observacoes.jsonl`);
console.log(`  vigilancia/arquivo-ciclos.jsonl`);
console.log(`  vigilancia/arquivo-custodia.jsonl\n`);
console.log(`  Rode 'npm run analise' quando quiser o relatório do que foi coletado.\n`);

coletar();
setInterval(coletar, INTERVALO_MIN * 60_000);
