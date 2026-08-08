# Snowball — Progression Platform v1.8: Causal Economic Identity e Control Semantics

**Tag:** `snowball-progression-platform-v1.8` · continua de `snowball-progression-platform-v1.7`
**Escopo:** trocar a identidade econômica heurística (símbolo+hora) por **identidade causal**,
separar **durabilitySoak** de **economicSoak**, e introduzir **Mirror Control** (espelho exato do
Champion) e **Policy Control** (reexecução das regras a partir do feed), corrigindo a semântica de
fechamento (não fechar por scanner stale).
**Natureza:** read-only / shadow / paper / append-only / reversível. **Nenhuma ordem, nenhum capital
real.** Champion, challengers existentes, capital, risco, alavancagem, execução e limites
**inalterados**. Nenhuma estratégia nova. **Durability Soak v1.7 não interrompido.** Construído em
**worktree isolado** (`feature/progression-v1.8-economic`), merge fast-forward para `main`.

---

## Veredito do gate: **BLOQUEADO** (honesto)

```
identidadeCausal=OK  MirrorFiel=true  PolicyDivExplicadas=true  semCloseImplicito=OK
economicSoak=EPOCH_CONGELADA  posições-fonte únicas 0/30  divergências 0/15
0/2 janelas/regimes  stress=false  concentração=false  durabilitySoakCompleto=false
→ NÃO recomendar Bitget+Bybit
```

As **correções de identidade e semântica** estão provadas. O economicSoak foi **congelado numa nova
epoch** e a amostra começa em 0 (não reutiliza o warmup). O gate só destrava com fechamentos
econômicos reais.

---

## Os 17 entregáveis

### 1. Separação de soaks
`soaks-separation.cjs`: **durabilitySoak** (`auditoria/progression/forward`, v1.7) **CONTINUA**
validando reader/WAL/checkpoint/watermark/supervisor. **economicSoak**
(`auditoria/progression/economic`, nova epoch) é separado. Os resultados econômicos anteriores são
marcados **ECONOMIC_WARMUP_NOT_GATE_ELIGIBLE** — dados **preservados**, não apagados.

### 2. Identidade causal
Removida a heurística símbolo+hora / timestamp arredondado. O reader emite:
`sourceObservationEventId` (linha física), `sourceRankingCycleId` (scan burst por contiguidade da
fonte), `sourceOpportunityEpisodeId` (episódio por contiguidade da chave), `sourceDecisionId`
= `hash(epoch, rankingCycleId, opportunityEpisodeId, symbol, long, short)` — **comum entre políticas
que veem a mesma oportunidade no mesmo scan** — e `sourcePositionId` (uma posição-fonte por episódio).

### 3. Testes de identidade
`causal-identity.test.sh` **7/7**: mesmo símbolo/hora com gap → episódios distintos (sem falso
agrupamento); oportunidade cruza a hora → mesmo episódio (sem falsa separação); direções opostas →
decisões distintas; mesmos timestamps → distintos por chave; **mesma oportunidade em 5 políticas →
decisionId IGUAL**; reabertura após gap → posição-fonte nova; reaparição pós-episódio → renova.

### 4. Mirror Control
`forward-mirror.cjs`: espelho **puro** do Champion — abre só quando o Champion abre, escala só quando
escala, funding só quando o Champion recebe, fecha só quando fecha. Registro por evento
(sourceEventId/sourcePositionId/mirrorPositionId/championPositionId/…). `mirror-fidelity.cjs`:
**fielTotal=true** (3 posições Champion = 3 Mirror; capital espelhado). Objetivo — fidelidade
contábil e operacional exata — atingido.

### 5. Policy Control
`policy-control-fidelity.cjs`: processo que reexecuta as regras do Champion a partir do feed;
divergências classificadas `ENTRY/SIZING/RANKING/BALANCE/CLOSE/DATA`. Estado atual: 3
`ENTRY_DIVERGENCE`, **todas explicadas** (posições do Champion abertas **antes** da economicForwardEpoch
= warmup). Fidelidade **separada** da do Mirror.

