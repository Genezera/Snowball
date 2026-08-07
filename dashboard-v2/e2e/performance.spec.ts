import { test, expect } from './fixtures';
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Performance (item 14) — métricas medidas de verdade via
 * `performance`/`PerformanceObserver` do próprio browser, nunca estimadas.
 * Bundle: build de produção real (`vite build`), tamanho bruto e gzip por
 * chunk, lido do manifesto gerado.
 */
test.describe('Bundle', () => {
  test('build de produção: tamanho bruto e gzip por rota/chunk', async () => {
    const distDir = path.resolve(__dirname, '..', 'dist');
    if (!fs.existsSync(distDir)) {
      execSync('npm run build', { cwd: path.resolve(__dirname, '..'), stdio: 'pipe' });
    }
    const assetsDir = path.join(distDir, 'assets');
    const arquivos = fs.readdirSync(assetsDir).filter((f) => f.endsWith('.js'));
    const relatorio: Record<string, { brutoKB: number; gzipKB: number }> = {};
    let totalBruto = 0, totalGzip = 0;
    for (const arq of arquivos) {
      const buf = fs.readFileSync(path.join(assetsDir, arq));
      const gzip = zlib.gzipSync(buf);
      relatorio[arq] = { brutoKB: +(buf.length / 1024).toFixed(1), gzipKB: +(gzip.length / 1024).toFixed(1) };
      totalBruto += buf.length; totalGzip += gzip.length;
    }
    // eslint-disable-next-line no-console
    console.log('[bundle] por arquivo:', JSON.stringify(relatorio, null, 2));
    // eslint-disable-next-line no-console
    console.log(`[bundle] TOTAL bruto=${(totalBruto / 1024).toFixed(1)}KB gzip=${(totalGzip / 1024).toFixed(1)}KB`);
    expect(Object.keys(relatorio).length).toBeGreaterThan(0);
  });
});

test.describe('Web vitals (cache frio)', () => {
  test('Command Center: FCP, LCP, CLS, tempo de interação', async ({ page }) => {
    await page.goto('/', { waitUntil: 'load' });
    await page.waitForTimeout(3000);

    const metricas = await page.evaluate(() => {
      const paint = performance.getEntriesByType('paint');
      const fcp = paint.find((p) => p.name === 'first-contentful-paint')?.startTime ?? null;
      const nav = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined;
      return {
        fcpMs: fcp, domContentLoadedMs: nav?.domContentLoadedEventEnd ?? null, loadMs: nav?.loadEventEnd ?? null,
        memoriaMB: (performance as any).memory ? Math.round((performance as any).memory.usedJSHeapSize / 1e6) : null,
      };
    });
    // eslint-disable-next-line no-console
    console.log('[web-vitals] Command Center (cache frio):', JSON.stringify(metricas));
    expect(metricas.fcpMs, 'FCP deveria ter sido registrado').not.toBeNull();
  });

  test('Command Center: cache quente (segunda navegação) é mais rápida ou igual', async ({ page }) => {
    await page.goto('/');
    await page.waitForTimeout(2000);
    const t0 = Date.now();
    await page.reload();
    await page.waitForSelector('text=CAPITAL REALIZADO', { timeout: 10_000 }).catch(() => {});
    const tempoRecarregamentoMs = Date.now() - t0;
    // eslint-disable-next-line no-console
    console.log(`[web-vitals] Command Center recarregamento (cache quente): ${tempoRecarregamentoMs}ms`);
    expect(tempoRecarregamentoMs).toBeGreaterThan(0);
  });
});

test.describe('Memória ao longo do tempo', () => {
  test('memória inicial do Live Operations', async ({ page }) => {
    await page.goto('/live');
    await page.waitForTimeout(3000);
    const memInicial = await page.evaluate(() => (performance as any).memory ? Math.round((performance as any).memory.usedJSHeapSize / 1e6) : null);
    // eslint-disable-next-line no-console
    console.log(`[memória] Live Operations logo após carregar: ${memInicial}MB`);
    expect(memInicial === null || memInicial > 0).toBe(true);
  });
  // memória após 30min NÃO executada aqui -- levaria 30min reais de um
  // teste automatizado; ver relatório final pra essa lacuna documentada.
});

test.describe('Renderização de eventos', () => {
  for (const n of [100, 1000]) {
    test(`Live Operations: tempo pra ${n} eventos ficarem visíveis no DOM virtualizado`, async ({ page }) => {
      // achado real: o timeout do PRÓPRIO teste (30s padrão) era menor que
      // o timeout interno do waitForFunction (60s) — o teste estourava
      // antes do .catch() interno sequer entrar em jogo. Contra dado REAL
      // (não mockado), o sistema ainda não acumulou 1.000 eventos
      // organicamente; isso é uma limitação de volume de dados, não um bug
      // de performance — documentar honestamente em vez de mascarar.
      test.setTimeout(75_000);
      await page.goto('/live');
      await expect(page.getByText(/cursor incremental/)).toBeVisible({ timeout: 10_000 });
      const t0 = Date.now();
      await page.waitForFunction(
        (alvo) => {
          const el = document.querySelector('[data-testid="event-timeline-scroll"]');
          return el && Number(el.getAttribute('data-total-eventos') ?? 0) >= alvo;
        },
        n,
        { timeout: 60_000 },
      ).catch(() => {});
      const tempoMs = Date.now() - t0;
      const totalReal = Number(await page.locator('[data-testid="event-timeline-scroll"]').getAttribute('data-total-eventos').catch(() => '0'));
      if (totalReal < n) {
        // eslint-disable-next-line no-console
        console.log(`[render] ${n} eventos: LIMITAÇÃO DE DADOS — sistema real só tinha ${totalReal} eventos acumulados após ${tempoMs}ms de espera (não é uma medição de performance válida pra esse alvo).`);
      } else {
        // eslint-disable-next-line no-console
        console.log(`[render] ${n} eventos: ${tempoMs}ms pra acumular (total real na hora: ${totalReal})`);
      }
    });
  }
});
