/**
 * Dashboard do motor de spread.
 *
 * Serve uma página local que lê o estado e o diário em tempo real. Sem
 * dependência externa: os gráficos são SVG gerados em JavaScript puro, para
 * funcionar offline e não depender de CDN.
 *
 * O que ele mostra, e por quê:
 *
 *   · POSIÇÃO ATUAL — o que está montado, onde, e com que tamanho
 *   · DECISÕES — cada abertura, fechamento, transferência e reinvestimento,
 *     com o motivo. É o log de raciocínio do motor, não só o resultado.
 *   · CURVA DE CAPITAL — o que interessa no fim
 *   · PAGAMENTOS — cada funding recebido, para ver a frequência
 *   · VARREDURA — o ranking ao vivo dos spreads, com consistência
 *
 * A varredura roda no servidor a cada 10 minutos e é cacheada, para a página
 * poder atualizar de segundo em segundo sem martelar as exchanges.
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import ccxt from 'ccxt';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { ROOT } from '../data/store.ts';
import { varrerSpreads, type OportunidadeSpread } from '../funding/spread.ts';
import { lerVigilancia, saudeVigilancia } from '../funding/ponte.ts';
import { avaliarValor } from '../funding/valor.ts';
import { posicoesSustentaveis, taxaEfetiva } from '../funding/custos-reais.ts';
import { PAGINA } from './pagina.ts';

const execAsync = promisify(exec);

const PORTA = Number(process.env.PORTA ?? 8787);
const DIR = path.join(ROOT, 'spread');

/**
 * A varredura roda em BACKGROUND, nunca no caminho da requisição.
 *
 * A primeira versão chamava `varrerSpreads()` dentro do handler. Como a
 * varredura consulta 10 exchanges e 32 ativos com histórico, ela leva minutos —
 * e travava o carregamento da página inteira. A API dava timeout enquanto o
 * HTML servia normalmente, o que é o pior dos dois mundos.
 *
 * Agora a página responde na hora com o que houver em cache (vazio no primeiro
 * minuto), e a varredura se atualiza sozinha em paralelo.
 */
let cacheVarredura: { ts: number; dados: OportunidadeSpread[]; rodando: boolean } =
  { ts: 0, dados: [], rodando: false };

async function atualizarVarredura() {
  if (cacheVarredura.rodando) return;
  // Se a vigilância está viva, esta varredura é redundante — e cara: carrega os
  // mercados de 10 exchanges só para produzir uma segunda opinião que a página
  // nem mostra. Ela existe apenas como rede de segurança para quando a
  // vigilância cair.
  if (saudeVigilancia().viva) return;
  cacheVarredura.rodando = true;
  try {
    const dados = await varrerSpreads();
    cacheVarredura = { ts: Date.now(), dados, rodando: false };
    console.log(`[${new Date().toISOString().slice(11, 19)}] varredura atualizada: ${dados.length} oportunidades`);
  } catch (e) {
    cacheVarredura.rodando = false;
    console.log(`[varredura] falhou: ${(e as Error).message.slice(0, 60)}`);
  }
}

/**
 * PREÇO AO VIVO — não é websocket, é REST via ccxt sondado a cada ~2,5s.
 *
 * O projeto não tem ccxt.pro nem chave de exchange para stream. Isto é o mais
 * perto de "sem delay" que dá para entregar com o que está instalado: assim
 * que o preço chega, `transmitir()` empurra pro navegador, em vez de esperar
 * o próximo ciclo do motor (5 min) ou o heartbeat (10 s).
 *
 * Cobre TUDO que a tela mostra — as pernas de posições abertas e os 15
 * candidatos da varredura (o mesmo corte de `scan.slice(0,15)`) — e não
 * estoura limite de taxa porque agrupa por exchange e usa `fetchTickers` em
 * lote (uma chamada por exchange) em vez de uma chamada por par. Antes cada
 * fetchTicker era isolado e só cobria os 5 primeiros, por isso boa parte da
 * tabela ficava com "—" no preço.
 */
const poolTickers: Record<string, any> = {};
const marketsCarregados = new Set<string>();
const precosAoVivo: Record<string, { preco: number; ts: number }> = {};

async function exchangeParaTicker(id: string) {
  if (!poolTickers[id]) poolTickers[id] = new (ccxt as any)[id]({ enableRateLimit: true });
  const ex = poolTickers[id];
  if (!marketsCarregados.has(id)) {
    await ex.loadMarkets();
    marketsCarregados.add(id);
  }
  return ex;
}