### 6. Semântica de fechamento
`--close-policy economic_inversion`: **não** fecha por sumiço do scanner. Registra
`scannerVisible/scannerLastSeen/economicEV/inversion/riskExit/sourceChampionClose/policyClose`. Mirror
fecha só no `sourceChampionClose`; observers/Trial usam política pré-registrada (inversão econômica
sustentada). `scannerLastSeen` é **feature**, nunca gatilho implícito. (O durabilitySoak mantém
`scanner_stale`, que só valida durabilidade.)

### 7. Posições censuradas
Posições abertas no fim da janela = **RIGHT_CENSORED**; reportadas à parte
(realizedClosedPnL/unrealizedMarkedPnL/executablePnL/expectedFunding/settledFunding). Nunca fechar
artificialmente para gerar amostra.

### 8. Pareamento econômico
`economic-pairing.cjs`: pareia por **sourcePositionId/sourceDecisionId** (nunca horário). Para cada
posição-fonte compara policy/trial/observer-max3/4/5: abriu/recusou, motivo, notional, custos,
funding, close timing, PnL, capital-horas, drawdown.

### 9. Amostra independente
`economic-sample.cjs`: conta **sourcePositionId únicos fechados** e divergências reais por
posição-fonte — nunca a mesma oportunidade × políticas. Metas ≥30 únicas / ≥15 divergências.
**Atual (soak recém-congelado): 0/30, 0/15.**

### 10. Segurança dos testes
`FORWARD_TEST_MODE=1` + `FORWARD_TEST_ROOT` temp obrigatórios; **aborta** se TEST_ROOT resolver p/
qualquer árvore `auditoria/progression/forward`; **proíbe `--label` duplicado**.
`test-safety.test.sh` **4/4** (inclui teste que confirma que o harness recusa tocar produção).

### 11. Watermark econômico
`economic-watermark.cjs`: comparação pareada só com posições materializadas no mesmo watermark;
registra `commonWatermarkEventCount/Offset/Hash`, `comparablePositions`, `excludedDueToLag`.

### 12. Nova epoch econômica
`freeze-economic-epoch.cjs` congelou `economicForwardEpochId`; Mirror/Policy/Trial/max3/4/5 partem do
mesmo watermark; economicSoak separado. **Não reutiliza fechamentos do warmup.**

### 13. Gate
`relatorio-forward.cjs` estendido: identidade causal validada, Mirror fiel, Policy explicada, sem
fechamento implícito por scanner, economicSoak íntegro, ≥30 posições-fonte únicas, ≥15 divergências,
2 janelas, 2 regimes, stress, concentração, durabilitySoak completo. **BLOQUEADO.**

### 14–17. Fechamento
- **14.** Commit. **15.** Tag `snowball-progression-platform-v1.8`.
- **16.** Working tree: só `scripts/progression/`, `auditoria/progression/`, `docs/`.
- **17.** Champion intacto: capital **612,98**, reconcilia `true`, 3 posições. Nenhum caminho
  protegido tocado.

---

## Testes (leitor v1.8)

| Suíte | Resultado |
|---|---|
| causal-identity | **7/7** |
| test-safety | **4/4** |
| forward-crash-injection | **7/7** |
| forward-restart | **10/10** |
| forward-fault-injection | **6/6** |
| wal-durability | **10/10** |
| recovery-matrix | **8/8** |
| rotation-overlap | **6/6** |
| supervisor-matrix | **6/6** |

Schema `forward.v1_8` com COMPAT `[v1_7, v1_8]` — o durabilitySoak v1.7 sobrevive a restart sob o
código v1.8, sem interrupção.

## Recomendação

A **identidade** agora é causal (episódio/scan), não mais um proxy de símbolo+hora, e o **fechamento**
não é mais disparado por sumiço do scanner — as duas causas-raiz das medições econômicas enganosas
das fases anteriores. **Mirror** e **Policy** separam fidelidade contábil de fidelidade de regras. O
economicSoak recomeça limpo numa nova epoch. Falta o de sempre: **tempo com fechamentos econômicos
reais** (≥30 posições-fonte únicas, ≥15 divergências, 2 janelas/2 regimes, stress, concentração). Até
lá, **gate BLOQUEADO**, **nada muda no Champion**.
