# Snowball — Progression v1.5: Forward Epoch sincronizado e cursor exato

Continuação de `snowball-progression-platform-v1.4`. **Read-only / shadow / paper.**
Não altera Champion, challengers existentes, estratégias, capital, risco,
alavancagem, execução ou limites. **Nenhum modelo/estratégia novo.** Objetivo: tornar
Trial/Control/observers metodologicamente **comparáveis** e **resistentes a perda de
eventos**. Reprodutível por `build-all.cjs` (26 builders).

## 1. Forward Epoch comum (`forward-epoch.json`)

`forwardEpochId = 465a50b7aa1e382e` — congela snapshotId, configEpochId, arquivo,
**byteOffset 14.658.894**, lineNumber 125.588, eventHash, timestamp e a primeira
observação esperada. **Os 5 processos partem do MESMO offset** (verificado ao vivo).
Estado anterior de qualquer processo é preservado como `warmup-<epoch>.json`
(**WARMUP_NOT_COMPARABLE**) — **nada é apagado**.

## 2. Cursor por byte offset

Substituído o cursor temporal por: `sourceFileId · fileIdentity (dev:ino/birthtime)
· byteOffset · lineNumber · lastCompleteLineHash · lastTimestamp · lastOpportunityKey
· partial`. **Nunca avança além de uma linha parcial.**

## 3. Buffer de linha parcial

Lê até o último `\n` completo, processa só linhas completas, guarda o resto em
`partial`, concatena no próximo ciclo e processa quando o JSON fecha. **Testado: uma
linha parcial completada depois é processada exatamente 1×.**

## 4. Rotação e truncamento

Detecta `size < byteOffset`, identidade de arquivo alterada, rotação, truncamento,
substituição atômica → **SOURCE_TRUNCATED / SOURCE_ROTATED / SOURCE_IDENTITY_CHANGED**,
**suspende** (não reinicia silenciosamente do zero).

## 5. observationEventId

Hash determinístico de `timestamp | opportunityKey | apr | spread | volume | cycle |
hash da linha`. **Dedup por observationEventId** (não só por timestamp).

## 6. Ranking determinístico

Ordena obs por `ts, offset, key`; ranqueia por `score desc, EV desc, key asc`. **Os 5
produzem o mesmo ranking antes do corte por maxPositions/exchanges.**

## 7. Common-window validator (`common-window-validator.json`)

A cada ciclo valida forwardEpochId, startOffset, source identity, contagem de eventos
e **hash acumulado**. Estado atual: **comparisonStatus = OK** (todos no mesmo
epoch/fonte, hashes concordam na mesma contagem, spread 0). Se dois processos na MESMA
contagem tiverem hashes diferentes → **SUSPENDED_SOURCE_DIVERGENCE** (coleta segue,
sem comparação econômica).

## 8. Episódios e disponibilidade da fonte

Distingue `opportunityAbsent` (feed ativo, chave sumiu) de `feedUnavailable` (ciclo sem
nenhum evento) → **FEED_UNAVAILABLE_NO_EVENTS**: **não encerra episódio durante
indisponibilidade global da fonte**. Também: opportunityAbsent/scannerFiltered/
exchangeUnavailable/collectorDowntime registrados.

## 9. Sensibilidade do gap (`gap-sensitivity.json`)

| gap | episódios | dur. mediana (completos) | modelPositive | reaparições/chave |
|---|---|---|---|---|
| 15min | 28.045 | **0,01h** | 7.111 | 9,62 |
| 30min | 18.447 | **0,17h** | 5.053 | 6,33 |
| 45min | 15.075 | **0,34h** | 4.270 | 5,17 |
| 60min | 13.396 | **0,43h** | 3.903 | 4,60 |

A duração mediana do episódio de scanner fica **< 1h em todos os gaps** → a conclusão
(episódio de scanner é curto, ≠ tempo de hold, não cobre o payback ~160h) é
**ROBUSTA**. **30min não é arbitrário.**

## 10. Scanner versus economia

Registrados **separadamente**: `scannerEpisodeFirstSeen/LastSeen`,
`economicPositiveFirstSeen/LastSeen`, `positionOpenedAt/ClosedAt`. **scannerEpisodeLastSeen
NÃO é usado como fim econômico** da oportunidade.

## 11. Fidelidade real do Control (`control-fidelity-vectorial.json`)

Separado em duas seções:
- **Champion accounting consistency** — 4 identidades INTERNAS (capital=inicial+funding−custos; Σsaldos=capital; equityMark=capital+pnlMark; equityLiquidacao=capital+pnlExec−custoFecho) → **todas OK**.
- **Control forward fidelity** — 9 definições (funding/custos/capital/realized/marked/executable PnL/saldos/posições/positionIds), cada uma **≤US$0,01 na sua base, sem resíduo**.

## 12. Supervisor e fault injection

**Supervisor forward** (v1.4) gerencia os 5 com heartbeat/lock/single-instance/
restart/backoff/cursor. **Fault injection 6/6** (`forward-fault-injection.test.sh`):
2 linhas mesmo ts, obs fora de ordem, **truncamento**, **rotação** (suspende sem
reset), **hash final determinístico**. + `forward-restart.test.sh` **9/9** (linha
parcial/dup/stale-lock/restart, cursor/saldo/estado preservados).

## 13. Forward soak separado (`forward-soak-resumo.json`)

Monitor **forwardSoak** dedicado (**não** reutiliza a contagem do monitor dos
challengers). Exige **1440/1440 min contínuos**. Registra uptime/restarts/downtime/
eventos/perdas/duplicações/sourceDivergences/fidelityDivergences. Rodando; integridade
**SEM PERDA**; **não completo** ainda.

## 14. Gate — BLOQUEADO

`epochValido=true · sourceHashesIdenticos=true · forwardSoakCompleto=false ·
0/30 fechadas · 0/2 janelas · 0/2 regimes · Control fiel=true`. **BLOQUEADO** até
soak completo + ≥30 fechadas forward + 2 janelas/2 regimes + custos 2× + concentração
+ zero falha crítica.

## 15. Recomendação

1. **A infraestrutura forward agora é comparável e à prova de perda** — mesmo epoch/byteOffset, dedup por hash de conteúdo, ranking determinístico, validator OK. Só agora os números dos 5 são metodologicamente comparáveis.
2. **Contabilidade dupla-verificada** — Champion consistente internamente (4 identidades) + Control fiel em 9 definições a US$0,01.
3. **Robustez do gap confirmada** — a conclusão scanner≠hold vale de 15 a 60min.
4. **Deixar o forwardSoak completar 1440/1440** e acumular ≥30 fechadas forward em 2 janelas/2 regimes — é o que libera o gate.
5. **Nada muda no Champion** até o gate liberar com dado forward íntegro.

## Integridade

- **Champion intacto** — só leitura; nenhuma escrita em motor/estado/execução; nenhuma ordem; nenhum capital movido.
- **Challengers existentes intactos**; monitor 24h deles segue separado.
- Novo código em `scripts/progression/`; runtime forward em `auditoria/progression/forward/` (gitignored). Reversível.

Distinções: observed · replayed · simulated · shadow · **live-paper forward (epoch-sincronizado)** · hypothetical · real (nada).
