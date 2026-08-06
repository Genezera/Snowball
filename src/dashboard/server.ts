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
import { estatisticasCicloBasis, type EstadoVigilanciaBasis } from '../funding/vigilancia-basis.ts';
import { agregarEstatisticas } from '../funding/preenchimento.ts';
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

  // PODA: sem isto, cada símbolo que já passou pelo top-15 da varredura fica
  // pra sempre em precosAoVivo, mesmo depois de sair do ranking — o dicionário
  // só cresce, nunca encolhe. Achado analisando quedas sem erro registrado no
  // dashboard (candidato a vazamento de memória). Remove qualquer chave que
  // não seja mais alvo (posição aberta ou candidata atual do top-15).
  const chavesValidas = new Set<string>();
  for (const [exchange, simbolos] of porExchange) {
    for (const symbol of simbolos) chavesValidas.add(`${exchange}|${symbol}`);
  }
  for (const chave of Object.keys(precosAoVivo)) {
    if (!chavesValidas.has(chave)) delete precosAoVivo[chave];
  }

  if (mudou) void transmitir();
}

/**
 * CANDLES para o gráfico de mercado por trás de cada posição aberta —
 * pedido explícito: ver o candle do ativo com a entrada da posição marcada
 * em cima. Cache de 20s por chave (exchange|symbol|timeframe): o gráfico
 * pede de novo a cada poucos segundos no cliente, e não faz sentido bater na
 * exchange toda vez só pra devolver os mesmos candles fechados de nnovo.
 */
const cacheCandles = new Map<string, { ts: number; candles: number[][] }>();
async function lerCandles(exchange: string, symbol: string, timeframe: string): Promise<number[][]> {
  if (!exchange || !symbol) throw new Error('exchange e symbol são obrigatórios');
  const chave = exchange + '|' + symbol + '|' + timeframe;
  const cache = cacheCandles.get(chave);
  if (cache && Date.now() - cache.ts < 20_000) return cache.candles;
  const ex = await exchangeParaTicker(exchange);
  const candles: number[][] = await ex.fetchOHLCV(symbol, timeframe, undefined, 120);
  cacheCandles.set(chave, { ts: Date.now(), candles });
  return candles;
}

// PODA de cacheCandles: sem isto, toda posição que já fechou (ou toda
// candidata que já saiu do topo da varredura) deixa pra trás uma entrada de
// ~120 candles que nunca mais é pedida, mas nunca é liberada — mesmo
// problema de precosAoVivo acima. Uma posição já viu dezenas de símbolos
// diferentes passarem pelo top-15 ao longo de horas. Varre a cada 5 min e
// remove chaves que não são pedidas há mais de 10 min (bem acima do poll de
// 20s do cliente — só sobrevive o que está genuinamente sendo exibido).
setInterval(() => {
  const limite = Date.now() - 10 * 60_000;
  for (const [chave, v] of cacheCandles) {
    if (v.ts < limite) cacheCandles.delete(chave);
  }
}, 5 * 60_000);

/**
 * RANKING DE PARES DE EXCHANGE — não "qual exchange rende mais" (uma
 * exchange participa de várias rotas diferentes, então isso não diz muito),
 * é "qual COMBINAÇÃO de 2 exchanges entrega o melhor spread pelo custo".
 * Importa de verdade porque a estrutura exige duas pernas em exchanges
 * diferentes por construção — quando for pra dinheiro real, provavelmente
 * só 2 exchanges serão financiadas, e esta é a pergunta que decide quais.
 *
 * Usa a MESMA fórmula do portão real (`avaliarValor`/`taxaEfetiva`), só que
 * com a média histórica de spread/consistência/duração de cada par em vez
 * do valor instantâneo de uma candidata — é uma nota de qualidade do par,
 * não uma decisão de abrir posição.
 *
 * Cache de 30s: agrega até milhares de ciclos de `vigilancia/ciclos.json` a
 * cada chamada, caro demais para refazer a cada requisição do SSE.
 */
const EXCHANGES_RANKING_PARES = ['binanceusdm', 'bybit', 'okx', 'gate', 'bitget', 'bingx'];
let rankingParesCache: { ts: number; dados: any[] } = { ts: 0, dados: [] };

