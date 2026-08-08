# Fase econômica shadow — implementação (snapshot 1786189433850)

Continuação da auditoria aprovada. **Tudo read-only/observador/shadow.** Nada
aqui altera Champion, motores, alavancagem, capital, risco, execução ou limites;
nenhum modelo definitivo treinado; nada envia ordem, aprova ou bloqueia.
Artefatos em `auditoria/dataset/` e `auditoria/shadow/`; scripts em
`scripts/auditoria/`.

## 1. Config epochs (item 1) — `auditoria/dataset/config-epochs.json`

| época | capital base | exchanges | início | fim |
|---|---|---|---|---|
| epoch-0 | 200 | 2 (binanceusdm, bybit) | 2026-08-03 12:04 | 2026-08-05 22:09 |
| epoch-1 | 600 | 6 | 2026-08-05 22:09 | atual |

Fronteira detectada por salto de capital-base (199→599). **Métricas de retorno/
drawdown/capital-horas só valem dentro de uma época** — nunca atravessando.
Lacuna honesta: alavancagem/reserva/margemPayback/maxPosicoes **não são
re-logados** pelo motor após o init (assumidos constantes por época). Instrumentar
um evento de config seria melhoria **aditiva** futura.

## 2. Dataset em dois níveis + leakage (itens 2,3) — `auditoria/dataset/`

- `candidate-observations.jsonl`: **21.195** observações (features de decisão + configEpochId).
- `opportunity-episodes.jsonl`: **2.077 episódios** (agrega obs; **label vive no
  episódio, nunca replicado por observação** — corrige o dataset anterior).
- `position-outcomes.jsonl`: **23 posições** (do diario, por época).
- **Leakage guard:** fold por `episodeId` (todas as obs do episódio no mesmo
  fold), sem feature pós-decisão, sem imputação, respeita tempo/posição/configEpoch.
- `eligibleForTraining`: **29 episódios** completos — **todos em epoch-1**.

## 3. Alternative Candidate Logger (item 4)

A fonte `inteligencia/oportunidades/*.jsonl` **já** registra, por ciclo, todas as
candidatas (aprovadas, rejeitadas com motivo, escolhida, ranking implícito por
score, capital necessário, margem, valor esperado, payback, persistência, custo).
O `candidate-observations.jsonl` é esse log normalizado append-only; os **outcomes
são anexados por processo separado** (`opportunity-episodes` via join com
`position-outcomes`) — o registro original da decisão **nunca é editado**.

## 4. Batch Rebalancing Replay (item 5) — `auditoria/shadow/batch-replay.json`

45 eventos de rebalance (escalona/apara/reinveste), custo controle **US$ 2.50**:

| política | custo | economia |
|---|---|---|
| controle | 2.5023 | — |
| batch 15/30/60 min | 2.4575 | **1.8%** |

**Achado honesto:** batelar rebalances economiza só ~1.8% — o custo é quase
proporcional ao notional, então coalescer adds/trims salva pouco. O grande custo
**não** é rebalance: é `fecha` (US$ 3.59) e `escalona` (2.27) via **muitos**
fechamentos/escalonamentos, não a cadência de rebalance. Redirecionar o esforço:
menos fechamentos precoces (modelo de sobrevivência) rende mais que batching.
Exposição/dist-liquidação/capital-horas **não instrumentadas por evento** →
marcadas como não medidas (proteção intocada).

## 5. Switch Value Observer (item 6) — `auditoria/shadow/switch-value-observer.jsonl`

29 oportunidades bloqueadas por saldo no último ciclo, registradas. **Gap
honesto:** o EV de *manter a posição fraca* vs EV *líquido da troca*
(fechar+abrir+slippage) exige o estado das posições **no mesmo instante do
ciclo**, que não é co-registrado no oportunidades.jsonl. O observer real precisa
rodar **dentro do ciclo** (aditivo, read-only) para capturar os dois lados —
recomendação atual: `PENDENTE_INSTRUMENTACAO`. **Nunca fecha nada.**

## 6. Capture Accounting (item 7) — `auditoria/shadow/capture-accounting.json`

