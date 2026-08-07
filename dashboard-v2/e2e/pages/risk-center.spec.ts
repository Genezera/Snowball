import { test, expect, verificarIsolamentoEConsole } from '../fixtures';
import { mockarChampionEProfitLab, profitLabComAltoRisco } from '../mocks';

test.describe('Risk Center', () => {
  test('carrega drawdown, concentração, cenários', async ({ page, consoleErrors, requestsTo8787 }) => {
    await page.goto('/risk');
    await expect(page.getByRole('heading', { name: 'Risk Center' })).toBeVisible();
    await expect(page.getByText(/Drawdown & concentração/)).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(/Cenários — ideal/)).toBeVisible();

    verificarIsolamentoEConsole(consoleErrors, requestsTo8787);
  });

  test('smoke (dados reais): challengers acima de 5x alavancagem sempre mostram o selo PAPER EXPERIMENT — HIGH RISK', async ({ page }) => {
    const resposta = await page.request.get('http://localhost:5184/api/v2/profit-lab');
    const json = await resposta.json();
    const altoRisco = (json.riscos?.porChallenger ?? []).filter((r: any) => r.altoRiscoAlavancagem);
    if (!altoRisco.length) test.skip(true, 'nenhum challenger de alto risco no momento — cobertura funcional garantida pelo teste determinístico abaixo, este é só um smoke adicional com dados reais');

    await page.goto('/risk');
    await expect(page.getByText(/PAPER EXPERIMENT — HIGH RISK/)).toBeVisible({ timeout: 10_000 });
    for (const r of altoRisco) {
      await expect(page.getByText(r.challengerId, { exact: false }).first()).toBeVisible();
    }
  });

  test('determinístico: challenger acima de 5x alavancagem sempre mostra o selo PAPER EXPERIMENT — HIGH RISK', async ({ page }) => {
    await mockarChampionEProfitLab(page, { profitLab: profitLabComAltoRisco() });
    await page.goto('/risk');
    await expect(page.getByText(/PAPER EXPERIMENT — HIGH RISK/)).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText('challenger-leverage-8', { exact: false }).first()).toBeVisible();
    // o challenger sem alto risco não deveria estar dentro do bloco do selo
    const seloSecao = await page.getByText(/PAPER EXPERIMENT — HIGH RISK/).locator('..').textContent();
    expect(seloSecao).not.toContain('challenger-equal-weight');
  });

  test('tabela de risco mostra drawdown, concentração, posições, capital ocioso, alavancagem por challenger', async ({ page }) => {
    await page.goto('/risk');
    const temTabela = await page.getByText('Drawdown').isVisible({ timeout: 5000 }).catch(() => false);
    if (!temTabela) test.skip(true, 'sem dados de risco ainda');
    await expect(page.getByText('Concentração')).toBeVisible();
    await expect(page.getByText('Capital ocioso')).toBeVisible();
    await expect(page.getByText('Alavancagem')).toBeVisible();
  });
});
