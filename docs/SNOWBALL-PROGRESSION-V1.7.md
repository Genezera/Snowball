# Snowball — Progression Platform v1.7: Durability Soak e Economic Event Fidelity

**Tag:** `snowball-progression-platform-v1.7` · continua de `snowball-progression-platform-v1.6`
**Escopo:** validar a durabilidade v1.6 em execução prolongada e começar a comprovar a
**fidelidade econômica forward evento por evento**.
**Natureza:** tudo read-only / shadow / paper / append-only / reversível. **Nenhuma ordem enviada,
nenhum capital real movido.** Champion, challengers, estratégias, capital, risco, alavancagem,
execução e limites **inalterados**. Nenhuma estratégia, observer ou modelo novo.

---

## Veredito do gate: **BLOQUEADO** (honesto)

```
durabilityMatriz=OK  supervisorMatriz=OK  watermark=true(estável=true)  epoch=true
soakCompleto=false  economicFidelity=false  únicasFechadas 0/30  divergências 0/15
stress=false  concentração=false  0/2 janelas/regimes  HOST_REBOOT_TESTED=false
→ NÃO recomendar Bitget+Bybit
```

A **durabilidade** (WAL + recovery matrix + rotação) e a **comparabilidade** (watermark comum
estável) estão provadas. O que continua bloqueando é o que só o tempo resolve: **eventos econômicos
forward reais** — o soak foi **reiniciado do zero** neste release (o leitor mudou), então a amostra
recomeçou em 0. O gate não é afrouxado para destravar.

---

## Nível de garantia real (item 1)

Declaramos **apenas o que foi testado**:

| Nível | Declarado | Base |
|---|---|---|
| **PROCESS_CRASH_SAFE** | ✅ **sim** | crash-injection 7/7, wal-durability 10/10, recovery-matrix 8/8 |
| HOST_REBOOT_TESTED | ❌ não | ambiente principal; sem container descartável p/ reboot abrupto seguro |
| POWER_LOSS_DURABLE | ❌ não | fsync+rename dão *ordering*, não durabilidade de firmware sob queda de energia |
| STORAGE_FAILURE_TOLERANT | ❌ não | detectamos corrupção via checksum, mas sem replicação contra perda de disco |

Crash de **processo** provado **não** vira reboot de **host**. `assurance-level.json` + `host-reboot-result.json`.

---

## Os 18 entregáveis

### 1. Linguagem de garantia
Taxonomia acima; só `PROCESS_CRASH_SAFE` declarado. `HOST_REBOOT_TESTED=false` registrado explicitamente.

### 2. Durabilidade do WAL
O WAL agora carrega `schemaVersion`, `walSequence` e `checksum`. Escrita durável: **WAL PREPARED
(fsync)** → **checkpoint tmp (fsync) → rename atômico → fsync do diretório** (quando o SO suporta) →
**WAL COMMITTED (fsync)**. Teste `wal-durability.test.sh` (**10/10**) simula WAL **vazio / parcial /
truncado / checksum inválido / PREPARED-sem-COMMITTED / COMMITTED-sem-checkpoint** — em todos, o
leitor **nunca começa do zero em silêncio**: suspende (`SUSPENDED_WAL_CORRUPTION`), reaplica o ciclo
(`REPLAYED_PREPARED_CYCLE`, idempotente) ou recupera do anterior.

### 3. Recovery matrix
`recovery-matrix.test.sh` (**8/8**) — 8 cenários → estados permitidos:
`RECOVERED_FROM_PRIMARY`, `RECOVERED_FROM_PREVIOUS`, `REPLAYED_PREPARED_CYCLE`,
`SUSPENDED_CHECKPOINT_CORRUPTION`, `SUSPENDED_WAL_CORRUPTION`, `SUSPENDED_SCHEMA_MISMATCH`
(+ `FRESH_START`/`RESET_NEW_EPOCH` para boot legítimo). O leitor escolhe a base íntegra, replaya o
ciclo PREPARED, e **suspende** quando não há base confiável — nunca zera.

### 4. Rotation overlap
`rotation-overlap.test.sh` (**6/6**) — quando o arquivo roda e o novo começa com uma **cópia da
cauda** do antigo, o leitor compara `logicalObservationHash` (últimos 24) e **pula as linhas
copiadas** (sem dupla contagem: 6→8, não 6→11). Sem sobreposição comprovada →
`SOURCE_IDENTITY_CHANGED_NO_OVERLAP` (suspende avanço, não reprocessa, não zera). `physicalEventId`
para identidade física, `logicalObservationHash` para continuidade entre arquivos.

### 5. Cobertura do watermark comum
`common-watermark.cjs` registra continuamente (append-only) `watermarkCoveragePct`,
`commonCommittedOffset`, `commonEventCount`, `maxProcessLagEvents`, `maxProcessLagBytes`,
`maxReconvergenceTimeMs`, `sourceDivergences`, `stateDivergences`. Comparação econômica **só** no
watermark comum. **Atual:** `OK_COMMON_WATERMARK`, cobertura 100%, 0 divergências.