6 capturas (HFT, ACE, COTI), **separadas do modo normal**:
receita funding **2.752** − custo round-trip **1.930** = **PnL +0.823**.
**2 de 6 inverteram antes do settlement** (33% — pagaram custo, não receberam
funding). Margem fina: a captura só compensa se o funding esperado supera o
round-trip (~US$ 0.32/captura de custo médio total). Aumentar frequência sem
elevar a taxa de inversão é o alvo.

## 7. Funding Cross-Sectional Shadow (item 8) — `auditoria/shadow/cross-sectional-ranking.jsonl`

Ranking determinístico do universo (80 candidatas do último ciclo) por
`valorPorHora × folgaPayback × persistência`. **Top-1 shadow: BICO** — que foi
um dos maiores geradores reais (+2.47). Sanidade: o ranking determinístico
aponta um vencedor real. **Só registra qual escolheria; não influencia o Champion.**

## 8. Diagnóstico de Pares (item 9) — `auditoria/shadow/pares-diagnostico.json`

**Não é bug nem filtro apertado.** O log mostra "ciclo · sem barra nova" em
**todos** os ciclos. Pares opera em **barras diárias** (ciclo de 20 min, ~1 barra
nova/dia). Está calibrado (4+ pares: GRT/LPT, XRP/QTUM, ADA/YFI, SUSHI/KSM;
correlações 0.50–0.76; meia-vida 2–3 barras) desde ~2 dias atrás. Com meia-vida
de 2–3 dias e só ~2 dias desde a calibração, **ainda não houve barra diária com
sinal de entrada** — é ausência real de sinal / estratégia de baixa frequência,
não filtro a afrouxar. **Ação: observar mais tempo; NÃO afrouxar filtros.**

## 9. Baselines + gate mínimo (itens 10,11) — `auditoria/shadow/baselines-and-gates.json`

**GATE: BLOQUEADO** — 29/50 episódios completos, **1/2 épocas**. Só EDA/baseline
é lícito; treinar/validar modelo definitivo agora seria overfit. Baselines
(EDA honesto, amostra pequena):

- **Regra atual:** 20 posições fechadas, **80% pagaram payback**, **15%
  inverteram** antes do settlement, PnL médio +0.46, total +9.17. → **80% de
  acerto é a barra** que qualquer modelo terá de bater.
- **Kaplan-Meier (fechamento):** mediana de vida da posição **~2.6 h** — reciclagem
  rápida de capital.
- Modelos (logística/Cox/árvore) **deferidos** até o gate abrir. Sem NN/RL/LLM.
  Nenhum modelo promovido.

## 10. Matriz atualizada (item 12)

| # | ideia | evidência desta fase | prioridade |
|---|---|---|---|
| 1 | **Modelo de sobrevivência (quando o gate abrir)** | 15% invertem; KM mediana 2.6h; WAXP-like é o alvo | alta (bloqueada por dados) |
| 2 | **Switch Value Observer in-cycle (aditivo)** | 27% das rejeições por margem; EV de troca não instrumentado | alta |
| 3 | **Reduzir fechamentos precoces > batching** | batching só 1.8%; fecha 3.59 é o custo real | alta |
| 4 | **Capture: cortar inversões (33%)** | 2/6 capturas não pagaram round-trip | média |
| 5 | **Instrumentar evento de config** | épocas hoje inferidas por salto de capital | média (aditivo) |
| 6 | **Pares: observar, não afrouxar** | sem barra/sinal; baixa frequência por design | baixa (paciência) |
| 7 | **Cross-sectional shadow contínuo** | top-1 determinístico = vencedor real (BICO) | média |
| 8 | **Acumular dataset até o gate (≥50 ep., ≥2 épocas)** | 29/50 hoje | pré-requisito de tudo em ML |

## 11. Integridade (item 15)

`git diff` **não** altera `src/cli/*`, `src/inteligencia`, `src/funding`,
`src/risk`, nem estado dos motores/dashboard. Champion, risco, capital e
alavancagem **intactos**. Tudo nesta fase é leitura/observação/shadow.
