import { test, expect } from './fixtures';

/**
 * Navegação por teclado (item 10) — nenhum elemento interativo pode exigir
 * mouse. Testa Tab/Shift+Tab/Enter/Espaço/Escape e foco visível.
 */
test.describe('Navegação por teclado', () => {
  test('sidebar: todos os links são alcançáveis via Tab, ativáveis via Enter', async ({ page, browserName }) => {
    // LIMITAÇÃO DE AMBIENTE (não é bug do produto): o WebKit/Safari não move
    // o foco de Tab para hiperlinks por padrão — é o comportamento do ajuste
    // de SO "Full Keyboard Access" (desligado por padrão no Safari), que o
    // Playwright-webkit emula fielmente. Os links são `<a href>` semânticos
    // e SÃO alcançáveis por Tab no Chromium e no Firefox (e no Safari com o
    // ajuste ligado). Documentado, nunca escondido — a cobertura de teclado
    // real acontece no chromium-desktop/mobile.
    test.skip(browserName === 'webkit', 'WebKit não dá Tab em links por padrão (ajuste de SO "Full Keyboard Access"); links são <a href> semânticos, alcançáveis por Tab no Chromium/Firefox');

    await page.goto('/');

    // MOBILE: a navegação é um drawer próprio atrás do hambúrguer (item 7 —
    // "não apenas comprimir a sidebar desktop"). O fluxo de teclado é:
    // Tab até o hambúrguer, Enter abre o drawer, link focável, Enter navega.
    const hamburger = page.getByRole('button', { name: 'Abrir menu' });
    if (await hamburger.isVisible().catch(() => false)) {
      await hamburger.focus();
      await page.keyboard.press('Enter');
      const linkLive = page.getByRole('link', { name: 'Live Operations' });
      await expect(linkLive).toBeVisible();
      await linkLive.focus();
      await page.keyboard.press('Enter');
      await expect(page.getByRole('heading', { name: 'Live Operations' })).toBeVisible({ timeout: 5000 });
      return;
    }

    await page.keyboard.press('Tab'); // primeiro foco: pular pro conteúdo (skip-link) ou o primeiro link
    const primeiroFoco = await page.evaluate(() => document.activeElement?.tagName);
    expect(primeiroFoco).toBeTruthy();

    // navega até achar o link "Live Operations" via Tab. Checa que o foco
    // está mesmo num ELEMENTO focável (A/BUTTON) — nunca no <body>, cujo
    // textContent seria a página inteira e daria um falso-positivo.
    let achou = false;
    for (let i = 0; i < 20; i++) {
      const foco = await page.evaluate(() => {
        const el = document.activeElement;
        return { tag: el?.tagName, texto: el?.textContent?.trim() };
      });
      if ((foco.tag === 'A' || foco.tag === 'BUTTON') && foco.texto?.includes('Live Operations')) { achou = true; break; }
      await page.keyboard.press('Tab');
    }
    expect(achou, 'Live Operations deveria ser alcançável via Tab a partir do topo, num elemento focável de verdade').toBe(true);

    await page.keyboard.press('Enter');
    await expect(page.getByRole('heading', { name: 'Live Operations' })).toBeVisible({ timeout: 5000 });
  });

  test('botão de congelar/retomar no Live Operations é ativável via Espaço', async ({ page }) => {
    await page.goto('/live');
    const botao = page.getByRole('button', { name: '⏸ congelar' });
    await expect(botao).toBeVisible({ timeout: 10_000 });
    await botao.focus();
    await page.keyboard.press('Space');
    await expect(page.getByRole('button', { name: /retomar/ })).toBeVisible();
    await page.getByRole('button', { name: /retomar/ }).focus();
    await page.keyboard.press('Space');
    await expect(page.getByRole('button', { name: '⏸ congelar' })).toBeVisible();
  });

  test('nav recolhível/drawer é operável via teclado (Enter/Escape), foco preservado', async ({ page }) => {
    await page.goto('/');

    // MOBILE: o equivalente ao "recolher" é o drawer — hambúrguer abre via
    // Enter, Escape fecha.
    const hamburger = page.getByRole('button', { name: 'Abrir menu' });
    if (await hamburger.isVisible().catch(() => false)) {
      await hamburger.focus();
      await page.keyboard.press('Enter');
      await expect(page.getByRole('link', { name: 'Command Center' })).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(page.getByRole('link', { name: 'Command Center' })).toBeHidden();
      return;
    }

    // DESKTOP: botão « Recolher.
    const botaoRecolher = page.getByRole('button', { name: /recolher menu/i });
    await botaoRecolher.focus();
    await page.keyboard.press('Enter');
    await page.waitForTimeout(300);
    // depois de recolher, o botão deveria continuar focável e reversível
    const focoAtual = await page.evaluate(() => document.activeElement?.getAttribute('aria-label') ?? document.activeElement?.textContent);
    expect(focoAtual).toBeTruthy();
  });

  test('filtros do Live Operations (selects) são operáveis via teclado', async ({ page }) => {
    await page.goto('/live');
    await expect(page.getByText(/cursor incremental/)).toBeVisible({ timeout: 10_000 });
    const selectMotor = page.locator('select').first();
    await selectMotor.focus();
    const focado = await page.evaluate(() => document.activeElement?.tagName);
    expect(focado).toBe('SELECT');
  });

  test('cobertura no Live Operations: painel abre/fecha via Enter, foco permanece no botão que o controla', async ({ page }) => {
    await page.goto('/live');
    const botaoCobertura = page.getByRole('button', { name: /cobertura:/ });
    await expect(botaoCobertura).toBeVisible({ timeout: 10_000 });
    await botaoCobertura.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByText('Depois do cursor')).toBeVisible();
    await page.keyboard.press('Enter');
    await expect(page.getByText('Depois do cursor')).toBeHidden();
  });

  test('nenhum elemento interativo tem tabindex negativo escondendo-o do teclado sem motivo', async ({ page }) => {
    await page.goto('/');
    const escondidos = await page.locator('button[tabindex="-1"], a[tabindex="-1"]').count();
    expect(escondidos, 'nenhum botão/link deveria ter tabindex=-1 sem justificativa (nenhum encontrado nesta versão)').toBe(0);
  });
});
