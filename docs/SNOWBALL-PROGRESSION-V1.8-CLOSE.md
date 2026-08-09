# Snowball — Progression Platform v1.8 (CLOSE): rigor e honestidade da economia causal

**Continuação/fechamento** de `snowball-progression-platform-v1.8`. Objetivo: completar e **comprovar**
os itens que ficaram em aberto, sem iniciar v1.9, sem novas estratégias, sem interromper o
durabilitySoak. Construído em worktree isolado (`feature/progression-v1.8-economic`), merge
fast-forward para `main`. **Nenhuma ordem, nenhum capital real.**

---

## Entrega obrigatória (27 itens)

### 1. Status do durabilitySoak
**PARADO** — como o usuário o deixou após o reboot da sessão anterior. **Não reiniciado** (instrução
explícita). Estado crash-safe e checkpointado; retomável a qualquer momento. `soaks-separation.json`:
`durabilitySoak.status = CONTINUA` (definição), processos atualmente 0/5 por decisão do usuário.

### 2. Separação de soaks
`durabilitySoak` (`auditoria/progression/forward`) valida reader/WAL/checkpoint/watermark/supervisor.
`economicSoak` (`auditoria/progression/economic`) é **separado**, nova epoch. Monitores independentes.

### 3. Identidade causal e sua CONFIANÇA
O feed **não tem** `collectorCycleId/scanCycleId` nativo (chaves: `ts,k,spread,apr,vol`). Logo
`sourceRankingCycleId` é **`INFERRED_FROM_SOURCE_TIMING`**, prefixado **`inf_`** (impede confusão com
ID nativo). `identity-provenance.json`: confiança **ALTA (1.0)** — sobre 18.065 gaps reais, 17.934
intra-burst, 131 inter-burst, **0 ambíguos** na zona-limiar → separação bimodal limpa. Gap documentado:
burst 120s / episódio 30min. Recomendação preservada: adicionar `collectorCycleId` append-only no
coletor elevaria a `NATIVE` (não feito p/ não tocar produção nesta fase).

### 4. Testes de identidade — **causal-identity 7/7**
Mesmo símbolo/hora → episódios distintos (sem falso agrupamento); cruza a hora → mesmo episódio (sem
falsa separação); direções opostas / mesmos timestamps → distintos; **mesma oportunidade em 5
políticas → decisionId IGUAL**; reabertura/reaparição pós-gap → renova.

### 5. Mirror Control real
`forward-mirror.cjs` emite eventos **OPEN / SCALE / FUNDING_SETTLED / COST_APPLIED / CLOSE** com
`championEventId` (SINTÉTICO, prefixo `synth_`), `cycleId`, `timestamp`, `payload`, `stateHashAfter`.
Idempotente (dedup por `championEventId`). **Declarado `SNAPSHOT_MIRROR_INCOMPLETE`**: o Champion NÃO
expõe log de eventos append-only, então os eventos são **derivados do diff de snapshots** — não se
finge fidelidade event-level.

### 6. Mirror fidelity
`mirror-fidelity.json`: `mirrorMode=SNAPSHOT_MIRROR_INCOMPLETE`, `operacionalFiel=true` (3 Champion =
3 Mirror), `contabilFiel=true` (**maxDiffFunding=US$0,00**, capital espelhado), `fielTotal=true` **na
granularidade de snapshot**. "Zero evento perdido" a nível de evento **não** é declarado (limitação honesta).

### 7. Policy Control
`forward-lab --close-policy economic_inversion` no feed econômico: identidade causal, ranking
determinístico, saldo próprio, close policy explícita, **sem fechamento implícito por scanner stale**.

### 8. Divergências do Policy
`policy-control-fidelity.json`: `ENTRY_DIVERGENCE=3`, demais 0; **todasExplicadas=true** (Champion
abriu as 3 posições **antes** da economicForwardEpoch → warmup). Fidelidade **separada** da do Mirror.

### 9. Close semantics
Registra `scannerVisible / latestEconomicEvaluation / latestEconomicEvaluationAgeMs / inversion /
riskExit / maxHoldingExit / fundingDeterioration / exchangeFailure / policyCloseReason`. Fecha por
inversão econômica, deterioração de funding, falha de exchange (hook) ou **maxHolding (risco, 7d)** —
**nunca** por scanner stale. `scannerLastSeen` é feature.

