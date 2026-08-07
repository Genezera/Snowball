import { test, expect, verificarIsolamentoEConsole } from '../fixtures';
import { mockarChampionEProfitLab, profitLabComMotorForaDaJanela } from '../mocks';

test.describe('Command Center', () => {
  test('carrega dados reais: capital, equity, PnL, posições, challengers, capital virtual', async ({ page, consoleErrors, requestsTo8787 }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Command Center' })).toBeVisible();

    await expect(page.getByText('CAPITAL REALIZADO')).toBeVisible();
    await expect(page.getByText('EQUITY MARK')).toBeVisible();
    await expect(page.getByText(/realizado \+ não-realizado marcado/)).toBeVisible();
    await expect(page.getByText('PNL REALIZADO')).toBeVisible();
    await expect(page.getByText('FUNDING BRUTO')).toBeVisible();
    await expect(page.getByText('CUSTOS TOTAIS')).toBeVisible();

    await expect(page.getByText('CAPITAL VIRTUAL AGREGADO DOS EXPERIMENTOS')).toBeVisible();
    // aviso permanente — não é capital real (pedido explícito de sessões anteriores)
    await expect(page.getByText(/Soma de carteiras paper independentes\. Não representa capital real ou disponível\./)).toBeVisible();

    await expect(page.getByText('TRADES PAPER')).toBeVisible();
    await expect(page.getByText('CHALLENGERS ATIVOS')).toBeVisible();

    verificarIsolamentoEConsole(consoleErrors, requestsTo8787);
  });

  test('comparação entre motores: ranking só de motores comparáveis, motivo explícito pros de fora', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByText('COMPARAÇÃO ENTRE MOTORES')).toBeVisible({ timeout: 15_000 });

    const corpo = await page.textContent('body');
    // nunca "Comparação indisponível" E "melhor motor" ao mesmo tempo -- são estados exclusivos
    const temIndisponivel = corpo?.includes('Comparação indisponível');
    const temMelhorMotor = corpo?.includes('MELHOR MOTOR (JANELA COMUM)');
    expect(temIndisponivel !== temMelhorMotor || (!temIndisponivel && !temMelhorMotor)).toBeTruthy();

    if (temMelhorMotor) {
      // se existe ranking, precisa existir a contagem de quantos participam E quantos ficaram de fora
      await expect(page.getByText(/motor\(es\) compartilham a mesma janela comum/)).toBeVisible();
    }
  });

  test('smoke (dados reais): motor fora da janela comum nunca aparece como melhor/pior motor comparável', async ({ page }) => {
    // Fonte de verdade: `leaderboardMulti.linhas[].comparavelNaJanela` da
    // API V2 — a UI NUNCA decide comparabilidade sozinha, só reflete o que
    // a API já classificou. Este teste confirma que todo strategyId citado
    // como "melhor"/"pior motor" na tela está marcado comparavelNaJanela=true
    // na API, nunca um dos que ficaram de fora.
    const resposta = await page.request.get('http://localhost:5184/api/v2/profit-lab');
    const json = await resposta.json();
    const linhas: any[] = json.leaderboardMulti?.linhas ?? [];
    if (!linhas.length) test.skip(true, 'sem leaderboardMulti no momento — cobertura funcional garantida pelo teste determinístico abaixo, este é só um smoke adicional com dados reais');

    const naoComparaveis = linhas.filter((l) => !l.comparavelNaJanela).map((l) => l.strategyId);
    if (!naoComparaveis.length) test.skip(true, 'todos os motores são comparáveis nesta janela no momento — mesma justificativa acima');

    await page.goto('/');
    await page.waitForTimeout(2000);
    const corpo = await page.textContent('body');
    if (!corpo?.includes('MELHOR MOTOR (JANELA COMUM)')) test.skip(true, 'sem ranking exibido nesta janela — mesma justificativa acima');

    const melhorMotorSecao = await page.locator('text=MELHOR MOTOR (JANELA COMUM)').locator('..').textContent();
    for (const idForaDaJanela of naoComparaveis) {
      expect(melhorMotorSecao, `${idForaDaJanela} está fora da janela comum e nunca deveria aparecer como melhor motor`).not.toContain(idForaDaJanela);
    }
  });

  test('determinístico: motor recém-chegado com PnL altíssimo, mas fora da janela comum, NUNCA vence o ranking', async ({ page }) => {
    // item 3 do Quality Gate: teste explícito e determinístico — o motor
    // mockado tem pnlDesdeOInicio=9999 (maior que qualquer comparável) mas
    // comparavelNaJanela=false; se ele aparecer como melhor motor, a UI
    // estaria misturando históricos de tamanhos diferentes, exatamente o
    // viés que a "janela comum" existe pra evitar.
    await mockarChampionEProfitLab(page, { profitLab: profitLabComMotorForaDaJanela() });
    await page.goto('/');
    await expect(page.getByText('MELHOR MOTOR (JANELA COMUM)')).toBeVisible();
    const melhorMotorSecao = await page.locator('text=MELHOR MOTOR (JANELA COMUM)').locator('..').textContent();
    expect(melhorMotorSecao).not.toContain('motor-recem-chegado-pnl-altissimo');
    expect(melhorMotorSecao).toContain('motor-veterano-a'); // maior pnl ENTRE os comparáveis
    // o motor fora da janela precisa aparecer na lista de excluídos, com motivo
    await page.getByText(/motor\(es\) fora da comparação/).click();
    await expect(page.getByText('motor-recem-chegado-pnl-altissimo')).toBeVisible();
    await expect(page.getByText(/fora da janela comum/)).toBeVisible();
  });
});
