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

## 🎯 O plano atual: motor único de 2 exchanges + spot-perp

O sistema começou com **6 exchanges** (o "Champion") como referência/benchmark — depois de servir pra descobrir os levers de lucro, ele foi **arquivado** (ver [`arquivo-6-exchanges/README.md`](arquivo-6-exchanges/README.md); código preservado, só não roda mais). O foco 100% agora é **2 exchanges, US$ 100 em cada**: o head-to-head entre pares já terminou.

**Decisão tomada:** `bybit + bitget` venceu o head-to-head contra `gate + okx` (que ficou faminto — quase nenhuma posição aberta). Os dois competidores foram consolidados num **motor único**, `snowball-2ex`, com todos os levers de maximização já embutidos:

| Lever | O que faz |
|---|---|
| **Ordens maker (limite)** | custo cai de ~40% do funding para ~15% — matemática exata dos presets reais (`--cost-model maker`) |
| **Filtro de persistência** | só entra após 30min de sinal positivo — corta entradas prematuras, a causa nº1 do vazamento de custo (`--persist-min 30`) |
| **Utilização de capital** | 6 posições, 20% de reserva (`--maxpos 6 --reserva 0.20`) |
| **Rendimento da reserva ociosa** | reserva rende ~6%/ano no livro-caixa, neutro (`--stable-yield 0.06`) |
| **Margem de segurança na entrada** | exige apr cobrir 2,5× o custo fixo antes de abrir (`--entry-safety-mult 2.5`) |
| **Compounding** | lucro liquidado pro capital deployável a cada 24h — libera mais posições simultâneas, não posições maiores (`--settle-interval-h 24`) |

### Spot-perp — segunda superfície de captura (mesma exchange)
Além do cross-exchange (capta o **diferencial** de funding entre 2 exchanges), o motor também opera **cash-and-carry**: compra spot + shorta perp **na mesma exchange**, capturando o funding **absoluto** — acessa oportunidades que o cross-exchange perde. Delta-neutro, mesmo livro-caixa, reconciliado ao centavo. Um coletor dedicado (`coletor-spotperp.cjs`) varre o mercado real via ccxt e só aceita oportunidades com liquidez real **nos dois lados** (perp e spot).

---

## 🏗️ Arquitetura

```
   ┌─────────────┐   varre o mercado inteiro    ┌──────────────────────────┐
   │  COLETOR    │  ~4.750 pares / 6 exchanges   │  arquivo-observacoes     │
   └─────────────┘        a cada ~5 min          └───────────┬──────────────┘
                                                              │
   ┌──────────────────┐  oportunidades spot+perp    ┌─────────┴────────────────┐
   │ COLETOR SPOT-PERP │  (mesma exchange, liquidez  │  arquivo-spotperp        │
   │ (ccxt, real)       │  real nos 2 lados)          │  (feed do radar)         │
   └────────┬───────────┘ ────────────────────────▶  └─────────┬────────────────┘
            │                                                  │
            └──────────────────────┬───────────────────────────┘
                                    ▼
                     ┌───────────────────────────────────┐   ┌──────────────┐
                     │ snowball-2ex (forward-lab)        │   │  DASHBOARD   │
                     │ bybit+bitget · MOTOR REAL         │   │  Command     │
                     │ maker + persistência 30min +       │   │  Center      │
                     │ cross-exchange + spot-perp juntos  │   │  (React, ao  │
                     └───────────────────────────────────┘   │  vivo)        │
                                    ▲                          └──────────────┘
                                    └── supervisão + blindagem (auto-restart) ──▲
```

- **Scanner** (`src/cli/vigilancia.ts`): varre o **mercado inteiro** (~4.750 pares nas 6 exchanges) via `fetchFundingRates` em massa, sem viés de seleção — escreve `vigilancia/historico.jsonl`.
- **Arquivador** (`src/cli/coletor.ts`): só lê o que a vigilância/custódia escrevem e arquiva pra sempre em `arquivo-observacoes.jsonl` (nunca consulta exchange) — é este arquivo que o `snowball-2ex` lê.
- **snowball-2ex** (`scripts/progression/forward-lab.cjs`): o motor do dinheiro real — bybit+bitget, maker, filtro de persistência, cross-exchange **e** spot-perp no mesmo livro-caixa reconciliado.
- **Coletor spot-perp** (`scripts/progression/coletor-spotperp.cjs`): varre spot+perp na mesma exchange via ccxt (dado real), só aceita liquidez real dos dois lados.
- **Dashboard** (`dashboard-v2/`): React + API read-only. Command Center com o motor real + radar spot-perp.
- **Supervisão** (`scripts/supervisor.sh`, `scripts/supervisor-competidores.sh`, `scripts/blindagem.ps1`): auto-restart em crash, tudo windowless.

> O **Champion** (referência de 6 exchanges) foi **arquivado** depois de servir pra descobrir os levers de lucro acima — ver [`arquivo-6-exchanges/README.md`](arquivo-6-exchanges/README.md). Código preservado, não roda mais.

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

O `blindagem.ps1` é idempotente (não duplica). **Auto-start no boot está desabilitado a pedido** — precisa subir à mão depois de reiniciar o PC.

- **Dashboard:** http://localhost:5183 → **Command Center** (o motor real, capital, posições cross-exchange + spot-perp, radar de oportunidades, o que está pensando).
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
| Champion (6-ex) | **arquivado** — último estado: +US$ 17,52 em ~6,3 dias. Ver `arquivo-6-exchanges/` |
| snowball-2ex (bybit+bitget, motor real) | US$ 200 · cross-exchange + spot-perp juntos |
| Scanner | mercado inteiro, ~4.750 pares, a cada 5 min |
| Radar spot-perp | ~120 oportunidades reais (bybit+bitget), perfil vol > US$5M nos 2 lados |
| Próximo passo | observar dias de operação contínua e medir quanto o spot-perp soma ao funding/dia |
