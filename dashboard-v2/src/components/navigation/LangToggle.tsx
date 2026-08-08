import { useLangStore } from '../../i18n/store';
import { useT } from '../../i18n';

/**
 * Botão de idioma (PT / EN) — fica no header, ao lado do relógio. Controle
 * segmentado compacto: o idioma ativo fica destacado; clicar no outro troca.
 * Persiste em localStorage e ajusta <html lang>.
 */
export function LangToggle() {
  const lang = useLangStore((s) => s.lang);
  const setLang = useLangStore((s) => s.setLang);
  const t = useT();

  const opcoes: { id: 'pt' | 'en'; rotulo: string }[] = [
    { id: 'pt', rotulo: 'PT' },
    { id: 'en', rotulo: 'EN' },
  ];

  return (
    <div
      role="group"
      aria-label={t('Idioma')}
      title={t('Trocar idioma')}
      style={{
        display: 'flex', alignItems: 'center', flex: 'none',
        padding: 2, borderRadius: 'var(--radius-full)',
        background: 'var(--surface-glass)', border: '1px solid var(--border-subtle)',
      }}
    >
      {opcoes.map((o) => {
        const ativo = lang === o.id;
        return (
          <button
            key={o.id}
            type="button"
            onClick={() => setLang(o.id)}
            aria-pressed={ativo}
            aria-label={o.id === 'en' ? 'English' : 'Português'}
            style={{
              appearance: 'none', cursor: 'pointer', border: 'none', margin: 0,
              padding: '3px 9px', borderRadius: 'var(--radius-full)',
              fontSize: 'var(--text-2xs)', fontWeight: 800, letterSpacing: '0.04em',
              color: ativo ? 'var(--snow-text-primary)' : 'var(--ink-3)',
              background: ativo ? 'linear-gradient(90deg, rgba(23,217,255,0.20), rgba(23,217,255,0.05))' : 'transparent',
              boxShadow: ativo ? 'inset 0 0 0 1px var(--border-strong)' : 'none',
              transition: 'color var(--dur-fast) var(--ease-out), background var(--dur-fast) var(--ease-out)',
            }}
          >
            {o.rotulo}
          </button>
        );
      })}
    </div>
  );
}
