# Inventário de paridade — dashboard legado (:8787) → Snowball Dashboard (V2, :5183/:5184)

Comparação página a página e função a função antes de arquivar o legado.
Legenda de paridade: **completa** · **parcial** · **não migrado**.
O Snowball Dashboard é **read-only por design** — controles de escrita não são
transportados só para paridade visual (ver `docs/controles-legado.md`).

## Páginas / abas

| Função antiga | Rota antiga | Equivalente no novo | Dados migrados | Controles | Só-leitura | Paridade | Ação necessária |
|---|---|---|---|---|---|---|---|
| Visão Geral | `?tab=visao` | Command Center `/` | sim (`/api/v2/champion`) | nenhum | sim | completa | — |
| Champion | aba/seção | Champion `/champion` | sim | nenhum | sim | completa | — |
| Operações | `?tab=operacoes` | Live Operations `/live` | sim (`/api/v2/events`, cursor incremental) | filtros/congelar (leitura) | sim | completa | — |
| Oportunidades | `?tab=oportunidades` | Opportunity Map `/opportunities` | sim (fonte persistente do motor) | nenhum | sim | completa | — |
| Portfolio | seção da visão | Portfolio `/portfolio` | sim (auditado, `docs/auditoria-financeira-portfolio.md`) | nenhum | sim | completa | — |
| Exchanges | `?tab=exchanges` | Exchanges `/exchanges` | sim | nenhum | sim | completa | — |
| Risco | `?tab=risco` | Risk Center `/risk` | sim | nenhum | sim | completa | — |
| Custos | seção | Cost Intelligence `/costs` | sim (`/api/v2/waterfall`) | nenhum | sim | completa | — |
| Processos | `?tab=processos` | Processos `/processes` | sim (leitura de SO) | nenhum | sim | completa (menos o próprio legado, agora arquivado) | — |
| Pesquisa | `?tab=pesquisa` | Pesquisa `/pesquisa` | fundida em páginas dedicadas | nenhum | sim | completa | — |
| Histórico | `?tab=historico` | Histórico `/historico` | sim | nenhum | sim | completa | — |
| Logs | `?tab=logs` | Logs `/logs` | sim (`/api/logs` → leitura V2) | seletor de processo (leitura) | sim | completa | — |
| Sistema | `?tab=sistema` | System Health `/system` | sim | nenhum | sim | completa (legado exibido como ARCHIVED) | — |
| Profit Lab (visão) | `?tab=profitlab` | Experiment Lab `/experiments` + Strategy Universe `/strategies` + Challenger Arena `/arena` + Champion vs. Control `/champion-vs-control` | sim (`/api/v2/profit-lab`) | **ver controles abaixo** | sim (visão) | completa (visualização) | — |
| Profit Lab (controles) | `POST /api/profit-lab/controle` | — | n/a | promover/pausar/resetar challenger | **não** (escrita) | **não migrado** (por design) | documentado em `docs/controles-legado.md`; acessível via rollback |
| Gráfico de candles | `/api/candles` | — | — | zoom/timeframe (leitura) | sim | **parcial** | V2 mostra curva de capital + timeline de eventos; OHLC por símbolo não replicado (não é necessário para operar) |

## Endpoints de dados

| Endpoint legado | Tipo | Equivalente V2 | Paridade |
|---|---|---|---|
| `/api/dados` | leitura (JSON) | `/api/v2/champion` (+ derivados) | completa |
| `/api/stream` | leitura (SSE) | `/api/v2/events` (cursor incremental — transporte diferente, mesmo dado) | completa |
| `/api/profit-lab/dados` | leitura | `/api/v2/profit-lab` | completa |
| `/api/profit-lab/stream` | leitura (SSE) | polling V2 | completa |
| `/api/profit-lab/challenger` | leitura | dentro de `/api/v2/profit-lab` | completa |
| `/api/profit-lab/controle` | **escrita (POST)** | — | **não migrado** (read-only por design) |
| `/api/logs` | leitura | Logs `/logs` (leitura V2) | completa |
| `/api/candles` | leitura | — | parcial (ver acima) |
| `/logo.png`, `/logo-fundo-branco.png`, `/favicon.png` | assets | `public/brand/*` | completa |

## Assets

Todos os assets oficiais do legado estão presentes no V2; os originais foram
**preservados** (nunca apagados) — ver `docs/assets-legado-v2.md`.

## Conclusão

Toda função **necessária** para operar e monitorar tem paridade **completa**
no Snowball Dashboard. As duas exceções são:

1. **Controle de escrita do Profit Lab** (`/api/profit-lab/controle`) — não
   migrado por design (V2 é read-only). Não é necessário para o trading; segue
   acessível via rollback de emergência do legado. Arquitetura segura proposta
   em `docs/controles-legado.md`.
2. **Gráfico de candles por símbolo** — parcial; não necessário para operar. O
   V2 cobre a informação decisória por outras visões (curva, timeline, risco).

Nenhuma dessas bloqueia a unificação, e nenhuma função é **perdida**: o legado
permanece no Git e recuperável via rollback documentado
(`docs/dashboard-legacy-rollback.md`).
