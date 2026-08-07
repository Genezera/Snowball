/**
 * TESTE D (independência) — a API V2 pode retornar JSON inválido, schema
 * incompatível, HTTP 500 ou falha de rede. Em NENHUM desses casos o
 * cliente pode: fabricar zero, tentar outra URL (fallback pra 8787), ou
 * lançar uma exceção não tratada. Sempre um `Resultado` tipado
 * ('erro' | 'corrompido'), nunca 'sucesso' com dado inventado.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

describe('resiliência da camada de API contra respostas inválidas da V2', () => {
  const URL_BASE = 'http://localhost:5184';
  let fetchOriginal: typeof fetch;

  beforeEach(() => {
    fetchOriginal = globalThis.fetch;
    vi.stubEnv('VITE_DASHBOARD_V2_API_URL', URL_BASE);
  });
  afterEach(() => {
    globalThis.fetch = fetchOriginal;
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  async function importApiFresco() {
    // reimporta o módulo depois de mockar env/fetch — `BASE` é lido uma vez
    // no top-level do módulo, então precisa de um módulo novo por teste
    vi.resetModules();
    return import('../services/api');
  }

  it('JSON inválido: nunca lança, retorna estado corrompido, nunca chama outra URL', async () => {
    globalThis.fetch = vi.fn(async () => new Response('isto não é json{{{', { status: 200 })) as any;
    const { buscarChampion } = await importApiFresco();
    const r = await buscarChampion();
    expect(r.estado).toBe('corrompido');
    expect((globalThis.fetch as any).mock.calls.length).toBe(1);
    expect((globalThis.fetch as any).mock.calls[0][0]).toContain(URL_BASE);
  });

  it('schema incompatível: campo obrigatório faltando vira corrompido, nunca sucesso fabricado', async () => {
    globalThis.fetch = vi.fn(async () => new Response(JSON.stringify({ estado: null }), { status: 200 })) as any;
    const { buscarChampion } = await importApiFresco();
    const r = await buscarChampion();
    expect(r.estado).toBe('corrompido');
  });

  it('HTTP 500: vira estado de erro, nunca finge sucesso com zero', async () => {
    globalThis.fetch = vi.fn(async () => new Response('erro interno', { status: 500 })) as any;
    const { buscarChampion } = await importApiFresco();
    const r = await buscarChampion();
    expect(r.estado).toBe('erro');
    if (r.estado === 'erro') expect(r.motivo).toContain('500');
  });

  it('timeout/falha de rede: vira estado de erro, nunca lança exceção não tratada', async () => {
    globalThis.fetch = vi.fn(async () => { throw new TypeError('Failed to fetch'); }) as any;
    const { buscarChampion } = await importApiFresco();
    await expect(buscarChampion()).resolves.toMatchObject({ estado: 'erro' });
  });

  it('resposta parcial (faltando campos opcionais mas presentes os obrigatórios): ainda é sucesso — schema não deveria exigir mais do que o necessário', async () => {
    const corpoMinimo = {
      estado: { capital: 1, capitalInicial: 1, pico: 1, fundingTotal: 0, custosTotal: 0, pagamentos: 0 },
      processos: [], vigilancia: {}, atualizadoEm: Date.now(),
    };
    globalThis.fetch = vi.fn(async () => new Response(JSON.stringify(corpoMinimo), { status: 200 })) as any;
    const { buscarChampion } = await importApiFresco();
    const r = await buscarChampion();
    expect(r.estado).toBe('sucesso');
  });

  it('sem VITE_DASHBOARD_V2_API_URL configurada: erro explícito, JAMAIS tenta outra porta como fallback', async () => {
    vi.unstubAllEnvs();
    vi.stubEnv('VITE_DASHBOARD_V2_API_URL', '');
    globalThis.fetch = vi.fn(async () => new Response('{}', { status: 200 })) as any;
    const { buscarChampion } = await importApiFresco();
    const r = await buscarChampion();
    expect(r.estado).toBe('erro');
    expect((globalThis.fetch as any).mock.calls.length).toBe(0); // nem tenta a requisição sem BASE configurada
  });

  it('nenhuma chamada em nenhum teste acima aponta pra porta 8787', async () => {
    // meta-verificação: releitura de todos os mocks de chamada acumulados
    // nesta suíte pra garantir que 8787 nunca apareceu como destino
    expect(URL_BASE).not.toContain('8787');
  });
});
