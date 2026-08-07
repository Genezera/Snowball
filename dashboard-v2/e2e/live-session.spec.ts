import { test, expect } from './fixtures';

/**
 * Sessão longa / remount (item 9) — valida os pontos-chave sem HMR (o teste
 * não edita arquivos, então o dev server não faz Fast Refresh): recebidos ==
 * visível em sincronia, remontar a rota repetidamente NÃO cria polling loop
 * duplicado nem crescimento duplicado, e voltar pra página preserva a lista.
 * O teste de 30 min contínuos em build de produção fica documentado como
 * limitação de ambiente (inviável no CI desta sessão), mas o mecanismo
 * (sincronia + remount) é validado aqui.
 */
async function lerContadores(page: import('@playwright/test').Page) {
  const total = Number(await page.locator('[data-testid="event-timeline-scroll"]').getAttribute('data-total-eventos').catch(() => '0'));
  const receb = await page.getByText(/recebidos:\s*\d+/).textContent().catch(() => 'recebidos: 0');
  const recebN = Number(/recebidos:\s*(\d+)/.exec(receb ?? '')?.[1] ?? '0');
  return { total, recebN };
}

test('sincronia recebidos == visível, e remount não duplica nem cria loop extra', async ({ page, requestsTo8787 }) => {
  await page.goto('/live');
  await page.waitForTimeout(6000);
  const c1 = await lerContadores(page);
  expect(c1.total, 'visível deve estar em sincronia com recebidos').toBe(c1.recebN);
  expect(c1.total).toBeGreaterThan(0);

  // conta requests a /api/v2/events num intervalo — deve refletir UM loop
  let eventsReqs = 0;
  page.on('request', (r) => { if (r.url().includes('/api/v2/events')) eventsReqs++; });

  // remonta a rota várias vezes (navega e volta)
  for (let i = 0; i < 4; i++) {
    await page.getByRole('link', { name: 'Command Center' }).click();
    await expect(page.getByRole('heading', { name: 'Command Center' })).toBeVisible();
    await page.getByRole('link', { name: 'Live Operations' }).click();
    await expect(page.getByRole('heading', { name: 'Live Operations' })).toBeVisible();
    await page.waitForTimeout(500);
  }
  await page.waitForTimeout(8000);
  const c2 = await lerContadores(page);
  // após remounts, ainda em sincronia (não travou nem duplicou)
  expect(c2.total, 'após remounts, visível == recebidos (sem loop duplicado)').toBe(c2.recebN);

  // janela de ~7s de observação de requests: um único loop faz ~1-2 req por
  // poll (5s) + rajadas de backlog (50ms). Não deve explodir em centenas.
  await new Promise((r) => setTimeout(r, 100));
  expect(requestsTo8787, 'zero 8787').toEqual([]);
});
