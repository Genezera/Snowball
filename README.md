<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="assets/logo.png">
    <img src="assets/logo-fundo-branco.png" alt="Snowball" width="220">
  </picture>
</p>

<p align="center">
  <img alt="Paper trading" src="https://img.shields.io/badge/modo-paper%20trading-38bdf8?style=flat-square">
  <img alt="Node" src="https://img.shields.io/badge/node-24%2B-38bdf8?style=flat-square">
  <img alt="Foco" src="https://img.shields.io/badge/foco-2%20exchanges-36e3a0?style=flat-square">
  <img alt="Estratégia" src="https://img.shields.io/badge/estrat%C3%A9gia-funding%20arb-8b5cf6?style=flat-square">
</p>

# ❄️ Snowball — Funding-Rate Arbitrage (delta-neutro)

> Um robô que fica **comprado numa exchange e vendido em outra**, no mesmo ativo,
> ao mesmo tempo. A exposição a preço é **zero por construção** — se o ativo sobe
> ou cai, as duas pernas se cancelam. O lucro vem do **funding rate**: o
> pagamento que uma exchange transfere à outra a cada 8h. Não se aposta em
> direção — se **cobra pela liquidez**.

> ⚠️ **Tudo é paper trading.** Nenhuma ordem real é emitida. O objetivo é validar
> a estratégia com dados reais de mercado (taxas, funding, liquidez reais) antes
> de arriscar dinheiro de verdade.

---

## 🎯 O plano atual: 2 melhores exchanges

O sistema começou com **6 exchanges** (o "Champion", que rende **+US$ 17,48 em 6 dias ≈ +0,49%/dia** em paper). Mas o dinheiro real vai começar com **2 exchanges, US$ 100 em cada** — então todo o foco agora é **descobrir qual par de 2 exchanges rende mais** e migrar pra ele.

**Como se decide:** dois competidores paper rodam ao vivo no motor reconciliado, cada um com US$ 200:

| Competidor | Capital | Política |
|---|---|---|
| **bybit + bitget** | US$ 100 + US$ 100 | maker + filtro de persistência |
| **gate + okx** | US$ 100 + US$ 100 | maker + filtro de persistência |

Em alguns dias o head-to-head crava o vencedor, e o **mesmo motor** (`spread-live`) é reconfigurado de 6 → 2 exchanges pro dinheiro real.

### Os 3 levers de maximização (todos com base em dados)
1. **Ordens maker (limite)** em vez de market → custo cai a ~36% (de 40% do funding para ~15%). **+27% de lucro**, matemática exata dos presets reais.
2. **Filtro de persistência** → só entra após 30min de sinal positivo, cortando entradas prematuras (a causa nº1 do vazamento de custo).
3. **Compounding** → o lucro vira notional maior, bola de neve.

---

## 🏗️ Arquitetura

```
   ┌─────────────┐   varre o mercado inteiro    ┌──────────────────────────┐
   │  COLETOR    │  ~4.750 pares / 6 exchanges   │  arquivo-observacoes     │
   │ + universo  │ ────────────────────────────▶ │  (feed, {k,apr,spread})  │
   └─────────────┘        a cada ~5 min          └───────────┬──────────────┘
                                                             │
                    ┌────────────────────────────────────────┼───────────────┐
                    ▼                                         ▼               ▼
          ┌──────────────────┐              ┌──────────────────────┐   ┌──────────────┐
          │ MOTOR (spread-   │              │ COMPETIDORES (paper) │   │  DASHBOARD   │
          │ live) — Champion │              │ bybit+bitget /       │   │  (React,     │
          │ 6-ex → futuro    │              │ gate+okx, maker      │   │  tempo real) │
          │ 2-ex. dinheiro   │              │ + persistência       │   │              │
          │ real + Telegram  │              │ (forward-lab)        │   │              │
          └──────────────────┘              └──────────────────────┘   └──────────────┘
                    ▲                                   ▲                      ▲
                    └───────── supervisão + blindagem (auto-restart, boot) ────┘
```

