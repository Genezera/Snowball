# Arquivo — documentação pré-refactor

Estes documentos descrevem a **primeira fase** do projeto: um laboratório de
pesquisa quantitativa multi-estratégia (backtest, 5 estratégias direcionais,
ML com meta-labeling, execução paper/testnet/live, pares cointegrados,
momentum multi-ativo, um "Auditor" de expectativa vs. realizado, servidor MCP
local). O refactor de 2026-08 (`abe107b Refactor 2-exchange: apaga ~256
arquivos obsoletos, foca no funding-arb`) removeu a maior parte desse código
(`src/backtest/`, `src/strategies/`, `src/risk/`, `src/mcp/`, `src/live/`,
`src/pairs/`, `src/audit/`) para focar só na arbitragem de funding delta-neutra
entre 2 exchanges.

**Estes arquivos ficam aqui como registro histórico** — o raciocínio, os
números medidos e as decisões continuam válidos como documentação do que foi
tentado e por quê. Mas **não descrevem o estado atual do código**.

Para o estado atual, use:
- [`../../CONTEXTO.md`](../../CONTEXTO.md) — o handoff mais recente.
- [`../../README.md`](../../README.md) — visão geral do projeto hoje.
- [`../../CONTINUIDADE.md`](../../CONTINUIDADE.md) — handoff anterior (parcialmente desatualizado também: descreve `src/live/`, `src/audit/` como ativos, mas esses módulos também foram removidos no mesmo refactor).

| Documento | O que era |
|---|---|
| [PEDIDOS.md](PEDIDOS.md) | Rastreamento de cada pedido do usuário, item a item |
| [BACKLOG.md](BACKLOG.md) | Prioridades pendentes da fase multi-estratégia |
| [EVOLUCAO.md](EVOLUCAO.md) | Diário de descobertas da pesquisa original |
| [RESULTADOS.md](RESULTADOS.md) | Números medidos das 5 estratégias e do backtest |
| [ESTRATEGIAS.md](ESTRATEGIAS.md) | Regras exatas das 5 estratégias direcionais |
| [MCP.md](MCP.md) | trader.dev + servidor MCP local (`src/mcp/server.ts`, removido) |
| [ARQUITETURA.md](ARQUITETURA.md) | Módulos da plataforma multi-estratégia |
| [ARQUITETURA-DECISORIA.md](ARQUITETURA-DECISORIA.md) | Decisões sobre o "Auditor" (`src/audit/`, removido) |
| [EQUIPE.md](EQUIPE.md) | O orquestrador `npm run team` + Auditor |
| [ADAPTATIVO.md](ADAPTATIVO.md) | Tentativa de ML seletor de estratégia por regime |
| [ROADMAP.md](ROADMAP.md) | Roadmap da fase multi-estratégia (02/08) |
