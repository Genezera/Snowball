# Challengers determinísticos de timing de fechamento (snapshot 1786189433850)

Continuação de `snowball-fase-shadow-2-1786189433850`. **Paper isolado,
read-only.** Os challengers replicam as ENTRADAS e o SIZING reais do Champion
(do diario) e divergem **só na regra de fechamento**. Nada toca Champion, motor,
risco, capital, alavancagem, limites ou execução. Scripts em `scripts/auditoria/`.

## 1. Auditoria do replay + payback (itens 1,2)

Ver `auditoria/challengers/replay-audit.md`. **Achado que muda a leitura:** a
mediana de payback de ~5 min é **dominada por aberturas perto do settlement**
(85% recebem o 1º funding em <10 min; o motor abre ~5–12 min antes do settlement,
por design). Logo "segurar mais" = esperar o **próximo** settlement (+1h/+8h) —
compromisso maior. Por isso **não** se classifica fechamento como precoce só por
funding posterior positivo; usa-se EV líquido.

## 2. Fidelidade (item 7) — `challenger-metrics.json`

O Challenger **Control** replica todas as decisões reais e fecha no mesmo
instante:

| | PnL |
|---|---|
| real (diario) | **5.4379** |
| Control (simulado) | **5.4379** |
| diferença absoluta | **0.000043** (tolerância 0.01) |

**Control FIEL** ✅ — a contabilidade da simulação reproduz o real. 12 posições
fechadas comparáveis.

## 3. Challengers (itens 3-6)

- **Control** — fecha igual ao Champion.
- **Close Confirm** — quando o Champion fecha por inversão/ausência, espera 1
  ciclo; fecha se a inversão persistir, mantém se recuperar. Saídas de risco
  seguem imediatas.
- **Next Settlement** — segura até o próximo settlement só se EV restante > 0,
  funding esperado cobre o custo, sem inversão confirmada e dados frescos.
- **EV Exit** — recalcula EV_continuar = funding esperado − custo − oportunidade;
  fecha quando ≤ 0.

## 4. Common-window (item 8) — custos normais

| challenger | PnL líquido | funding adicional | settlements extra | custo oportunidade |
|---|---|---|---|---|
| Control | 5.4379 | 0 | 0 | 0 |
| Close Confirm | 5.7357 | +0.549 | 3 | 0.252 |
| **Next Settlement** | **10.0884** | +5.976 | 6 | 1.326 |
| **EV Exit** | **10.0884** | +5.976 | 6 | 1.326 |

## 5. Stress (item 9)

Custos 1.5×/2×, slippage 2×, funding −25%/−50%: os três challengers **superam o
Control em todos os cenários** de custo/funding.

## 6. ⚠️ Por que NÃO recomendo alterar o Champion (itens 10, 11.10)

Apesar de Next Settlement/EV Exit **quase dobrarem** o PnL na simulação, há três
motivos decisivos para **não** mexer no Champion:

1. **Risco de segurar NÃO está modelado.** O ganho de "segurar mais" é creditado
   **sem penalizar a distância de liquidação / inversão por ciclo** — que **não
   está instrumentada** no historico. A razão provável do Champion fechar cedo é
   justamente **gestão de risco** (evitar segurar através de uma inversão que
   perderia mais do que o funding extra). Sem essa dimensão, os challengers
   "vencem" por um viés otimista da simulação, não por edge comprovado.
2. **Funding pós-fechamento é ESTIMADO** do apr do historico, não realizado. É
   uma hipótese, não PnL.
3. **Gate NÃO atendido (item 10):** apenas **12/30** fechamentos comparáveis;
   drawdown e distância de liquidação por ciclo **não instrumentados**.

**Veredito do gate: BLOQUEADO.**

## 7. Recomendação (item 11.10)

- **Não alterar o Champion.**
- **Instrumentar** (aditivo, read-only) a distância de liquidação e o mark por
  perna **por ciclo** — sem isso, nenhuma comparação de "segurar mais" é honesta,
  porque o risco de segurar é o lado que falta.
- **Rodar os challengers como paper-isolado AO VIVO** (motor paper próprio,
  capital 100% virtual, replicando as entradas do Champion) para colher outcomes
  **realizados** (não estimados) — elimina a incerteza do apr do historico.
- **Acumular ≥30 fechamentos comparáveis** em ≥2 janelas/regimes antes de
  qualquer comparação formal.
- O sinal (segurar até o próximo settlement pode adicionar funding) é **forte o
  bastante para justificar o challenger paper ao vivo**, mas **não** para tocar o
  Champion agora.

## 8. Integridade (item 13)

`git diff` não altera `src/cli/*`, `src/inteligencia`, `src/funding`, `src/risk`
nem estado dos motores. **Champion intacto.** Tudo simulação/observação em paper.
