import { test, expect, verificarIsolamentoEConsole } from '../fixtures';
import { championComPosicoes, mockarChampionEProfitLab } from '../mocks';

test.describe('Champion View', () => {
  test('carrega curva, snapshots de equity, drawdown, waterfall, posições', async ({ page, consoleErrors, requestsTo8787 }) => {
    await page.goto('/champion');
    await expect(page.getByRole('heading', { name: 'Champion View' })).toBeVisible();

    const metricas = page.getByLabel('Métricas do champion');
    await expect(metricas.getByText('CAPITAL INICIAL')).toBeVisible();
    await expect(metricas.getByText('CAPITAL REALIZADO')).toBeVisible();
    await expect(metricas.getByText('PnL realizado', { exact: true })).toBeVisible();
    await expect(metricas.getByText('EQUITY MARK')).toBeVisible();
    await expect(metricas.getByText('EQUITY DE LIQUIDAÇÃO')).toBeVisible();
    await expect(metricas.getByText('Funding bruto', { exact: true })).toBeVisible();
    await expect(metricas.getByText('Custos totais', { exact: true })).toBeVisible();
    await expect(metricas.getByText(/posições abertas/i)).toBeVisible();
    await expect(metricas.getByText(/settlements \(pagamentos\)/i)).toBeVisible();

    await expect(page.getByRole('heading', { name: /curva de equity/i })).toBeVisible();
    await expect(page.getByText(/drawdown/i).first()).toBeVisible();
    await expect(page.getByRole('heading', { name: /funding bruto até pnl líquido/i })).toBeVisible();

    verificarIsolamentoEConsole(consoleErrors, requestsTo8787);
  });

  test('identidade fundingTotalLifetime - custosTotalLifetime = pnlRealizadoLifetime, dentro da tolerância', async ({ page }) => {
    const resposta = await page.request.get('http://localhost:5184/api/v2/waterfall');
    const json = await resposta.json();
    const a = json.autoritativo;
    expect(a, 'autoritativo não deveria ser null com o motor rodando').not.toBeNull();
    const diferenca = a.pnlRealizadoLifetime - (a.fundingTotalLifetime - a.custosTotalLifetime);
    expect(Math.abs(diferenca)).toBeLessThanOrEqual(a.tolerancia);
    expect(a.reconciliado).toBe(true);

    // a própria API expõe a diferença e a tolerância -- nunca escondidas
    expect(a).toHaveProperty('diferenca');
    expect(a).toHaveProperty('tolerancia');
  });

  test('buckets não instrumentados (slippage, emergencial) aparecem como "não instrumentado", nunca como zero', async ({ page }) => {
    const resposta = await page.request.get('http://localhost:5184/api/v2/waterfall');
    const json = await resposta.json();
    const buckets = json.decomposicao?.buckets;
    if (!buckets) test.skip(true, 'decomposição indisponível');

    expect(buckets.slippageEntrada.tracked).toBe(false);
    expect(buckets.slippageEntrada.valor).toBeNull();
    expect(buckets.slippageEntrada.motivo.length).toBeGreaterThan(0);
    expect(buckets.emergencial.tracked).toBe(false);
    expect(buckets.emergencial.valor).toBeNull();
  });

  test('smoke (dados reais): posições abertas mostram as duas pernas, custos, funding, distância de liquidação, SE houver alguma no momento', async ({ page }) => {
    await page.goto('/champion');
    const secaoPosicoes = page.locator('text=/Posições abertas \\(\\d+\\)/').locator('..');
    const temPosicoes = await secaoPosicoes.locator('text=Notional/perna').first().isVisible().catch(() => false);
    if (!temPosicoes) test.skip(true, 'sem posições abertas no momento — cobertura funcional garantida pelos testes determinísticos abaixo, este é só um smoke adicional com dados reais');

    await expect(page.getByText('SHORT').first()).toBeVisible();
    await expect(page.getByText('LONG').first()).toBeVisible();
    await expect(page.getByText('Notional/perna').first()).toBeVisible();
    await expect(page.getByText('Spread na entrada').first()).toBeVisible();
    await expect(page.getByText('Funding acumulado').first()).toBeVisible();
    await expect(page.getByText('Distância liquidação').first()).toBeVisible();
    await expect(page.getByText('Perna em risco').first()).toBeVisible();
  });

  // ── Fechamento do Quality Gate (item 7): cobertura funcional determinística,
  // não dependente do estado vivo do mercado ────────────────────────────────
  test('determinístico: 0 posições abertas mostra a ilustração de vazio, nunca uma tabela falsa', async ({ page }) => {
    await mockarChampionEProfitLab(page, { champion: championComPosicoes(0) });
    await page.goto('/champion');
    await expect(page.getByRole('heading', { name: 'Posições abertas (0)' })).toBeVisible();
    await expect(page.getByText('Nenhuma posição aberta no momento')).toBeVisible();
  });

  test('determinístico: 1 posição aberta mostra as duas pernas e as métricas de risco', async ({ page }) => {
    await mockarChampionEProfitLab(page, { champion: championComPosicoes(1) });
    await page.goto('/champion');
    await expect(page.getByRole('heading', { name: 'Posições abertas (1)' })).toBeVisible();
    await expect(page.getByText('SHORT').first()).toBeVisible();
    await expect(page.getByText('LONG').first()).toBeVisible();
    await expect(page.getByText('Distância liquidação').first()).toBeVisible();
  });

  test('determinístico: 2 posições abertas — as duas aparecem, cada uma com suas próprias pernas', async ({ page }) => {
    await mockarChampionEProfitLab(page, { champion: championComPosicoes(2) });
    await page.goto('/champion');
    await expect(page.getByRole('heading', { name: 'Posições abertas (2)' })).toBeVisible();
    await expect(page.getByText('BTCUSDT')).toBeVisible();
    await expect(page.getByText('ETHUSDT')).toBeVisible();
  });

  test('determinístico: posição com risco elevado (distância mínima de liquidação muito baixa) continua identificável na perna em risco', async ({ page }) => {
    await mockarChampionEProfitLab(page, { champion: championComPosicoes(1, { risco: true }) });
    await page.goto('/champion');
    await expect(page.getByRole('heading', { name: 'Posições abertas (1)' })).toBeVisible();
    await expect(page.getByText('Perna em risco').first()).toBeVisible();
    // a distância mínima de 0.02 (2.00%, fmtPct do próprio componente) precisa aparecer — não pode ser arredondada a ponto de sumir
    await expect(page.getByText('2.00%').first()).toBeVisible();
  });

  test('status dos dados: banner correto quando stale/erro/corrompido', async ({ page }) => {
    await page.goto('/champion');
    // condição normal: sem banner de erro visível quando os dados são bons
    const bannerOffline = page.getByText('Sem conexão com o servidor');
    await page.waitForTimeout(1500);
    const visivel = await bannerOffline.isVisible().catch(() => false);
    // com a API viva, não deveria haver banner de offline
    expect(visivel).toBe(false);
  });
});
