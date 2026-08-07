# Snowball Dashboard — Etapa A: Identidade e Design System

Unificação dos dois dashboards. Esta etapa **não** constrói páginas novas —
ela traz a identidade visual do Snowball (que o dashboard novo havia
descartado) para dentro da arquitetura já validada do `dashboard-v2/`.

> Nenhum motor, estratégia, capital, risco, alavancagem ou lógica econômica
> foi alterado. A API V2 continua **read-only**. Nenhum controle de escrita
> foi migrado. Nenhum logo oficial foi redesenhado.

---

## 1. Inventário do dashboard antigo (porta 8787)

Fonte: `src/dashboard/pagina.ts` (server-rendered, 3.173 linhas) + `server.ts`.

| seção antiga | métrica/componente | fonte do dado | relevante | já no novo | ação |
|---|---|---|---|---|---|
| Visão Geral | KPIs: capital, pico, funding, custos, caixa ocioso, coletando há | `spread/estado.json` | sim | sim (Command Center) | migrada |
| Visão Geral | Curva de capital | `spread/` curva | sim | sim (Champion/Command) | migrada |
| Visão Geral | Ranking de exchanges (lucro individual) | `spread/estado.json` saldos | sim | **não** | **migrar → Portfolio (Etapa C)** |
| Visão Geral | Ranking de pares (melhor combinação de 2 exchanges) | diário + agregação | sim | **não** | **migrar → Opportunity Map (Etapa C)** |
| Operações | Posições (2 pernas, market-neutral) | `spread/estado.json` posicoes | sim | sim (Champion View) | migrada |
| Operações | Funding recebido por dia | `spread/` pagamentosPorDia | sim | sim (Champion View) | migrada |
| Oportunidades | candidatas observadas / bloqueadas / motivo | diários | sim | **não** | **migrar → Opportunity Map (Etapa C)** |
| Exchanges | saúde/latência por exchange | telemetria | sim | parcial (Risk) | **migrar → System Health (Etapa C)** |
| Risco | drawdown, concentração, alavancagem, cenários | profit-lab riscos | sim | sim (Risk Center) | migrada |
| Processos | PIDs, heartbeats, uptime, restarts | heartbeat/telemetria | sim | **não** | **migrar → System Health (Etapa C)** |
| Custos | waterfall, fee-to-gross, buckets | profit-lab custos | sim | sim (Cost Intelligence) | migrada |
| Profit Lab | leaderboard multi, challengers, capital virtual | profit-lab | sim | parcial (Command) | **migrar → Strategy Universe / Challenger Arena (Etapa B)** |
| Champion | estado, equity, funding | champion | sim | sim (Champion View) | migrada |
| Histórico / Logs | eventos, diário | diários | sim | parcial (Live Ops) | **migrar → Audit (Etapa C)** |
| Sistema | status geral | vários | sim | **não** | **migrar → System Health (Etapa C)** |
| — | **controles de escrita** (pausar/promover/etc.) | — | sim | **não** | **NÃO migrar** — API V2 é read-only; ficam só no legado até arquitetura segura aprovada |

Nenhum controle de escrita foi migrado para a API V2 (conforme item 3 da spec).

---

## 2. Auditoria da identidade visual antiga

Extraída de `:root` e componentes de `pagina.ts`. Para cada elemento:
ação = **preservar / modernizar / substituir / remover**.

