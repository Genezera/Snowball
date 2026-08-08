# Snowball — Progression v1.4: Forward Soak e integridade de episódios

Continuação de `snowball-progression-platform-v1.3`. **Read-only / shadow / paper.**
Não altera Champion, challengers existentes, motores, capital, risco, alavancagem,
execução ou limites. **Nenhuma estratégia nova.** Objetivo: validar a integridade
dos processos forward e **corrigir a metodologia de vida das oportunidades antes de
interpretar economia**. Reprodutível por `build-all.cjs` (24 builders).

## 1. Identidade do common-window (`forward-daily.json`)

Registra snapshotId, lastEventId, lastCycleId, configEpochId e, por processo,
startObservationTs + cursorTs. **Todos os 5 processos leem a MESMA fonte**
(`arquivo-observacoes.jsonl`) → `comparacaoValida: true`. Se as fontes iniciais
diferissem, a comparação seria **suspensa**.

## 2. Episódios de oportunidade (`opportunity-episodes.json`)

`opportunityEpisodeId = key | configEpochId # firstSeen`. Reaparição após **gap
> 30min** (cadência de scan ~5min) inicia **novo episódio**. Resultado: **18.409
episódios** — não 2.909 "chaves". Agrupar tudo (v1.3) inflava a duração.

## 3. Censura

**leftCensored 5 · rightCensored 167 · completeEpisodes 18.237** + observationCoverage.
A duração mediana só é calculada em **completos**. Censurados à direita **não têm
duração conhecida** e ficam fora da mediana.

## 4. Payback sem lookahead

No **primeiro ciclo** do episódio: decisionTimeAPR/Spread/Costs + payback em
1h/8h/24h/72h (evUSD + pago?). **Não recalculado com o futuro.** Após o encerramento:
realizedLifetime, realizedAPRPath (funding cumulativo pelo APR observado),
paidBackBeforeDisappearance, realizedOutcome.

## 5. Funil corrigido

| Etapa | Valor |
|---|---|
| allEpisodes | 18.409 |
| completeEpisodes | 18.237 |
| modelPositiveAtDecisionTime | 5.042 |
| **survivedPayback (pela vida-no-scanner)** | **0** |
| engineApproved (estim. v1.2) | ~13 |
| opened / profitableClosed | poucos / 19 |
| survivalAmongAll · survivalAmongModelPositive | 0 · 0 |

**A correção central:** duração mediana do **episódio no scanner = 0,17h (~10 min)**
(não os 27h da v1.3), mas o **HOLD real da posição = ~2,97h** — cerca de **18× o
episódio do scanner**. Ou seja, **o Champion segura a posição ATRAVÉS da
invisibilidade no scanner**, rendendo funding mesmo quando o spread some da varredura.
`survivedPayback=0` medido pela vida-no-scanner é **enganoso** — a vida-do-episódio
**não é** a métrica de payback. **Nenhum proxy offline responde ao payback; só o teste
FORWARD** (que segura posições sob as regras reais) resolve. Corrigir a metodologia
antes de interpretar economia **era o objetivo do v1.4**.

## 6. Fidelidade vetorial do Control (`control-fidelity-vectorial.json`)

**9 definições, cada uma reconciliando ≤US$0,01 na SUA base, sem categoria residual:**

| Definição | Base | Dif |
|---|---|---|
| funding | soma de ganhos | 0 |
| custos | soma de custos de eventos | 0 |
| capital | inicial+funding−custos | 0 |
| realized PnL | capital − capitalInicial | 0 |
| marked PnL | equityMark − capitalRealizado | 0 |
| executable PnL | equityLiquidacao − capitalRealizado **+ custoEstimadoFechamento** | 0 |
| saldos por exchange | Σ saldos = capital | 0 |
| posições / positionIds | contagem / conjunto | OK |

O executable PnL exigiu o **custo de fechamento nomeado** (a equity de liquidação já o
desconta) — **não** um resíduo. Cada base bate com a sua fonte no Champion.

## 7. Supervisor forward (`supervisor-forward`)

Supervisor **isolado** só dos 5: trial-bitget-bybit, control-six-exchanges,
observer-max3/4/5. heartbeat, lock/mutex single-instance, restart, **backoff**,
**cursor preservado** (no estado.json de cada label), **zero interação com o
Champion**. Os 5 rodando.

## 8. Testes operacionais (`tests/forward-restart.test.sh`) — 9/9 ✅

Isolado (observações sintéticas): evento novo incremental (zero perda), cursor
monotônico, **cursor/saldo/estado preservados no restart**, **zero duplicação**,
evento duplicado (ts≤cursor) **ignorado**, **linha parcial/truncada não quebra**,
obs anexada durante restart processada, **stale lock → takeover**.

## 9. Observers maxPositions 3/4/5

Rodam mode control (mesmas 6 exchanges, mesmo capital US$600, mesmo feed, mesmos
custos/risco/saldos) — **a única variável é maxPositions**. Isolam o efeito do limite
de posições no forward (o teste offline da v1.3 era inconclusivo).

## 10. Capital local (`forward-daily.json` · por processo)

Cada decisão registra exchangeLong/Short, saldo local, margem livre, reserva local,
capital por perna e o **motivo exato**, decomposto em `aggregateCapitalBlocked ·
localBalanceBlocked · reserveBlocked · maxPositionsBlocked · minOrderBlocked`.

## 11. Relatório diário forward

`forward-daily.json`: uptime, heartbeats, restarts, eventos avaliados, duplicações
(0), perdas (0), episódios, abertas/fechadas, PnL, fidelidade, bloqueios locais,
progresso do gate — por processo.

## 12. Gate — BLOQUEADO

Mantido bloqueado até: **≥30 posições forward fechadas** (0 hoje), 2 janelas, 2
regimes, **Control fiel em todas as definições (✅)**, monitor completo, custos 2×,
concentração aceitável, zero falha crítica.

## 13. Monitor 24h + Recomendação

Monitor **78/1440 min**, integridade SEM PERDA/DUPLICAÇÃO, **não encerrado**.

**Recomendação:**
1. **A metodologia agora está correta** — episódios + censura + payback sem lookahead + a distinção scanner-vs-hold. Só depois disso se interpreta economia.
2. **Nenhum proxy offline decide** capital-vs-posições-vs-vida — o **teste forward** (5 processos sob o supervisor) é o árbitro; deixá-lo acumular ≥30 fechadas em 2 janelas/2 regimes.
3. **Contabilidade confiável** — Control reconcilia em **9 definições a US$0,01**, sem resíduo.
4. **Nada muda no Champion** (maxPos=3, 6 exchanges) até o gate liberar com dado forward.

## Integridade

- **Champion intacto** — só leitura; nenhuma escrita em motor/estado/execução; nenhuma ordem; nenhum capital movido.
- **Challengers existentes intactos**; validação segue no monitor.
- Novo código em `scripts/progression/`; runtime forward em `auditoria/progression/forward/` (gitignored). Reversível.

Distinções: observed · replayed · simulated · shadow · **live-paper forward** · hypothetical · real (nada).