### 10. Posições censuradas
Abertas no fim = **RIGHT_CENSORED**, reportadas à parte; nunca fechadas artificialmente p/ gerar amostra.

### 11. Segurança de TODAS as suítes
Guard exige `FORWARD_TEST_MODE=1` + `FORWARD_TEST_ROOT` **existente**, **sob temp**, **fora de
árvore forward/economic**, e proíbe `--label` duplicado. **As 9 suítes migradas** e verdes sob temp
root: wal 10, recovery 8, rotation 6, crash 7, restart 10, fault 6, supervisor 6, causal 7,
test-safety 6. **Produção `forward/` comprovadamente intocada** durante toda a suíte.

### 12. Registro do near-miss (t2)
`near-miss-record.json`: um smoke test apontou `FORWARD_TEST_ROOT` para a produção do repo principal
a partir do worktree; como o `L.ROOT` diferia, o guard antigo não pegou e criou um dir `t2` vazio.
**Detectado e removido**; guard endurecido (rejeita qualquer segmento `auditoria/progression/forward|
economic` independente do repo). **Impacto: nenhum** — nenhum arquivo econômico, estado, processo de
produção ou Champion alterado.

### 13. Pareamento econômico
`economic-pairing.json`: pareia por `sourcePositionId/sourceDecisionId` (nunca horário). Atual: 0
fechadas (economicSoak recém-congelado).

### 14. Amostra independente
`economic-sample.json`: `sourcePositionId únicos fechados = 0/30`, `divergências = 0/15`,
RIGHT_CENSORED = 0. Honesto — não reutiliza fechamentos do warmup.

### 15. Watermark econômico
`economic-watermark.json`: `OK_COMMON_WATERMARK`, `commonWatermarkEventCount=0`,
`comparablePositions=0`, `excludedDueToLag=0`.

### 16. economicForwardEpochId
**`032a0b32782e1e8a`** — congelado no watermark atual; os 6 processos partem do mesmo byteOffset.

### 17. Processos econômicos VIVOS
**6/6 vivos**: mirror, policy, trial, observer-max3, observer-max4, observer-max5 (heartbeats frescos).
`node total = 7` (6 + economic-soak-monitor).

### 18. economicSoak
`economic-soak-monitor.cjs` (separado): `economic-soak-resumo.json` — uptime, common watermark
(OK), eventos, decisionIds/positionIds, abertas/fechadas/censuradas, divergências, perdas,
duplicações, Mirror/Policy fidelity, vivos 6/6.

### 19. Gate
`economic-gate.json` **BLOQUEADO** — metodologia **SÓLIDA**, mas 0/30 posições-fonte, 0/15
divergências, 2 janelas/2 regimes/stress/concentração/durabilitySoak pendentes.

### 20. profitGameLayerReadiness
**`COLLECTING`** (teto v1.8) — metodologia sólida + 6/6 processos vivos coletando. Nunca
`READY_FOR_PROFIT_ANALYSIS` na v1.8.

### 21. durabilitySoak não interrompido
Não iniciado/reiniciado por esta fase (estava parado pós-reboot, por decisão do usuário). O código
v1.8 mantém COMPAT `[v1_7, v1_8]` para que ele **sobreviva a restart** quando religado.

### 22. Champion intacto
Capital **612,98**, reconcilia `true`, 3 posições. Nenhum caminho protegido tocado.

### 23–27. Commit / Tag / Working tree / Branch / Merge
Commit na `main`; tag `snowball-progression-platform-v1.8.1`; working tree limpo (economic runtime
gitignorado como forward/); branch/worktree `feature/progression-v1.8-economic`; **merge fast-forward
seguro na main**. **Sem push remoto** (aguardando autorização explícita).

---

## Recomendação
As duas honestidades que faltavam estão explícitas: a identidade é **inferida** (não nativa), com
confiança medida; o Mirror é **snapshot-incomplete** (Champion sem event log), fiel só na granularidade
de snapshot. A metodologia é sólida e os 6 processos coletam. Falta o de sempre: **tempo com
fechamentos econômicos reais**. Gate **BLOQUEADO**, profit readiness no teto **COLLECTING**.
