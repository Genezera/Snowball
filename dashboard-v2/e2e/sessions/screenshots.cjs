/**
 * Manifesto de screenshots (item 7) — 5 páginas × 3 resoluções = 15 capturas.
 * Roda contra o frontend vivo (5183). Gera os PNGs em docs/screenshots/ e um
 * manifesto JSON com página/resolução/arquivo/commit/capturadoEm/resultado.
 *
 * Uso: node e2e/sessions/screenshots.cjs
 */
const { chromium } = require('@playwright/test');
const { execSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const BASE = process.env.BASE_URL || 'http://localhost:5183';
const OUTDIR = path.join(process.cwd(), 'docs', 'screenshots');
const MANIFESTO = path.join(OUTDIR, 'manifesto.json');

const PAGINAS = [
  { nome: 'Command Center', rota: '/', heading: /Command Center/i, slug: 'command-center' },
  { nome: 'Champion', rota: '/champion', heading: /^Champion$/i, slug: 'champion' },
  { nome: 'Live Operations', rota: '/live', heading: /Live Operations/i, slug: 'live-operations' },
  { nome: 'Opportunity Map', rota: '/opportunities', heading: /Opportunity Map/i, slug: 'opportunity-map' },
  { nome: 'Portfolio', rota: '/portfolio', heading: /^Portfolio$/i, slug: 'portfolio' },
];
const RESOLUCOES = [
  { w: 1366, h: 768 },
  { w: 1920, h: 1080 },
  { w: 2560, h: 1440 },
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  fs.mkdirSync(OUTDIR, { recursive: true });
  const commit = execSync('git rev-parse HEAD').toString().trim();
  const browser = await chromium.launch();
  const manifesto = [];

  for (const res of RESOLUCOES) {
    const ctx = await browser.newContext({ viewport: { width: res.w, height: res.h }, deviceScaleFactor: 1 });
    const page = await ctx.newPage();
    for (const p of PAGINAS) {
      const arquivo = `${p.slug}-${res.w}x${res.h}.png`;
      const destino = path.join(OUTDIR, arquivo);
      let resultado = 'ok';
      let detalhe = '';
      try {
        await page.goto(`${BASE}${p.rota}`, { waitUntil: 'domcontentloaded' });
        // espera o heading esperado — prova que a página montou de verdade
        try {
          await page.getByRole('heading', { name: p.heading }).first().waitFor({ timeout: 12_000 });
        } catch {
          resultado = 'heading-nao-encontrado';
          detalhe = 'screenshot capturado mesmo assim, mas o heading esperado não apareceu no tempo';
        }
        await sleep(1800); // deixa gráficos/curvas renderizarem
        await page.screenshot({ path: destino, fullPage: true });
      } catch (e) {
        resultado = 'erro';
        detalhe = e.message;
      }
      manifesto.push({
        pagina: p.nome, resolucao: `${res.w}x${res.h}`, arquivo,
        commit, capturadoEm: new Date().toISOString(), resultado, detalhe: detalhe || undefined,
      });
      console.log(`${resultado === 'ok' ? 'OK ' : '!! '} ${p.nome} @ ${res.w}x${res.h} -> ${arquivo}${detalhe ? ' (' + detalhe + ')' : ''}`);
    }
    await ctx.close();
  }
  await browser.close();

  fs.writeFileSync(MANIFESTO, JSON.stringify({
    geradoEm: new Date().toISOString(), commit, base: BASE,
    total: manifesto.length, ok: manifesto.filter((m) => m.resultado === 'ok').length,
    itens: manifesto,
  }, null, 2));
  const ok = manifesto.filter((m) => m.resultado === 'ok').length;
  console.log(`\n${ok}/${manifesto.length} capturas OK — manifesto em docs/screenshots/manifesto.json`);
  process.exit(ok === manifesto.length ? 0 : 1);
})().catch((e) => { console.error('ERRO FATAL screenshots:', e); process.exit(2); });