async function atualizarPrecosAoVivo() {
  const estado = lerEstado();
  const abertas: any[] = estado?.posicoes ?? (estado?.posicao ? [estado.posicao] : []);
  const vig = lerVigilancia(3);
  const candidatos = (vig.disponivel && vig.oportunidades.length ? vig.oportunidades : cacheVarredura.dados).slice(0, 15);

  const porExchange = new Map<string, Set<string>>();
  const alvo = (exchange: string, symbol: string) => {
    if (!porExchange.has(exchange)) porExchange.set(exchange, new Set());
    porExchange.get(exchange)!.add(symbol);
  };
  for (const p of abertas) { alvo(p.exchangeShort, p.symbol); alvo(p.exchangeLong, p.symbol); }
  for (const o of candidatos) { alvo(o.exchangeShort, o.symbol); alvo(o.exchangeLong, o.symbol); }
  if (!porExchange.size) return;

  let mudou = false;
  await Promise.all([...porExchange.entries()].map(async ([exchange, simbolos]) => {
    try {
      const ex = await exchangeParaTicker(exchange);
      const symbols = [...simbolos];
      const tickers = await ex.fetchTickers(symbols);
      for (const symbol of symbols) {
        const t = tickers[symbol];
        const preco = t?.last ?? t?.close ?? t?.bid ?? t?.ask;
        if (preco) { precosAoVivo[`${exchange}|${symbol}`] = { preco, ts: Date.now() }; mudou = true; }
      }
    } catch { /* exchange momentaneamente indisponível; mantém o último preço conhecido */ }
  }));
  if (mudou) void transmitir();
}

/**
 * SAÚDE DOS PROCESSOS — antes só existia no watchdog (vigilancia/supervisor-
 * watchdog.log), invisível pra quem só olha o navegador. Consulta o
 * CommandLine de cada node.exe via PowerShell, cacheada 10s pra não
 * atropelar o sistema com um subprocesso a cada requisição.
 */
const PROCESSOS_ESPERADOS = [
  { chave: 'vigilancia', nome: 'Vigilância', padrao: 'src/cli/vigilancia.ts' },
  { chave: 'custodia', nome: 'Custódia', padrao: 'src/cli/custodia.ts' },
  { chave: 'motor', nome: 'Motor', padrao: 'src/cli/spread-live.ts' },
  { chave: 'dashboard', nome: 'Dashboard', padrao: 'src/dashboard/server.ts' },
  { chave: 'coletor', nome: 'Coletor', padrao: 'src/cli/coletor.ts' },
];

let saudeProcessosCache: { ts: number; dados: any[] } = { ts: 0, dados: [] };

async function saudeProcessos() {
  if (Date.now() - saudeProcessosCache.ts < 10_000) return saudeProcessosCache.dados;
  try {
    const { stdout } = await execAsync(
      'powershell -NoProfile -Command "Get-CimInstance Win32_Process -Filter \\"Name=\'node.exe\'\\" ' +
      '| Select-Object CommandLine,WorkingSetSize,CreationDate | ConvertTo-Json -Compress"',
      { timeout: 8000 },
    );
    let lista: any = [];
    try { lista = JSON.parse(stdout || '[]'); } catch { lista = []; }
    const arr = Array.isArray(lista) ? lista : (lista ? [lista] : []);
    const dados = PROCESSOS_ESPERADOS.map((p) => {
      const proc = arr.find((x: any) => typeof x.CommandLine === 'string' && x.CommandLine.includes(p.padrao));
      let desde = 0;
      if (proc?.CreationDate) {
        const m = /\/Date\((\d+)\)\//.exec(proc.CreationDate);
        desde = m ? Number(m[1]) : Date.parse(proc.CreationDate) || 0;
      }
      return {
        ...p, vivo: !!proc,
        memoriaMB: proc ? Math.round((proc.WorkingSetSize ?? 0) / 1e6) : 0,
        desde,
      };
    });
    saudeProcessosCache = { ts: Date.now(), dados };
    return dados;
  } catch {
    return saudeProcessosCache.dados.length ? saudeProcessosCache.dados : PROCESSOS_ESPERADOS.map((p) => ({ ...p, vivo: false, memoriaMB: 0, desde: 0 }));
  }
}

