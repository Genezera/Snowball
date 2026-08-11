/**
 * DASHBOARD 2.0 — API EXCLUSIVA, SEPARADA DO SERVIDOR DE PRODUÇÃO
 * ---------------------------------------------------------------------
 * Regras absolutas, verificáveis lendo este arquivo inteiro:
 *   - NUNCA importa `MotorSpread`, nenhum motor, nenhuma lógica econômica.
 *   - NUNCA chama fs.writeFileSync/appendFileSync/qualquer escrita.
 *   - NUNCA importa nem depende de `src/dashboard/server.ts` (o servidor
 *     antigo) — lê os MESMOS arquivos do Snowball diretamente.
 *   - Roda em porta própria (padrão 5184), PID próprio, log próprio.
 *   - Não faz parte dos processos supervisionados pelo watchdog principal —
 *     tem supervisão própria (scripts/supervisor-dashboard-v2).
 *
 * ARQUIVO 6-EXCHANGES: as rotas /api/v2/champion, /api/v2/profit-lab,
 * /api/v2/opportunities, /api/v2/waterfall e /api/v2/events (e os serviços
 * que só existiam pra elas: champion.ts, captura.ts, oportunidades.ts,
 * cobertura.ts, waterfall.ts, eventos.ts) foram ARQUIVADAS — ver
 * arquivo-6-exchanges/README.md. Devolvem `{ok:true, arquivado:true}`
 * abaixo em vez de tentar ler arquivos/processos que não existem mais.
 *
 * Fluxo: arquivos/agregadores do Snowball → (somente leitura) → esta API
 * → frontend do Dashboard 2.0. Nunca o caminho inverso.
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { lerJsonSeguro, lerJsonlComNumeroDeLinha } from './readers/arquivos.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..'); // raiz do repositório Snowball
const PORTA = Number(process.env.PORTA_V2_API ?? 5184);
// Diretório de runtime (heartbeat/logs/crash-diagnostics). Padrão de PRODUÇÃO
// preservado (`api/logs`); só é sobrescrito por API_V2_LOG_DIR para permitir
// uma instância ISOLADA de teste (porta 5199) que nunca clobber o heartbeat
// de produção que o supervisor lê. Nada de leitura de estado do Snowball muda.
const DIR_LOGS = process.env.API_V2_LOG_DIR ? path.resolve(process.env.API_V2_LOG_DIR) : path.join(__dirname, 'logs');

fs.mkdirSync(DIR_LOGS, { recursive: true });
function log(msg: string) {
  const linha = `[${new Date().toISOString()}] ${msg}`;
  console.log(linha);
  try { fs.appendFileSync(path.join(DIR_LOGS, 'api.log'), linha + '\n'); } catch { /* log é best-effort, nunca derruba a API por causa disso */ }
}

// ── heartbeat/PID próprios (Parte 4/13 — supervisão independente) ───────
interface HeartbeatV2 { pid: number; startedAt: number; ultimaRequisicao: number | null; totalRequisicoes: number; version: string }
const heartbeat: HeartbeatV2 = { pid: process.pid, startedAt: Date.now(), ultimaRequisicao: null, totalRequisicoes: 0, version: '2.0.0-api' };
let ultimaRota: string | null = null;
function salvarHeartbeat() {
  try { fs.writeFileSync(path.join(DIR_LOGS, 'heartbeat.json'), JSON.stringify(heartbeat, null, 2)); } catch { /* best-effort */ }
}

// ── diagnóstico persistente de quedas (Parte 11) ─────────────────────────
// Registra CADA saída do processo (limpa ou não) num jsonl append-only —
// nunca sobrescreve entradas antigas, nunca depende de o processo ainda
// estar vivo pra ser lido depois. Classificação sempre explícita — nunca
// deixa "motivoClassificado" vazio/adivinhado.
type MotivoQueda = 'startup' | 'shutdown_limpo' | 'maintenance' | 'crash' | 'watchdog_restart' | 'porta_ocupada' | 'erro_de_build' | 'erro_nao_tratado';
function registrarDiagnosticoQueda(motivo: MotivoQueda, extra: Record<string, unknown> = {}) {
  const entrada = {
    timestamp: Date.now(), timestampLegivel: new Date().toISOString(),
    processo: 'dashboard-v2-api', pid: process.pid,
    exitCode: extra.exitCode ?? null, signal: extra.signal ?? null,
    stderrFinal: extra.stderrFinal ?? null, stdoutFinal: extra.stdoutFinal ?? null,
    stack: extra.stack ?? null,
    memoriaRssMB: Math.round(process.memoryUsage().rss / 1e6),
    porta: PORTA, ultimoRequest: ultimaRota,
    motivoClassificado: motivo,
  };
  try { fs.appendFileSync(path.join(DIR_LOGS, 'crash-diagnostics.jsonl'), JSON.stringify(entrada) + '\n'); } catch { /* best-effort — nunca impede o shutdown/registro de seguir */ }
}
registrarDiagnosticoQueda('startup');