- **Scanner** (`src/cli/coletor.ts`, `src/funding/universo.ts`): varre o **mercado inteiro** (~4.750 pares nas 6 exchanges) via `fetchFundingRates` em massa, sem viés de seleção.
- **Motor** (`src/cli/spread-live.ts`, `src/funding/`): abre/gere/fecha posições delta-neutras, com funding, custos, marcação, liquidação, compounding e avisos no Telegram. É o mesmo motor do dinheiro real.
- **Competidores** (`scripts/progression/forward-lab.cjs`): réplicas paper isoladas por par de 2 exchanges, com custo maker + filtro de persistência.
- **Dashboard** (`dashboard-v2/`): React + API read-only. Páginas de Champion, Maximização e Competidores (dupla lado a lado).
- **Supervisão** (`scripts/supervisor.sh`, `supervisor-competidores.sh`, `blindagem.ps1`): auto-restart + sobrevivência a reboot, tudo windowless.

---

## 📁 Estrutura do projeto

```
src/
  cli/          spread-live · coletor · vigilancia · custodia   (pontos de entrada)
  funding/      motor delta-neutro: engine, spread, universo, compound, marcacao,
                liquidacao, telegram, custos-reais, execucao (maker)…
  config.ts     presets reais de taxa por exchange (taker/maker)
  ml/           prontidão do scanner (readiness)
scripts/
  progression/  forward-lab.cjs + lib-progression.cjs           (competidores paper)
  analise/      counterfactual, backtest, comparador dos competidores
  supervisor.sh · supervisor-competidores.sh · blindagem.ps1    (blindagem)
dashboard-v2/   frontend React (:5183) + API read-only (:5184)
```

> O projeto foi **enxugado** (refactor 2026-08): removidas ~256 arquivos de
> estratégias antigas e pesquisa shadow que não serviam ao plano de 2 exchanges.
> Ficou só o que melhora o funding-arb. O histórico do git preserva tudo.

---

## ▶️ Como rodar

```bash
# 1. dependências
npm install

# 2. configurar Telegram (opcional — avisos de abre/fecha/lucro)
cp .env.example .env   # preencher TELEGRAM_BOT_TOKEN e TELEGRAM_CHAT_ID
npm run telegram:chatid

# 3. subir tudo (motor + scanner + competidores + dashboard), windowless + blindado
powershell -File scripts/blindagem.ps1
```

O `blindagem.ps1` é idempotente (não duplica) e está registrado na pasta Startup
do Windows — o sistema **volta sozinho após reboot**.

- **Dashboard:** http://localhost:5183 → aba **Competidores 2-Ex** (a dupla, cada um com dinheiro, gráfico, ordens abertas, o que está pensando e histórico).
- **Placar rápido no terminal:** `node scripts/analise/compare-competidores.cjs`
- **Testar mensagens do Telegram:** `node scripts/telegram-teste-todos.cjs`

---

## 📱 Avisos no Telegram

Escritos pra qualquer pessoa entender (emojis + separadores + explicação):
`🟢 nova operação` · `✅ lucro` / `⚠️ prejuízo` · `🔁 lucro reinvestido (bola de neve)`
· `📊 resumo do dia` · `🛑 robô pausado`.

---

## 🛡️ Segurança

- **Paper trading:** nenhuma ordem real é emitida.
- **Delta-neutro:** exposição a preço zero por construção.
- **Guardião de risco:** fecha posição se o preço se aproximar da liquidação.
- **Blindagem:** auto-restart em crash + sobrevivência a reboot, windowless.
- **Sem segredos versionados:** token do Telegram só via `.env` (fora do git).

---

## 📊 Status atual (paper)

| | |
|---|---|
| Champion (6-ex, referência) | **US$ 617,48** · +US$ 17,48 · ~0,49%/dia |
| Competidores 2-ex | bybit+bitget vs gate+okx (head-to-head ao vivo) |
| Scanner | mercado inteiro, ~4.750 pares, a cada 5 min |
| Próximo passo | cravar o par vencedor → dinheiro real (US$ 100 + US$ 100) |