/** Últimos eventos do watchdog (quedas e religadas) — antes só existiam num log que ninguém via. */
function lerWatchdog(limite = 20) {
  const p = path.join(ROOT, 'vigilancia', 'supervisor-watchdog.log');
  if (!fs.existsSync(p)) return [];
  const linhas = fs.readFileSync(p, 'utf8').trim().split('\n').filter(Boolean);
  return linhas.slice(-limite).reverse();
}

/** Totais do coletor de longo prazo — antes só visível rodando `npm run analise` manualmente. */
function lerColeta() {
  const p = path.join(ROOT, 'vigilancia', 'coletor-estado.json');
  if (!fs.existsSync(p)) return null;
  try {
    const e = JSON.parse(fs.readFileSync(p, 'utf8'));
    return {
      totalObservacoes: e.totalObservacoes ?? 0,
      totalCiclos: e.totalCiclos ?? 0,
      totalCustodia: e.totalCustodia ?? 0,
      coletandoDesde: e.iniciadoEm ?? 0,
    };
  } catch { return null; }
}

function lerEstado() {
  const p = path.join(DIR, 'estado.json');
  return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : null;
}

function lerDiario(limite = 400) {
  const p = path.join(DIR, 'diario.jsonl');
  if (!fs.existsSync(p)) return [];
  const linhas = fs.readFileSync(p, 'utf8').trim().split('\n').filter(Boolean);
  return linhas.slice(-limite).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
}

/**
 * Monta o retrato completo do sistema. Usado tanto pela rota REST quanto pelo
 * stream — uma função só, para que os dois nunca divirjam.
 */
async function retrato() {
  return montarDados();
}

/**
 * Streaming de verdade, em vez de a página perguntar de 5 em 5 segundos.
 *
 * O motor escreve `spread/estado.json` quando decide, a vigilância escreve
 * `vigilancia/ciclos.json` quando varre, a custódia escreve o dela. Observando
 * os três arquivos, o painel recebe o evento no instante em que ele acontece —
 * não até 5 segundos depois.
 *
 * O heartbeat de 10 s existe por dois motivos: mantém a conexão viva contra
 * proxies que matam conexão ociosa, e atualiza os campos que dependem do tempo
 * (idade do dado, horas de vida de cada par) mesmo quando nada mudou em disco.
 */
const clientes = new Set<http.ServerResponse>();

async function transmitir() {
  if (!clientes.size) return;
  const payload = `data: ${JSON.stringify(await retrato())}\n\n`;
  for (const c of clientes) {
    try { c.write(payload); } catch { clientes.delete(c); }
  }
}

function observar(arquivo: string) {
  try {
    if (!fs.existsSync(arquivo)) return;
    // `fs.watch` dispara várias vezes por gravação em alguns sistemas de
    // arquivos do Windows. O debounce evita mandar cinco eventos idênticos.
    let pendente: NodeJS.Timeout | null = null;
    fs.watch(arquivo, () => {
      if (pendente) clearTimeout(pendente);
      pendente = setTimeout(() => { pendente = null; void transmitir(); }, 250);
    });
  } catch { /* arquivo ainda não existe; o heartbeat cobre */ }
}

const servidor = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://localhost:${PORTA}`);

  if (url.pathname === '/api/stream') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });
    res.write(`data: ${JSON.stringify(await retrato())}\n\n`);
    clientes.add(res);
    req.on('close', () => clientes.delete(res));
    return;
  }

  if (url.pathname === '/api/dados') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(await retrato()));
    return;
  }

  // Sem Cache-Control, o navegador decide sozinho (heurística varia, e já
  // aconteceu de mostrar versão velha depois de um redeploy). A página é
  // pequena e re-servida na hora do disco, então nunca vale a pena cachear.
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(PAGINA);
});