function enviarJson(res: http.ServerResponse, status: number, corpo: unknown) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(corpo));
}

// ── detalhe de operação (Fase 2 — o que abriu, por que, o que faria fechar) ──
// Limiares copiados de forward-lab.cjs — se mudarem lá, mudam aqui também
// (não têm getter público; documentado pra não ficar defasado em silêncio).
const INVERSION_CICLOS = 2, MAX_HOLDING_MS = 7 * 86400000, FUNDING_DETERIORATION_FRAC = 0.5, PERSIST_MIN_MS = 30 * 60000;

function condicoesDeFechamento(v: any, agora: number): string[] {
  const c: string[] = [];
  if (v.tipo === 'spotperp') {
    const x = v.ciclosSemFunding || 0;
    c.push(x > 0 ? `Sem funding há ${x}/${INVERSION_CICLOS} ciclos — fecha se continuar` : 'Recebendo funding normalmente.');
    return c;
  }
  const inv = v.ciclosInversao || 0, det = v.ciclosFundingDeteriorado || 0;
  c.push(inv > 0 ? `Inversão econômica: ${inv}/${INVERSION_CICLOS} ciclos com EV negativo — fecha se continuar` : 'EV positivo agora — sem sinal de inversão.');
  if (det > 0) c.push(`Funding caiu abaixo de ${Math.round(FUNDING_DETERIORATION_FRAC * 100)}% da entrada: ${det}/${INVERSION_CICLOS} ciclos.`);
  const restanteMs = MAX_HOLDING_MS - (agora - (v.positionOpenedAt || agora));
  const restanteD = restanteMs / 86400000;
  c.push(restanteD > 0 ? `Prazo máximo de 7 dias: fecha automaticamente em ${restanteD.toFixed(1)}d se nada mudar antes.` : 'Prazo máximo de 7 dias atingido — deveria fechar no próximo ciclo.');
  return c;
}

// lê só a COLA do feed (bounded, não o arquivo inteiro) — histórico "recente
// desde a abertura", não a vida inteira; honesto sobre a janela no campo
// `janelaLimitada`, nunca finge ser o histórico completo.
function lerSerieRecente(caminhoFeed: string, chave: string, desdeTs: number, limiteBytes = 3 * 1024 * 1024): { pontos: { ts: number; apr: number }[]; janelaLimitada: boolean } {
  try {
    const st = fs.statSync(caminhoFeed);
    const N = Math.min(st.size, limiteBytes);
    const fd = fs.openSync(caminhoFeed, 'r'); const buf = Buffer.alloc(N);
    fs.readSync(fd, buf, 0, N, st.size - N); fs.closeSync(fd);
    const linhas = buf.toString('utf8').split('\n').filter(Boolean);
    const pontos: { ts: number; apr: number }[] = [];
    for (const l of linhas) {
      let o: any; try { o = JSON.parse(l); } catch { continue; }
      if (o.k !== chave || o.ts < desdeTs || o.apr == null) continue;
      pontos.push({ ts: o.ts, apr: Math.round(o.apr * 1e4) / 1e4 });
    }
    return { pontos, janelaLimitada: N < st.size };
  } catch { return { pontos: [], janelaLimitada: false }; }
}