function rankingPares() {
  if (Date.now() - rankingParesCache.ts < 30_000) return rankingParesCache.dados;
  try {
    const p = path.join(ROOT, 'vigilancia', 'ciclos.json');
    if (!fs.existsSync(p)) return rankingParesCache.dados;
    const raw = JSON.parse(fs.readFileSync(p, 'utf8'));
    const ciclos: any[] = Object.values(raw.ciclos ?? raw);
    const porPar = new Map<string, { n: number; spreadSum: number; consistSum: number; duracaoSum: number; duracaoN: number }>();
    for (const c of ciclos) {
      if (!c.observacoes || c.observacoes < 3) continue;
      if (!EXCHANGES_RANKING_PARES.includes(c.exchangeShort) || !EXCHANGES_RANKING_PARES.includes(c.exchangeLong)) continue;
      const par = [c.exchangeShort, c.exchangeLong].sort().join('+');
      const acc = porPar.get(par) ?? { n: 0, spreadSum: 0, consistSum: 0, duracaoSum: 0, duracaoN: 0 };
      acc.n++;
      acc.spreadSum += c.spreadMedio;
      acc.consistSum += c.consistencia;
      if (c.fechadoEm) { acc.duracaoSum += (c.fechadoEm - c.abertoEm) / 3_600_000; acc.duracaoN++; }
      porPar.set(par, acc);
    }
    const dados = [...porPar.entries()].map(([par, acc]) => {
      const [exchangeA, exchangeB] = par.split('+');
      const spreadMedio = acc.spreadSum / acc.n;
      const consistenciaMedia = acc.consistSum / acc.n;
      const duracaoMediaHoras = acc.duracaoN ? acc.duracaoSum / acc.duracaoN : 0;
      const taxaCombinada = taxaEfetiva(exchangeA, exchangeB);
      const v = avaliarValor({ spread: spreadMedio, consistencia: consistenciaMedia, duracaoHoras: duracaoMediaHoras, notional: 1, taxa: taxaCombinada });
      return {
        exchangeA, exchangeB, amostra: acc.n,
        spreadMedio, consistenciaMedia, duracaoMediaHoras,
        taxaCombinada, paybackHoras: v.paybackHoras, vidaEsperadaHoras: v.vidaEsperadaHoras, folga: v.folga,
      };
    }).sort((a, b) => b.folga - a.folga);
    rankingParesCache = { ts: Date.now(), dados };
    return dados;
  } catch {
    return rankingParesCache.dados;
  }
}

/**
 * MEDIÇÃO DE PREENCHIMENTO MAKER — agrega o diário do monitor (item B6): taxa
 * de preenchimento, tempo mediano até encher e a reação de preço depois,
 * separado por lado (venda = perna short, compra = perna long). Cache de
 * 15s: o diário só cresce a cada poucos minutos, não vale reler a cada tick.
 */
let preenchimentoCache: { ts: number; dados: any } = { ts: 0, dados: null };

function preenchimento() {
  if (Date.now() - preenchimentoCache.ts < 15_000) return preenchimentoCache.dados;
  try {
    const p = path.join(ROOT, 'preenchimento', 'diario.jsonl');
    if (!fs.existsSync(p)) return preenchimentoCache.dados;
    const linhas = fs.readFileSync(p, 'utf8').trim().split('\n').filter(Boolean);
    const registros = linhas.map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);

    const paraStats = (rs: any[]) => agregarEstatisticas(rs.map((r) => ({
      preenchido: r.preenchido, msParaEncher: r.msParaEncher,
      reacao: r.retornoPosPct != null ? { retornoPct: r.retornoPosPct, favoravel: r.favoravel } : null,
    })));

    const dados = {
      geral: paraStats(registros),
      venda: paraStats(registros.filter((r) => r.lado === 'venda')),
      compra: paraStats(registros.filter((r) => r.lado === 'compra')),
      recentes: registros.slice(-30).reverse(),
    };
    preenchimentoCache = { ts: Date.now(), dados };
    return dados;
  } catch {
    return preenchimentoCache.dados;
  }
}

/**
 * SAÚDE DOS PROCESSOS — antes só existia no watchdog (vigilancia/supervisor-
 * watchdog.log), invisível pra quem só olha o navegador. Consulta o
 * CommandLine de cada node.exe via PowerShell, cacheada 10s pra não
 * atropelar o sistema com um subprocesso a cada requisição.
 */
