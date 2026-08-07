import { test, expect } from './fixtures';

/**
 * Screenshots de regressão visual (item 13) — versionados via
 * `toHaveScreenshot` (Playwright grava em `e2e/visual-regression.spec.ts-snapshots/`
 * na primeira execução; comparações seguintes usam a tolerância definida em
 * `playwright.config.ts` — `maxDiffPixelRatio: 0.02`, 2% de diferença
 * tolerada, nunca aprovação automática de diferença grande).
 */
const PAGINAS = [
  { rota: '/', nome: 'command-center' },
  { rota: '/champion', nome: 'champion-view' },
  { rota: '/live', nome: 'live-operations' },
  { rota: '/capture', nome: 'settlement-capture' },
  { rota: '/costs', nome: 'cost-intelligence' },
  { rota: '/risk', nome: 'risk-center' },
];

test.describe('Screenshots — desktop', () => {
  test.use({ viewport: { width: 1440, height: 900 } });
  for (const { rota, nome } of PAGINAS) {
    test(`${nome} — desktop`, async ({ page }) => {
      await page.goto(rota);
      await page.waitForTimeout(2500);
      await expect(page).toHaveScreenshot(`${nome}-desktop.png`, { fullPage: true, animations: 'disabled' });
    });
  }
});

test.describe('Screenshots — mobile', () => {
  test.use({ viewport: { width: 390, height: 844 } });
  for (const { rota, nome } of PAGINAS) {
    test(`${nome} — mobile`, async ({ page }) => {
      await page.goto(rota);
      await page.waitForTimeout(2500);
      await expect(page).toHaveScreenshot(`${nome}-mobile.png`, { fullPage: true, animations: 'disabled' });
    });
  }
});

test.describe('Screenshots — estados', () => {
  test('loading (throttle da API)', async ({ page }) => {
    await page.route('**/api/v2/champion', async (route) => {
      await new Promise((r) => setTimeout(r, 3000));
      await route.continue();
    });
    const navegando = page.goto('/champion');
    await page.waitForTimeout(300);
    await expect(page).toHaveScreenshot('champion-loading.png', { animations: 'disabled' });
    await navegando;
  });

  test('error (API V2 offline)', async ({ page }) => {
    await page.route('**/api/v2/champion', (route) => route.abort('connectionrefused'));
    await page.goto('/champion');
    await page.waitForTimeout(2000);
    await expect(page).toHaveScreenshot('champion-error.png', { animations: 'disabled' });
  });

  test('corrupted (JSON inválido)', async ({ page }) => {
    await page.route('**/api/v2/champion', (route) => route.fulfill({ status: 200, body: 'isto não é json{{{' }));
    await page.goto('/champion');
    await page.waitForTimeout(2000);
    await expect(page).toHaveScreenshot('champion-corrupted.png', { animations: 'disabled' });
  });

  test('reduced motion — Champion View', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/champion');
    await page.waitForTimeout(2000);
    await expect(page).toHaveScreenshot('champion-reduced-motion.png', { animations: 'disabled' });
  });

  test('tema escuro — Command Center (o design é single-theme dark por padrão)', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.goto('/');
    await page.waitForTimeout(2000);
    await expect(page).toHaveScreenshot('command-center-dark.png', { animations: 'disabled' });
  });
});