const servidor = http.createServer((req, res) => {
  heartbeat.ultimaRequisicao = Date.now();
  heartbeat.totalRequisicoes++;
  // CORS: API somente-leitura, sem autenticação, sem efeito colateral — o
  // frontend V2 roda em porta diferente (5183) desta API (5184), então
  // precisa disto pra falar direto sem depender de proxy de nenhum outro
  // servidor (isso incluiria o antigo, na 8787 — nunca é usado aqui).
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
  const url = new URL(req.url ?? '/', `http://localhost:${PORTA}`);
  ultimaRota = url.pathname;

  try {
    // ── saúde da própria API ────────────────────────────────────────────
    if (url.pathname === '/api/v2/health') {
      return enviarJson(res, 200, { ok: true, ...heartbeat, uptimeMs: Date.now() - heartbeat.startedAt });
    }

    // ── ARQUIVO 6-EXCHANGES: Champion e Paper Profit Lab foram isolados em
    // arquivo-6-exchanges/ e não rodam mais — ver README lá. Estas rotas
    // existem só pra qualquer cliente antigo não quebrar com 404 silencioso.
    if (url.pathname === '/api/v2/champion' || url.pathname === '/api/v2/profit-lab'
      || url.pathname === '/api/v2/opportunities' || url.pathname === '/api/v2/waterfall'
      || url.pathname === '/api/v2/events') {
      return enviarJson(res, 200, { ok: true, arquivado: true, motivo: 'Champion/Paper Profit Lab (bloco "6 exchanges") foram arquivados — ver arquivo-6-exchanges/README.md. Esta rota não serve mais dado.' });
    }

    // ── maximização de lucro: Champion + ranking 2-exchanges + head-to-head ao vivo ──
    // Serve o JSON pré-construído (scripts/analise/profit-max-dashboard.cjs) + relê os
    // estados dos competidores AO VIVO para o head-to-head não ficar defasado. SÓ LEITURA.
    if (url.pathname === '/api/v2/profit-maximization') {
      const base = lerJsonSeguro<any>(path.join(ROOT, 'auditoria', 'progression', 'profit-maximization.json'), null);
      if (base && base.headToHead) {
        const compDir = path.join(ROOT, 'auditoria', 'progression', 'compete');
        base.headToHead.competidores = (base.headToHead.competidores || []).map((c: any) => {
          const est = lerJsonSeguro<any>(path.join(compDir, c.label, 'estado.json'), null);
          const hb = lerJsonSeguro<any>(path.join(compDir, c.label, 'heartbeat.json'), null);
          // diretório não existe mais (competidor aposentado pós-consolidação) — nunca herdar o
          // "vivo:true" congelado do JSON estático, senão a página mente que ainda está rodando.
          if (!est) return { ...c, vivo: false, disponivel: false };
          const funding = est.fundingAcum || 0, custos = est.custosAcum || 0, rend = est.yieldAcum || 0, net = funding + rend - custos;
          const vivo = !!(hb && hb.ultimoCiclo && Date.now() - hb.ultimoCiclo < 15 * 60000);
          return { ...c, fundingAcum: Math.round(funding * 1e4) / 1e4, custosAcum: Math.round(custos * 1e4) / 1e4, net: Math.round(net * 1e4) / 1e4,
            capital: Math.round((est.capitalInicial + net) * 1e4) / 1e4, abertas: Object.keys(est.virtuais || {}).length,
            fechadas: (est.contadores || {}).fechadas || 0, persistencePending: (est.bloqueios || {}).persistencePending || 0, vivo };
        });
      }
      return enviarJson(res, 200, { ok: true, dados: base, geradoEm: Date.now() });
    }

    // ── competidores 2-exchange: detalhe rico por competidor (dupla, cada um separado) ──
    // dinheiro, curva de capital, ordens abertas, operações (histórico), "o que está pensando".
    // Tudo lido AO VIVO dos arquivos do motor (estado/diario/snapshots). SÓ LEITURA.
    if (url.pathname === '/api/v2/competidores') {
      const compDir = path.join(ROOT, 'auditoria', 'progression', 'compete');
      // BOT ÚNICO — a configuração do dinheiro real: bybit+bitget, maker + persistência,
      // utilização máxima (5 pos · reserva 20%) + rendimento na reserva. Sem várias frentes.
      const defs = [{ label: 'snowball-2ex', par: 'bybit + bitget · MOTOR REAL' }];
      const r2 = (n: number, c = 4) => Math.round(n * 10 ** c) / 10 ** c;
      const competidores = defs.map((d) => {
        const est = lerJsonSeguro<any>(path.join(compDir, d.label, 'estado.json'), null);
        const hb = lerJsonSeguro<any>(path.join(compDir, d.label, 'heartbeat.json'), null);
        if (!est) return { ...d, disponivel: false };
        const funding = est.fundingAcum || 0, custos = est.custosAcum || 0, rend = est.yieldAcum || 0, net = funding + rend - custos;
        const dias = est.iniciadoEm ? (Date.now() - est.iniciadoEm) / 86400000 : 0;
        const vivo = !!(hb && hb.ultimoCiclo && Date.now() - hb.ultimoCiclo < 15 * 60000);
        const agora = Date.now();
        const feedObs = path.join(ROOT, 'vigilancia', 'arquivo-observacoes.jsonl');
        const abertas = Object.values(est.virtuais || {}).map((v: any) => {
          const serie = v.tipo !== 'spotperp' ? lerSerieRecente(feedObs, v.k, v.positionOpenedAt || agora) : { pontos: [], janelaLimitada: false };
          return {
            tipo: v.tipo === 'spotperp' ? 'spot-perp' : v.tipo === 'settlement_capture' ? 'settlement-capture' : 'cross',
            symbol: String(v.sym || v.k || '').replace('/USDT:USDT', '').replace(/^sp:/, ''),
            long: v.tipo === 'spotperp' ? v.exchange : v.long, short: v.tipo === 'spotperp' ? 'spot+perp' : v.short,
            notional: v.notional, fundingAcum: r2(v.fundingAcum || 0), aprEntrada: r2(v.aprEntrada || 0, 2),
            ultimoApr: v.ultimoApr != null ? r2(v.ultimoApr, 2) : null, economicEV: v.economicEV ?? null,
            holdH: v.positionOpenedAt ? r2((agora - v.positionOpenedAt) / 3.6e6, 1) : null,
            scannerVisible: !!v.scannerVisible, scannerAgeMin: v.scannerLastSeen ? r2((agora - v.scannerLastSeen) / 60000, 1) : null,
            condicoesFechamento: condicoesDeFechamento(v, agora),
            serieRecente: serie.pontos, serieJanelaLimitada: serie.janelaLimitada,
          };
        });
        const diario = lerJsonlComNumeroDeLinha(path.join(compDir, d.label, 'diario.jsonl')).map((x) => x.linha as any);
        const operacoes = diario.filter((e) => e.evento === 'abre' || e.evento === 'fecha').slice(-15).reverse()
          .map((e) => ({ ts: e.ts, tipo: e.evento, symbol: String(e.k || '').split('|')[0], apr: e.apr != null ? r2(e.apr, 2) : null, funding: e.funding != null ? r2(e.funding) : null, pnl: e.pnl != null ? r2(e.pnl) : null, motivo: e.closeReason || null }));
        // candidatos aguardando o filtro de persistência (30min de sinal positivo contínuo) —
        // usa candidatoPositivoDesde do próprio estado (fonte de verdade), não o diário.
        const candidatos = Object.entries(est.candidatoPositivoDesde || {}).map(([k, desdeTs]: [string, any]) => {
          const decorridoMs = agora - desdeTs, restanteMin = Math.max(0, (PERSIST_MIN_MS - decorridoMs) / 60000);
          return { symbol: k.split('|')[0], par: k.split('|').slice(1).join('/'), decorridoMin: r2(decorridoMs / 60000, 1), restanteMin: r2(restanteMin, 1) };
        }).sort((a, b) => a.restanteMin - b.restanteMin).slice(0, 10);
        const snaps = lerJsonlComNumeroDeLinha(path.join(compDir, d.label, 'snapshots.jsonl')).map((x) => x.linha as any).slice(-300);
        const curva = snaps.map((s: any, i: number) => ({ ts: s.eventCount || i, capital: s.capital != null ? s.capital : (est.capitalInicial + (s.funding || 0) - (s.custos || 0)) }));
        return { ...d, disponivel: true, vivo, idadeS: hb && hb.ultimoCiclo ? Math.round((Date.now() - hb.ultimoCiclo) / 1000) : null,
          dinheiro: { capitalInicial: est.capitalInicial, capital: r2(est.capitalInicial + net, 2), funding: r2(funding), rendimento: r2(rend), custos: r2(custos), net: r2(net), dias: r2(dias, 2), pctDia: dias > 0 && est.capitalInicial ? r2(net / est.capitalInicial / dias * 100, 3) : 0,
            // META: bybit+bitget quando era 1 par dentro do Champion (6-ex) — 7 posições, 100% de
            // acerto, medido no diário arquivado (arquivo-6-exchanges/estado/spread/diario.jsonl,
            // 2026-08-06 a 2026-08-09, 3,43 dias, capital do Champion US$600 total/6 exchanges).
            // O objetivo declarado é bater ou passar isso agora que bybit+bitget é o foco total.
            metaChampionUsdDia: 1.7918, metaChampionContexto: 'US$6,15 em 7 posições, 100% acerto, 3,43 dias — Champion 6-ex, capital US$600 total' },
          abertas, operacoes,
          pensando: { avaliadas: (est.contadores || {}).avaliadas || 0, abertas: abertas.length, fechadas: (est.contadores || {}).fechadas || 0,
            aguardandoPersistencia: (est.bloqueios || {}).persistencePending || 0, rejeitadasSemEV: (est.bloqueios || {}).evNaoPositivo || 0,
            semCapacidade: ((est.bloqueios || {}).maxPositionsBlocked || 0) + ((est.bloqueios || {}).localBalanceBlocked || 0), candidatosObservados: candidatos },
          curva };
      });
      return enviarJson(res, 200, { ok: true, competidores, geradoEm: Date.now() });
    }

    // ── system health: saúde do motor 2-ex + infra compartilhada (scanner, spot-perp). SÓ LEITURA ──
    // Recriada pro sistema atual depois do arquivamento do bloco "6 exchanges" (ver
    // arquivo-6-exchanges/dashboard-v2-src/pages/SystemHealth.tsx pro antecessor). Nada de
    // listar processos do SO aqui — mesmo padrão do resto da API: lê heartbeat/timestamp
    // embutido nos arquivos que cada componente já escreve, e classifica por idade.
    if (url.pathname === '/api/v2/system-health') {
      const agora = Date.now();
      const r2 = (n: number, c = 4) => Math.round(n * 10 ** c) / 10 ** c;
      const compDir = path.join(ROOT, 'auditoria', 'progression', 'compete', 'snowball-2ex');
      const idadeMin = (ts: number | null | undefined) => ts ? r2((agora - ts) / 60000, 1) : null;
      const mtimeMin = (caminho: string) => { try { return r2((agora - fs.statSync(caminho).mtimeMs) / 60000, 1); } catch { return null; } };
      const sev = (idade: number | null, warnMin: number, lossMin: number): 'ok' | 'warn' | 'loss' =>
        idade == null ? 'loss' : idade > lossMin ? 'loss' : idade > warnMin ? 'warn' : 'ok';

      // 1) motor snowball-2ex: heartbeat + reconciliação ao vivo (mesma fórmula de reconciliar() no forward-lab.cjs)
      const hbMotor = lerJsonSeguro<any>(path.join(compDir, 'heartbeat.json'), null);
      const estMotor = lerJsonSeguro<any>(path.join(compDir, 'estado.json'), null);
      const idadeMotor = idadeMin(hbMotor?.ultimoCiclo);
      let erroReconciliacao: number | null = null;
      if (estMotor) {
        let committed = 0;
        for (const vp of Object.values<any>(estMotor.virtuais || {})) committed += vp.tipo === 'spotperp' ? (vp.footprint || 0) : 2 * (vp.margemPorPerna || 0);
        const somaSaldos = Object.values<number>(estMotor.saldosPorExchange || {}).reduce((s, v) => s + (v || 0), 0);
        erroReconciliacao = r2(Math.abs(somaSaldos + committed - (estMotor.capitalInicial || 0)), 6);
      }

      // 2) scanner compartilhado: watchdog (supervisor.sh) + custódia + coletor (feed que o motor lê)
      const supHb = lerJsonSeguro<any>(path.join(ROOT, 'vigilancia', 'supervisor-heartbeat.json'), null);
      const custodia = lerJsonSeguro<any>(path.join(ROOT, 'vigilancia', 'custodia.json'), null);
      const custodiaRelevante = ['bybit', 'bitget'].map((ex) => custodia?.saude?.[ex]).filter(Boolean);
      const coletorEstado = lerJsonSeguro<any>(path.join(ROOT, 'vigilancia', 'coletor-estado.json'), null);
      const idadeObservacoes = mtimeMin(path.join(ROOT, 'vigilancia', 'arquivo-observacoes.jsonl'));

      // 3) spot-perp: feed do coletor dedicado (roda a cada 10min)
      const idadeSpotperp = mtimeMin(path.join(ROOT, 'vigilancia', 'arquivo-spotperp.jsonl'));

      // 3b) COMPOUNDING: quando o lucro acumulado vira capital deployável de verdade (liquidar()).
      const diarioMotor = path.join(compDir, 'diario.jsonl');
      let ultimaLiquidacao: any = null;
      try {
        const linhas = fs.readFileSync(diarioMotor, 'utf8').trim().split('\n');
        for (let i = linhas.length - 1; i >= 0; i--) {
          let o: any; try { o = JSON.parse(linhas[i]); } catch { continue; }
          if (o.evento === 'settlement') { ultimaLiquidacao = o; break; }
        }
      } catch { /* sem diario ainda */ }
      const proximaLiquidacaoH = estMotor?.ultimoSettlementTs ? r2((estMotor.ultimoSettlementTs + 24 * 3600000 - agora) / 3600000, 1) : null;

      // 4) LUCRO POR EXCHANGE — exigência explícita: nenhuma exchange pode ficar no negativo,
      // as duas têm de dar lucro. fundingPorExchange/custosPorExchange/yieldPorExchange são
      // instrumentação nova (adicionada nesta sessão) — decompõem exatamente os agregados
      // fundingAcum/custosAcum/yieldAcum por exchange; não mudam capital nem reconciliação.
      // Posições abertas ANTES desta instrumentação só passam a contribuir aqui a partir do
      // primeiro ciclo em que o scanner reenxerga cada símbolo com o feed novo (fundingShort/
      // fundingLong) — por isso os primeiros ciclos após o deploy podem mostrar líquido ~0.
      // liquidar() zera fundingPorExchange/custosPorExchange/yieldPorExchange a cada 24h (compounding)
      // — por isso o net por exchange soma a janela aberta atual + netPorExchangeVida, que é o
      // acumulado de todas as liquidações passadas e nunca é zerado (ver forward-lab.cjs liquidar()).
      const lucroPorExchange = estMotor && estMotor.fundingPorExchange
        ? ['bybit', 'bitget'].map((ex) => {
            const funding = estMotor.fundingPorExchange?.[ex] || 0, custos = estMotor.custosPorExchange?.[ex] || 0, yieldE = estMotor.yieldPorExchange?.[ex] || 0;
            const netJanela = funding + yieldE - custos;
            const netVida = estMotor.netPorExchangeVida?.[ex] || 0;
            return { exchange: ex, net: r2(netVida + netJanela), netJanelaAtual: r2(netJanela), netVida: r2(netVida), funding: r2(funding), custos: r2(custos), yield: r2(yieldE) };
          })
        : [];

      const dominios = [
        {
          titulo: 'Motor snowball-2ex',
          itens: [
            { nome: 'Motor (ciclo)', sev: sev(idadeMotor, 10, 15), detalhe: idadeMotor != null ? `último ciclo há ${idadeMotor} min · ${hbMotor.abertas} abertas · sourceStatus=${hbMotor.sourceStatus}` : 'sem heartbeat' },
            { nome: 'Reconciliação (livro-caixa)', sev: erroReconciliacao == null ? 'loss' : erroReconciliacao > 0.01 ? 'loss' : 'ok', detalhe: erroReconciliacao == null ? 'sem estado lido' : `erro = US$ ${erroReconciliacao.toFixed(6)} (limite 0.01) — garantia anti-número-falso` },
            { nome: 'Compounding (liquidação)', sev: 'info', detalhe: proximaLiquidacaoH != null ? `capitalInicial = US$ ${(estMotor?.capitalInicial ?? 0).toFixed(2)} · próxima liquidação em ${proximaLiquidacaoH}h${ultimaLiquidacao ? ` · última: US$ ${ultimaLiquidacao.lucroLiquido >= 0 ? '+' : ''}${ultimaLiquidacao.lucroLiquido} em ${new Date(ultimaLiquidacao.ts).toLocaleString('pt-BR')}` : ' · nenhuma liquidação ainda'}` : 'desligado' },
          ],
        },
        {
          titulo: 'Lucro por exchange (bybit vs bitget — as duas têm de dar lucro)',
          itens: lucroPorExchange.length ? lucroPorExchange.map((e) => ({
            nome: `${e.exchange}`, sev: e.net >= 0 ? 'ok' : 'warn',
            detalhe: `net vitalício US$ ${e.net.toFixed(4)} (liquidado ${e.netVida >= 0 ? '+' : ''}${e.netVida.toFixed(4)} + janela atual ${e.netJanelaAtual >= 0 ? '+' : ''}${e.netJanelaAtual.toFixed(4)}: funding ${e.funding >= 0 ? '+' : ''}${e.funding.toFixed(4)} + yield +${e.yield.toFixed(4)} − custos ${e.custos.toFixed(4)})`,
          })) : [{ nome: 'sem dado ainda', sev: 'info', detalhe: 'instrumentação nova — aguardando o motor reavaliar as posições com o feed enriquecido' }],
        },
        {
          titulo: 'Scanner (infraestrutura compartilhada — o motor depende disto pra ter dado)',
          itens: [
            { nome: 'Watchdog (supervisor.sh)', sev: !supHb ? 'loss' : (supHb.processesMissing > 0 ? 'loss' : sev(idadeMin(supHb.lastLoopCompleted), 5, 15)), detalhe: supHb ? `${supHb.processesChecked} processos · ${supHb.processesMissing} ausentes · última varredura há ${idadeMin(supHb.lastLoopCompleted)} min` : 'sem heartbeat' },
            { nome: 'Custódia (bybit + bitget)', sev: custodiaRelevante.length && custodiaRelevante.every((c) => c.nivel === 'ok') ? sev(idadeMin(custodia.verificadoEm), 30, 60) : 'warn', detalhe: custodiaRelevante.length ? custodiaRelevante.map((c) => `${c.id}=${c.nivel}`).join(' · ') + ` · há ${idadeMin(custodia.verificadoEm)} min` : 'sem dado' },
            { nome: 'Coletor (feed arquivo-observacoes)', sev: sev(idadeObservacoes ?? idadeMin(coletorEstado?.ultimoTsHistorico), 15, 45), detalhe: idadeObservacoes != null ? `feed atualizado há ${idadeObservacoes} min · ${coletorEstado?.totalObservacoes ?? '?'} observações` : 'feed não encontrado' },
          ],
        },
        {
          titulo: 'Spot-perp',
          itens: [
            { nome: 'Coletor spot-perp (feed)', sev: sev(idadeSpotperp, 25, 60), detalhe: idadeSpotperp != null ? `feed atualizado há ${idadeSpotperp} min` : 'feed não encontrado' },
          ],
        },
        {
          titulo: 'Utilização de capital (motor)',
          itens: estMotor ? [
            { nome: 'Bloqueios do ciclo (cross)', sev: 'info', detalhe: `persistência ${estMotor.bloqueios?.persistencePending ?? 0} · sem EV ${estMotor.bloqueios?.evNaoPositivo ?? 0} · sem capacidade ${(estMotor.bloqueios?.maxPositionsBlocked ?? 0) + (estMotor.bloqueios?.localBalanceBlocked ?? 0)}` },
            { nome: 'Bloqueios do ciclo (spot-perp)', sev: (estMotor.bloqueios?.spotperpSemCapital ?? 0) > 0 ? 'warn' : 'ok', detalhe: `sem capital: ${estMotor.bloqueios?.spotperpSemCapital ?? 0} · sem payback: ${estMotor.bloqueios?.spotperpSemPayback ?? 0} · aguardando persistência: ${estMotor.bloqueios?.spotperpPersistencePending ?? 0}` },
            { nome: 'Bloqueios do ciclo (settlement-capture)', sev: 'info', detalhe: `sem payback (1 período): ${estMotor.bloqueios?.captureSemPayback ?? 0} · sem capital: ${(estMotor.bloqueios?.captureLocalBalanceBlocked ?? 0) + (estMotor.bloqueios?.captureReserveBlocked ?? 0)}` },
          ] : [],
        },
        {
          titulo: 'Dashboard',
          itens: [
            { nome: 'API (porta 5184)', sev: 'ok', detalhe: `respondendo · ${heartbeat.totalRequisicoes} requisições · uptime ${r2((Date.now() - heartbeat.startedAt) / 60000, 1)} min` },
          ],
        },
      ];
      return enviarJson(res, 200, { ok: true, geradoEm: agora, dominios });
    }

    // ── spot-perp: oportunidades reais (cash-and-carry no perp) do coletor. SÓ LEITURA ──
    if (url.pathname === '/api/v2/spotperp') {
      const feed = path.join(ROOT, 'vigilancia', 'arquivo-spotperp.jsonl');
      let ops: any[] = [];
      try {
        const st = fs.statSync(feed);
        const N = Math.min(st.size, 500 * 1024);
        const fd = fs.openSync(feed, 'r'); const buf = Buffer.alloc(N);
        fs.readSync(fd, buf, 0, N, st.size - N); fs.closeSync(fd);
        const parsed = buf.toString('utf8').split('\n').filter(Boolean)
          .map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean) as any[];
        const ultimoTs = parsed.reduce((m, o) => Math.max(m, o.ts || 0), 0);
        ops = parsed.filter((o) => o.ts === ultimoTs);
      } catch { /* feed pode não existir ainda */ }
      const r2 = (n: number, c = 4) => Math.round(n * 10 ** c) / 10 ** c;
      ops.sort((a, b) => (b.evDiaBruto || 0) - (a.evDiaBruto || 0));
      const porExchange: Record<string, number> = {};
      for (const o of ops) porExchange[o.exchange] = (porExchange[o.exchange] || 0) + 1;
      const top = ops.slice(0, 20).map((o) => ({ sym: o.sym, exchange: o.exchange,
        pctDia: r2((o.fundingDia || 0) * 100, 3), fundingIntervalo: r2((o.funding || 0) * 100, 4), iv: o.iv,
        paybackDias: r2(o.paybackDias || 0, 1), vol: o.vol }));
      return enviarJson(res, 200, { ok: true, total: ops.length, porExchange, geradoEm: ops[0]?.ts || null, top });
    }

    enviarJson(res, 404, { ok: false, erro: 'rota não encontrada', rota: url.pathname });
  } catch (e) {
    log(`ERRO não tratado em ${url.pathname}: ${(e as Error).stack}`);
    enviarJson(res, 500, { ok: false, erro: (e as Error).message });
  }
});

