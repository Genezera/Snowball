import { test, expect } from './fixtures';

/**
 * Reduced motion (item 11) — `prefers-reduced-motion: reduce`. Confirma
 * que nenhuma informação depende de animação, e regressão específica do
 * bug real do AnimatedNumber (achado nesta mesma sessão em turno anterior:
 * ficava preso no valor inicial porque o texto dependia de um evento
 * assíncrono do framer-motion nunca disparar — corrigido pra sempre
 * derivar o texto direto do valor no próprio render).
 */
test.use({ colorScheme: 'dark' });

test.describe('prefers-reduced-motion: reduce', () => {
  test.beforeEach(async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
  });

  test('Command Center: números corretos, nada com opacity zero permanente', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByText('CAPITAL REALIZADO')).toBeVisible({ timeout: 10_000 });
    await page.waitForTimeout(1500);

    // nenhum elemento de métrica visível deveria ficar com opacity computada 0
    const opacidadesZero = await page.evaluate(() => {
      const els = Array.from(document.querySelectorAll('main *'));
      let count = 0;
      for (const el of els) {
        const style = window.getComputedStyle(el);
        if (style.opacity === '0' && el.textContent?.trim()) count++;
      }
      return count;
    });
    expect(opacidadesZero, 'nenhum elemento com texto deveria ficar preso em opacity:0 com reduced motion').toBe(0);
  });

  test('regressão: AnimatedNumber nunca fica preso em 0/valor inicial com reduced motion', async ({ page }) => {
    await page.goto('/champion');
    await expect(page.getByRole('heading', { name: 'Champion View' })).toBeVisible();
    await page.waitForTimeout(2000);

    const metricas = page.getByLabel('Métricas do champion');
    // sobe 2 níveis a partir do label: span -> div (linha do cabeçalho) ->
    // div (o MetricCard inteiro, onde o número (irmão da linha de
    // cabeçalho) também está)
    const cardPosicoes = metricas.getByText('Posições abertas', { exact: true }).locator('xpath=../..');
    const posicoesTexto = await cardPosicoes.textContent();

    // valor real vindo da API, comparado ao que a tela mostra -- nunca preso em 0 se a API diz outra coisa
    const resposta = await page.request.get('http://localhost:5184/api/v2/champion');
    const json = await resposta.json();
    const posicoesReais = (json.posicoes ?? []).length;

    if (posicoesReais > 0) {
      expect(posicoesTexto).toContain(String(posicoesReais));
    }
  });

  test('gráficos continuam utilizáveis (SVG presente, não substituído por placeholder vazio)', async ({ page }) => {
    await page.goto('/champion');
    await page.waitForTimeout(2000);
    const svgCount = await page.locator('main svg').count();
    expect(svgCount, 'waterfall/curva/drawdown deveriam continuar renderizando SVG com reduced motion').toBeGreaterThan(0);
  });

  test('settlement flash (Settlement Capture) tem alternativa não animada — status legível sem transição', async ({ page }) => {
    await page.goto('/capture');
    await page.waitForTimeout(2000);
    await expect(page.getByText('5min')).toBeVisible();
    // o status de cada janela precisa estar como TEXTO, nunca só cor/animação
    const corpo = await page.textContent('body');
    expect(corpo).toMatch(/OBSERVANDO|POSIÇÃO ABERTA|FUNDING PENDENTE|FECHANDO|CONCLUÍDA|ERRO/i);
  });

  test('transições longas removidas: nenhuma transition-duration > 300ms em elementos visíveis', async ({ page }) => {
    await page.goto('/');
    await page.waitForTimeout(1500);
    const duracoesLongas = await page.evaluate(() => {
      const els = Array.from(document.querySelectorAll('main *'));
      let n = 0;
      for (const el of els) {
        const dur = window.getComputedStyle(el).transitionDuration;
        const ms = dur.split(',').map((d) => (d.trim().endsWith('ms') ? parseFloat(d) : parseFloat(d) * 1000));
        if (ms.some((m) => m > 300)) n++;
      }
      return n;
    });
    expect(duracoesLongas, 'com reduced motion, transições deveriam ser curtas/removidas').toBe(0);
  });
});
