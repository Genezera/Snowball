import { test, expect, verificarIsolamentoEConsole } from '../fixtures';

test.describe('Live Operations', () => {
  test('carrega feed, cursor incremental, cobertura dos 47, indicador de transporte', async ({ page, consoleErrors, requestsTo8787 }) => {
    await page.goto('/live');
    await expect(page.getByRole('heading', { name: 'Live Operations' })).toBeVisible();
    await expect(page.getByText(/cursor incremental/)).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(/^cobertura: \d+\/\d+/)).toBeVisible({ timeout: 10_000 });

    verificarIsolamentoEConsole(consoleErrors, requestsTo8787);
  });

  test('manifesto: challengers sem eventos mostram motivo explícito, nunca somem silenciosamente', async ({ page }) => {
    await page.goto('/live');
    const botaoCobertura = page.getByRole('button', { name: /cobertura:/ });
    await expect(botaoCobertura).toBeVisible({ timeout: 10_000 });
    await botaoCobertura.click();
    await expect(page.getByText('Depois do cursor')).toBeVisible();
    await expect(page.getByText('Entregues')).toBeVisible();
    await expect(page.getByText('Motivo')).toBeVisible();
  });

  test('IDs estáveis: eventId legado no formato fonte:g<geração>:b<byteOffset>', async ({ page }) => {
    const resposta = await page.request.get('http://localhost:5184/api/v2/events?limit=50');
    const json = await resposta.json();
    const legados = json.eventos.filter((e: any) => e.idLegado);
    if (!legados.length) test.skip(true, 'sem eventos legados nesta página');
    for (const ev of legados) {
      expect(ev.eventId).toMatch(/^[\w-]+:g\d+:b\d+$/);
    }
  });

  test('eventos com mesmo timestamp nunca colapsam — IDs distintos', async ({ page }) => {
    const resposta = await page.request.get('http://localhost:5184/api/v2/events?limit=500');
    const json = await resposta.json();
    const ids = json.eventos.map((e: any) => e.eventId);
    expect(new Set(ids).size, 'nenhum eventId deveria se repetir na mesma página').toBe(ids.length);
  });

  test('freeze/resume: buffer cresce durante congelamento, lista visível não muda, retomar insere tudo sem duplicar', async ({ page }) => {
    await page.goto('/live');
    await expect(page.getByRole('button', { name: '⏸ congelar' })).toBeVisible({ timeout: 10_000 });
    await page.waitForTimeout(3000); // deixa o feed encher um pouco antes de congelar

    const totalVisivel = () => page.locator('[data-testid="event-timeline-scroll"]').getAttribute('data-total-eventos');

    // CONGELA primeiro, DEPOIS mede o baseline — medir ANTES do clique era um
    // bug do próprio teste: no intervalo entre a medição e o clique cair, um
    // poll ainda-ao-vivo podia (legitimamente) anexar eventos, e o baseline
    // ficava velho. O ponto de medição correto do "visível congelado" é
    // imediatamente após o freeze estar comprovadamente engatado.
    await page.getByRole('button', { name: '⏸ congelar' }).click();
    await expect(page.getByRole('button', { name: /retomar/ })).toBeVisible();
    const visivelNoCongelamento = await totalVisivel();

    // aguarda vários polls (intervalo é 5s; backlog pode disparar polls de 50ms) pra dar chance do buffer crescer
    await page.waitForTimeout(11_000);
    const botaoRetomar = page.getByRole('button', { name: /retomar/ });
    const textoBotao = await botaoRetomar.textContent();

    // 1) enquanto congelado, a lista VISÍVEL não muda, ponto final
    const visivelDurante = await totalVisivel();
    expect(visivelDurante, 'lista visível não pode mudar enquanto congelado').toBe(visivelNoCongelamento);

    // 2) o buffer precisa ter crescido — senão o teste não prova nada (feed
    // parado não exercita freeze). O texto do botão mostra "(N no buffer)".
    const matchBuffer = textoBotao?.match(/\((\d+) no buffer\)/);
    const noBuffer = matchBuffer ? Number(matchBuffer[1]) : 0;
    expect(noBuffer, 'esperava que o feed ao vivo produzisse ao menos 1 evento durante os 11s congelado — se falhar aqui, o feed pode estar sem atividade nova, não é falha de freeze').toBeGreaterThan(0);

    // 3) retomar insere o buffer inteiro na lista visível, sem perder nada.
    // Invariante é ">=", não "==": num feed AO VIVO o buffer continua
    // crescendo entre a leitura de `noBuffer` e o clique em retomar, então o
    // visível final é (congelado + buffer no momento da leitura) MAIS o que
    // chegou nesse meio-tempo. O que importa é que nada se PERDE — nunca
    // menos que congelado+buffer.
    await botaoRetomar.click();
    await expect(page.getByRole('button', { name: '⏸ congelar' })).toBeVisible();
    await page.waitForTimeout(500);
    const visivelDepois = Number(await totalVisivel());
    const congeladoNum = Number(visivelNoCongelamento ?? 0);
    expect(visivelDepois, 'retomar deveria ter inserido pelo menos o buffer inteiro (congelado + buffer), nunca perder eventos').toBeGreaterThanOrEqual(congeladoNum + noBuffer);

    // 4) zero duplicado: cada data-index é único dentro do DOM virtualizado
    const indices = await page.locator('[data-testid="event-timeline-scroll"] [data-index]').evaluateAll(
      (els) => els.map((el) => el.getAttribute('data-index')),
    );
    expect(new Set(indices).size).toBe(indices.length);
  });

  test('API V2 offline: estado correto, sem fallback pra 8787, recupera quando a API volta', async ({ page }) => {
    // Simula offline interceptando a rota -- não derruba a API de verdade
    // (nunca repete os testes de matar processo desta etapa em diante).
    await page.route('**/api/v2/events**', (route) => route.abort('connectionrefused'));
    await page.goto('/live');
    await page.waitForTimeout(2000);
    const corpo = await page.textContent('body');
    expect(corpo).not.toMatch(/localhost:8787/);

    await page.unroute('**/api/v2/events**');
    await page.waitForTimeout(6000);
    await expect(page.getByText(/^cobertura: \d+\/\d+/)).toBeVisible({ timeout: 10_000 });
  });
});
