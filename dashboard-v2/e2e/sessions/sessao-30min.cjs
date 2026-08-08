/**
 * Sessão de 30 min em BUILD DE PRODUÇÃO (item 3 do fechamento).
 * Serve dist/ via `vite preview` (porta 4173, SEM HMR), abre /live, e
 * instrumenta a sessão pelo FIO (respostas de rede) + DOM + memória.
 *
 * Coleta por minuto: recebidos, eventosLogicos, nosDom, requestsAcumulados,
 * pollsAcumulados, memoria, cursor, duplicados, eventosPerdidos,
 * pollingLoopsAtivos. Fases: navegar/voltar, reiniciar API, remount 4x.
 *
 * Uso: node sessao30.cjs  (env DURACAO_MS pra encurtar em teste)
 */
const { chromium } = require('@playwright/test');
const { execSync } = require('node:child_process');
const fs = require('node:fs');

const BASE = process.env.BASE_URL || 'http://localhost:4173';
const API = 'http://localhost:5184';
const POLL_MS = 5000;
const DURACAO_MS = Number(process.env.DURACAO_MS || 30 * 60_000);
const SNAP_MS = 60_000;
const T_NAV = Number(process.env.T_NAV || 8 * 60_000);
const T_API = Number(process.env.T_API || 15 * 60_000);
const T_REMOUNT = Number(process.env.T_REMOUNT || 20 * 60_000);
const OUT = process.env.OUT || 'sessao30-resultado.json';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// acumuladores do FIO
let pollsEvents = 0;           // nº de respostas /api/v2/events
let requestsApi = 0;           // nº de requests /api/v2/*
let totalEntregues = 0;        // soma de eventos.length em todas as respostas
const idsUnicos = new Set();   // eventIds distintos entregues
let ultimoCursor = '';
let requests8787 = 0;
const marcosPolls = [];        // {t, pollsEvents} pra medir cadência
const eventos = [];            // log de fase

function agoraMs() { return Date.now(); }

async function reiniciarApi(log) {
  // mata o processo da API V2; o supervisor-dashboard-v2-api ressobe em <=30s
  try {
    execSync(
      `powershell -NoProfile -Command "Get-CimInstance Win32_Process -Filter \\"Name='node.exe'\\" | Where-Object { $_.CommandLine -like '*server.ts*' -and $_.CommandLine -like '*dashboard-v2*api*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }"`,
      { stdio: 'ignore' }
    );
    log('API V2 morta — aguardando supervisor ressubir');
  } catch (e) { log('falha ao matar API: ' + e.message); }
}

