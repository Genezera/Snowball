# Snowball — Sistema de Níveis de Progressão

> **Fonte de dados:** `auditoria/progression/levels.json` (schema `snowball.levels.v1`) e
> `auditoria/progression/progression-status.json` (schema `snowball.progression-status.v1`).
> Gerado em `2026-08-08T13:59:08.002Z` (`asOfMs = 1786197548002`).
> Todos os números deste documento são **copiados** desses arquivos read-only/append-only. Nada é inventado.
>
> **Fase:** plataforma de progressão — tudo é read-only / shadow / arquitetura / append-only / reversível.
> Nada aqui envia ordem, usa credencial ou promete lucro futuro. Distinção sempre explícita:
> `observed` / `replayed` / `simulated` / `shadow` / `hypothetical` / `live-paper` / `real`.

---

## Mensagem central (leia primeiro)

**O Champion tem CAPITAL para o Nível 3, mas por EVIDÊNCIA está no Nível 1.**

- **Capital realizado:** `US$609,98` (`capitalRealizado = 609.9825`, `real`/`live-paper`).
- **Nível por capital:** o capital atual cobre o mínimo do Nível 3 (US$600) e sobra folga.
- **Nível por evidência:** `nivelAtual = 1` — "Motor principal".
- **Conclusão:** o bloqueio de progressão é **PROVA** (amostra + gate + chefe derrotado), **não dinheiro**.

O Champion literalmente **poderia** rodar a topologia do Nível 3 hoje: **3 posições delta-neutro concorrentes
ocupando 6 slots de exchange = 6 × US$100 = US$600**. O capital não é o gargalo. O que falta é **evidência
independente**: um segundo motor comprovado, o gate de timing liberado, o Chefe da Concentração/Diversificação
derrotado com amostra.

> **Regra de ouro (`levels.json → principio`):**
> "Capital sozinho não desbloqueia. Um lucro isolado ou uma moeda que subiu muito NÃO desbloqueia um motor.
> Exige capital + amostra + 2 janelas + 2 regimes + custos estressados + drawdown aceitável + concentração +
> estabilidade + dados íntegros + rollback + aprovação humana."

Prova numérica do descasamento capital × evidência (`progression-status.json`):

| Indicador | Valor | Fonte |
|---|---|---|
| Capital atual | `US$609,98` | `capitalAtual` |
| Capital necessário p/ próximo nível (por EVIDÊNCIA) | `US$0` | `capitalNecessarioProximoNivelEvidencia` |
| Nota do gate | "Capital do próximo nível JÁ atingido — o bloqueio é EVIDÊNCIA (gate/amostra), não dinheiro." | `capitalNecessarioNota` |
| Contribuição de PnL do funding | `US$9,98` (100% do lucro) | `contribuicaoPnL.champion-funding` |
| Contribuição de outros motores | `US$0` | `contribuicaoPnL.outros` |
| Nota de PnL | "100% do lucro vem do funding; nenhum 2º motor comprovado." | `contribuicaoPnL.nota` |

**Um lucro isolado NÃO desbloqueia um motor.** Os `US$9,98` vêm inteiramente do Champion funding; nenhuma
segunda fonte independente foi provada.

---

## Como o capital mínimo é DERIVADO

O capital mínimo de cada nível **não é arbitrário**: é derivado da topologia de slots de exchange.

```
capitalMinimo = slots × US$100
```

Onde:

- **1 slot** = uma perna (leg) ocupada em uma exchange.
- Cada posição **delta-neutro** usa **2 slots** (long em uma exchange + short em outra).
- **US$100** é o tamanho-base de perna do laboratório PAPER.

| Nível | slots | Cálculo | capitalMinimo | Estimativa? |
|---|---|---|---|---|
| 0 | 0 | 0 × 100 | US$0 | não |
| 1 | 2 | 2 × 100 | US$200 | não |
| 2 | 4 | 4 × 100 | US$400 | não |
| 3 | 6 | 6 × 100 | US$600 | não |
| 4 | 8 | 8 × 100 | US$800 | **sim** |
| 5 | 12 | 12 × 100 | US$1.200 | **sim** |
| 6 | 20 | 20 × 100 | US$2.000 | **sim** |