async function montarDados() {
    const estado = lerEstado();
    const diario = lerDiario();
    // Mesma regra do motor: o ranking da vigilância manda, a varredura própria
    // é só rede de segurança. Assim o painel mostra exatamente o que o motor
    // está vendo, em vez de uma segunda opinião que confundiria.
    const vig = lerVigilancia(3);
    const saudeVig = saudeVigilancia();
    // exposição por exchange — a métrica de concentração, que só existe agora
    // que o motor opera várias posições
    const abertas: any[] = estado?.posicoes ?? (estado?.posicao ? [estado.posicao] : []);
    const exposicao: Record<string, number> = {};
    for (const p of abertas) {
      exposicao[p.exchangeShort] = (exposicao[p.exchangeShort] ?? 0) + p.margemShort;
      exposicao[p.exchangeLong] = (exposicao[p.exchangeLong] ?? 0) + p.margemLong;
    }
    let concentracao = { exchange: '—', fracao: 0 };
    for (const [id, v] of Object.entries(exposicao)) {
      const fr = v / Math.max(1e-9, estado?.capital ?? 1);
      if (fr > concentracao.fracao) concentracao = { exchange: id, fracao: fr };
    }

    const usandoVigilancia = vig.disponivel && vig.oportunidades.length > 0;
    const scanBruto = usandoVigilancia ? vig.oportunidades : cacheVarredura.dados;

    // O painel precisa mostrar o VEREDICTO do portão, não só o spread. Sem
    // isso, a tabela lista candidatas que o motor jamais vai montar como se
    // fossem oportunidades — que é como ela ficou depois do portão entrar.
    const capital = estado?.capital ?? 100;
    const alavancagem = 5, margemPayback = 1.5;
    const sust = posicoesSustentaveis(capital, alavancagem, 0.12, 0.01, 3);
    const notionalPorPerna = (sust.capitalPorPosicao / 2) * alavancagem;
    const scan = scanBruto.map((o) => {
      const taxa = taxaEfetiva(o.exchangeShort, o.exchangeLong);
      const v = avaliarValor({
        spread: o.spread, consistencia: o.consistencia,
        duracaoHoras: o.duracaoHoras ?? 0, notional: notionalPorPerna, taxa,
      });
      const tickShort = precosAoVivo[`${o.exchangeShort}|${o.symbol}`];
      const tickLong = precosAoVivo[`${o.exchangeLong}|${o.symbol}`];
      return {
        ...o,
        paybackHoras: v.paybackHoras,
        vidaEsperadaHoras: v.vidaEsperadaHoras,
        valorEsperado: v.valorEsperado,
        pctDoCaminho: Math.min(100, (v.folga / margemPayback) * 100),
        passaPortao: v.folga >= margemPayback,
        precoShortAoVivo: tickShort?.preco ?? null,
        precoLongAoVivo: tickLong?.preco ?? null,
      };
    });

    // série de capital ao longo do tempo, montada a partir do diário
    const curva: { ts: number; capital: number }[] = [];
    for (const e of diario) {
      if (e.capital != null) curva.push({ ts: e.ts, capital: e.capital });
    }

    // agrupa pagamentos por dia, para o gráfico de barras
    const porDia = new Map<string, number>();
    for (const e of diario) {
      if (e.evento !== 'funding') continue;
      const d = new Date(e.ts).toISOString().slice(0, 10);
      porDia.set(d, (porDia.get(d) ?? 0) + (e.ganho ?? 0));
    }

    // ── saldos por exchange: margem em uso, reserva livre ──────────────────
    //
    // É a visão que o modelo novo pede. "Capital total" não diz nada quando o
    // dinheiro está em contas que não se comunicam.
    const saldos: Record<string, number> = estado?.saldos ?? {};
    const contas = Object.entries(saldos).map(([ex, saldo]) => {
      const usada = exposicao[ex] ?? 0;
      return {
        exchange: ex, saldo, margemUsada: usada,
        livre: Math.max(0, saldo - usada),
        fracaoUsada: saldo > 0 ? usada / saldo : 0,
        alvoReserva: saldo * reservaConfig,
      };
    });

    // ── equilíbrio de direção: quanto cada exchange drena numa alta ─────────
    const dreno: Record<string, number> = {};
    for (const p of abertas) {
      dreno[p.exchangeShort] = (dreno[p.exchangeShort] ?? 0) + p.notionalPorPerna;
      dreno[p.exchangeLong] = (dreno[p.exchangeLong] ?? 0) - p.notionalPorPerna;
    }
    const piorDrenoVal = Object.values(dreno).length ? Math.max(...Object.values(dreno).map(Math.abs)) : 0;

    // ── distância até a liquidação, por posição ────────────────────────────
    const posicoes = abertas.map((p) => {
      const mmr = 0.01;
      const dShort = p.margemShort / p.notionalPorPerna - mmr;
      const dLong = p.margemLong / p.notionalPorPerna - mmr;
      const livreShort = Math.max(0, (saldos[p.exchangeShort] ?? 0) - (exposicao[p.exchangeShort] ?? 0));
      const livreLong = Math.max(0, (saldos[p.exchangeLong] ?? 0) - (exposicao[p.exchangeLong] ?? 0));
      const tickShort = precosAoVivo[`${p.exchangeShort}|${p.symbol}`];
      const tickLong = precosAoVivo[`${p.exchangeLong}|${p.symbol}`];
      const precoAoVivoShort = tickShort?.preco ?? p.precoUltimo ?? null;
      const precoAoVivoLong = tickLong?.preco ?? p.precoUltimo ?? null;
      return {
        ...p,
        distanciaShort: dShort, distanciaLong: dLong,
        distanciaMinima: Math.min(dShort, dLong),
        pernaEmRisco: dShort <= dLong ? 'short' : 'long',
        // com a reserva desta exchange somada — o fôlego real
        distanciaComReserva: Math.min(
          (p.margemShort + livreShort) / p.notionalPorPerna - mmr,
          (p.margemLong + livreLong) / p.notionalPorPerna - mmr,
        ),
        horasAberta: (Date.now() - p.abertaEm) / 3_600_000,
        precoAoVivoShort, precoAoVivoLong,
        variacaoShort: precoAoVivoShort && p.precoEntrada ? (precoAoVivoShort - p.precoEntrada) / p.precoEntrada : 0,
        variacaoLong: precoAoVivoLong && p.precoEntrada ? (precoAoVivoLong - p.precoEntrada) / p.precoEntrada : 0,
        precoTickEm: Math.max(tickShort?.ts ?? 0, tickLong?.ts ?? 0),
      };
    });

    const processos = await saudeProcessos();

    return {
      // 'leitura' é só o ponto periódico pra curva de capital não ficar com um
      // ponto só — não é uma decisão, então some da tabela "Decisões do motor"
      // mas continua contando pra `curva` acima, que lê o `diario` completo.
      estado, posicoes, contas, diario: diario.filter((e) => e.evento !== 'leitura').slice(-80).reverse(), curva,
      pagamentosPorDia: [...porDia].map(([dia, total]) => ({ dia, total })),
      scan: scan.slice(0, 15),
      atualizadoEm: Date.now(),
      idadeVarreduraMin: usandoVigilancia
        ? Math.round(vig.idadeMinutos)
        : (cacheVarredura.ts ? Math.round((Date.now() - cacheVarredura.ts) / 60000) : -1),
      varrendo: cacheVarredura.rodando,
      exposicao, concentracao, dreno, piorDreno: piorDrenoVal, tetoPorExchange: 0.40,
      config: { alavancagem, reserva: reservaConfig, margemPayback, maxPosicoes: 3, tetoPorExchange: 0.40 },
      custodia: lerCustodia(),
      vigilancia: {
        ...saudeVig,
        fonte: usandoVigilancia ? 'vigilância · mercado inteiro' : 'varredura própria · 32 ativos',
        motivo: vig.motivo,
        candidatos: vig.oportunidades.length,
      },
      processos,
      watchdog: lerWatchdog(),
      coleta: lerColeta(),
    };
}

