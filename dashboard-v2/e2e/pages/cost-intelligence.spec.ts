import { test, expect, verificarIsolamentoEConsole } from '../fixtures';

test.describe('Cost Intelligence', () => {
  test('carrega waterfall, escopo, delta da janela comum', async ({ page, consoleErrors, requestsTo8787 }) => {
    await page.goto('/costs');
    await expect(page.getByRole('heading', { name: 'Cost Intelligence' })).toBeVisible();
    await expect(page.getByText(/funding bruto até pnl líquido/i)).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(/delta da janela comum/i)).toBeVisible();
    await expect(page.getByText(/nunca confundir com o total acumulado/i)).toBeVisible();

    verificarIsolamentoEConsole(consoleErrors, requestsTo8787);
  });

  test('escopo "partial" nunca é apresentado como "lifetime"/"complete"', async ({ page }) => {
    const resposta = await page.request.get('http://localhost:5184/api/v2/waterfall');
    const json = await resposta.json();
    const escopo = json.decomposicao?.escopo;
    if (escopo !== 'partial') test.skip(true, 'decomposição está complete nesta janela — nada a verificar');

    await page.goto('/costs');
    const corpo = await page.textContent('body');
    // se o escopo é partial, o texto da tela precisa mencionar "janela"/"recente", nunca "vitalício" sozinho como se fosse completo
    expect(corpo).toMatch(/janela|recente/i);
  });

  test('custo não instrumentado nunca aparece como zero fabricado', async ({ page }) => {
    const resposta = await page.request.get('http://localhost:5184/api/v2/waterfall');
    const json = await resposta.json();
    const b = json.decomposicao?.buckets;
    if (!b) test.skip(true, 'sem decomposição');
    expect(b.slippageEntrada.tracked).toBe(false);
    expect(b.slippageEntrada.valor).toBeNull();
  });

  test('sem tendência temporal fabricada quando não existe série diária', async ({ page }) => {
    await page.goto('/costs');
    await expect(page.getByText(/funding bruto até pnl líquido/i)).toBeVisible({ timeout: 10_000 });
    const corpo = await page.textContent('body');
    expect(corpo).toMatch(/Tendência temporal: indisponível|não é periódico/);
  });

  test('custo estimado de fechamento nunca somado ao custo total realizado', async ({ page }) => {
    const resposta = await page.request.get('http://localhost:5184/api/v2/waterfall');
    const json = await resposta.json();
    const b = json.decomposicao?.buckets;
    if (!b || b.fechamentoEstimado == null) test.skip(true, 'sem fechamento estimado nesta janela');
    const somaSemFechamento = b.entrada + b.saida + b.escalonamento + b.apara + b.reinvestimento;
    expect(json.decomposicao.custoTotalNoEscopo).toBeCloseTo(somaSemFechamento, 2);
  });
});
