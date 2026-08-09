import { useEffect, useState } from 'react';
import { buscarCompetidores, type Resultado } from '../services/api';

const INTERVALO_MS = 10_000;

/** Lê `/api/v2/competidores` — detalhe rico da dupla 2-exchange. Só LEITURA. */
export function useCompetidores() {
  const [resultado, setResultado] = useState<Resultado<{ competidores: any[] } | null> | null>(null);
  useEffect(() => {
    let ativo = true;
    let timer: ReturnType<typeof setTimeout> | null = null;
    async function tick() {
      const r = await buscarCompetidores();
      if (!ativo) return;
      setResultado(r);
      timer = setTimeout(tick, INTERVALO_MS);
    }
    tick();
    return () => { ativo = false; if (timer) clearTimeout(timer); };
  }, []);
  return resultado;
}
