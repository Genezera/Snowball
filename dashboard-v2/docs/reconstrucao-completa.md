# Snowball Dashboard — Reconstrução Completa (todas as páginas)

Desktop-only (mín. 1366×768). Identidade Snowball do dashboard antigo +
arquitetura confiável do V2 + todas as páginas + zero placeholders.

> Nenhum motor, estratégia, capital, risco, alavancagem ou lógica econômica
> foi alterado. API V2 read-only. Nenhum controle de escrita. Nenhum logo
> redesenhado.

## Inventário final de rotas (19 páginas, 0 placeholders)

| rota | página | grupo | estado | fonte de dados | ação |
|---|---|---|---|---|---|
| `/` | Command Center | Overview | reconstruída | champion + profit-lab | redesign |
| `/champion` | Champion View | Overview | reconstruída | champion | redesign |
| `/live` | Live Operations | Operações | mantida (virtualização/cursor) | events (cursor) | preservada |
| `/capture` | Settlement Capture | Operações | mantida | profit-lab capturaStatus | preservada |
| `/opportunities` | Opportunity Map | Operações | **criada** | vigilância + eventos bloqueado | OBSERVATION ONLY |
| `/portfolio` | Portfolio | Operações | **criada** | champion + resumo | real vs virtual separado |
| `/strategies` | Strategy Universe | Estratégias | **criada** | leaderboardMulti (54) | catálogo por categoria |
| `/arena` | Challenger Arena | Estratégias | **criada** | leaderboardMulti + riscos + custos | tabela + detalhe |
| `/champion-vs-control` | Champion vs. Control | Estratégias | **criada** | resumo.champion/control | comparação espelhada |
| `/experiments` | Experiment Lab | Estratégias | **criada** | profit-lab + famílias | laboratório paper |
| `/costs` | Cost Intelligence | Inteligência fin. | mantida | waterfall/custos | preservada |
| `/risk` | Risk Center | Inteligência fin. | mantida | riscos | preservada |
| `/exchanges` | Exchanges | Inteligência fin. | **criada** | champion.estado.saldos | comparação por exchange |
| `/processes` | Processos | Sistema | **criada** | champion.processos + telemetria | topologia |
| `/system` | System Health | Sistema | **criada** | telemetria + heartbeat + vigilância | incident center |
| `/pesquisa` | Pesquisa | Sistema | **fundida** | — | redireciona (documenta fusão) |
| `/historico` | Histórico | Sistema | **criada** | curva + pagamentosPorDia | análise temporal |
| `/logs` | Logs | Sistema | **criada** | events (transporte) | stream virtualizado |
| `/audit` | Audit | Sistema | **criada** | events + rotações + colisões | timeline forense |

**12 páginas criadas** (antes `PaginaPendente`), **6 reconstruídas/mantidas**,
**1 fundida** (Pesquisa → Strategy Universe/Experiment Lab/Champion vs
Control/Arena). Nenhuma rota vazia, nenhum `SOON` na sidebar.

## Layout exclusivo por página (item 26)

Cada página tem composição própria, não a mesma grade de cards:
Command Center (panorama executivo), Champion (cockpit com curva+risco),
Live Operations (timeline master-detail), Settlement (fluxo/timeline),
Opportunity Map (observação + heatmap de bloqueio), Portfolio (exposição),
Strategy Universe (catálogo por categoria), Challenger Arena (tabela +
painel de detalhe), Champion vs. Control (comparação espelhada), Experiment
Lab (laboratório), Cost Intelligence (waterfall narrativo), Risk Center
(severidade), Exchanges (comparação), Processos (nós/topologia), System
Health (incident center), Histórico (temporal), Logs (stream terminal
virtualizado), Audit (timeline forense).

## Endpoints read-only pendentes (documentados, nunca fabricados)

- **Opportunity Map — tabela por-candidato** (symbol/spread/APR/liquidez
  individuais): a fonte existe nos diários, mas não há endpoint read-only
  exposto ainda. A página mostra o que a API entrega (vigilância + motivos
  de bloqueio reais) e marca o resto como pendente, sem inventar.
- **Logs — stream de processo** (stdout/stderr dos motores): a página usa o
  transporte de eventos (única fonte de stream disponível) e documenta o
  endpoint de log de processo como próximo passo.

## Design system + assets

Identidade glacial Snowball (`--snow-*`), assets oficiais em
`public/brand/` (logo, símbolo, favicon, kit de ícones). UI kit
compartilhado em `components/ui/kit.tsx` (PageHeader, Section, DataTable,
RankBar, StatusBadge, fmt) — consistência sem uniformizar. Ticker real,
header com relógio local+UTC, sidebar agrupada recolhível.

## Confiabilidade preservada (item 17)

API V2 read-only, schemas Zod, cursor byteOffset, virtualização,
freeze/resume, fixtures determinísticas, zero-8787, acessibilidade de
teclado — tudo intacto. Estados loading/empty/stale/partial/corrupted/
error/offline/success mantidos.

## Confirmação

Nenhum motor, estratégia, risco, capital, alavancagem ou lógica econômica
alterado. Nenhuma versão mobile desenvolvida (desktop-only). Nenhum
placeholder restante.