> **N4–N6 são ESTIMATIVA** (`capitalMinimoEstimativa = true`): a topologia de slots desses níveis ainda não
> foi exercida, então o número é uma projeção de arquitetura — `hypothetical`, não `observed`. N0–N3 têm
> `capitalMinimoEstimativa = false` (topologia conhecida).

**Leitura do Nível 3 aplicada ao Champion:** 6 slots = 3 posições concorrentes × 2 pernas = US$600. O Champion
tem `US$609,98` — **capital suficiente para essa topologia**. Por isso a mensagem central: o dinheiro chega ao
Nível 3; a evidência não.

---

## Estado atual (snapshot de `progression-status.json`)

- **Nível atual (evidência):** 1 — "Motor principal".
- **Próximo desbloqueio:** `N2 Eficiência — BLOCKED`.
- **Fronteira de capital:** o próximo degrau *de capital* seria o N4 (US$800); faltam `US$190,02`
  (`fronteiraCapital.gapUSD`). Isso é apenas a fronteira de dinheiro — **não** é o que destrava a progressão.
- **Chefes derrotados:** custos, sobrevivência, concentração.
- **Chefes ativos:** capacidade, diversificação.
- **Motores por estado:** `LIVE: 1`, `DATA_COLLECTION: 4`, `SHADOW: 1`, `LOCKED: 2`, `ARCHITECTURE_ONLY: 1`.
- **Motores elegíveis:** `champion-funding` (único).
- **Motores em pesquisa:** close-timing-challengers, settlement-capture, funding-cross-sectional, pares, momentum.
- **Motores bloqueados:** news-event-radar, listing-opportunity-lab, acoes-multimercado.

**Progresso de amostra (gates que faltam):**

| Gate | Progresso | Fonte |
|---|---|---|
| Challengers de timing (extensões reais) | `0/30` | `progressoAmostra.challengersTimingRealExtensions` |
| Settlement — captura | `4/30` | `progressoAmostra.settlementCaptura` |
| Exchange selector — EV positivo | `13/30` | `progressoAmostra.exchangeSelectorEVpositivo` |

**Aviso de amostra (`crescimento.avisoAmostra`):** "AMOSTRA INSUFICIENTE: só 2.72 dias de epoch-1. TODA projeção
abaixo é HIPÓTESE frágil — não é lucro futuro garantido. Não extrapolar dias como meses." Retorno diário
observado: `0,6652%` (`observed`, amostra minúscula — não anualizar).

**Honestidade (`levels.json`/`progression-status.json`):** "Nível por EVIDÊNCIA = 1 (capital suporta 3). Nada
promovido. Nenhuma alteração real."

---

## Os 7 níveis

### Nível 0 — Fundação

- **levelId:** 0
- **Descrição:** dados íntegros, contabilidade reconciliada, processos estáveis, zero perda/duplicação.
- **Capital mínimo:** **US$0** — derivação: 0 slots × US$100 (nível de infraestrutura, sem posição de mercado). Não é estimativa.
- **Pré-requisitos:** reconciliação exata; fidelidade/integridade do Control OK.
- **Métricas obrigatórias:** reconciliação exata; fidelidade/integridade do Control OK.
- **Módulos desbloqueados:** ledger; reconciliação; supervisão; monitor de integridade.
- **Riscos novos:** corrupção de estado; perda/duplicação de evento.
- **bossCondition:** "Integridade: reconcilia exato + monitor sem perda/duplicação."
- **unlockStatus:** `UNLOCKED` (capital atingido ✔, evidência atingida ✔).
- **blockedReasons:** — (nenhum).

### Nível 1 — Motor principal  ⟵ **nível atual por evidência**

- **levelId:** 1
- **Descrição:** funding delta-neutro em 2 exchanges, US$100 cada, protegendo o capital inicial e provando lucro líquido após custos.
- **Capital mínimo:** **US$200** — derivação: 2 slots × US$100 (1 posição delta-neutro = 2 pernas). Não é estimativa.
- **Pré-requisitos:** Champion LIVE; Chefe Custos derrotado; Chefe Sobrevivência derrotado; lucro líquido > 0.
- **Métricas obrigatórias:** idem pré-requisitos (Champion LIVE; Custos derrotado; Sobrevivência derrotado; lucro líquido > 0).
- **Módulos desbloqueados:** Champion funding; marcação executável; saída de risco.
- **Riscos novos:** inversão de spread; custo > funding; liquidação.
- **bossCondition:** "Chefe dos Custos + Chefe da Sobrevivência derrotados na amostra viva."
- **unlockStatus:** `UNLOCKED` (capital atingido ✔, evidência atingida ✔).
- **blockedReasons:** — (nenhum).