servidor.listen(PORTA, () => {
  log(`Dashboard 2.0 API no ar — porta ${PORTA}, PID ${process.pid}, ROOT=${ROOT}`);
  log('SOMENTE LEITURA — nenhuma escrita em estado do Snowball acontece neste processo.');
  salvarHeartbeat();
  setInterval(salvarHeartbeat, 10_000);
});

servidor.on('error', (err: NodeJS.ErrnoException) => {
  if (err.code === 'EADDRINUSE') {
    log(`ERRO FATAL: porta ${PORTA} já está em uso — outra instância viva? Não sobe uma segunda.`);
    registrarDiagnosticoQueda('porta_ocupada', { stderrFinal: err.message });
    process.exit(1);
  }
  log(`ERRO FATAL no servidor: ${err.stack}`);
  registrarDiagnosticoQueda('erro_nao_tratado', { stderrFinal: err.message, stack: err.stack ?? null });
  process.exit(1);
});

process.on('SIGINT', () => { log('shutdown limpo (SIGINT)'); registrarDiagnosticoQueda('shutdown_limpo', { signal: 'SIGINT' }); process.exit(0); });
process.on('SIGTERM', () => { log('shutdown limpo (SIGTERM)'); registrarDiagnosticoQueda('shutdown_limpo', { signal: 'SIGTERM' }); process.exit(0); });
process.on('uncaughtException', (err) => {
  log(`uncaughtException: ${err.stack}`);
  registrarDiagnosticoQueda('erro_nao_tratado', { stderrFinal: err.message, stack: err.stack ?? null });
  // nunca segue rodando depois de um estado potencialmente corrompido — o
  // supervisor detecta o PID morto e decide se reinicia (com limite de
  // tentativas), igual ao padrão já usado em scripts/supervisor-profit-lab
  process.exit(1);
});
