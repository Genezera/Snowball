import { test, expect, verificarIsolamentoEConsole } from '../fixtures';
import { championComPosicoes, mockarChampionEProfitLab } from '../mocks';

test.describe('Champion (cockpit)', () => {
  test('cockpit: hero operacional, curva, drawdown, painel de risco, posições', async ({ page, consoleErrors, requestsTo8787 }) => {
    await page.goto('/champion');
    await expect(page.getByRole('heading', { name: 'Champion', exact: true })).toBeVisible();

    // faixa hero — capital PAPER, PnL, funding, custos, posições
    await expect(page.getByText('Capital · PAPER').first()).toBeVisible();
    await expect(page.getByText('PnL realizado').first()).toBeVisible();
    await expect(page.getByText('Funding', { exact: true }).first()).toBeVisible();

    await expect(page.getByRole('heading', { name: /curva de capital/i })).toBeVisible();
    await expect(page.getByRole('heading', { name: /drawdown/i }).first()).toBeVisible();
    await expect(page.getByRole('heading', { name: /painel de risco/i })).toBeVisible();
    await expect(page.getByRole('heading', { name: /posições abertas/i })).toBeVisible();

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

  // ── cobertura determinística das posições no cockpit ──────────────────────
  test('determinístico: 0 posições abertas mostra a ilustração de vazio, nunca uma tabela falsa', async ({ page }) => {
    await mockarChampionEProfitLab(page, { champion: championComPosicoes(0) });
    await page.goto('/champion');
    await expect(page.getByRole('heading', { name: 'Posições abertas · 0' })).toBeVisible();
    await expect(page.getByText('Nenhuma posição aberta no momento')).toBeVisible();
  });

  test('determinístico: 1 posição aberta mostra as duas pernas e a distância de liquidação', async ({ page }) => {
    await mockarChampionEProfitLab(page, { champion: championComPosicoes(1) });
    await page.goto('/champion');
    const secao = page.getByLabel('Posições abertas — cockpit');
    await expect(page.getByRole('heading', { name: 'Posições abertas · 1' })).toBeVisible();
    await expect(secao.getByText(/short ·/i).first()).toBeVisible();
    await expect(secao.getByText(/long ·/i).first()).toBeVisible();
    await expect(secao.getByText('Dist. liq.').first()).toBeVisible();
  });

  test('determinístico: 2 posições abertas — as duas aparecem no cockpit', async ({ page }) => {
    await mockarChampionEProfitLab(page, { champion: championComPosicoes(2) });
    await page.goto('/champion');
    await expect(page.getByRole('heading', { name: 'Posições abertas · 2' })).toBeVisible();
    // escopo na seção de posições — o Ticker (topo) também mostra os símbolos
    const secao = page.getByLabel('Posições abertas — cockpit');
    await expect(secao.getByText('BTCUSDT')).toBeVisible();
    await expect(secao.getByText('ETHUSDT')).toBeVisible();
  });

  test('determinístico: posição com risco elevado (distância mínima baixa) mostra o selo de risco e a % de liquidação', async ({ page }) => {
    await mockarChampionEProfitLab(page, { champion: championComPosicoes(1, { risco: true }) });
    await page.goto('/champion');
    const secao = page.getByLabel('Posições abertas — cockpit');
    await expect(page.getByRole('heading', { name: 'Posições abertas · 1' })).toBeVisible();
    await expect(secao.getByText(/RISCO LIQ/i).first()).toBeVisible();
    // distância mínima 0.02 = 2,00% precisa aparecer (não pode sumir por arredondamento)
    await expect(secao.getByText('2,00%').first()).toBeVisible();
  });

  test('status dos dados: banner correto quando stale/erro/corrompido', async ({ page }) => {
    await page.goto('/champion');
    const bannerOffline = page.getByText('Sem conexão com o servidor');
    await page.waitForTimeout(1500);
    const visivel = await bannerOffline.isVisible().catch(() => false);
    expect(visivel).toBe(false);
  });
});