const reservaConfig = 0.30;

function lerCustodia() {
  try {
    const p = path.join(ROOT, 'vigilancia', 'custodia.json');
    if (!fs.existsSync(p)) return { verificadoEm: 0, saude: {} };
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch { return { verificadoEm: 0, saude: {} }; }
}

servidor.listen(PORTA, () => {
  console.log(`\n${'='.repeat(70)}`);
  console.log(`DASHBOARD NO AR`);
  console.log(`${'='.repeat(70)}\n`);
  console.log(`  Abra no navegador:  http://localhost:${PORTA}\n`);
  console.log(`  Atualização em TEMPO REAL: a página recebe um evento no instante`);
  console.log(`  em que o motor, a vigilância ou a custódia gravam em disco.\n`);

  observar(path.join(DIR, 'estado.json'));
  observar(path.join(DIR, 'diario.jsonl'));
  observar(path.join(ROOT, 'vigilancia', 'ciclos.json'));
  observar(path.join(ROOT, 'vigilancia', 'custodia.json'));
  observar(path.join(ROOT, 'vigilancia', 'supervisor-watchdog.log'));
  // heartbeat: mantém a conexão viva e atualiza os campos que dependem do
  // relógio (idade do dado, horas de vida) mesmo sem mudança em disco
  setInterval(() => void transmitir(), 10_000);

  // preço ao vivo das posições abertas e dos melhores candidatos — sondado a
  // cada ~2,5s e empurrado assim que chega, sem esperar o heartbeat
  void atualizarPrecosAoVivo();
  setInterval(() => void atualizarPrecosAoVivo(), 2_500);

  void atualizarVarredura();
  setInterval(() => void atualizarVarredura(), 10 * 60_000);
});
