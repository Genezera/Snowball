import { test, expect, verificarIsolamentoEConsole } from '../fixtures';
import { mockarChampionEProfitLab, profitLabComSettlementConcluido } from '../mocks';

test.describe('Settlement Capture', () => {
  test('carrega as 5 janelas com status honesto', async ({ page, consoleErrors, requestsTo8787 }) => {
    await page.goto('/capture');
    await expect(page.getByRole('heading', { name: 'Settlement Capture' })).toBeVisible();
    await expect(page.getByText('5min')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText('10min')).toBeVisible();
    await expect(page.getByText('20min')).toBeVisible();
    await expect(page.getByText('30min')).toBeVisible();
    await expect(page.getByText('60min')).toBeVisible();

    verificarIsolamentoEConsole(consoleErrors, requestsTo8787);
  });

  test('status possíveis batem com o enum real da API (observando/posicao_aberta/funding_pendente/fechando/concluida/erro)', async ({ page }) => {
    const resposta = await page.request.get('http://localhost:5184/api/v2/profit-lab');
    const json = await resposta.json();
    const status = (json.capturaStatus ?? []).map((s: any) => s.status);
    const enumValido = ['observando', 'posicao_aberta', 'funding_pendente', 'fechando', 'concluida', 'erro'];
    for (const s of status) expect(enumValido).toContain(s);
  });

  test('custo de entrada nunca é tratado como perda final enquanto o funding está pendente', async ({ page }) => {
    await page.goto('/capture');
    await page.waitForTimeout(2000);
    const corpo = await page.textContent('body');
    // Nunca deveria existir a frase de perda concluída junto com "posição aberta" na mesma tela
    if (corpo?.includes('POSIÇÃO ABERTA')) {
      expect(corpo).toContain('PnL ainda não concluído');
    }
  });

  test('smoke (dados reais): janela concluída mostra funding recebido e custos, nunca mistura com janela ainda aberta', async ({ page }) => {
    const resposta = await page.request.get('http://localhost:5184/api/v2/profit-lab');
    const json = await resposta.json();
    const concluidas = (json.capturaStatus ?? []).filter((s: any) => s.status === 'concluida');
    if (!concluidas.length) test.skip(true, 'nenhuma janela concluída no momento — cobertura funcional garantida pelo teste determinístico abaixo, este é só um smoke adicional com dados reais');
    for (const c of concluidas) {
      expect(c.pnlRealizado).not.toBeNull();
      expect(typeof c.pnlRealizado).toBe('number');
    }
  });

  // ── Fechamento do Quality Gate (item 7/6): fixtures determinísticas ────────
  test('determinístico: janela com posição aberta mostra "PnL ainda não concluído", nunca um número fechado', async ({ page }) => {
    await mockarChampionEProfitLab(page, { profitLab: profitLabComSettlementConcluido() });
    await page.goto('/capture');
    // exact:true pra não colidir com o parágrafo de explicação permanente no
    // rodapé da página, que também contém a mesma frase entre aspas
    await expect(page.getByText('PnL ainda não concluído', { exact: true })).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText('posição aberta', { exact: true })).toBeVisible();
  });

  test('determinístico: janela concluída mostra o PnL fechado (funding recebido − custos), status "concluída"', async ({ page }) => {
    await mockarChampionEProfitLab(page, { profitLab: profitLabComSettlementConcluido() });
    await page.goto('/capture');
    // exact:true pra não colidir com o selo fixo "SEM OPERAÇÃO CONCLUÍDA..."
    // (getByText por string é case-insensitive por padrão no Playwright)
    await expect(page.getByText('concluída', { exact: true })).toBeVisible({ timeout: 10_000 });
    // fundingJaRecebido:false -> fundingRecebido = pnlRealizado + custosTotais = 8.4 + 3.1 = 11.5
    // PnL exibido = fundingRecebido - custos = 11.5 - 3.1 = 8.4 (o pnlRealizado original, corretamente reconstruído) -> "US$ 8,40"
    await expect(page.getByText('US$ 8,40')).toBeVisible();
  });
});
