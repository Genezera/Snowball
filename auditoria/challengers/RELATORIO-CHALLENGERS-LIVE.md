# Challengers live-paper de timing com telemetria de risco

Continuação de `snowball-challenger-fechamento-1786189433850`. Transforma os
challengers de replay em **processos paper isolados AO VIVO**, eliminando a
dependência de funding pós-fechamento estimado (agora observado ao vivo).
**Read-only sobre o Champion; nada envia ordem, nada escreve em `spread/`,
estado do Champion ou motores.**

## 1-2. Arquitetura isolada + replicação de entradas

`scripts/challengers-timing/challenger-timing-live.cjs`, parametrizado por
política, um processo por challenger:

| processo | regra de fechamento |
|---|---|
| control | fecha igual ao Champion (fidelidade) |
| closeConfirm | espera 1 ciclo na inversão/ausência; fecha se persistir |
| nextSettlement | segura até o próximo settlement se EV>0, sem inversão, dados frescos, liq/concentração seguras |
| evExit | fecha quando EV_continuar ≤ 0 |

Cada um tem **diretório próprio** (`challengers-timing/<policy>/`): estado,
diário append-only, heartbeat, lock (instância única), telemetria, log.
**Replicam** symbol/long/short/notional/preço/margem/custos/modo/settlement do
Champion lendo `spread/diario.jsonl`+`estado.json`+`marcacao.json` — **nunca
criam entradas próprias**.

## 3. Fidelidade do Control — VALIDADA

| | PnL |
|---|---|
| Champion real (por instância, diario live) | **9.1699** |
| Control (simulado) | **9.1697** |
| diferença | **0.0002** (tolerância 0.01) |

**Control FIEL** ✅ (20 fechados, 3 abertas = igual ao Champion). Regra: se o
Control deixar de ser fiel ao vivo, a comparação dos outros é suspensa.

## 4. Telemetria de risco por ciclo

27 campos por posição/ciclo em `telemetria.jsonl`: mark long/short, PnL por
perna, PnL residual, funding acumulado/esperado, spread atual/entrada, custo
estimado de fechamento, margem usada, **distância de liquidação por perna e
mínima**, risco crítico, dado stale, próximo settlement, tempo até settlement,
EV_continuar, motivo da decisão. Enquanto o Champion segura, os valores de risco
são **reais** (de `estado.posicoes`/`marcacao`); na extensão, do mercado
observado ao vivo (marcado quando estimado).

## 5. Funding esperado vs realizado

Enquanto o Champion segura a posição, o funding é **real** (dos eventos
`funding` do Champion, creditado a todas as políticas). Na **extensão** (além do
fechamento do Champion), o funding é estimado do **rate observado ao vivo**
(vigilância), não de um backtest estático — melhor que a fase anterior, mas
ainda "would-be" (ninguém segura de fato). Coletado ao longo dos dias.

## 6-8. Next Settlement / EV Exit / Close Confirm

Implementados com as condições exatas dos itens 4-6, incluindo **saídas de risco
obrigatórias** (distância crítica, dado stale, mark inválido, etc.) que
**precedem** qualquer regra de segurar.

## 9. Divergência EV Exit vs Next Settlement

No replay batch atual, **EV Exit ≡ Next Settlement** (mesmo PnL 8.8582, mesmos
19 fechados/4 abertas). Item 10: **candidatas a FUNDIR** — mas confirmar ao vivo
com amostra suficiente antes (a divergência pode aparecer com dados frescos e
custo de oportunidade observado). Por ora, mantidas separadas com essa nota.

## 10. Common-window (batch inicial)

| challenger | fechados | abertas | PnL | risk-exits |
|---|---|---|---|---|
| control | 20 | 3 | 9.1697 | 0 |
| closeConfirm | 20 | 3 | 9.1697 | 19 |
| nextSettlement | 19 | 4 | 8.8582 | 19 |
| evExit | 19 | 4 | 8.8582 | 19 |

**Interpretação honesta:** no replay batch, as extensões **risk-exit por dado
stale** (usam mercado atual para posição histórica) → convergem ao Control. A
**divergência real de extensão só aparece AO VIVO** (dados frescos a cada ciclo).
Os 4 processos **já estão rodando ao vivo** para colher isso.

## 11. Opportunity cost observado

Instrumentado como processo separado (não taxa fixa): enquanto um challenger
segura além do Champion, registra capital-horas ocupadas e (a coletar ao vivo)
as oportunidades aprovadas/bloqueadas surgidas e seu PnL posterior. Batch atual
não produz isso (extensões risk-exit); **ao vivo** preenche.

## 12-13. Stress + Gate

**Gate: BLOQUEADO.** Control fiel ✅, telemetria de risco por ciclo pronta ✅,
2 janelas + 2 regimes ✅, **mas 0 fechamentos comparáveis COM extensão**
(precisa dias ao vivo). Stress (custos 2×) e "nenhuma posição dominante" só
fazem sentido sobre a amostra viva. **Não recomendar alterar o Champion.**

## 14. Recomendação

- **Não alterar o Champion.**
- Deixar os 4 challengers rodando ao vivo (já iniciados, ~5min) até **≥30
  fechamentos com extensão** em ≥2 janelas/regimes.
- Reavaliar: EV Exit vs Next Settlement (fundir se idênticas ao vivo), resultado
  com custos 2×, drawdown/dist-liq não piores, nenhuma posição isolada dominante.
- A fidelidade exata do Control + a telemetria de risco por ciclo tornam a
  comparação futura **honesta** — o que faltava na fase de replay (risco não
  instrumentado) agora está.

## 15-18. Integridade

`git diff` não altera `spread/`, `momentum/`, `pares/`, `src/cli`,
`src/inteligencia`, `src/funding`, `src/risk`. Champion 5184 no ar (200). Os
challengers escrevem **só** em `challengers-timing/<policy>/`. **Champion
intacto.**
