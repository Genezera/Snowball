# Snowball — Progression v1.2: Opportunity Frontier e Level-1 Trial

Continuação de `snowball-progression-platform-v1.1`. **Read-only / shadow /
paper.** Não altera Champion, challengers, motores, risco, alavancagem, execução,
capital real ou limites. Reprodutível por `node scripts/progression/build-all.cjs`.

## 1. Observer pré-saldo — economia das rejeições por saldo

`opportunity-frontier.json` → `item1_observerPreSaldo`. Observer **aditivo,
read-only** que reprocessa as observações BRUTAS do mercado
(`vigilancia/arquivo-observacoes.jsonl`: `{ts, k=symbol|long|short, spread, apr, vol}`)
e **recomputa a economia** de toda candidata — inclusive as que o motor rejeitou
por saldo antes de avaliar (features zeradas na v1). Nunca aprova/abre nada.

Modelo documentado (src/config.ts + engine.ts): custo round-trip delta-neutro
`= notional·(4·taker + 4·slippage) = 0,28%` + basis; funding/hora `= notional·apr/8760`;
payback `= custo / (apr/8760)`; viável se `payback·1,5 ≤ 168h`.

- **2.896 oportunidades distintas** observadas (6 exchanges).
- **Até 1.064 seriam EV-positivas** — mas isso é **limite superior** (assume hold até 168h). A **vida real** de cada oportunidade **não está no bruto** e é o que derruba o número: usando a vida observada, o motor aprovou só **~13** (v1.1).
- **Resposta ao item 1:** de qualquer forma, **0 oportunidades EV-positivas foram bloqueadas por capital** (margem/posição = US$40). O gargalo é **vida/oferta de EV+**, não capital.

## 2. Opportunity Frontier (`item2_opportunityFrontier`)

| Capital | Concorrentes | Bloq. por capital | PnL limitado por concorrência | Marginal/US$ |
|---|---|---|---|---|
| US$200 | 3 | **0** | 0,60 | — |
| US$300–1000 | 3 | **0** | 0,60 | **0** |

- **Satura ~US$171** (3 posições × US$40 margem ÷ 0,7). Acima disso: capital ocioso, retorno marginal **0**.
- **Saturação operacional observada:** Champion nunca passou de 3 posições / US$232,83 de margem.
- **Saturação econômica comprovada:** só ~13 EV+ realistas + limite de 3 posições ⇒ capital extra não financia nada lucrativo.
- **Desconhecida por ausência de features:** a **vida esperada** por oportunidade não está no bruto ⇒ viabilidade é ESTIMADA, não a decisão exata do motor.

## 3–4. Trial Bitget+Bybit vs Controle de 6 exchanges

`trial-control-window.json`. Sandboxes paper com contabilidade própria, **zero
ordem, zero saldo movido**, rodando em paralelo ao Champion (observador).

| | Trial **Bitget+Bybit** (US$200) | Controle **6 exchanges** (US$600) |
|---|---|---|
| PnL líquido | **+6,04** | **+11,18** |
| Retorno % | **3,02%** | 1,86% |
| Reconcilia | ✅ (inicial+funding−custos) | ✅ com o Champion (dif **0,33** < tol 1,0) |
| Posições | 6 | 21 |

O controle de 6 exchanges **reconcilia com o Champion** dentro da tolerância
documentada (a diferença é o funding acumulado das posições abertas ainda não
líquido do custo de fechamento).

## 5. Common-window (`item5_commonWindow`)

Mesma janela, mesmos custos. **6 exchanges rendem +5,13 a mais** que o trial de 2
(+11,18 vs +6,04) — a vantagem vem de **largura de exchanges** (mais pares = mais
oferta), não de mais capital. Porém o trial tem **retorno % maior** (3,02% vs
1,86%) porque usa menos capital para o mesmo tipo de operação. Métricas completas
(drawdown, fee-to-gross, capital-horas, ocioso, concentração, ordens mínimas,
funding, custos, estabilidade) no JSON.

## 6. Janelas e regimes (`item6_gateJanelasRegimes`) — BLOQUEADO