// padrao e so o NOME DO ARQUIVO (sem diretorio) -- nao o caminho inteiro.
// Motivo (mesmo bug ja corrigido em scripts/supervisor.sh): o Git Bash
// reescreve caminhos estilo POSIX (src/cli/vigilancia.ts) para estilo
// Windows (src\cli\vigilancia.ts) ao invocar node.exe, um binario nativo,
// e a CommandLine que o Windows registra fica com contrabarra. Casar pelo
// caminho completo com barra normal nunca dava match -- o painel mostrava
// os 5 processos como "nao detectado" mesmo todos vivos.
const PROCESSOS_ESPERADOS = [
  { chave: 'vigilancia', nome: 'Vigilância', padrao: 'vigilancia.ts' },
  { chave: 'custodia', nome: 'Custódia', padrao: 'custodia.ts' },
  { chave: 'motor', nome: 'Motor', padrao: 'spread-live.ts' },
  { chave: 'dashboard', nome: 'Dashboard', padrao: 'server.ts' },
  { chave: 'coletor', nome: 'Coletor', padrao: 'coletor.ts' },
  { chave: 'momentum', nome: 'Modo Agressivo', padrao: 'momentum-live.ts' },
  { chave: 'preenchimento', nome: 'Preenchimento', padrao: 'preenchimento-live.ts' },
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

/**
 * Status de prontidão pra treinar ML de sobrevivência de spread — mesma
 * conta de src/cli/ml-preparar.ts, exposta pro dashboard em vez de exigir
 * rodar comando manual. Nunca treina nada aqui; só conta quantos exemplos
 * positivos (sobreviveram ao portão de 1,5x) já existem no arquivado.
 */
const ML_TAXA = 0.0005, ML_NOTIONAL = 250, ML_PAGAMENTOS_HORA = 3 / 24, ML_MARGEM = 1.5, ML_MINIMO_POSITIVOS = 30;

function lerStatusML() {
  const p = path.join(ROOT, 'vigilancia', 'arquivo-ciclos.jsonl');
  if (!fs.existsSync(p)) return { confiaveis: 0, positivos: 0, minimoNecessario: ML_MINIMO_POSITIVOS };
  try {
    const linhas = fs.readFileSync(p, 'utf8').trim().split('\n').filter(Boolean);
    let confiaveis = 0, positivos = 0;
    for (const l of linhas) {
      let c: any; try { c = JSON.parse(l); } catch { continue; }
      const duracaoHoras = (c.fechadoEm - c.abertoEm) / 3_600_000;
      const esperadas = Math.max(1, duracaoHoras * 12);
      if (c.observacoes / esperadas < 0.15) continue;
      confiaveis++;
      const custo = ML_NOTIONAL * ML_TAXA * 4;
      const paybackHoras = c.spreadMedio > 0 ? custo / (ML_NOTIONAL * c.spreadMedio * ML_PAGAMENTOS_HORA) : Infinity;
      const vidaEsperada = duracaoHoras * c.consistencia;
      if (vidaEsperada >= paybackHoras * ML_MARGEM) positivos++;
    }
    return { confiaveis, positivos, minimoNecessario: ML_MINIMO_POSITIVOS };
  } catch { return { confiaveis: 0, positivos: 0, minimoNecessario: ML_MINIMO_POSITIVOS }; }
}

/**
 * Basis trade (spot+perp mesma exchange) — só coleta, o motor não usa ainda.
 * Mesma leitura que src/cli/vigilancia.ts já faz pra imprimir no console,
 * exposta aqui pra não depender de olhar log.
 */
function lerBasis() {
  const vazio = { vivas: 0, fechadas: 0, duracaoMedianaHoras: 0, duracaoMaximaHoras: 0, top: [] as any[] };
  try {
    const p = path.join(ROOT, 'vigilancia', 'ciclos-basis.json');
    if (!fs.existsSync(p)) return vazio;
    const estado: EstadoVigilanciaBasis = JSON.parse(fs.readFileSync(p, 'utf8'));
    const st = estatisticasCicloBasis(estado);
    const top = Object.values(estado.ciclos)
      .filter((c) => !c.fechadoEm)
      .map((c) => ({
        symbol: c.symbol, exchange: c.exchange,
        apr: c.funding8hMedio * 3 * 365,
        observacoes: c.observacoes,
        horasVivo: (Date.now() - c.abertoEm) / 3_600_000,
        volumeMedio: c.volumeMedio,
      }))
      .sort((a, b) => b.apr - a.apr)
      .slice(0, 10);
    return { ...st, top };
  } catch { return vazio; }
}

function lerEstado() {
  const p = path.join(DIR, 'estado.json');
  return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : null;
}

/**
 * Histórico de OPERAÇÕES DE VERDADE — abre, fecha, funding, reinveste,
 * escalona, socorre. Deliberadamente separado do `diario` que alimenta
 * "Decisões do motor": aquele mistura tudo (inclusive "bloqueado", que é a
 * maioria esmagadora dos eventos) e, com o corte de 80 linhas, uma sequência
 * de bloqueios recentes empurraria pra fora as operações reais mais antigas.
 * Aqui lê uma janela bem maior do arquivo ANTES de filtrar, porque bloqueio
 * é raro perto de operação de verdade nesta escala.
 */
const EVENTOS_OPERACAO = new Set(['abre', 'fecha', 'funding', 'reinveste', 'escalona', 'socorre']);

function lerOperacoes(caminhoDiario: string, limiteLinhas = 4000, limiteResultado = 200) {
  if (!fs.existsSync(caminhoDiario)) return [];
  const linhas = fs.readFileSync(caminhoDiario, 'utf8').trim().split('\n').filter(Boolean).slice(-limiteLinhas);
  const eventos = linhas.map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  return eventos.filter((e) => EVENTOS_OPERACAO.has(e.evento)).slice(-limiteResultado).reverse();
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

  if (url.pathname === '/logo.png' || url.pathname === '/logo-fundo-branco.png' || url.pathname === '/favicon.png') {
    const arquivo = path.join(ROOT, 'assets', url.pathname.slice(1));
    try {
      const buf = fs.readFileSync(arquivo);
      res.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=86400' });
      res.end(buf);
    } catch {
      res.writeHead(404);
      res.end();
    }
    return;
  }

  if (url.pathname === '/api/candles') {
    const exchange = url.searchParams.get('exchange') ?? '';
    const symbol = url.searchParams.get('symbol') ?? '';
    const timeframe = url.searchParams.get('timeframe') ?? '15m';
    try {
      const candles = await lerCandles(exchange, symbol, timeframe);
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ ok: true, candles }));
    } catch (e) {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ ok: false, erro: (e as Error).message }));
    }
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

    // ── ranking de lucro por exchange ───────────────────────────────────────
    //
    // `saldosIniciais` é o valor DECLARADO por exchange (ex.: US$ 100), fixo
    // desde que a exchange entrou em operação — nunca recalculado a partir do
    // saldo atual. Lucro individual = saldo agora menos essa baseline. É o
    // "qual exchange rende mais" pedido, sem misturar com o total agregado.
    const saldosIniciais: Record<string, number> = estado?.saldosIniciais ?? {};
    const rankingExchanges = Object.entries(saldos)
      .map(([ex, saldo]) => {
        const inicial = saldosIniciais[ex] ?? saldo;
        const lucro = saldo - inicial;
        return { exchange: ex, saldo, inicial, lucro, lucroPct: inicial > 0 ? lucro / inicial : 0 };
      })
      .sort((a, b) => b.lucro - a.lucro)
      .map((r, i) => ({ ...r, posicao: i + 1 }));

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
      estado, posicoes, contas, rankingExchanges, diario: diario.filter((e) => e.evento !== 'leitura').slice(-80).reverse(), curva,
      operacoes: lerOperacoes(path.join(DIR, 'diario.jsonl')),
      rankingPares: rankingPares(),
      preenchimento: preenchimento(),
      // diagnóstico de memória do próprio dashboard — achado depois de quedas
      // sem erro registrado (candidato a vazamento). Barato de calcular, só
      // leituras de tamanho, nada pesado.
      diagnostico: {
        memoriaRssMB: Math.round(process.memoryUsage().rss / 1e6),
        clientesSSE: clientes.size,
        cacheCandlesEntradas: cacheCandles.size,
        precosAoVivoEntradas: Object.keys(precosAoVivo).length,
      },
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
      ml: lerStatusML(),
      basis: lerBasis(),
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
  observar(path.join(ROOT, 'vigilancia', 'ciclos-basis.json'));
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

  // Log de memória a cada 10 min — antes deste dashboard não tinha NENHUMA
  // visibilidade de tendência de memória, só o fato de eventualmente cair
  // sem erro registrado (candidato a OOM). Agora, se acontecer de novo, dá
  // pra ver no log se a memória estava subindo sem parar antes da queda, em
  // vez de descobrir só quando o watchdog religa.
  setInterval(() => {
    const m = process.memoryUsage();
    console.log(
      `[memoria] rss=${(m.rss / 1e6).toFixed(0)}MB heap=${(m.heapUsed / 1e6).toFixed(0)}/${(m.heapTotal / 1e6).toFixed(0)}MB ` +
      `clientesSSE=${clientes.size} cacheCandles=${cacheCandles.size} precosAoVivo=${Object.keys(precosAoVivo).length}`,
    );
  }, 10 * 60_000);
});
