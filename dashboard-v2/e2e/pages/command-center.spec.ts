import { test, expect, verificarIsolamentoEConsole } from '../fixtures';
import { mockarChampionEProfitLab, profitLabComMotorForaDaJanela } from '../mocks';

test.describe('Command Center', () => {
  test('visão executiva: faixa de capital/PnL/exposição, curva, motores, posições, oportunidades', async ({ page, consoleErrors, requestsTo8787 }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Command Center' })).toBeVisible();

    // faixa executiva
    await expect(page.getByText('Capital · PAPER').first()).toBeVisible();
    await expect(page.getByText('PnL realizado').first()).toBeVisible();
    await expect(page.getByText('Equity mark').first()).toBeVisible();
    await expect(page.getByText('Exposição (notional)').first()).toBeVisible();

    // centro + lateral
    await expect(page.getByRole('heading', { name: /curva de capital/i })).toBeVisible();
    await expect(page.getByRole('heading', { name: /motores/i })).toBeVisible();
    await expect(page.getByRole('heading', { name: /posições abertas/i })).toBeVisible();
    await expect(page.getByRole('heading', { name: /oportunidades/i })).toBeVisible();

    verificarIsolamentoEConsole(consoleErrors, requestsTo8787);
  });

  test('determinístico: motor recém-chegado com PnL altíssimo, mas fora da janela comum, NUNCA aparece como melhor motor', async ({ page }) => {
    // A honestidade da janela comum: o motor mockado tem pnlDesdeOInicio=9999
    // (maior que qualquer comparável) mas comparavelNaJanela=false. O ranking
    // (calcularRankingComparavel) só considera comparáveis, então ele nunca
    // deveria aparecer no painel "melhor / pior motor".
    await mockarChampionEProfitLab(page, { profitLab: profitLabComMotorForaDaJanela() });
    await page.goto('/');
    const secao = page.locator('section').filter({ hasText: 'MELHOR / PIOR MOTOR' });
    await expect(secao).toBeVisible();
    const texto = await secao.textContent();
    expect(texto, 'motor fora da janela nunca vence o ranking').not.toContain('motor-recem-chegado-pnl-altissimo');
    expect(texto, 'o melhor entre os comparáveis é o veterano').toContain('motor-veterano-a');
  });

  test('smoke (dados reais): se há ranking na tela, nenhum motor fora da janela aparece como melhor/pior', async ({ page }) => {
    const resposta = await page.request.get('http://localhost:5184/api/v2/profit-lab');
    const json = await resposta.json();
    const linhas: any[] = json.leaderboardMulti?.linhas ?? [];
    if (!linhas.length) test.skip(true, 'sem leaderboardMulti — cobertura garantida pelo teste determinístico');
    const naoComparaveis = linhas.filter((l) => !l.comparavelNaJanela).map((l) => l.strategyId);
    if (!naoComparaveis.length) test.skip(true, 'todos comparáveis nesta janela');

    await page.goto('/');
    await page.waitForTimeout(2000);
    const secao = page.locator('text=/MELHOR \\/ PIOR MOTOR/i');
    if (!(await secao.isVisible().catch(() => false))) test.skip(true, 'sem ranking exibido nesta janela');
    const texto = await secao.locator('..').textContent();
    for (const id of naoComparaveis) {
      expect(texto, `${id} está fora da janela e nunca deveria aparecer como melhor/pior`).not.toContain(id);
    }
  });
});
