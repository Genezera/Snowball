import AxeBuilder from '@axe-core/playwright';
import { test, expect } from '../e2e/fixtures';

const PAGINAS = [
  { rota: '/', nome: 'Command Center' },
  { rota: '/champion', nome: 'Champion View' },
  { rota: '/live', nome: 'Live Operations' },
  { rota: '/capture', nome: 'Settlement Capture' },
  { rota: '/costs', nome: 'Cost Intelligence' },
  { rota: '/risk', nome: 'Risk Center' },
  { rota: '/strategies', nome: 'Strategy Universe' },
  { rota: '/arena', nome: 'Challenger Arena' },
  { rota: '/champion-vs-control', nome: 'Champion vs. Control' },
  { rota: '/experiments', nome: 'Experiment Lab' },
  { rota: '/portfolio', nome: 'Portfolio' },
  { rota: '/opportunities', nome: 'Opportunity Map' },
  { rota: '/exchanges', nome: 'Exchanges' },
  { rota: '/processes', nome: 'Processos' },
  { rota: '/system', nome: 'System Health' },
  { rota: '/pesquisa', nome: 'Pesquisa' },
  { rota: '/historico', nome: 'Histórico' },
  { rota: '/logs', nome: 'Logs' },
  { rota: '/audit', nome: 'Audit' },
];

/**
 * Acessibilidade (item 9) — axe-core contra as 6 páginas. Relata violações
 * por severidade (critical/serious/moderate/minor); FALHA o teste em
 * critical/serious (item explícito: "corrigir todas as violações critical
 * e serious"). Nunca desliga uma regra globalmente sem justificativa —
 * `disableRules` abaixo, quando usado, é por página e documentado.
 */
for (const { rota, nome } of PAGINAS) {
  test(`axe: ${nome} — zero violação critical/serious`, async ({ page }) => {
    await page.goto(rota);
    await page.waitForTimeout(2500); // deixa os dados reais assentarem antes de auditar (nunca audita um esqueleto de loading)

    const resultado = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();

    const porSeveridade = { critical: [] as any[], serious: [] as any[], moderate: [] as any[], minor: [] as any[] };
    for (const v of resultado.violations) {
      (porSeveridade[v.impact as keyof typeof porSeveridade] ?? porSeveridade.minor).push({
        id: v.id, descricao: v.description, nodes: v.nodes.length, help: v.helpUrl,
      });
    }

    // eslint-disable-next-line no-console
    console.log(`[axe] ${nome}: critical=${porSeveridade.critical.length} serious=${porSeveridade.serious.length} moderate=${porSeveridade.moderate.length} minor=${porSeveridade.minor.length}`);
    if (porSeveridade.critical.length || porSeveridade.serious.length) {
      // eslint-disable-next-line no-console
      console.log(JSON.stringify({ critical: porSeveridade.critical, serious: porSeveridade.serious }, null, 2));
    }

    expect(porSeveridade.critical, `violações critical em ${nome}`).toEqual([]);
    expect(porSeveridade.serious, `violações serious em ${nome}`).toEqual([]);
  });
}