| elemento | valor no antigo | ação | no novo |
|---|---|---|---|
| logo | `assets/logo.png` (esfera+setas+wordmark) | **preservar** | usado no sidebar (expandido) |
| símbolo isolado | `assets/favicon.png` 256² | **preservar** | sidebar colapsado + favicon |
| fundo principal | `#050b18` navy profundíssimo | **preservar** | `--snow-background` |
| fundo secundário | `#091426` | preservar | superfícies |
| brilhos radiais | ciano + violeta no topo | **preservar** | `body` background-image |
| grade técnica | linear-gradient 38px, mascarada | **preservar** | `body::before` |
| acento primário | **ciano `#17d9ff`** + glow | **preservar** | `--snow-primary` |
| gelo / azul | `#75e8ff` / `#168cff` | preservar | `--snow-accent` / `--snow-secondary` |
| violeta (Profit Lab) | `#8b6cf2` + glow | preservar | `--snow-violet` |
| positivo/aviso/perda | `#36e3a0` / `#ffc857` / `#ff5c7a` | preservar | `--snow-profit/warning/loss` |
| texto | `#eef4fb` / `#8ea3c2` / `#516a8c` | **modernizar** (muted→`#7d90b0` p/ WCAG) | `--snow-text-*` |
| bordas | ciano-translúcidas `rgba(91,211,255,.14)` | **preservar** | `--snow-border` |
| glass surfaces | `rgba(12,29,51,.72)` + blur | **preservar** | `--surface-glass` |
| LED "ao vivo" | pulso | **preservar** | `@keyframes snow-pulse` |
| tipografia | system sans + mono tabular | preservar | `--font-ui/mono` |
| raio | 16/10px | preservar | `--radius-*` |
| kit de ícones | `assets/icons-sprite.svg` (15 símbolos) | **preservar** | `brand/icons/snowball-icons.svg` |
| favicon antigo do NOVO | Vite roxo `#863bff` | **remover** | → `brand/legacy/` |

O resultado continua parecendo Snowball — não virou template SaaS genérico.

---

## 3. Novo design system Snowball

`src/theme/tokens.css` reescrito. Camada semântica canônica `--snow-*`
(item 5), com os nomes legados como alias apontando pra paleta Snowball —
assim as 6 páginas já testadas re-skinaram de uma vez.

- **Cor:** `--snow-background #050b18`, `--snow-surface #0c1526`,
  `--snow-surface-elevated #101d34`, `--snow-primary #17d9ff` (ciano),
  `--snow-accent #75e8ff`, `--snow-profit #36e3a0`, `--snow-loss #ff5c7a`,
  `--snow-warning #ffc857`, `--snow-violet #8b6cf2`.
- **Contraste (WCAG AA):** texto principal 15–18:1, secundário 6.5:1,
  muted `#7d90b0` ≥4.8:1, ciano ≥9.9:1, semânticas ≥5.6:1. Verificado por
  cálculo antes de aplicar; axe confirma 0/0/0/0 nas 6 páginas
  (desktop+mobile).
- **Motion:** `--ease-out cubic-bezier(.2,.7,.2,1)`, durações 120/220/420ms,
  todas zeradas em `prefers-reduced-motion`.
- **Elevação/brilho:** sombras suaves + `--glow-primary` usado com moderação.
- **Focus ring:** ciano (`--snow-primary`).
- Preservados: WCAG, reduced-motion, navegação por teclado, mobile.

---

## 4. Assets oficiais — inventário e mapa origem → destino

Todos os assets de imagem do projeto (fora de node_modules/dist):

| arquivo | dimensões | tam | tipo | ação |
|---|---|---|---|---|
| `assets/logo.png` | 1194×428 RGBA | 803 KB | logo horizontal (oficial) | **reutilizar** |
| `assets/favicon.png` | 256×256 RGBA | 34 KB | símbolo isolado (oficial) | **reutilizar** |
| `assets/logo-fundo-branco.png` | 1536×1024 | 1 MB | variante fundo claro | preservar (referência) |
| `assets/icons-sprite.svg` | vetor, 15 símbolos | 20 KB | kit de ícones Snowball | **reutilizar** |
| `dashboard-v2/public/favicon.svg` | vetor | 9.5 KB | **favicon Vite (roxo)** — não é Snowball | **arquivar → legacy** |
| `dashboard-v2/public/icons.svg` | vetor | 5 KB | ícones sociais Vite | **arquivar → legacy** |
| `dashboard-v2/src/assets/vite.svg` | vetor | 8.7 KB | logo Vite | **arquivar → legacy** |
| `dashboard-v2/src/assets/hero.png` | 343×361 | 13 KB | não referenciado | manter, verificar |

Mapa origem → destino (hash sha256 — cópia, **alteração: nenhuma**):

