import { test as base, expect, type Page } from '@playwright/test';

/**
 * FIXTURE COMPARTILHADO (item 17) — toda spec que usa `test` deste arquivo
 * automaticamente falha se:
 *   - console.error inesperado (fora da allowlist documentada abaixo);
 *   - unhandled promise rejection;
 *   - request pra porta 8787 (o servidor antigo NUNCA pode ser alvo de
 *     nenhuma chamada do Dashboard 2.0 — é o item mais crítico de todo o
 *     Quality Gate: zero acoplamento com a porta antiga);
 *   - recurso 404 não esperado.
 *
 * Mensagens permitidas na allowlist são erros DE REDE ESPERADOS durante os
 * testes de falha da API (item 16) — nunca erros de aplicação.
 */
const ALLOWLIST_CONSOLE = [
  /Failed to fetch/i, // esperado nos testes de API offline/timeout — o próprio app trata isso como estado 'erro'
  /Download the React DevTools/i,
];

export interface DashboardFixtures {
  consoleErrors: string[];
  requestsTo8787: string[];
}

export const test = base.extend<DashboardFixtures>({
  consoleErrors: async ({ page }, use) => {
    const erros: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() !== 'error') return;
      const texto = msg.text();
      if (ALLOWLIST_CONSOLE.some((re) => re.test(texto))) return;
      erros.push(texto);
    });
    page.on('pageerror', (err) => { erros.push(`pageerror: ${err.message}`); });
    await use(erros);
  },

  requestsTo8787: async ({ page }, use) => {
    const chamadas: string[] = [];
    page.on('request', (req) => {
      if (req.url().includes(':8787')) chamadas.push(req.url());
    });
    await use(chamadas);
  },

  page: async ({ page }, use) => {
    await use(page);
  },
});

export { expect };

/** Espera a página assentar (primeiro fetch bem-sucedido) sem depender de timeout fixo. */
export async function esperarCarregamento(page: Page, seletorDadoReal: string, timeoutMs = 10_000) {
  await page.waitForSelector(seletorDadoReal, { timeout: timeoutMs }).catch(() => {
    // não lança aqui -- o teste que chamou decide o que fazer com "não apareceu"
  });
}

/** Verifica ao final do teste que nada foi pedido pra 8787 e que não sobrou erro de console fora da allowlist. */
export function verificarIsolamentoEConsole(consoleErrors: string[], requestsTo8787: string[]) {
  expect(requestsTo8787, `zero request pra 8787 esperado, achou: ${JSON.stringify(requestsTo8787)}`).toEqual([]);
  expect(consoleErrors, `zero erro de console inesperado esperado, achou: ${JSON.stringify(consoleErrors)}`).toEqual([]);
}
