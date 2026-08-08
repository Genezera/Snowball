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
    await expect(page.getByText('Capital · PAPER').first()).toBeVisible({ timeout: 10_000 });
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
    // o AnimatedNumber vive no MetricCard; o Portfolio usa MetricCard para o
    // "Capital realizado". Verifica que o número exibido bate com a API, nunca
    // preso em 0 (o bug histórico) sob reduced motion.
    await page.goto('/portfolio');
    await expect(page.getByRole('heading', { name: 'Portfolio' })).toBeVisible();
    await page.waitForTimeout(2000);

    const card = page.getByText('Capital realizado', { exact: true }).locator('xpath=../..');
    const texto = await card.textContent();

    const resposta = await page.request.get('http://localhost:5184/api/v2/champion');
    const json = await resposta.json();
    const capital = json.estado?.capital;
    if (capital != null && capital > 0) {
      // parte inteira do capital (ex.: "608") deve aparecer — nunca só "0"
      expect(texto).toContain(String(Math.floor(capital)).slice(0, 3));
      expect(texto).not.toMatch(/US\$\s*0,00\s*$/);
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
    // exact:true — sem isso, 'min' casa também contadores como "55min 14s"
    // ou "25min 3s" (o "5min" aparece como substring), causando strict-mode
    // violation intermitente conforme o valor VIVO do contador. Flaky real
    // revelado pela suíte consolidada #2; o alvo é o RÓTULO da janela de 5min.
    await expect(page.getByText('5min', { exact: true }).first()).toBeVisible();
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
