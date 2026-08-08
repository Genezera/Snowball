# Snowball — Progression v1.3: Trial forward, saldos locais e capacidade real

Continuação de `snowball-progression-platform-v1.2`. **Read-only / shadow /
paper.** Não altera Champion, challengers existentes, motores, risco, capital,
alavancagem, execução ou limites. Reprodutível por `build-all.cjs` (21 builders).

## 1. Snapshot congelado (`snapshot.json`)

Corte comum para TODAS as comparações v1.3: **snapshotId `44b45cafdd487fd7`**,
janela `2026-08-03T12:04Z → 2026-08-08T20:33Z`, último eventId, último cycleId,
commit `b899d468`, `configEpochId epoch-1`, + **hashes SHA-256** de
`diario.jsonl`/`estado.json`/`marcacao.json`/`arquivo-observacoes.jsonl`.

## 2. Reconciliação exata do Control ≤ US$0,01 (`control-reconciliation.json`)

Substituída a tolerância de **US$1** (v1.2) por **≤US$0,01 por dimensão**:

| Dimensão | Diferença Control vs Champion | Dentro de $0,01 |
|---|---|---|
| funding | 0 | ✅ |
| custos | 0 | ✅ |
| capital (inicial+funding−custos) | 0 | ✅ |
| posições abertas | 0 | ✅ |

Decomposição de custos por categoria (abre/fecha/escalona/apara/socorre/reinveste/
abre-captura). A **única** diferença de PnL (US$0,45) é **100% atribuída a categoria
documentada**: *funding acumulado das posições abertas ainda sem custo de fechamento*
(marcacao.custoEstimadoFechamentoTotal). Nada é tolerado às cegas.

## 3–4. Processos forward Trial + Control (`forward-lab.cjs`)

Processo **live-paper FORWARD isolado**, roda como **Trial** (Bitget+Bybit, US$100+US$100)
ou **Control** (6 exchanges, US$100 cada). Cada um com **estado / ledger / diário
append-only / heartbeat / lock próprios**, reserva 30%, alavancagem 5×, regras
econômicas do Champion, **nenhuma ordem, nenhum saldo real movido**. Analisa **novas**
oportunidades a partir do início (cursor = último ts observado no start — **não replaya**
histórico). **Ambos rodando** (WMI-detached).

> **Honestidade:** os processos forward **começaram do zero neste corte** → capital
> Trial 200 / Control 600, 0 posições. Acumulam com o tempo (funding ao longo de
> horas). Os números forward só ficam significativos após dias — por design.

## 5. Capital local por exchange (`forward-lab` + `forward-status.json`)

Cada oportunidade registra saldo long/short, margem livre por exchange, reserva
local, capital por perna e o **bloqueio decomposto**:
`aggregateCapitalBlocked · exchangeLocalBalanceBlocked · reserveBlocked ·
maxPositionsBlocked · minOrderBlocked · evNaoPositivo`.

## 6. Economia forward multi-horizonte (`opportunity-life.json`)

EV por posição de US$100/perna em **1h / 8h / 24h / 72h + vida observada** (não só
168h). Horizontes curtos raramente pagam o round-trip de 0,28%; só APR alto **com
vida longa** fecha a conta.

## 7. Vida das oportunidades — explica o funil

`opportunityId` persistente com firstSeen/lastSeen/duração/maxAPR/minAPR/estabilidade/
inversões/ciclos/payback-suficiente.

| Etapa | Quantidade |
|---|---|
| Oportunidades distintas | **2.909** |
| modelPositiveEV (se segurar 168h) | **1.074** |
| **Viveram tempo suficiente p/ payback** | **153** |
| enginePositiveEV (v1.2, vida real) | ~13 |
| Abertas pelo Champion | subconjunto |

**A explicação:** duração **mediana 27h** vs payback **mediano 160h** → só **5,26%**
das oportunidades vivem o suficiente para pagar o round-trip. O "1.064/1.074" some
para ~153/~13 porque **as oportunidades desaparecem antes de pagar** — a vida, não o
capital, é o gargalo.

## 8. Teste maxPositions 3/4/5 (`maxpositions-test.json`)

Observers shadow (Champion intacto). Pelo modelo leniente, até **86** janelas de
payback se sobrepõem; maxPos 3→5 capturaria 15→23 (PnL 28→39). **MAS** o modelo
leniente superconta (153 vs ~13). **Os modelos offline DISCORDAM** (v1.1/v1.2:
capital satura em 3; este: limite de posições binda). A discordância vem do modelo
de viabilidade. **Só o teste FORWARD resolve o gargalo real** — por isso não se
mexe no maxPositions do Champion sem esse dado.

## 9. Common-window forward (`forward-status.json`)

Trial vs Control com PnL abs/%, funding, custos, avaliadas, abertas/fechadas,
bloqueios por saldo local, saldos por exchange. **Mínimo no corte** (processos
recém-iniciados) — preenche ao vivo.

## 10. Gate de seleção de exchanges — BLOQUEADO

**NÃO recomendar Bitget+Bybit** antes de: **≥30 posições fechadas FORWARD** (0 hoje),
2 janelas, 2 regimes, Control fiel (**✅ ≤US$0,01**), custos 2×, nenhuma posição >25%
do ganho, nenhum símbolo >35%, zero falha crítica de exchange, e **resultado forward,
não apenas replay**. Hoje: `0/30 fechadas forward` → **BLOQUEADO**.

## 11. Fundo de desbloqueio (`unlock-fund.json`)

Continua shadow: lucro **10,55**, **fundo US$6,14 = 3,07%** de US$200, candidato
**settlement-capture**, status **não elegível**. Nenhum motor financiado.

## 12. Monitor operacional (item 12)

Monitor 24h em **63/1440 min** (religado após a queda de ~2h da máquina).
Supervisor + 4 challengers vivos, fidelity OK, **SEM PERDA/DUPLICAÇÃO**. **NÃO
encerrado antecipadamente** — segue até 1.440/1.440.

## 13. Recomendação

1. **O gargalo é a VIDA das oportunidades, não o capital** — 27h de vida mediana vs 160h de payback; 5,26% sobrevivem. Injetar capital não ajuda.
2. **maxPositions: inconclusivo offline** — os modelos discordam. **Deixar o teste forward decidir**; não alterar o Champion (maxPos=3) sem dado forward.
3. **Manter 6 exchanges** — a largura rende +5,13 (~46%) a mais que 2 (v1.2). Só migrar para Bitget+Bybit após o gate (≥30 fechadas forward + 2 janelas/2 regimes).
4. **Deixar Trial/Control forward acumularem** ≥30 fechadas em 2 janelas/2 regimes — é a única evidência que resolve capital-vs-posições-vs-vida.
5. **Política C** continua construindo o fundo (US$6,14) a custo zero.
6. **Contabilidade confiável** — o Control reconcilia com o Champion em **US$0,01**.

## Integridade

- **Champion intacto** — só leitura; nenhuma escrita em motor/estado/execução; nenhuma ordem; nenhum capital movido.
- **Challengers existentes não alterados**; validação segue no monitor.
- Novo código em `scripts/progression/`; runtime forward em `auditoria/progression/forward/` (gitignored). Reversível.

Distinções: observed · replayed · simulated · shadow · **live-paper forward** · hypothetical · real (nada — nenhuma alteração real).
