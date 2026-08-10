/**
 * STORE AO VIVO — estado global mínimo e previsível (Zustand, sem
 * middleware extra). Guarda só o ÚLTIMO resultado válido de cada fonte + o
 * status da conexão. Nunca mistura os dois motores num objeto só — champion
 * e Profit Lab continuam fontes independentes, igual no backend.
 *
 * A API V2 não tem SSE (Parte 5 do pedido escolheu cursor incremental como
 * "alternativa aceitável" pro transporte de eventos; pros dois endpoints de
 * snapshot — champion e profit-lab — poll simples já é suficiente, o dado
 * em si já é barato de reler). Por isso isto é poll, não EventSource.
 */
import { create } from 'zustand';
import { buscarChampion, buscarProfitLab, type Resultado } from '../services/api';
import { type ChampionDados } from '../schemas/champion';
import { type ProfitLabDados } from '../schemas/profitLab';

type StatusConexao = 'conectando' | 'aoVivo' | 'reconectando';

const INTERVALO_CHAMPION_MS = 5000;
const INTERVALO_PROFIT_LAB_MS = 10000; // o Lab roda em ciclos de ~5min; 10s é sobra suficiente sem martelar o disco

interface LiveState {
  champion: Resultado<ChampionDados> | null;
  championStatus: StatusConexao;
  profitLab: Resultado<ProfitLabDados> | null;
  profitLabStatus: StatusConexao;
  iniciar: () => () => void;
}

function pollLoop<T>(
  buscar: () => Promise<Resultado<T>>, intervaloMs: number,
  onDado: (r: Resultado<T>) => void, onStatus: (s: StatusConexao) => void,
): () => void {
  let ativo = true;
  let tentativa = 0;
  let teveSucesso = false; // já recebeu ao menos um dado bom nesta sessão de poll
  let timer: ReturnType<typeof setTimeout> | null = null;

  async function tick() {
    if (!ativo) return;
    // "conectando" só na primeira tentativa de verdade (antes do 1º sucesso) — depois disso,
    // um re-poll normal NUNCA volta pra "conectando"/"reconectando" só por estar buscando de
    // novo. Só sai de "aoVivo" se o fetch FALHAR (senão fica cintilando a cada re-poll).
    if (!teveSucesso) onStatus('conectando');
    const r = await buscar();
    if (!ativo) return;
    onDado(r);
    if (r.estado === 'sucesso') { tentativa = 0; teveSucesso = true; onStatus('aoVivo'); }
    else { tentativa++; onStatus(teveSucesso ? 'reconectando' : 'conectando'); }
    timer = setTimeout(tick, intervaloMs);
  }
  tick();
  return () => { ativo = false; if (timer) clearTimeout(timer); };
}

export const useLiveStore = create<LiveState>((set) => ({
  champion: null,
  championStatus: 'conectando',
  profitLab: null,
  profitLabStatus: 'conectando',
  iniciar: () => {
    const pararChampion = pollLoop(buscarChampion, INTERVALO_CHAMPION_MS, (r) => set({ champion: r }), (s) => set({ championStatus: s }));
    const pararLab = pollLoop(buscarProfitLab, INTERVALO_PROFIT_LAB_MS, (r) => set({ profitLab: r }), (s) => set({ profitLabStatus: s }));
    return () => { pararChampion(); pararLab(); };
  },
}));

/** Idade em ms do último dado recebido — usado por todo componente pra decidir se mostra "stale". */
export function idadeDoDado(r: Resultado<unknown> | null): number | null {
  if (!r) return null;
  return Date.now() - r.recebidoEm;
}

export const LIMITE_STALE_MS = 90_000;
