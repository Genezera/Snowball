import { defineConfig, devices } from '@playwright/test';

/**
 * Dashboard 2.0 — Quality Gate de Interface. Roda contra os processos JÁ
 * VIVOS (frontend :5183, API V2 :5184) — nunca inicia servidor próprio,
 * nunca toca a porta 8787. `webServer` deliberadamente OMITIDO: os
 * supervisores dedicados (scripts/supervisor-dashboard-v2-*) já mantêm os
 * dois no ar; duplicar aqui criaria uma segunda instância brigando pelo
 * lock (ver Gate de Confiabilidade Operacional, etapa anterior).
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: false, // barato pra depurar; a suíte inteira ainda roda em minutos
  forbidOnly: !!process.env.CI,
  retries: 0, // falha de verdade nunca deve ser mascarada por retry
  workers: 1,
  reporter: [['html', { outputFolder: 'e2e-report', open: 'never' }], ['list']],
  timeout: 30_000,
  expect: { timeout: 8_000, toHaveScreenshot: { maxDiffPixelRatio: 0.02 } },
  use: {
    baseURL: 'http://localhost:5183',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
  },
  projects: [
    // A regressão visual (pixel-diff) roda SÓ no chromium-desktop: baselines
    // de screenshot são específicos por engine (WebKit/Firefox antialiasam
    // texto diferente), então difar pixels entre engines não é uma asserção
    // significativa — só geraria baselines paralelos e ruído. O próprio spec
    // já cobre desktop E mobile internamente via setViewportSize, então uma
    // engine canônica basta. Os demais projetos ignoram esse arquivo.
    { name: 'chromium-desktop', use: { ...devices['Desktop Chrome'] } },
    { name: 'chromium-mobile', use: { ...devices['Pixel 7'] }, testIgnore: /visual-regression\.spec\.ts/ },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] }, testIgnore: /visual-regression\.spec\.ts/ },
    { name: 'webkit', use: { ...devices['Desktop Safari'] }, testIgnore: /visual-regression\.spec\.ts/ },
  ],
});