**NÃO escolher Bitget+Bybit ainda.** Faltam: **2 janelas cronológicas** (tem 1),
**2 regimes** (tem 1), amostra do trial **6/30**. Control fiel ao Champion ✅.
Custos 2×: trial e controle a medir por janela. Sem operação dominante ✅. Sem
falha de exchange ✅.

## 7. Fundo de desbloqueio (`unlock-fund.json` · item 7)

Política C, **contabilidade SHADOW** — o fundo **não financia nada real**.

- Lucro total **10,55** · parcela reservada (fundo) **6,14** · operacional **4,42**.
- **Saldo do fundo: US$6,14** = **3,07%** do capital mínimo do próximo motor (US$200).
- Motor candidato ao desbloqueio: **settlement-capture**.
- Acumula a custo ZERO de PnL (motor saturado ~US$171).

## 8. Ranking dos candidatos a 2º motor (item 8)

| # | Motor | Estado | PnL | Independência | Gate |
|---|---|---|---|---|---|
| 1 | settlement-capture | SHADOW | **+0,82** | baixa (mesmas exchanges/funding) | amostra pequena (4<30) |
| 2 | close-timing-challengers | DATA_COLLECTION | 0 | ≈1 com Champion | gate BLOQUEADO |
| 3 | funding-cross-sectional | DATA_COLLECTION | 0 | mesmas taxas | 0 aprovados |
| 4 | pares | DATA_COLLECTION | 0 | **alta (potencial)** | sem sinal |
| 5 | momentum | DATA_COLLECTION | **−0,99** | **alta (potencial)** | amostra mínima |

## 9. Regra de desbloqueio (item 9) — BLOQUEADO

Exige **ELIGIBLE + amostra + 2 janelas + 2 regimes + custos 2× + PnL líquido
positivo + drawdown aceitável + correlação conhecida + rollback + aprovação
humana**. Nenhum candidato é ELIGIBLE; o topo (settlement-capture) tem amostra
pequena e 0 janelas/regimes confirmados. **Nada desbloqueia.**

## 10. Validação operacional (item 10) — NÃO encerrada

O sistema caiu ~2h (máquina dormiu) e foi **religado**; o monitor recomeçou.
**Estado atual: 24/1440 minutos** — supervisor + 4 challengers vivos, Control
fidelity **OK**, **SEM PERDA/DUPLICAÇÃO**. **Não encerrado antecipadamente** — segue
até 1.440/1.440. Reteste stale-lock isolado (Windows PID) **6/6** (v1.1) permanece
válido; entrega final de uptime/restarts/cursor/eventos/perdas/duplicações/
fidelidade/stale-lock virá ao completar as 24h.

## 11. Recomendação

1. **Capital NÃO é o gargalo** — 0 oportunidades EV+ bloqueadas por capital; satura ~US$171. Não injetar mais capital no motor de funding.
2. **Manter as 6 exchanges** — a largura captura **+5,13 (~46%)** a mais que o melhor par de 2. Só migrar para 2 exchanges após **2 janelas + 2 regimes** provarem paridade (gate BLOQUEADO hoje).
3. **Política C** — desviar o excedente ocioso para o fundo de desbloqueio (US$6,14, 3,07%) a custo zero, construindo diversificação.
4. **2º motor** — amadurecer **settlement-capture** (≥30 amostras) rumo a ELIGIBLE; é o único candidato com PnL positivo. Diagnosticar momentum (−0,99) antes de shadow.
5. **Próximo desbloqueio real** exige a regra completa (item 9) — hoje nada qualifica.

## Integridade

- **Champion intacto** — só leitura de `spread/` + observações; nenhuma escrita em motor/estado/execução; nenhuma ordem; nenhum capital movido.
- **Validação dos challengers não interrompida** por esta fase (segue no monitor).
- Novo código em `scripts/progression/`; artefatos em `auditoria/progression/`. Reversível.

Distinções: observed (spread/apr/vol, posições) · replayed (sandboxes reconciliados)
· simulated (EV recomputado, frontier) · shadow (trial/control/fundo) · hypothetical
(cenários) · live-paper (challengers) · real (nada — nenhuma alteração real).
