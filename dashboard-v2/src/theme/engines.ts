/**
 * IDENTIDADE POR MOTOR — cada família tem símbolo + forma + cor, nunca só
 * cor (pedido explícito: "não depender somente de cores para distinguir
 * motores"). `glyph` é um path SVG simples (24×24 viewBox), pensado pra
 * ficar legível em 14px num badge de tabela e em 48px num card expandido.
 */
export type EngineId =
  | 'funding-champion' | 'funding-control' | 'funding-exploration'
  | 'settlement-capture' | 'momentum' | 'pairs' | 'baseline' | 'portfolio';

export interface EngineIdentity {
  id: EngineId;
  label: string;
  color: string;
  glow: string;
  /** path 'd' num viewBox 0 0 24 24 */
  glyph: string;
  /** textura de fundo sutil aplicada a cards desse motor — nunca mais que 4% de opacidade */
  pattern: 'diamond' | 'ring' | 'chevron' | 'molecule' | 'flatline' | 'hex' | 'shield' | 'shield-mirror';
}

export const ENGINES: Record<EngineId, EngineIdentity> = {
  'funding-champion': {
    id: 'funding-champion', label: 'Funding Arbitrage — Champion', color: 'var(--engine-funding)', glow: 'var(--brass-glow)',
    glyph: 'M12 2 L20 12 L12 22 L4 12 Z', pattern: 'shield',
  },
  'funding-control': {
    id: 'funding-control', label: 'Funding Arbitrage — Control', color: 'var(--engine-funding)', glow: 'var(--brass-glow)',
    glyph: 'M12 2 L20 12 L12 22 L4 12 Z M12 6 L16 12 L12 18 L8 12 Z', pattern: 'shield-mirror',
  },
  'funding-exploration': {
    id: 'funding-exploration', label: 'Funding Arbitrage — Exploration', color: 'var(--engine-funding)', glow: 'var(--brass-glow)',
    glyph: 'M12 3v3M12 18v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M3 12h3M18 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1', pattern: 'diamond',
  },
  'settlement-capture': {
    id: 'settlement-capture', label: 'Settlement Capture', color: 'var(--engine-capture)', glow: 'var(--slate-glow)',
    glyph: 'M12 2a10 10 0 100 20 10 10 0 000-20zM12 6v6l4 2', pattern: 'ring',
  },
  momentum: {
    id: 'momentum', label: 'Momentum', color: 'var(--engine-momentum)', glow: 'var(--gain-glow)',
    glyph: 'M3 17l6-6 4 4 8-9', pattern: 'chevron',
  },
  pairs: {
    id: 'pairs', label: 'Pairs Trading', color: 'var(--engine-pairs)', glow: 'var(--oracle-glow)',
    glyph: 'M8 12a4 4 0 118 0 4 4 0 01-8 0z M6 12h1 M17 12h1', pattern: 'molecule',
  },
  baseline: {
    id: 'baseline', label: 'Baseline', color: 'var(--engine-baseline)', glow: 'transparent',
    glyph: 'M3 12h18', pattern: 'flatline',
  },
  portfolio: {
    id: 'portfolio', label: 'Multi-Strategy Portfolio', color: 'var(--engine-portfolio)', glow: 'var(--loss-glow)',
    glyph: 'M12 2l8.5 5v10L12 22l-8.5-5V7z', pattern: 'hex',
  },
};

export function engineFor(familia: string | undefined, challengerId: string): EngineIdentity {
  if (challengerId.startsWith('capture-')) return ENGINES['settlement-capture'];
  if (challengerId.startsWith('baseline-')) return ENGINES.baseline;
  if (challengerId === 'challenger-control') return ENGINES['funding-control'];
  if (familia === 'control') return ENGINES['funding-control'];
  return ENGINES['funding-exploration'];
}
