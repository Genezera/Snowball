import { useEffect, useState } from 'react';
import { buscarMaximizacao, type Resultado } from '../services/api';

const INTERVALO_MS = 15_000;

/**
 * Lê `/api/v2/profit-maximization` — Champion + ranking 2-exchanges + head-to-head
 * ao vivo. Só LEITURA; a página nunca produz nem preserva dados.
 */
export function useMaximizacao() {
  const [resultado, setResultado] = useState<Resultado<{ dados: any } | null> | null>(null);
  useEffect(() => {
    let ativo = true;
    let timer: ReturnType<typeof setTimeout> | null = null;
    async function tick() {
      const r = await buscarMaximizacao();
      if (!ativo) return;
      setResultado(r);
      timer = setTimeout(tick, INTERVALO_MS);
    }
    tick();
    return () => { ativo = false; if (timer) clearTimeout(timer); };
  }, []);
  return resultado;
}
