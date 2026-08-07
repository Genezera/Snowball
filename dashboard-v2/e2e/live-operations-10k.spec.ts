import { test, expect } from './fixtures';

/**
 * Live Operations com 10.000 eventos (item 15) — o sistema real ainda não
 * acumulou 10k eventos organicamente (roda há poucos dias), então este
 * teste INJETA um lote sintético via mock da resposta de
 * `/api/v2/events`, exatamente como os testes de "10.000 eventos" já
 * feitos no backend (dashboard-v2/api/tests/eventos.test.ts) — aqui o
 * alvo é o FRONTEND: tempo de render, memória, scroll, dedup,
 * freeze/resume e sobretudo VIRTUALIZAÇÃO (nunca 10.000 nós DOM reais
 * simultâneos).
 *
 * O mock devolve sempre o MESMO lote de 10k com `hasMore:false` — o hook
 * já deduplica por eventId (idsVistosRef), então polls repetidos com o
 * mesmo lote nunca inflam o total além de 10.000. Mais simples e sem
 * estado de closure do que alternar resposta por chamada.
 */
function gerarLoteSintetico(quantidade: number) {
  const eventos = Array.from({ length: quantidade }, (_, i) => ({
    eventId: `challenger-sintetico:g0:b${i}`,
    sequenceNumber: i + 1,
    cycleId: null,
    challengerId: 'challenger-sintetico',
    timestamp: Date.now() - (quantidade - i) * 1000,
    evento: 'bloqueado',
    motivo: `evento sintético #${i}`,
    idLegado: false,
  }));
  return {
    ok: true,
    eventos,
    nextCursor: 'cursor-sintetico-fixo',
    hasMore: false,
    serverTime: Date.now(),
    oldestAvailableCursor: '',
    cobertura: { challengersDeclarados: 47, challengersComEstado: 47, challengersComDiario: 47, challengersComEventosNaJanela: 1, challengersSemEventosNaJanela: 46, challengersComErroDeLeitura: 0, linhas: [] },
  };
}

async function montarMock10k(page: import('@playwright/test').Page) {
  const corpo = JSON.stringify(gerarLoteSintetico(10_000));
  await page.route('**/api/v2/events**', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: corpo }));
}

test.describe('Live Operations — 10.000 eventos sintéticos', () => {
  test('renderiza sem manter 10.000 nós DOM simultâneos (virtualização obrigatória)', async ({ page }) => {
    await montarMock10k(page);

    const t0 = Date.now();
    await page.goto('/live');
    await page.waitForFunction(() => {
      const el = document.querySelector('[data-testid="event-timeline-scroll"]');
      return el && Number(el.getAttribute('data-total-eventos') ?? 0) >= 10_000;
    }, { timeout: 30_000 });
    const tempoRenderMs = Date.now() - t0;

    const nosDom = await page.locator('[data-testid="event-timeline-scroll"] [data-index]').count();
    const memoria = await page.evaluate(() => (performance as any).memory ? Math.round((performance as any).memory.usedJSHeapSize / 1e6) : null);

    // eslint-disable-next-line no-console
    console.log(`[10k] tempo até 10.000 eventos na lista lógica: ${tempoRenderMs}ms | nós DOM reais: ${nosDom} | memória: ${memoria}MB`);

    expect(nosDom, 'virtualização: nunca 10.000 nós DOM reais simultâneos').toBeLessThan(200);

    // scroll até o fim continua funcionando (virtualizer recalcula a janela)
    await page.locator('[data-testid="event-timeline-scroll"]').evaluate((el) => { el.scrollTop = el.scrollHeight; });
    await page.waitForTimeout(300);
    const nosDomAposScroll = await page.locator('[data-testid="event-timeline-scroll"] [data-index]').count();
    expect(nosDomAposScroll).toBeGreaterThan(0);
    expect(nosDomAposScroll).toBeLessThan(200);

    // zero duplicado mesmo com 10k
    const indices = await page.locator('[data-testid="event-timeline-scroll"] [data-index]').evaluateAll((els) => els.map((e) => e.getAttribute('data-index')));
    expect(new Set(indices).size).toBe(indices.length);
  });

  test('filtros continuam responsivos com 10.000 eventos carregados', async ({ page }) => {
    await montarMock10k(page);
    await page.goto('/live');
    await page.waitForFunction(() => {
      const el = document.querySelector('[data-testid="event-timeline-scroll"]');
      return el && Number(el.getAttribute('data-total-eventos') ?? 0) >= 10_000;
    }, { timeout: 30_000 });

    const busca = page.getByPlaceholder('Buscar…');
    const t0 = Date.now();
    await busca.fill('sintético #500');
    await page.waitForTimeout(200);
    const tempoFiltroMs = Date.now() - t0;
    // eslint-disable-next-line no-console
    console.log(`[10k] tempo pra aplicar filtro de busca: ${tempoFiltroMs}ms`);
    expect(tempoFiltroMs).toBeLessThan(3000);
  });

  test('congelar/retomar continua funcionando com 10.000 eventos já carregados', async ({ page }) => {
    await montarMock10k(page);
    await page.goto('/live');
    await page.waitForFunction(() => {
      const el = document.querySelector('[data-testid="event-timeline-scroll"]');
      return el && Number(el.getAttribute('data-total-eventos') ?? 0) >= 10_000;
    }, { timeout: 30_000 });

    await page.getByRole('button', { name: '⏸ congelar' }).click();
    await expect(page.getByRole('button', { name: /retomar/ })).toBeVisible();
    await page.getByRole('button', { name: /retomar/ }).click();
    await expect(page.getByRole('button', { name: '⏸ congelar' })).toBeVisible();
  });

  test('troca de página e retorno: virtualização se reestabelece, sem vazar nós DOM nem duplicar (item 12)', async ({ page }) => {
    await montarMock10k(page);
    await page.goto('/live');
    const esperar10k = () => page.waitForFunction(() => {
      const el = document.querySelector('[data-testid="event-timeline-scroll"]');
      return el && Number(el.getAttribute('data-total-eventos') ?? 0) >= 10_000;
    }, { timeout: 30_000 });
    await esperar10k();

    // sai da página (Command Center) e volta pra Live Operations
    await page.getByRole('link', { name: 'Command Center' }).click();
    await expect(page.getByRole('heading', { name: 'Command Center' })).toBeVisible();
    await page.getByRole('link', { name: 'Live Operations' }).click();
    await esperar10k();

    // virtualização segue ativa após a remontagem — nunca 10k nós reais
    const nosDom = await page.locator('[data-testid="event-timeline-scroll"] [data-index]').count();
    expect(nosDom, 'após voltar pra página, a virtualização precisa continuar ativa').toBeLessThan(200);

    // zero duplicado após a remontagem (o Set de dedup é recriado do zero
    // com a página, e o mesmo lote de 10k volta a ser lido — não pode gerar
    // 20k nem índices repetidos)
    const totalLogico = await page.locator('[data-testid="event-timeline-scroll"]').getAttribute('data-total-eventos');
    expect(Number(totalLogico), 'voltar pra página não pode dobrar o total lógico').toBe(10_000);
    const indices = await page.locator('[data-testid="event-timeline-scroll"] [data-index]').evaluateAll((els) => els.map((e) => e.getAttribute('data-index')));
    expect(new Set(indices).size).toBe(indices.length);
  });
});