### 6. Matriz completa do supervisor
`supervisor-matrix.test.sh` (**6/6**, isolada) — para cada alvo (trial/control/observer-max3/4/5 +
supervisor): restart único, checkpoint recuperado, **cursor/posição/saldo preservados**, WAL
consistente, **sem duplicata**, single-instance. Complementa o **drill AO VIVO** (v1.6: `observer-max5`
morto → religou único em ~32s, cursor preservado). Backoff (5s→120s) e downtime (≤30s) são a lógica
do `supervisor-forward`.

### 7. Reinicialização do host
**Não executável com segurança** neste ambiente (máquina principal, sem VM descartável; reiniciar
derrubaria Champion + challengers). Registrado `HOST_REBOOT_TESTED=false`; **não** extrapolamos crash
de processo para reboot de host. `host-reboot-result.json` descreve como testar no futuro.

### 8. Source health real
`source-health.cjs` usa `lastModified` + scan interval + heartbeat do coletor + **saúde por
exchange** (lê a cauda do arquivo, `lastSeen` por exchange) + último ciclo completo. Classes
`NO_NEW_DATA_YET / COLLECTOR_DOWNTIME / EXCHANGE_UNAVAILABLE / OPPORTUNITY_ABSENT / SCANNER_FILTERED`.
**Atual:** global `NO_NEW_DATA_YET`; as 6 exchanges `HEALTHY`. Batch vazio **não** é prova de indisponibilidade.

### 9. Fidelidade econômica pareada
`paired-economic-fidelity.cjs` reconstrói cada operação forward (sourceOpportunityId, sourceEpisodeId,
controlPositionId, entry/close, exchanges, notional, custos entrada/saída, funding, closeReason,
realized/marked/executable PnL) e **pareia a MESMA oportunidade-fonte** entre as 5 políticas,
comparando **evento a evento** — não só agregados.

### 10. Amostra independente
`independent-sample.cjs` conta **sourceOpportunityId ÚNICOS fechados** — **não** políticas × mesmo
evento. Posições abertas = **censuradas**. Metas: ≥30 únicas, ≥15 divergências. **Atual (soak
recém-reiniciado): 0/30, 0/15.**

### 11. Concentração
`concentration.cjs` — antes de liberar: posição ≤25% do ganho, símbolo ≤35%, par de exchanges ≤50%,
nenhuma janela dominante. **Atual:** amostra insuficiente → **não aceitável ainda** (por falta de
evidência, não por aprovação).

### 12. Stress
`stress-paired.cjs` aplica no mesmo conjunto pareado: custos 1,5×/2×, funding −25%/−50%, slippage
adicional, perda de uma exchange. **Atual:** amostra insuficiente → **não aprovado ainda**.

### 13. Forward soak
**Reiniciado do zero** neste release — o leitor (WAL/checkpoint/recovery/rotação) mudou, então, por
regra, a contagem recomeça. Novo epoch `c816ed1a27fbc747`; os 5 processos v1.7 rodando em
`FRESH_START` (schemaVersion `forward.v1_7`, checksum presente). Estado v1.6 arquivado em
`archive-v1_6/`. Continua até 1440/1440.

### 14. Gate
Estendido: `durabilityMatrizAprovada`, `supervisorMatrizAprovada`, `watermarkEstavel`,
`sourceOpportunityUnicasFechadas ≥30`, `divergenciasReais ≥15`, `stressAprovado`,
`concentracaoAceitavel`, além das travas anteriores. **BLOQUEADO.**

### 15–18. Fechamento
- **15.** Este documento. **16.** Tag `snowball-progression-platform-v1.7`.
- **17.** Working tree: só `scripts/progression/`, `auditoria/progression/`, `docs/`.
- **18.** Champion intacto: capital **612,98**, reconcilia `true`, 3 posições. Nenhum caminho
  protegido (Champion / challengers / config / src) tocado.

---

## Suíte de durabilidade (rerun completo no leitor v1.7)

| Suíte | Resultado |
|---|---|
| forward-crash-injection | **7/7** |
| forward-restart | **10/10** |
| forward-fault-injection | **6/6** |
| wal-durability | **10/10** |
| recovery-matrix | **8/8** |
| rotation-overlap | **6/6** |
| supervisor-matrix | **6/6** |

## Recomendação

A camada de **durabilidade** está madura e honestamente rotulada (**PROCESS_CRASH_SAFE**, e só isso).
A **comparabilidade** dos 5 é estável no watermark comum. Falta a única coisa que sempre faltou:
**tempo com fechamentos econômicos forward reais** — deixar o soak acumular ≥30 oportunidades-fonte
únicas fechadas, ≥15 divergências, em 2 janelas / 2 regimes, sobrevivendo a stress e concentração.
Até lá, **gate BLOQUEADO** e **nada muda no Champion**.
