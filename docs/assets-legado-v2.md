# Assets — origem (legado) → destino (Snowball Dashboard V2)

Todos os assets oficiais usados pelo legado e ainda necessários estão presentes
no V2. **Os originais foram preservados** (nunca apagados).

| Asset | Origem (legado) | Destino (V2) | Observação |
|---|---|---|---|
| Logo principal | `assets/logo.png` | `dashboard-v2/public/brand/logos/snowball-logo.png` | logo oficial |
| Logo fundo branco | `assets/logo-fundo-branco.png` | `dashboard-v2/public/brand/logos/snowball-logo-light-bg.png` | variante clara |
| Favicon / símbolo | `assets/favicon.png` | `dashboard-v2/public/brand/icons/snowball-symbol.png` | favicon do V2 (`index.html`) |
| Sprite de ícones | `assets/icons-sprite.svg` | `dashboard-v2/public/brand/icons/snowball-icons.svg` | ícones da interface |
| Defaults do Vite | (scaffold) | `dashboard-v2/public/brand/legacy/vite-*.svg` | preservados, não usados na identidade |

## Garantias

- **Originais preservados:** `assets/logo.png`, `assets/logo-fundo-branco.png`,
  `assets/favicon.png`, `assets/icons-sprite.svg` continuam no Git (o legado,
  se subido via rollback, ainda os serve por `/logo.png` etc.).
- **Nada foi regenerado:** os arquivos oficiais foram reutilizados, não
  recriados.
- **Favicon canônico:** `dashboard-v2/index.html` aponta para
  `brand/icons/snowball-symbol.png`.
