# Snowball — Progression Platform v1.6: Atomic Checkpoint e Common Watermark

**Tag:** `snowball-progression-platform-v1.6` · continua de `snowball-progression-platform-v1.5`
**Escopo:** provar que o leitor forward v1.5 **não perde eventos em crashes** e que os cinco
processos são comparados **somente em um watermark realmente comum**.
**Natureza:** tudo read-only / shadow / paper / append-only / reversível. **Nenhuma ordem enviada,
nenhum capital real movido.** Champion, challengers, estratégias, capital, risco, alavancagem,
execução e limites **inalterados**. Nenhuma estratégia ou modelo novo.

---

## Veredito do gate: **BLOQUEADO** (honesto)

```
checkpointsAtomicos=OK  crashSuite=OK(7/7)  watermark=true  epoch=true  hashes=true
soakCompleto=false  economicFidelity=false (0/30 fechadas forward)  0/2 janelas/regimes
→ NÃO recomendar Bitget+Bybit
```

A durabilidade e a comparabilidade estão **provadas**. O que continua bloqueando é o que sempre
bloqueou e só o tempo resolve: **eventos econômicos forward reais** (≥30 fechamentos, 2 janelas,
2 regimes). O gate não é afrouxado para destravar — ele permanece fiel à evidência.

---

## Os 18 entregáveis

### 1. Checkpoint atômico
`escreverAtomico(p, obj)` — `copyFileSync(atual→prev)` → `openSync(tmp)` → `writeSync` →
`fsyncSync` → `closeSync` → `renameSync(tmp, p)`. O rename é atômico (libuv usa
`MOVEFILE_REPLACE_EXISTING` no Windows). Todo o estado (`estado.json`) é persistido numa única
transação; o `estado.prev.json` fica para recuperação. **Nunca** há um `estado.json` meio-escrito:
ou o rename aconteceu (novo estado) ou não (estado anterior íntegro).

### 2. Write-ahead log (WAL)
`wal.json` recebe **PREPARED** (via `escreverAtomico`) *antes* da mutação e **COMMITTED** *depois*
do checkpoint. Um PREPARED-sem-COMMITTED encontrado no restart é reprocessado de forma
**idempotente** — a idempotência vem do cursor por byte-offset + dedup por `physicalEventId`, então
reaplicar não duplica nem corrompe.

### 3. physicalEventId ≠ logicalObservationHash
- `physicalEventId = sha(sourceFileId | byteStart | byteEnd | lineHash)` — identidade **física** da
  linha na fonte.
- `logicalObservationHash = sha(ts | key | apr | spread | volume)` — identidade **de conteúdo**.

Duas linhas físicas distintas com conteúdo igual **não** são deduplicadas como se fossem a mesma —
o dedup é por `physicalEventId`. Conteúdo igual reaparecendo num novo offset **é** processado.

### 4. Eventos atrasados (late events)
Cada evento carrega `eventTime` (ts da obs), `ingestionTime` (agora), `latenessMs`, `lateEvent`
(`latenessMs > 10min`) e `sourceOffset`. O processamento é em **ordem de ingestão / sourceOffset**;
decisões finalizadas **não** são reordenadas retroativamente. Analytics pode ordenar por `eventTime`
sem alterar as decisões já tomadas.

### 5. Watermark comum
`common-watermark.cjs` lê os 5 `snapshots.jsonl` e calcula o **mínimo committed** entre os processos
(`minimumCommittedEventCount`, `commonLastEventId`, `commonAccumulatedHash`). A comparação econômica
acontece **só nesse watermark**. Estados possíveis: `OK_COMMON_WATERMARK` / `PROCESS_LAGGING` /
`SOURCE_DIVERGENCE` / `STATE_DIVERGENCE` / `SUSPENDED`.
**Resultado atual:** `OK_COMMON_WATERMARK`, hashes de fonte concordam.

### 6. Snapshots por watermark
Cada ciclo grava em `snapshots.jsonl` um snapshot compacto por `committedOffset` / `eventCount` /
`accumulatedHash` / capital / saldos / posições / PnL / custos / funding — a matéria-prima do
watermark comum.

### 7. Modelo de saúde da fonte
`source-health.cjs` usa `lastModified` do arquivo + scan interval esperado (~5min) + heartbeat do
coletor. Classifica `NO_NEW_DATA_YET` / `COLLECTOR_DOWNTIME` / `EXCHANGE_UNAVAILABLE` /
`OPPORTUNITY_ABSENT` / `SCANNER_FILTERED`. **Batch vazio não é prova de indisponibilidade** — só há
`COLLECTOR_DOWNTIME` quando o arquivo fica > 4× o scan interval sem modificação.
**Resultado atual:** `NO_NEW_DATA_YET` (arquivo fresco, sem obs nova no ciclo).

