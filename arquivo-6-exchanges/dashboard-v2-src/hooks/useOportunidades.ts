import { useEffect, useState } from 'react';
import { buscarOportunidades, type Resultado } from '../services/api';
import type { OportunidadesResposta } from '../schemas/opportunities';

const INTERVALO_MS = 30_000; // oportunidades mudam devagar; 30s é sobra

/**
 * Lê o endpoint read-only `/api/v2/opportunities`, que AGREGA a fonte
 * persistente do motor. O frontend só LÊ — nunca produz nem preserva
 * oportunidades. Fechar a página não perde nada: a coleta é do motor.
 */
export function useOportunidades() {
  const [resultado, setResultado] = useState<Resultado<OportunidadesResposta> | null>(null);

  useEffect(() => {
    let ativo = true;
    let timer: ReturnType<typeof setTimeout> | null = null;
    async function tick() {
      const r = await buscarOportunidades();
      if (!ativo) return;
      setResultado(r);
      timer = setTimeout(tick, INTERVALO_MS);
    }
    tick();
    return () => { ativo = false; if (timer) clearTimeout(timer); };
  }, []);

  return resultado;
}
