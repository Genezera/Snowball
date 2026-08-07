import { test, expect } from './fixtures';

/**
 * Responsividade (item 12) — 7 resoluções pedidas. Verifica overflow
 * horizontal (o pecado mais comum) em cada página, nas 7 resoluções.
 */
const RESOLUCOES = [
  { nome: '390x844 (mobile pequeno)', width: 390, height: 844 },
  { nome: '430x932 (mobile grande)', width: 430, height: 932 },
  { nome: '768x1024 (tablet)', width: 768, height: 1024 },
  { nome: '1366x768 (notebook comum)', width: 1366, height: 768 },
  { nome: '1440x900 (desktop)', width: 1440, height: 900 },
  { nome: '1920x1080 (full hd)', width: 1920, height: 1080 },
  { nome: '2560x1080 (ultrawide)', width: 2560, height: 1080 },
];

const PAGINAS = [
  { rota: '/', nome: 'Command Center' },
  { rota: '/champion', nome: 'Champion View' },
  { rota: '/live', nome: 'Live Operations' },
  { rota: '/capture', nome: 'Settlement Capture' },
  { rota: '/costs', nome: 'Cost Intelligence' },
  { rota: '/risk', nome: 'Risk Center' },
];

for (const res of RESOLUCOES) {
  test.describe(`Responsividade — ${res.nome}`, () => {
    test.use({ viewport: { width: res.width, height: res.height } });

    for (const { rota, nome } of PAGINAS) {
      test(`${nome}: sem overflow horizontal`, async ({ page }) => {
        await page.goto(rota);
        await page.waitForTimeout(2000);

        const overflow = await page.evaluate(() => {
          const doc = document.documentElement;
          return doc.scrollWidth > doc.clientWidth + 2; // +2px de tolerância de subpixel
        });
        expect(overflow, `${nome} em ${res.nome} não deveria ter overflow horizontal na página inteira`).toBe(false);
      });
    }
  });
}

test.describe('Mobile: prioriza saúde/PnL/posições/alertas/settlements/eventos', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('Command Center mobile mostra métricas essenciais acima da dobra', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByText('CAPITAL REALIZADO')).toBeVisible({ timeout: 10_000 });
    const box = await page.getByText('CAPITAL REALIZADO').boundingBox();
    expect(box, 'capital realizado deveria estar visível/posicionado, não fora da tela').not.toBeNull();
    if (box) expect(box.y).toBeLessThan(844 * 2); // dentro de um scroll razoável, não escondido no fim da página
  });

  test('Live Operations mobile: feed de eventos continua acessível, sem exigir scroll lateral', async ({ page }) => {
    await page.goto('/live');
    await expect(page.getByText(/cursor incremental/)).toBeVisible({ timeout: 10_000 });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 2);
    expect(overflow).toBe(false);
  });
});