### 8. Suíte de testes re-rodada no leitor reescrito
Não se reaproveitou resultado de v1.4/v1.5. Sobre o leitor v1.6:
- `forward-restart.test.sh` — **10/10** (cursor por byte-offset; T3 com semântica de dedup físico).
- `forward-fault-injection.test.sh` — **6/6** (same-ts / out-of-order / truncation / rotation).
- `forward-crash-injection.test.sh` — **7/7** (ver item 9).

### 9. Injeção de crash
Kill (exit 137 via `FORWARD_CRASH_AT`) em **7 pontos instrumentados**: `during_tmp_write`,
`after_fsync`, `before_rename`, `after_rename`, e pontos de WAL/commit. Para cada ponto: run de
referência, depois 3× com o crash injetado. Comparação da assinatura final
(`eventCount | accumulatedHash | saldos | virtuais | dedupIgnorados`) contra a referência: **idêntica
nos 7/7**. **Zero perda, zero duplicação, mesmo stateHash/eventHash/saldos/posições.**

### 10. Drill do supervisor (live)
`supervisor-forward` cuida dos 5 processos (heartbeat / lock / single-instance / restart / backoff).
Drill executado ao vivo: `observer-max5` morto → **religado único em ~32s**, `byteOffset` preservado
(`14720921 → 14736482`, monotônico, sem reset), **sem duplicata**, 5/5 vivos. Combinado com a suíte
de restart/crash, cobre restart único / backoff / downtime / checkpoint recuperado / sem duplicação.

### 11. Fidelidade do Control em 3 camadas
`control-fidelity-vectorial.cjs` → `fidelidade3Camadas`:
1. **ChampionAccountingConsistency** — identidades internas do Champion fecham consigo mesmas (OK).
2. **ControlSourceFidelity** — mesmos eventos + hash de fonte, via common-watermark (OK).
3. **ControlEconomicFidelity** — 9 definições ≤ US$0,01 na sua base, **sem categoria residual**;
   `aprovadoAposEventosForwardReais` só quando `fechadasForward ≥ 30` (hoje **0**).

A camada econômica só é aprovada depois de eventos econômicos forward reais — não por replay.

### 12. Sensibilidade do gap com cobertura
`gap-coverage.cjs` detecta buracos de cobertura **globais** (> 10min sem nenhuma obs) — proxy de
collector downtime / rotação / transição de config — e recalcula 15/30/45/60min **excluindo**
episódios que atravessam buracos operacionais.
**Resultado:** 14 buracos de cobertura; a duração mediana dos episódios completos permanece
**~0,17h (gap 30min), igual com e sem buracos**. Ou seja: a conclusão "episódio de scanner é curto"
**não** era artefato de downtime do coletor — distingue-se gap de **mercado** de gap **operacional**.

### 13. Forward soak até 1440/1440
`forward-soak-monitor.cjs` acompanha uptime / restarts / downtime / dups / perdas / divergência de
fonte/estado/fidelidade e cobertura do watermark comum. **Em andamento** (`soakCompleto=false`) — é
um monitor de tempo real, não um cálculo instantâneo.

### 14. Gate (estendido)
`relatorio-forward.cjs` — o gate agora exige, além das travas econômicas anteriores:
`checkpointsAtomicosComprovados`, `crashSuiteCompleta`, `commonWatermarkValido`,
`forwardEpochValido`, `sourceHashesIdenticos`, `forwardSoakCompleto`, `controlEconomicFidelity`,
≥30 fechadas forward, 2 janelas, 2 regimes, custos 2×, concentração, zero falha crítica.
**Hoje:** durabilidade/comparabilidade OK; soak + fidelidade econômica + janelas/regimes pendentes →
**BLOQUEADO**.

### 15–18. Fechamento
- **15.** Este documento.
- **16.** Tag `snowball-progression-platform-v1.6`.
- **17.** Working tree: só `scripts/progression/` e `auditoria/progression/` alterados.
- **18.** Champion intacto: capital **612,75**, reconcilia `true`, 3 posições, funding 23,53 / custos
  10,78. Nenhum caminho protegido (Champion / challengers / config / src) tocado.

---

## Recomendação

O leitor forward está **crash-proof** (7/7 pontos recuperam idênticos) e os 5 processos são
comparados **só num watermark comum válido**. A conclusão do scanner sobrevive à correção por
cobertura. O que falta é **tempo com dados forward reais** — deixar o soak fechar 1440/1440 e
acumular ≥30 fechamentos em 2 janelas / 2 regimes. Até lá, **gate BLOQUEADO** e **nada muda no
Champion**.
