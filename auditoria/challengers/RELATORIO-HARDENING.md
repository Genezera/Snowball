# Hardening operacional dos challengers live-paper

Continuação de `snowball-challengers-live-1786189433850`. **Read-only sobre o
Champion; nada envia ordem nem escreve em `spread/`, estado do Champion ou
motores.** Sem novos challengers — só endurecimento dos 4 atuais para coleta de
dias sem perda/duplicação/corrupção, separando observado de contrafactual.

## 1. Classificação de origem (item 1)

Cada campo da telemetria carrega **`{value, source, observedAt, ageMs, confidence}`**.
`source ∈ {champion_observed, market_observed, derived, unavailable}`. Confiança:
champion_observed=1.0; market_observed=0.9 (fresco) / 0.4 (stale); derived=0.7;
unavailable=0. O funding pós-fechamento **nunca** é chamado de realizado — é
**`liveObservedCounterfactualFunding`** (source market_observed).

## 2. Supervisor isolado (item 2)

`scripts/challengers-timing/supervisor-challengers-timing` cuida **só** dos 4
(control/closeConfirm/nextSettlement/evExit): heartbeat, lock/mutex de instância
única, restart seguro, **backoff** exponencial, **preservação de cursor** (no
estado.json de cada challenger), **zero interação com o Champion** e sem
processo duplicado. Rodando ao vivo (4 processos supervisionados).

## 3-4. Testes de restart/cursor/reabertura (itens 3,4) — 8/8 ✅

`scripts/challengers-timing/tests/restart-cursor-reopen.test.sh` (diario
sintético isolado):
- **T1** restart preserva cursor (351=351), zero duplicação, PnL/posições preservados.
- **T2** evento novo após restart processado incremental (zero perda).
- **T3** símbolo reabrindo → **2 instâncias distintas**, positionId distintos,
  funding roteado à instância certa (0.10 e 0.30 separados).
- **T4** fecha do Champion afeta **só** a instância corrente.

## 5. Fidelidade incremental do Control (item 5)

A cada ciclo o Control compara seu PnL fechado com o do Champion (por instância)
e grava `comparisonStatus`. Atual: **OK** (9.1699 vs 9.1697, dif 0.00016 < 0.01).
Se romper a tolerância → **`SUSPENDED_CONTROL_DIVERGENCE`**, suspendendo as
comparações econômicas **sem parar a coleta**.

## 6. Qualidade/elegibilidade da extensão (item 6)

Cada ciclo registra source+idade+confiança de marks/distância de liquidação/
funding/slippage. **Extensão inelegível** se: dado stale, mark indisponível,
distância de liquidação indisponível, settlement desconhecido, telemetria de uma
perna ausente. Inelegível → saída de risco (nunca conta como extensão).

## 7. Opportunity cost observado (item 7)

Registrado **só durante extensão real** (settlementsExtras>0), não por taxa fixa.
No batch atual não há extensão real (todas inelegíveis por dado stale) → 0; ao
vivo, preenche com oportunidades observadas + capital-horas.

## 8. Divergência entre políticas (item 8)

`divergencia.jsonl` por challenger: decisão/EV/motivo/distância mínima+source/
inversão por ciclo. **EV Exit e Next Settlement NÃO serão fundidas** antes de
30 extensões comparáveis, ≥95% de concordância e diferença econômica imaterial.

## 9. Gate atualizado (item 9) — BLOQUEADO

`relatorio-diario.json`: **0/30** fechamentos com extensão real, **0/15**
divergências reais vs Control, Control **OK**. (O flag `seguralemChampion` é
enganoso no replay batch — o gate usa **`settlementsExtras>0`** como sinal
honesto de extensão.) **NÃO alterar o Champion.**

## 10. Relatório diário (item 10)

`scripts/challengers-timing/relatorio-diario.cjs` → processos vivos, heartbeat
age, Control fidelity, extensões abertas/fechadas, divergências, PnL incremental,
risco, **eventos inelegíveis**, progresso do gate.

## 11-14. Integridade

`git diff` não altera `spread/`, `momentum/`, `pares/`, `src/cli`,
`src/inteligencia`, `src/funding`, `src/risk`. Champion 5184 no ar (200). Os
challengers escrevem **só** em `challengers-timing/<policy>/` (runtime volátil,
gitignored). **Champion intacto.**

**Estado:** 4 challengers coletando ao vivo sob supervisor isolado, com
telemetria classificada por origem, fidelidade incremental do Control e o gate
honestamente bloqueado até acumular ≥30 extensões reais em ≥2 janelas/regimes.
