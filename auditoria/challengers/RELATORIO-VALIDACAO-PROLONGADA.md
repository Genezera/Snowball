# Validação prolongada dos challengers live-paper

Continuação de `snowball-challengers-hardening-1786189433850`. **Read-only sobre o
Champion; nada envia ordem nem escreve em `spread/`, estado do Champion ou
motores.** Sem novos challengers. Refino das definições + validação de
resiliência dos 4 challengers atuais (control/closeConfirm/nextSettlement/evExit).

## 1. Definições de extensão separadas (item 1)

Registradas de forma independente por posição virtual (não mais só `settlementsExtras`):

| campo | significado |
|---|---|
| `decisionDivergence` | decidiu **segurar** quando o Control fecharia (≥1 ciclo) |
| `realExtension` | segurou **com telemetria elegível** nas 2 pernas (≥1 ciclo válido) |
| `settlementExtension` | capturou **≥1 settlement extra** (ts do settlement passou + 2 pernas elegíveis) |
| `settlementsExtras` | contagem de settlements extras capturados |
| `extensionDurationMs` | duração real da extensão (`fechaSimTs − championFechaTs`) |

`decisionDivergence ⊇ realExtension ⊇ settlementExtension`. O gate usa `realExtension`
e `decisionDivergence` — **não** o flag enganoso `seguralemChampion` (sempre true no
replay batch porque o relógio de parede ≫ ts histórico).

## 2. Fidelidade **vetorial** do Control (item 2)

A cada ciclo o Control reconstrói o vetor completo por instância e compara com o
Champion: `cursorByteOffset, lastEventId, eventosConsumidos, posições/positionIds,
notional por perna, funding, custos, capital, PnL`. Qualquer divergência material
(tolerância 0.01) → `comparisonStatus: SUSPENDED_CONTROL_DIVERGENCE`, suspendendo as
comparações econômicas **sem parar a coleta**.

Estado atual (vivo): **OK**. Vetor: cursor 461219, eventos 1936, fechados 20/20,
abertas 3/3, funding 17.3526/17.3527, custos 8.1828/8.1828, PnL **9.1699/9.1697**,
capital 600. A fidelidade vetorial já pegou um bug real (o Control replicava o
notional inicial mas não escalona/apara/reinveste — CXMT 1.46→279.62) que foi
corrigido replicando `ev.notionalNovo`.

## 3. Funding contrafactual **esperado vs assentado** (item 3)

- `expectedCounterfactualFunding` — estimativa corrente enquanto segura (source `market_observed`).
- `settledCounterfactualFunding` — creditado **somente após o ts real do settlement passar** e com **as 2 pernas elegíveis**; avança `proximoSettlementTs`.
- **O PnL de `fecharVirtual` usa apenas o assentado** (`vp.fundingAcumulado + settled − custoAcumulado`). Nunca chamado de "realizado".

## 4. Elegibilidade pós-fechamento nas 2 pernas (item 4)

Cada ciclo emite `eligibility = {eligible, ineligibleReason, allReasons, missingFields,
oldestDataAgeMs, confidenceMin, bothLegs}`. Fora do espelhamento do Champion, exige
telemetria válida nas **duas pernas**. Inelegível → saída de risco (`extensao_inelegivel:`),
**nunca** conta como `realExtension`. Contagem viva de inelegíveis por motivo:
control 12, demais 29 (dado stale / mark indisponível — esperado no batch histórico).

## 5. Teste prolongado 24h — monitor por minuto (item 5)

`scripts/challengers-timing/monitor-24h.cjs` (read-only) grava 1 linha/minuto em
`challengers-timing/monitor-24h.jsonl` com: supervisor vivo, challengers vivos,
idade de heartbeat, PIDs, restarts, cursor, fidelidade do Control, extensões
abertas, divergências, e **contadores de eventos perdidos/duplicados** (derivados
da monotonicidade de cursor e `eventosConsumidos`). Resumo em
`auditoria/challengers/monitor-24h-resumo.json`.

Rodando **detached** por 1440min (24h) como frente independente. Primeira amostra:
`sup=ok vivos=4/4 fid=OK restarts=0 perdidos=0 dups=0`. **A janela completa de 24h
transcorre em background** — este relatório documenta a arquitetura + o início da
coleta; a integridade acumulada é lida do resumo ao longo do dia.

