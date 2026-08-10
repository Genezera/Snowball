import { useEffect, useState } from 'react';
import { buscarSystemHealth, type Resultado } from '../services/api';

const INTERVALO_MS = 10_000;

/** Lê `/api/v2/system-health` — saúde do motor 2-ex + scanner + spot-perp. Só LEITURA. */
export function useSystemHealth() {
  const [resultado, setResultado] = useState<Resultado<{ dominios: any[]; geradoEm: number } | null> | null>(null);
  useEffect(() => {
    let ativo = true;
    let timer: ReturnType<typeof setTimeout> | null = null;
    async function tick() {
      const r = await buscarSystemHealth();
      if (!ativo) return;
      setResultado(r);
      timer = setTimeout(tick, INTERVALO_MS);
    }
    tick();
    return () => { ativo = false; if (timer) clearTimeout(timer); };
  }, []);
  return resultado;
}
