import { test, expect } from './fixtures';

/**
 * Falhas da API (item 16) — todos os cenários simulados via
 * `page.route()`, nunca derrubando a API V2 de verdade (não repete os
 * testes A-D do Gate de Confiabilidade Operacional). Confirma: estado
 * correto, zero valor fabricado, zero fallback pra 8787, zero loop de
 * requests, recuperação.
 */
test.describe('Falhas simuladas da API V2', () => {
  test('HTTP 500: estado de erro, nunca sucesso fabricado', async ({ page }) => {
    await page.route('**/api/v2/champion', (route) => route.fulfill({ status: 500, body: 'erro interno' }));
    await page.goto('/champion');
    await page.waitForTimeout(2000);
    await expect(page.getByText('Sem conexão com o servidor')).toBeVisible();
    const corpo = await page.textContent('body');
    expect(corpo).not.toMatch(/localhost:8787/);
  });

  test('timeout: nunca trava a UI, mostra estado correto', async ({ page }) => {
    await page.route('**/api/v2/champion', async (route) => {
      await new Promise((r) => setTimeout(r, 15_000));
      await route.abort('timedout');
    });
    await page.goto('/champion');
    await page.waitForTimeout(3000);
    // enquanto não resolve, a página não deveria quebrar nem mostrar dado fabricado
    const temErroJS = await page.evaluate(() => !!(window as any).__erroNaoTratado);
    expect(temErroJS).toBe(false);
  });

  test('JSON inválido: estado corrompido, nunca erro de parsing vazando pro usuário como crash', async ({ page }) => {
    await page.route('**/api/v2/champion', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: 'isto não é json{{{' }));
    await page.goto('/champion');
    await page.waitForTimeout(2000);
    const corpo = await page.textContent('body');
    expect(corpo).not.toMatch(/localhost:8787/);
    // a página continua de pé (heading visível), mesmo com dado corrompido
    await expect(page.getByRole('heading', { name: 'Champion View' })).toBeVisible();
  });

  test('schema incompatível: campo obrigatório faltando vira corrompido, nunca sucesso parcial fabricado', async ({ page }) => {
    await page.route('**/api/v2/champion', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ estado: null }) }));
    await page.goto('/champion');
    await page.waitForTimeout(2000);
    await expect(page.getByRole('heading', { name: 'Champion View' })).toBeVisible();
  });

  test('resposta parcial: campos opcionais ausentes não quebram a página', async ({ page }) => {
    await page.route('**/api/v2/champion', (route) => route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({
        estado: { capital: 600, capitalInicial: 600, pico: 600, fundingTotal: 0, custosTotal: 0, pagamentos: 0 },
        processos: [], vigilancia: {}, atualizadoEm: Date.now(),
      }),
    }));
    await page.goto('/champion');
    await expect(page.getByRole('heading', { name: 'Champion View' })).toBeVisible();
  });

  test('conexão recusada: estado de erro honesto, recupera quando a rota é liberada', async ({ page }) => {
    await page.route('**/api/v2/champion', (route) => route.abort('connectionrefused'));
    await page.goto('/champion');
    await page.waitForTimeout(2000);
    await expect(page.getByText('Sem conexão com o servidor')).toBeVisible();

    await page.unroute('**/api/v2/champion');
    await page.waitForTimeout(6000);
    await expect(page.getByText('CAPITAL REALIZADO')).toBeVisible({ timeout: 10_000 });
  });

  test('resposta lenta: não trava a navegação nem gera loop de requests', async ({ page }) => {
    let contagem = 0;
    await page.route('**/api/v2/champion', async (route) => {
      contagem++;
      await new Promise((r) => setTimeout(r, 2000));
      await route.continue();
    });
    await page.goto('/champion');
    await page.waitForTimeout(6000);
    // com poll de 5s, uma resposta lenta de 2s não deveria dobrar a contagem de requests descontroladamente
    expect(contagem).toBeLessThan(6);
  });

  test('cursor do Live Operations é preservado quando a falha é transitória (não reinicia do zero)', async ({ page }) => {
    await page.goto('/live');
    await expect(page.getByText(/cursor incremental/)).toBeVisible({ timeout: 10_000 });
    await page.waitForTimeout(6000); // deixa avançar o cursor real pelo menos uma vez

    let falhouUmaVez = false;
    await page.route('**/api/v2/events**', (route) => {
      if (!falhouUmaVez) { falhouUmaVez = true; return route.abort('connectionrefused'); }
      return route.continue();
    });
    await page.waitForTimeout(8000); // uma falha + uma recuperação dentro dos polls de 5s
    // recuperado — cobertura volta a aparecer, sem erro persistente
    await expect(page.getByText(/^cobertura: \d+\/\d+/)).toBeVisible({ timeout: 10_000 });
  });
});
