import { create } from 'zustand';

/**
 * Idioma da interface. Padrão = 'pt' (mantém o comportamento original e os
 * testes E2E, que assertam em português). Ao alternar para 'en', o helper t()
 * troca cada string pela tradução do dicionário. Persiste em localStorage.
 */
export type Lang = 'pt' | 'en';

const KEY = 'snowball.lang';

function inicial(): Lang {
  try {
    const v = localStorage.getItem(KEY);
    if (v === 'en' || v === 'pt') return v;
  } catch { /* SSR / storage bloqueado */ }
  return 'pt';
}

function aplicarHtmlLang(lang: Lang) {
  if (typeof document !== 'undefined') document.documentElement.lang = lang === 'en' ? 'en' : 'pt-BR';
}

interface LangState {
  lang: Lang;
  setLang: (l: Lang) => void;
  toggle: () => void;
}

export const useLangStore = create<LangState>((set, get) => {
  const lang = inicial();
  aplicarHtmlLang(lang);
  return {
    lang,
    setLang: (l) => {
      try { localStorage.setItem(KEY, l); } catch { /* ignore */ }
      aplicarHtmlLang(l);
      set({ lang: l });
    },
    toggle: () => get().setLang(get().lang === 'pt' ? 'en' : 'pt'),
  };
});
