import { DICT } from './dict';
import { useLangStore, type Lang } from './store';

export type { Lang };
export { useLangStore };

/**
 * translate(lang, pt) — em 'pt' devolve a própria string (comportamento original
 * intacto); em 'en' devolve a tradução do dicionário, ou a string original com um
 * aviso em dev quando faltar tradução (nunca quebra a UI).
 */
export function translate(lang: Lang, pt: string): string {
  if (lang === 'pt') return pt;
  const en = DICT[pt];
  if (en == null) {
    if (import.meta.env.DEV) console.warn('[i18n] tradução EN ausente:', JSON.stringify(pt));
    return pt;
  }
  return en;
}

/** Locale para APIs de formatação (Intl / toLocaleString) conforme o idioma. */
export function localeDe(lang: Lang): string { return lang === 'en' ? 'en-US' : 'pt-BR'; }

/** Idioma atual (reativo). */
export function useLang(): Lang { return useLangStore((s) => s.lang); }

/** Hook: retorna t(pt) já ligado ao idioma atual (re-renderiza ao alternar). */
export function useT(): (pt: string) => string {
  const lang = useLangStore((s) => s.lang);
  return (pt: string) => translate(lang, pt);
}