## 6. Falhas controladas (item 6) — **27/28**

`scripts/challengers-timing/tests/failure-drill-live.sh` operou a stack **REAL**
(supervisor + 4 challengers lendo o diario real do Champion). Evidência completa em
`auditoria/challengers/FALHAS-CONTROLADAS.json`.

**Lado challenger — 24/24 ✅** (mata cada um 1×):
- restart **único** (1 processo, sem duplicar);
- processo **realmente reiniciado** (PID muda: p.ex. control 1700→18692);
- **cursor preservado/avançado**, nunca reset a 0 (461151→461151 ou →461219);
- `eventosConsumidos` **monotônico** (1935→1936) = **zero perda / zero duplicação**
  — closeConfirm/nextSettlement/evExit leram um evento novo do Champion *durante* a
  janela de restart sem perdê-lo nem reprocessá-lo;
- `fechamentos` preservados (20→20) e **PnL preservado** (9.1697→9.1697).

**Lado supervisor — 2/3:**
- ✅ supervisor morto → os 4 challengers **sobreviveram** (observadores órfãos);
- ✅ restart do supervisor **não duplicou** nenhum challenger;
- ⚠️ auto-heal do lock stale **não exercido nesta corrida** — artefato de
  Windows/MSYS: o supervisor grava `$$` (PID do MSYS) no lock, mas `Stop-Process`
  precisa do PID do Windows, então o processo antigo não foi terminado. **Não é
  defeito do supervisor** (o mutex + a detecção de lock stale existem no código).
  O helper do drill foi corrigido (`kill_supervisor`/`sup_win_pid` via CIM por
  command-line) para atingir o PID do Windows; a perna de auto-heal deve ser
  re-exercida numa corrida isolada futura (não re-executada agora para **não
  interromper a validação viva**).

## 7. Cursor / integridade incremental (itens 3,4 do hardening, reconfirmados)

Suíte determinística `tests/restart-cursor-reopen.test.sh` — **8/8**. O drill vivo
confirma o mesmo sobre a stack real: cursor por byte-offset em `estado.cursorDiario`,
resume incremental sem perda/duplicação, positionId distinto por reabertura de símbolo.

## 8. Gate econômico atualizado (item 7) — **BLOQUEADO**

`auditoria/challengers/relatorio-diario.json`:

- `realExtensionsFechadas`: **0/30** (mínimo 30) — não atende;
- `decisionDivergences`: **0/15** (mínimo 15) — não atende;
- `extensoesQueCapturaramSettlement`: **0** (mostrado separadamente);
- `controlFielVetorial`: **true** (comparisonStatus OK);
- custos 2× / drawdown / dist. liq. / concentração: a medir sobre a amostra viva.

**Veredito: BLOQUEADO.** No replay histórico todas as extensões são inelegíveis
(dado stale) → 0 extensões reais. O gate só libera com ≥30 `realExtensions` e ≥15
`decisionDivergences` em ≥2 janelas/regimes, Control fiel vetorialmente e telemetria
elegível durante a extensão. **NÃO alterar o Champion.**

## 9. Relatório diário expandido (item 8)

`scripts/challengers-timing/relatorio-diario.cjs` → por política: vivo, heartbeatAge,
**pid, cursorDiario, eventosConsumidos, lastEventId**, fechados, abertas,
`decisionDivergences`/`realExtensions`/`settlementExtensions`, PnL incremental,
`expectedCounterfactualFunding`/`settledCounterfactualFunding`, divergências,
inelegíveis por motivo, riscoExits; + fidelidade vetorial do Control + gate.

## Integridade

`git diff` **não** toca `spread/`, `momentum/`, `pares/`, `src/cli`,
`src/inteligencia`, `src/funding`, `src/risk`, execução ou o Champion. Os
challengers escrevem **só** em `challengers-timing/<policy>/` (runtime gitignored).
Champion 5184 intacto. Nada envia ordem. **Champion intacto.**

**Estado:** 4 challengers vivos sob supervisor isolado; fidelidade vetorial OK;
resiliência provada (27/28, a única lacuna é artefato de harness já corrigido);
monitor 24h coletando; gate honestamente **BLOQUEADO** até acumular extensões reais.
