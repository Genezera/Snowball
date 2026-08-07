import { motion, useReducedMotion } from 'framer-motion';

interface Props {
  value: number;
  formatar: (v: number) => string;
  className?: string;
}

/**
 * Número que anima suavemente até o novo valor.
 *
 * Achado ao vivo (bug real, pego testando no navegador): a versão anterior
 * usava `useSpring` + assinatura assíncrona (`spring.on('change', cb)` e
 * depois `useMotionValueEvent`) pra atualizar um `useState` próprio — o
 * texto exibido dependia de um evento disparar, não do valor renderizado.
 * Em pelo menos um caso real (o card "Posições abertas" indo de 0 pra 2
 * quando a primeira posição abriu) o evento nunca disparava e o número
 * ficava travado no valor inicial pra sempre, enquanto o RESTO da página
 * (fora do AnimatedNumber) mostrava o valor certo — inconsistência visível
 * na tela real, não hipotética.
 *
 * Esta versão nunca depende de um evento externo pra decidir o que
 * mostrar: o texto vem SEMPRE de `formatar(value)` no próprio render — o
 * mesmo dado que o resto da página usa. A animação é só cosmética (fade +
 * leve deslocamento vertical no texto, via `key={texto}` no motion.span),
 * nunca pode deixar o número desatualizado porque não existe estado
 * intermediário que precise de um evento pra ser corrigido.
 */
export function AnimatedNumber({ value, formatar, className }: Props) {
  const reduzMovimento = useReducedMotion();
  const texto = formatar(value);
  if (reduzMovimento) return <span className={className + ' tabular'}>{texto}</span>;
  return (
    <motion.span
      key={texto}
      className={className + ' tabular'}
      initial={{ opacity: 0, y: -4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
      style={{ display: 'inline-block' }}
    >
      {texto}
    </motion.span>
  );
}
