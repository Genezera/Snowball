import { motion } from 'framer-motion';

export interface CoreNode {
  id: string;
  label: string;
  value: number;
  color: string;
  x: number; y: number;
}

interface Props {
  championCapital: number;
  challengersCapital: number;
  numeroChallengers: number;
}

/**
 * "Snowball Core" — mapa central pedido no Command Center. Não é
 * decorativo: o tamanho de cada nó é proporcional ao capital virtual real
 * daquela família, e as linhas representam o fluxo de dado real (o mesmo
 * feed que os challengers e o champion compartilham) — não uma metáfora
 * vazia. Leve o bastante (SVG puro) pra não pesar no FCP.
 */
export function SnowballCore({ championCapital, challengersCapital, numeroChallengers }: Props) {
  const total = Math.max(1, championCapital + challengersCapital);
  const rChampion = 26 + 22 * Math.sqrt(championCapital / total);
  const rChallengers = 26 + 22 * Math.sqrt(challengersCapital / total);

  const nodes: CoreNode[] = [
    { id: 'champion', label: 'Champion', value: championCapital, color: 'var(--engine-funding)', x: 130, y: 90 },
    { id: 'challengers', label: `${numeroChallengers} Challengers`, value: challengersCapital, color: 'var(--engine-capture)', x: 320, y: 90 },
    { id: 'momentum', label: 'Momentum', value: 0, color: 'var(--engine-momentum)', x: 90, y: 200 },
    { id: 'pairs', label: 'Pairs', value: 0, color: 'var(--engine-pairs)', x: 220, y: 220 },
    { id: 'baselines', label: 'Baselines', value: 0, color: 'var(--engine-baseline)', x: 350, y: 200 },
  ];

  return (
    <svg viewBox="0 0 440 260" width="100%" height="260" role="img" aria-label="Mapa do Snowball Core: fluxo de capital entre champion, challengers e motores independentes">
      <defs>
        <radialGradient id="core-glow" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="var(--brass-glow)" />
          <stop offset="100%" stopColor="transparent" />
        </radialGradient>
      </defs>
      <circle cx="220" cy="140" r="90" fill="url(#core-glow)" opacity="0.4" />

      {/* linhas de fluxo — mesmo feed real (vigilância) compartilhado entre champion e challengers */}
      {nodes.slice(1).map((n) => (
        <motion.line
          key={n.id} x1="220" y1="140" x2={n.x} y2={n.y}
          stroke="var(--border-subtle)" strokeWidth="1.4"
          initial={{ pathLength: 0, opacity: 0 }} animate={{ pathLength: 1, opacity: 1 }}
          transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
        />
      ))}

      {/* núcleo central */}
      <circle cx="220" cy="140" r="14" fill="var(--surface-2)" stroke="var(--brass-300)" strokeWidth="1.4" />
      <text x="220" y="144" textAnchor="middle" fontSize="8" fill="var(--ink-1)" fontWeight={700}>CORE</text>

      {nodes.map((n, i) => {
        const r = n.id === 'champion' ? rChampion : n.id === 'challengers' ? rChallengers : 20;
        return (
          <motion.g key={n.id} initial={{ opacity: 0, scale: 0.7 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 0.3, delay: 0.1 + i * 0.06, ease: [0.16, 1, 0.3, 1] }}>
            <circle cx={n.x} cy={n.y} r={r} fill="var(--surface-1)" stroke={n.color} strokeWidth="1.6" opacity={0.92} />
            <text x={n.x} y={n.y - 2} textAnchor="middle" fontSize="9" fontWeight={700} fill="var(--ink-0)">{n.label}</text>
            {n.value > 0 && <text x={n.x} y={n.y + 10} textAnchor="middle" fontSize="8" fill="var(--ink-3)">${n.value.toFixed(0)}</text>}
          </motion.g>
        );
      })}
    </svg>
  );
}
