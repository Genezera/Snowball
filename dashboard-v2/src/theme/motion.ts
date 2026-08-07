/**
 * MOTION SYSTEM — tokens centralizados, únicos usados em todo o dashboard.
 * Nenhuma página define timing/easing próprio — todas importam daqui.
 * Respeita `prefers-reduced-motion` automaticamente (ver `useReducedMotion`
 * do framer-motion, usado nos componentes que consomem isto).
 */
import type { Transition, Variants } from 'framer-motion';

export const duration = { fast: 0.12, normal: 0.22, slow: 0.42 } as const;
export const ease = {
  standard: [0.4, 0, 0.2, 1] as const,
  entrance: [0.16, 1, 0.3, 1] as const,
  exit: [0.4, 0, 1, 1] as const,
};
export const stagger = { small: 0.04, large: 0.09 } as const;

export const transitionStandard: Transition = { duration: duration.normal, ease: ease.standard };
export const transitionEntrance: Transition = { duration: duration.normal, ease: ease.entrance };
export const transitionExit: Transition = { duration: duration.fast, ease: ease.exit };

/** Entrada de página — usado no wrapper de toda página nova. */
export const pageEnter: Variants = {
  hidden: { opacity: 0, y: 8 },
  visible: { opacity: 1, y: 0, transition: transitionEntrance },
};

/** Lista com stagger — usado em grids de card e linhas de tabela que entram juntas. */
export const staggerContainer = (gap: keyof typeof stagger = 'small'): Variants => ({
  hidden: {},
  visible: { transition: { staggerChildren: stagger[gap] } },
});
export const staggerItem: Variants = {
  hidden: { opacity: 0, y: 6 },
  visible: { opacity: 1, y: 0, transition: transitionEntrance },
};

/** Mudança de status (led, pill) — pulso curto, nunca looping infinito sem motivo. */
export const statusPulse: Variants = {
  initial: { scale: 1 },
  changed: { scale: [1, 1.25, 1], transition: { duration: duration.slow, ease: ease.standard } },
};

/** Evento novo entrando numa timeline — desliza e clareia, sem empurrar o scroll do usuário. */
export const eventEnter: Variants = {
  hidden: { opacity: 0, x: -6, backgroundColor: 'var(--surface-2)' },
  visible: { opacity: 1, x: 0, transition: transitionEntrance },
};

/** Settlement/funding recebido — destaque breve em verde, nunca permanente. */
export const settlementFlash: Variants = {
  initial: { boxShadow: '0 0 0 0 var(--gain-glow)' },
  flash: { boxShadow: ['0 0 0 0 var(--gain-glow)', '0 0 0 6px var(--gain-glow)', '0 0 0 0 transparent'], transition: { duration: duration.slow * 1.6 } },
};

/** Alerta/erro — mesmo princípio, em vermelho, breve. */
export const alertFlash: Variants = {
  initial: { boxShadow: '0 0 0 0 var(--loss-glow)' },
  flash: { boxShadow: ['0 0 0 0 var(--loss-glow)', '0 0 0 6px var(--loss-glow)', '0 0 0 0 transparent'], transition: { duration: duration.slow * 1.6 } },
};

/** Expansão de painel (accordion, detalhe de posição). */
export const panelExpand: Variants = {
  collapsed: { height: 0, opacity: 0 },
  expanded: { height: 'auto', opacity: 1, transition: transitionStandard },
};

/** Mudança de ranking — reordenação suave via layout animation do framer-motion (usar `layout` no elemento + este transition). */
export const rankingReorder: Transition = { duration: duration.normal, ease: ease.standard };