### Nível 2 — Eficiência  ⟵ **próximo, BLOCKED por evidência**

- **levelId:** 2
- **Descrição:** segunda posição simultânea, melhor timing de fechamento e uso de margem, seleção dinâmica de exchanges.
- **Capital mínimo:** **US$400** — derivação: 4 slots × US$100 (2 posições delta-neutro simultâneas). Não é estimativa.
- **Pré-requisitos:** gate dos challengers de timing LIBERADO; Chefe Concentração derrotado.
- **Métricas obrigatórias:** gate dos challengers de timing LIBERADO; Chefe Concentração derrotado.
- **Módulos desbloqueados:** close-timing challengers; exchange selector; 2ª posição simultânea.
- **Riscos novos:** concentração; correlação entre posições.
- **bossCondition:** "Challenger de timing com gate LIBERADO + Chefe da Concentração derrotado."
- **unlockStatus:** `BLOCKED` — **capital atingido ✔ (US$609,98 ≥ US$400), evidência atingida ✘**.
- **blockedReasons:** "capital suficiente; falta evidência: gate dos challengers de timing LIBERADO · Chefe Concentração derrotado."

> Observação: o Chefe da Concentração já consta como **derrotado** em `progressoGates.chefeConcentracao`, mas o
> gate de timing (`challengersTimingRealExtensions = 0/30`) ainda não abriu — por isso o nível permanece `BLOCKED`
> por evidência. Capital nunca foi o problema aqui.

### Nível 3 — Segunda fonte de lucro  ⟵ **capital SUFICIENTE, mas BLOCKED por evidência**

- **levelId:** 3
- **Descrição:** um segundo motor comprovado (captura de settlement, cross-sectional, momentum ou pares) contribuindo lucro independente.
- **Capital mínimo:** **US$600** — derivação: 6 slots × US$100 (**3 posições delta-neutro concorrentes em 6 exchanges**). Não é estimativa.
- **Pré-requisitos:** Chefe Diversificação derrotado (≥2 fontes independentes lucrativas com amostra).
- **Métricas obrigatórias:** Chefe Diversificação derrotado (≥2 fontes independentes lucrativas com amostra).
- **Módulos desbloqueados:** settlement capture; funding cross-sectional; momentum; pares.
- **Riscos novos:** dependência do mesmo evento; correlação oculta.
- **bossCondition:** "Chefe da Diversificação derrotado (≥2 fontes independentes lucrativas)."
- **unlockStatus:** `BLOCKED` — **capital atingido ✔ (US$609,98 ≥ US$600), evidência atingida ✘**.
- **blockedReasons:** "capital suficiente; falta evidência: Chefe Diversificação derrotado (≥2 fontes independentes lucrativas com amostra)."

> **Este é o coração da mensagem central.** O Champion tem exatamente o capital da topologia deste nível
> (6 slots = US$600) e ainda sobra folga. Mesmo assim está `BLOCKED`: existe **apenas 1 motor elegível**
> (`champion-funding`), 100% do PnL vem dele, e nenhuma segunda fonte independente foi provada
> (settlement em `4/30`). Dinheiro não vira diversificação — evidência vira.

### Nível 4 — Eventos especiais

- **levelId:** 4
- **Descrição:** radar de notícias/eventos, novas listagens, unlocks, anomalias de volume — oportunidades raras.
- **Capital mínimo:** **US$800 (estimativa)** — derivação: 8 slots × US$100; `capitalMinimoEstimativa = true` (topologia ainda não exercida).
- **Pré-requisitos:** Chefe Capacidade derrotado; dados de evento/listagem suficientes.
- **Métricas obrigatórias:** Chefe Capacidade derrotado; dados de evento/listagem suficientes.
- **Módulos desbloqueados:** news/event radar; listing opportunity lab.
- **Riscos novos:** sinal de LLM tratado como verdade; iliquidez de listagem; slippage extremo.
- **bossCondition:** "Chefe da Capacidade derrotado (motor atual satura) + dados de evento suficientes."
- **unlockStatus:** `LOCKED` — capital atingido ✘, evidência atingida ✘.
- **blockedReasons:** "capital insuficiente: US$609.98 < US$800 (estimativa)."