```
assets/logo.png            (d308d47e2898) → public/brand/logos/snowball-logo.png            (d308d47e2898)
assets/logo-fundo-branco   (d6648e1ad5ab) → public/brand/logos/snowball-logo-light-bg.png   (d6648e1ad5ab)
assets/favicon.png         (6df4a788ce0f) → public/brand/icons/snowball-symbol.png          (6df4a788ce0f)
assets/icons-sprite.svg    (b8fe1ddb7881) → public/brand/icons/snowball-icons.svg           (b8fe1ddb7881)
public/favicon.svg (Vite)  → public/brand/legacy/vite-favicon.svg
public/icons.svg   (Vite)  → public/brand/legacy/vite-social-icons.svg
src/assets/vite.svg        → public/brand/legacy/vite-logo.svg
```

- **Nenhum logo oficial foi redesenhado, recolorido ou recriado com CSS.**
- **Os arquivos originais em `assets/` permaneceram intactos** (só cópias
  foram para `public/brand/`).
- Uso visual: **sidebar** (logo + símbolo), **favicon** (símbolo). Não
  repetido em cards. Header, empty-states e legacy-warning: pendentes das
  próximas sub-etapas.
- Assets ausentes/quebrados: nenhum referenciado pelo antigo está faltando.

---

## 5. Sidebar definitiva + header

- **Sidebar agrupada** (item 7): Overview / Operations / Strategies /
  Financial / System. Grupos recolhíveis. Estado ativo em ciano glacial
  (gradiente + ícone com glow). Páginas não construídas marcadas `SOON`.
- **Header:** badge `PAPER · VIRTUAL · NÃO REAL` em ciano com text-shadow,
  pills Champion/Profit Lab com **LED pulsante** quando ao vivo, glass + blur.
- **Mobile (item 7 — nav própria, não sidebar comprimida):** drawer
  off-canvas com hambúrguer no header, backdrop, Escape fecha, fecha ao
  navegar. A sidebar desktop nunca é só "espremida" no mobile.

---

## 6. Páginas existentes redesenhadas

As 6 páginas (Command Center, Champion View, Live Operations, Settlement
Capture, Cost Intelligence, Risk Center) re-skinaram via a camada de tokens
— **schemas, estados, acessibilidade, fixtures, testes, virtualização,
transporte incremental, cursor, freeze/resume e zero-8787 preservados**.
Nenhuma lógica comprovada foi reescrita. O `SnowballCore` já mostra cada
motor na sua cor de identidade (Champion ciano, Momentum menta, Pairs
violeta, Baselines slate).

---

## 7. Páginas restantes (Etapas B/C — só após aprovação visual da A)

**Etapa B (paridade principal):** Strategy Universe, Challenger Arena,
Champion vs. Control, Experiment Lab.
**Etapa C (operação e sistema):** Portfolio, Opportunity Map, System Health,
Audit.
(Hoje são stubs `PaginaPendente`, marcados `SOON` na sidebar.)

---

## 8. Plano de migração

- **Etapa A (esta):** identidade — design audit, design system, sidebar,
  header, componentes comuns, re-skin das 6 páginas, assets oficiais.
- **Etapa B:** as 4 páginas de estratégia.
- **Etapa C:** as 4 de operação/sistema (aqui migram ranking de exchanges,
  ranking de pares, oportunidades, processos, auditoria).
- **Etapa D:** unificação — rota oficial `/` (novo), `/dashboard/legacy`
  (antigo, marcado `LEGACY — TEMPORARY FALLBACK`), checklist de paridade,
  rollback, e só então arquivar o legado.

Critérios para desligar o antigo (item 23): todas as páginas essenciais +
métricas relevantes migradas, identidade aprovada, nenhum controle
necessário perdido, E2E/axe/responsividade/regressão-visual passando,
rollback documentado, **aprovação visual do usuário**.

---

## 9. Confirmações

- Nenhum motor, estratégia, capital, risco, alavancagem ou lógica econômica
  alterado.
- API V2 permanece read-only; nenhum controle de escrita migrado.
- Nenhum logo oficial redesenhado; originais preservados em `assets/`.
- **Não começar as páginas novas antes da aprovação visual desta Etapa A.**
