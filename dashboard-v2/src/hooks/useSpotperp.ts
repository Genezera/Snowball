import { useEffect, useState } from 'react';
import { buscarSpotperp, type Resultado } from '../services/api';

const INTERVALO_MS = 30_000;

/** Lê `/api/v2/spotperp` — oportunidades reais de spot-perp (cash-and-carry no perp). Só LEITURA. */
export function useSpotperp() {
  const [resultado, setResultado] = useState<Resultado<{ total: number; porExchange: Record<string, number>; geradoEm: number | null; top: any[] } | null> | null>(null);
  useEffect(() => {
    let ativo = true;
    let timer: ReturnType<typeof setTimeout> | null = null;
    async function tick() {
      const r = await buscarSpotperp();
      if (!ativo) return;
      setResultado(r);
      timer = setTimeout(tick, INTERVALO_MS);
    }
    tick();
    return () => { ativo = false; if (timer) clearTimeout(timer); };
  }, []);
  return resultado;
}