### Nível 5 — Portfólio multimotor

- **levelId:** 5
- **Descrição:** alocador de capital distribuindo entre várias estratégias comprovadas conforme oportunidade.
- **Capital mínimo:** **US$1.200 (estimativa)** — derivação: 12 slots × US$100; `capitalMinimoEstimativa = true`.
- **Pré-requisitos:** ≥2 motores ELIGIBLE/LIVE; router shadow fiel por ≥2 janelas.
- **Métricas obrigatórias:** ≥2 motores ELIGIBLE/LIVE; router shadow fiel por ≥2 janelas.
- **Módulos desbloqueados:** capital allocator; capital opportunity router (live).
- **Riscos novos:** má alocação; risco sistêmico entre motores.
- **bossCondition:** "≥2 motores ELIGIBLE + router shadow fiel por ≥2 janelas."
- **unlockStatus:** `LOCKED` — capital atingido ✘, evidência atingida ✘.
- **blockedReasons:** "capital insuficiente: US$609.98 < US$1200 (estimativa)."

### Nível 6 — Novos mercados

- **levelId:** 6
- **Descrição:** ações fracionárias/ETFs/eventos em ações, com capital, risco, execução e contabilidade separados de cripto.
- **Capital mínimo:** **US$2.000 (estimativa)** — derivação: 20 slots × US$100; `capitalMinimoEstimativa = true`.
- **Pré-requisitos:** arquitetura multi-mercado com capital/risco/contabilidade separados; custos normalizados.
- **Métricas obrigatórias:** arquitetura multi-mercado com capital/risco/contabilidade separados; custos normalizados.
- **Módulos desbloqueados:** stock data provider; broker adapter; market calendar; corporate actions.
- **Riscos novos:** gap overnight; calendário/execução distintos; mistura de contabilidade.
- **bossCondition:** "Arquitetura multi-mercado com capital separado + custos/risco normalizados."
- **unlockStatus:** `LOCKED` — capital atingido ✘, evidência atingida ✘.
- **blockedReasons:** "capital insuficiente: US$609.98 < US$2000 (estimativa)."

---

## Tabela-resumo dos 7 níveis

| Nível | Nome | slots | Cap. mín. | Est.? | unlockStatus | Capital ✔? | Evidência ✔? |
|---|---|---|---|---|---|---|---|
| 0 | Fundação | 0 | US$0 | não | `UNLOCKED` | ✔ | ✔ |
| 1 | Motor principal | 2 | US$200 | não | `UNLOCKED` | ✔ | ✔ |
| 2 | Eficiência | 4 | US$400 | não | `BLOCKED` | ✔ | ✘ |
| 3 | Segunda fonte de lucro | 6 | US$600 | não | `BLOCKED` | ✔ | ✘ |
| 4 | Eventos especiais | 8 | US$800 | **sim** | `LOCKED` | ✘ | ✘ |
| 5 | Portfólio multimotor | 12 | US$1.200 | **sim** | `LOCKED` | ✘ | ✘ |
| 6 | Novos mercados | 20 | US$2.000 | **sim** | `LOCKED` | ✘ | ✘ |

Legenda de status:
- **`UNLOCKED`** — capital atingido **e** evidência atingida.
- **`BLOCKED`** — capital atingido, **mas evidência não** (N2 e N3: o dinheiro está lá; falta prova).
- **`LOCKED`** — capital ainda não atingido (N4–N6, todos com mínimo em estimativa).

> **Resumo em uma frase:** o Champion tem capital para o Nível 3 e está travado no Nível 1 porque progressão
> no Snowball é comprada com **evidência** — amostra, gate, chefe derrotado, segundo motor independente —
> e **nunca** apenas com dinheiro ou um lucro isolado.