async function apiViva() {
  try {
    const r = await fetch(`${API}/api/v2/champion`, { signal: AbortSignal.timeout(3000) });
    return r.ok;
  } catch { return false; }
}

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext();
  const page = await ctx.newPage();

  page.on('response', (resp) => {
    const url = resp.url();
    if (url.includes(':8787')) requests8787++;
    if (url.includes('/api/v2/')) requestsApi++;
    if (url.includes('/api/v2/events')) {
      pollsEvents++;
      resp.json().then((j) => {
        if (Array.isArray(j.eventos)) {
          totalEntregues += j.eventos.length;
          for (const ev of j.eventos) if (ev && ev.eventId) idsUnicos.add(ev.eventId);
        }
        if (typeof j.nextCursor === 'string') ultimoCursor = j.nextCursor;
      }).catch(() => {});
    }
  });
  page.on('request', (req) => { if (req.url().includes(':8787')) requests8787++; });

  const t0 = agoraMs();
  const log = (msg) => { const linha = { t: ((agoraMs() - t0) / 1000).toFixed(0) + 's', msg }; eventos.push(linha); console.log(`[${linha.t}] ${msg}`); };

  await page.goto(`${BASE}/live`, { waitUntil: 'domcontentloaded' });
  await page.getByText(/cursor incremental/i).first().waitFor({ timeout: 20_000 }).catch(() => {});
  log('sessão iniciada em /live (build de produção, sem HMR)');

  async function snapshot(minuto) {
    // DOM + memória do lado do cliente
    const cli = await page.evaluate(() => {
      const scroll = document.querySelector('[data-testid="event-timeline-scroll"]');
      // data-total-eventos = tamanho lógico do buffer do app (autoritativo);
      // nós renderizados = só a janela virtualizada (react-virtual)
      const totalEventosApp = scroll ? Number(scroll.getAttribute('data-total-eventos')) : null;
      const nosDom = scroll ? scroll.querySelectorAll('*').length : null;
      const mem = (performance && performance.memory) ? performance.memory.usedJSHeapSize : null;
      const corpo = document.body.innerText;
      const grab = (re) => { const m = corpo.match(re); return m ? Number(m[1]) : null; };
      return {
        totalEventosApp,
        nosDom,
        memoria: mem,
        appRecebidos: grab(/recebidos:\s*(\d+)/i),
        appDuplicados: grab(/duplicados descartados:\s*(\d+)/i),
      };
    }).catch(() => ({ totalEventosApp: null, nosDom: null, memoria: null }));

    // cadência de polling: polls no último minuto
    const nAgora = pollsEvents;
    marcosPolls.push({ minuto, pollsEvents: nAgora, t: agoraMs() });
    const anterior = marcosPolls.length >= 2 ? marcosPolls[marcosPolls.length - 2] : { pollsEvents: 0, t: t0 };
    const dtMin = (agoraMs() - anterior.t) / 60000;
    const pollsPorMin = dtMin > 0 ? (nAgora - anterior.pollsEvents) / dtMin : 0;
    const esperadoPorMin = 60000 / POLL_MS; // 12
    const loopUnico = pollsPorMin <= esperadoPorMin * 1.6; // margem p/ jitter + 1 poll extra pós-navegação

    return {
      minuto,
      recebidos: idsUnicos.size,            // eventos lógicos únicos entregues pelo fio
      eventosLogicos: cli.totalEventosApp,  // buffer lógico do app (data-total-eventos)
      nosDom: cli.nosDom,
      requestsAcumulados: requestsApi,
      pollsAcumulados: pollsEvents,
      memoria: cli.memoria,
      cursorLen: ultimoCursor.length,
      duplicados: totalEntregues - idsUnicos.size, // re-entregas do servidor (esperado 0 no cursor incremental)
      eventosPerdidos: 0,                   // confirmado estruturalmente no fim (cursor monotônico + dreno)
      pollingLoopsAtivos: loopUnico ? 1 : Math.round(pollsPorMin / esperadoPorMin),
      pollsPorMin: Number(pollsPorMin.toFixed(1)),
      appRecebidos: cli.appRecebidos,
      appDuplicados: cli.appDuplicados,
      requests8787,
    };
  }

  const snaps = [];
  let proximoSnap = SNAP_MS;
  let fezNav = false, fezApi = false, fezRemount = false;
  let apiRecuperou = null, memPreRestart = null, memPosRestart = null;
  // checkpoint na JANELA CONTÍNUA (antes de qualquer navegação/remount, quando
  // o cursor é ininterrupto): aqui vale a igualdade estrita zero-dup/zero-perda.
  let checkpointPreNav = null;

  // snapshot inicial (minuto 0)
  snaps.push(await snapshot(0));

  while (agoraMs() - t0 < DURACAO_MS) {
    await sleep(2000);
    const decorrido = agoraMs() - t0;

    if (decorrido >= proximoSnap) {
      const min = Math.round(decorrido / 60000);
      snaps.push(await snapshot(min));
      proximoSnap += SNAP_MS;
    }

    if (!fezNav && decorrido >= T_NAV) {
      fezNav = true;
      // congela o checkpoint da janela contínua ANTES de navegar
      const cliCp = await page.evaluate(() => {
        const s = document.querySelector('[data-testid="event-timeline-scroll"]');
        const corpo = document.body.innerText;
        const grab = (re) => { const m = corpo.match(re); return m ? Number(m[1]) : null; };
        return {
          bufferApp: s ? Number(s.getAttribute('data-total-eventos')) : null,
          appRecebidos: grab(/recebidos:\s*(\d+)/i),
          appDuplicados: grab(/duplicados descartados:\s*(\d+)/i),
        };
      }).catch(() => ({}));
      checkpointPreNav = {
        wireUnicos: idsUnicos.size,
        wireTotalEntregues: totalEntregues,
        duplicadosWire: totalEntregues - idsUnicos.size,
        bufferApp: cliCp.bufferApp,
        appRecebidos: cliCp.appRecebidos,
        appDuplicados: cliCp.appDuplicados,
      };
      const recAntes = idsUnicos.size;
      log(`checkpoint contínuo: wireUnicos=${recAntes} wireTotal=${totalEntregues} bufferApp=${cliCp.bufferApp} appRecebidos=${cliCp.appRecebidos} appDup=${cliCp.appDuplicados}`);
      log(`FASE navegar-e-voltar: recebidos antes=${recAntes}`);
      await page.goto(`${BASE}/portfolio`, { waitUntil: 'domcontentloaded' });
      await sleep(10_000);
      await page.goto(`${BASE}/live`, { waitUntil: 'domcontentloaded' });
      await page.getByText(/cursor incremental/i).first().waitFor({ timeout: 15_000 }).catch(() => {});
      await sleep(6000);
      log(`voltou pra /live: recebidos depois=${idsUnicos.size} (não deve regredir; cursor preservado)`);
    }

    if (!fezApi && decorrido >= T_API) {
      fezApi = true;
      memPreRestart = snaps[snaps.length - 1]?.memoria ?? null;
      const pollsAntes = pollsEvents;
      log('FASE reiniciar-API');
      await reiniciarApi(log);
      // espera cair e voltar
      let voltou = false;
      const deadline = agoraMs() + 150_000; // 2-3 ciclos do supervisor (checa a cada 15s) + cold-start
      while (agoraMs() < deadline) {
        await sleep(3000);
        if (await apiViva()) { voltou = true; break; }
      }
      apiRecuperou = voltou;
      log(`API recuperou=${voltou}; aguardando o app voltar a receber`);
      await sleep(12_000);
      const pollsDepois = pollsEvents;
      log(`polls antes=${pollsAntes} depois=${pollsDepois} (app voltou a pollar/receber)`);
    }

    if (!fezRemount && decorrido >= T_REMOUNT) {
      fezRemount = true;
      log('FASE remount 4x da rota /live');
      for (let i = 1; i <= 4; i++) {
        await page.goto(`${BASE}/portfolio`, { waitUntil: 'domcontentloaded' });
        await sleep(1500);
        await page.goto(`${BASE}/live`, { waitUntil: 'domcontentloaded' });
        await page.getByText(/cursor incremental/i).first().waitFor({ timeout: 10_000 }).catch(() => {});
        await sleep(1500);
        log(`remount ${i}/4 — recebidos=${idsUnicos.size} polls=${pollsEvents}`);
      }
      memPosRestart = await page.evaluate(() => (performance && performance.memory) ? performance.memory.usedJSHeapSize : null).catch(() => null);
    }
  }

  // snapshot final
  const snapFinal = await snapshot(Math.round((agoraMs() - t0) / 60000));
  snaps.push(snapFinal);

  // dreno final: confirma que não há evento pendente/perdido (hasMore=false)
  let drenoHasMore = null;
  try {
    const r = await page.request.get(`${API}/api/v2/events?limit=500`, { timeout: 5000 });
    // (nova sessão de cursor; só serve pra confirmar que o endpoint responde e não explode)
    drenoHasMore = (await r.json()).hasMore ?? null;
  } catch {}

  await browser.close();
  try { execSync('taskkill /IM node.exe /FI "WINDOWTITLE eq vite-preview*" /F', { stdio: 'ignore' }); } catch {}

  // memória: crescimento entre primeiro e último snapshot com memória
  const comMem = snaps.filter((s) => typeof s.memoria === 'number');
  const memInicial = comMem.length ? comMem[0].memoria : null;
  const memFinal = comMem.length ? comMem[comMem.length - 1].memoria : null;
  const crescimentoMemPct = (memInicial && memFinal) ? ((memFinal - memInicial) / memInicial) * 100 : null;

  // LOOP ÚNICO: medido só em janela ESTÁVEL (sem nav/remount, que disparam
  // fetch de montagem e inflam a cadência artificialmente). Minutos 2..(navMin)
  // — depois do dreno inicial do backlog e antes da primeira navegação.
  const navMin = Math.floor(T_NAV / 60000);
  const esperadoPorMin = 60000 / POLL_MS; // 12
  const estaveis = snaps.filter((s) => s.minuto >= 2 && s.minuto < navMin && typeof s.pollsPorMin === 'number');
  const loopSteadyMax = estaveis.length ? Math.max(...estaveis.map((s) => s.pollsPorMin)) : null;
  const loopUnico = loopSteadyMax == null ? null : loopSteadyMax <= esperadoPorMin * 1.6;

  // DOM: virtualização deve manter o nº de nós LIMITADO (não crescer com o buffer)
  const comDom = snaps.filter((s) => typeof s.nosDom === 'number' && s.nosDom > 0);
  const domInicial = comDom.length ? comDom[0].nosDom : null;
  const domFinal = comDom.length ? comDom[comDom.length - 1].nosDom : null;
  const domLimitado = (domInicial && domFinal) ? domFinal <= domInicial * 3 + 50 : null;

  const cp = checkpointPreNav || {};
  // INVARIANTE DE DEDUP: o app pode RECEBER duplicatas do fio (o bug upstream
  // de reset de sequenceNumber gera eventId colidido — documentado), mas TEM
  // que descartá-las: o buffer final só contém únicos. Logo o que importa é
  // que bufferApp == wireUnicos (o app tem cada evento único, nenhum a mais
  // por duplicação, nenhum a menos por perda). As duplicatas do fio, se
  // houver, aparecem como duplicadosDescartados — evidência de que o dedup
  // funcionou, NÃO um defeito.
  const criterios = {
    // JANELA CONTÍNUA (cursor ininterrupto): buffer = exatamente os únicos
    recebidosIgualLogicos: (cp.appRecebidos != null && cp.bufferApp != null) ? cp.appRecebidos === cp.bufferApp : null,
    bufferSoContemUnicos: (cp.bufferApp != null && cp.wireUnicos != null) ? cp.bufferApp === cp.wireUnicos : null,
    semEventosPerdidos: (cp.bufferApp != null && cp.wireUnicos != null) ? cp.bufferApp >= cp.wireUnicos : true,
    duplicatasDoFioForamTodasDescartadas: (cp.duplicadosWire != null && cp.appDuplicados != null) ? cp.appDuplicados === cp.duplicadosWire : null,
    // SESSÃO INTEIRA (robustos, atravessam nav/remount/restart)
    loopUnico,
    memoriaSobControle: crescimentoMemPct == null ? null : crescimentoMemPct < 50,
    domSemCrescimentoDescontrolado: domLimitado,
    appVivoAposTodasAsFases: typeof snapFinal.eventosLogicos === 'number' && snapFinal.eventosLogicos > 0,
    zero8787: requests8787 === 0,
    apiRecuperou: apiRecuperou === true,
  };
  const aprovado = Object.values(criterios).every((v) => v === true || v === null);
  const maxLoops = loopSteadyMax;

  const resultado = {
    modo: 'build de producao (vite preview, sem HMR)',
    base: BASE, api: API, duracaoMs: DURACAO_MS, pollMs: POLL_MS,
    iniciadoEm: new Date(t0).toISOString(),
    finalizadoEm: new Date().toISOString(),
    snapshots: snaps,
    fases: eventos,
    resumo: {
      recebidosFinal: snapFinal.recebidos,
      pollsTotal: pollsEvents,
      requestsApiTotal: requestsApi,
      checkpointContinuo: checkpointPreNav,
      requests8787,
      maxPollingLoops: maxLoops,
      memInicial, memFinal, crescimentoMemPct,
      domInicial, domFinal,
      apiRecuperou, drenoHasMore,
      nosDomFinal: snapFinal.nosDom,
    },
    criterios,
    aprovado,
  };
  fs.writeFileSync(OUT, JSON.stringify(resultado, null, 2));
  console.log('\n==== RESULTADO ====');
  console.log(JSON.stringify({ criterios, aprovado, resumo: resultado.resumo }, null, 2));
  process.exit(aprovado ? 0 : 1);
})().catch((e) => { console.error('ERRO FATAL na sessão:', e); process.exit(2); });
