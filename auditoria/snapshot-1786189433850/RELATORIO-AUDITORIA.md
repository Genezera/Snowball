# Auditoria Snowball — lucro, oportunidades e ML (snapshot congelado)

**Snapshot:** `1786189433850` · **UTC:** 2026-08-08T11:43:53Z · **commit:** `4ace181`
· **branch:** `checkpoint/dashboard-v2-isolamento-real` · working tree dirty
(trabalho de resiliência do supervisor; **não afeta dados**). 115 arquivos,
todos presentes, 111 cópias imutáveis, hashes em `manifesto.json`. **Todos os
números abaixo vêm exclusivamente deste corte.** Relatórios antigos foram
tratados como hipótese, não verdade.

> Restrições respeitadas: nenhuma alteração em motor, estratégia, capital,
> alavancagem, execução ou lógica econômica; Champion protegido; paper only;
> tudo aqui é **leitura/observação**. Nenhum modelo criado envia ordem, aprova
> ou bloqueia oportunidade.

## 1. Reconciliação financeira do Champion (item 3) — LIMPA

Recalculada evento a evento sobre `spread/diario.jsonl` (1891 linhas, 0
corrompidas, 0 fora de ordem):

| grandeza | soma dos eventos | estado.json | dif |
|---|---|---|---|
| funding recebido (`funding.ganho`, 31 eventos) | 18.1767 | 18.1767 | 0 |
| custos (abre+fecha+reinveste+escalona+apara+captura) | 8.6595 | 8.6595 | 0 |
| PnL realizado (capital − inicial) | 9.5172 | 9.5172 | 0 |

`funding − custos = capital − capitalInicial = 9.5172` — **reconciliação exata**.
Os 18 eventos `socorre` (US$ 293.84) são **transferências entre exchanges**,
corretamente **fora** do custo (movem margem, não consomem capital).

**PnL:** +US$ 9.52 sobre US$ 600 em ~5 dias ≈ **+1.59%** (~+0.31%/dia,
grosseiramente). Fee-to-gross do Champion: custos/funding = 8.66/18.18 = **47.6%**
— quase metade do funding bruto é comido por custos. É o maior alvo de melhoria.

## 2. Qualidade dos dados (item 2) — achados

- **Base de capital mudou no meio do run:** eventos antigos carregam `capital≈199`
  enquanto `capitalInicial=600`. Evidência de reconfiguração (provável 2→6
  exchanges) durante o run. **O ledger funding/custo sobreviveu limpo** (soma
  confere), mas o campo `capital` embutido nos eventos **não é uma curva de
  equity contínua** e não deve ser usado como tal. Risco de leakage se um modelo
  usar `capital` cru como feature.
- Oportunidades: **0 rejeições sem motivo** nesta janela (bom). Todos os
  `motivoRejeicao` presentes.
- momentum/pares: séries muito curtas (47 / 3 linhas de diário) — amostra
  insuficiente para qualquer conclusão estatística.

## 3. Funil de oportunidades (item 4) — o gargalo quantificado

146 ciclos · **21.195 observações** · **1.071 chaves únicas** (symbol|long|short):

| etapa | n | % das observações |
|---|---|---|
| observadas | 21.195 | 100% |
| **aprovadas** | **12** | **0.06%** |
| rejeitadas | 21.183 | 99.94% |
| escolhidas/abertas | 11 | — |

**Motivos de rejeição:**
| motivo | n | % das rejeições |
|---|---|---|
| **payback_insuficiente** | 14.741 | **69.6%** |
| saldo_insuficiente (sem margem acima da reserva de 30%) | 5.753 | **27.2%** |
| notional abaixo do mínimo de US$ 5 | ~640 | ~3% |
| cobertura_insuficiente | 20 | 0.1% |

**Dois gargalos dominam:** (1) o **portão de payback** barra ~70% — a maioria
das candidatas não tem vida provada suficiente para pagar o próprio custo; (2) a
**reserva de margem de 30% + capital ocupado** barra ~27%. Juntos, explicam
~97% de tudo que é descartado. Aumentar frequência de lucro passa por atacar
esses dois — sem afrouxar risco por afrouxar (ver matriz).

## 4. Atribuição de PnL por símbolo (item 5, parcial)

| símbolo | funding | nFund | abre | captura | fecha | custo | líq* |
|---|---|---|---|---|---|---|---|
| KMNO | 4.520 | 3 | 1 | 0 | 1 | 0.575 | **+3.945** |
| BICO | 4.093 | 8 | 4 | 0 | 3 | 1.624 | **+2.469** |
| ACE | 2.194 | 3 | 1 | 4 | 5 | 1.328 | +0.866 |
| BANK | 1.694 | 1 | 1 | 0 | 1 | 0.611 | +1.083 |
| HOME | 1.202 | 1 | 1 | 0 | 1 | 0.642 | +0.560 |
| HFT | 1.058 | 1 | 0 | 1 | 1 | 0.356 | +0.702 |
| … | | | | | | | |
| ZBT | 0.051 | 2 | 1 | 0 | 1 | 0.218 | **−0.167** |
| **WAXP** | **0.000** | **0** | 1 | 0 | 1 | 0.858 | **−0.858** |

`*` líquido por símbolo é parcial (reinveste sem symbol e socorre não entram;
o funding total confere no estado). **WAXP é uma falha de seleção limpa:** aberta
por US$ 0.858 de custo, **zero funding**, fechada — inverteu antes de pagar
qualquer settlement. É o pior resultado individual e o exemplo canônico do que
um modelo de sobrevivência (item 12) deveria evitar.

**Concentração:** KMNO+BICO = 6.41 de 18.18 de funding = **35% do funding em 2
símbolos**. Top-6 símbolos concentram a quase totalidade do PnL. Sem controlar
ativo/regime/amostra, **não** se declara "melhor par" — a amostra por par é
pequena (a maioria tem 1 abertura).

## 5. Settlement capture (item 9)

6 `abre-captura` em 3 símbolos (HFT, ACE, COTI), custo total US$ 0.965,
intervalos majoritariamente de 1h (mais 8h), **escorregamento medido em todas**.
ACE foi o mais ativo (4 capturas). A captura é um subsistema pequeno mas
funcional; aumentar frequência exige alinhar mais janelas de settlement sem
aceitar capturas cujo funding não paga o round-trip (custo médio/captura ≈
US$ 0.16 — a captura precisa render acima disso).

## 6. Multi-strategy — quantas fontes independentes de lucro? (itens 11, 13)

| motor | capital | PnL | trades | vitórias | veredito |
|---|---|---|---|---|---|
| **Champion (funding arb)** | 600 | **+9.52** | 20 fecha | — | **única fonte produtiva** |
| Momentum (ts) | 200 (paper) | **−0.99** | 1 fechado | 0 | negativo, sem vitória, amostra ínfima |
| Pares | 200 (paper) | 0.00 | 0 | 0 | **dormente** (calibrou, nunca operou) |

Hoje há **1 fonte de lucro real** (funding arb). Momentum está levemente negativo
sem nenhuma vitória; pares nunca disparou uma operação. O objetivo do usuário
("aumentar fontes independentes de lucro") tem base honesta: **as duas
alternativas ainda não são fontes** — precisam de dados/tuning antes de qualquer
conclusão, e nenhuma amostra atual permite declarar vencedor (item 14).

## 6b. Decomposição de custos (item 8) — onde está o fee-to-gross de 47.6%

Total US$ 8.6595:

| categoria | US$ | % | eventos |
|---|---|---|---|
| **trading** (abre+fecha) | 5.1923 | **60.0%** | 37 |
| **gestão** (reinveste+escalona+apara) | 2.5023 | **28.9%** | 45 |
| **captura** (abre-captura) | 0.9648 | 11.1% | 6 |

Por tipo (maiores): **fecha 3.59** (fechar posição — o maior custo isolado,
41% do total), **escalona 2.27** (subir posição em incrementos, 26%), abre 1.60,
abre-captura 0.96, apara 0.18, reinveste 0.05.

**Alvo #1 de batching:** os 13 `escalona` (US$ 2.27, ~US$ 0.17/evento) — subir
notional em incrementos paga custo a cada passo. Batelar escalonamentos (por
intervalo / por valor mínimo / antes do settlement) é a maior economia
plausível sem tocar proteção de liquidação. **Alvo #2:** menos fechamentos
precoces (fecha 3.59) — conecta ao modelo de sobrevivência (evitar WAXP-like).
A simulação cronológica de batching (controle atual vs batch por intervalo/valor/
desbalanceamento/pré-settlement) é o próximo passo shadow, medindo economia **e**
risco incremental — sem remover proteções.

## 7. Matriz priorizada de melhorias (item 15)

Ordenada por valor esperado × confiança ÷ (risco × tempo-para-evidência). Todas
começam **shadow/read-only**.

| # | ideia | mecanismo | ataca | evidência atual | lucro | freq | risco | complex. | modo de teste | critério aprovação | rollback |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | **Redução de fee-to-gross** | custos = 47.6% do funding; decompor trade vs gestão vs proteção e batelar rebalance | custos | forte (ledger) | alto | — | baixo | média | simular batching cronológico (item 8) shadow | economia > X% sem aumentar dist. liquidação | não aplicar |
| 2 | **Switch Value Observer** | 27% das rejeições são falta de margem; medir EV(manter posição fraca) vs EV(trocar por candidata melhor bloqueada) | capital/seleção | forte (funil) | alto | alto | baixo | média | observer shadow, sem trocar nada | recomendações batem outcomes | desligar observer |
| 3 | **Logger de candidatas alternativas + outcomes** | já existe candidata/rejeição no oportunidades.jsonl; enriquecer com resultado posterior (contrafactual) | seleção/ML | forte | médio | — | zero | baixa | dataset append-only read-only | dataset validável | apagar dataset |
| 4 | **Modelo de sobrevivência (shadow)** | prever tempo-até-inversão / chance de pagar o payback (WAXP-like) | seleção | média | médio | médio | baixo | alta | shadow, nunca decide | AUC/CI > baseline determinístico | não promover |
| 5 | **Afinar portão de payback com contrafactual** | 70% rejeitado por payback; medir quantas rejeitadas teriam pago | freq/seleção | fraca (precisa dataset #3) | médio | alto | médio | média | contrafactual sobre dataset #3 | rejeições lucrativas > custo do risco | reverter limiar |
| 6 | **Ativar/diagnosticar pares** | pares dormente há dias; descobrir por que nunca dispara | fontes indep. | fraca | baixo-médio | médio | baixo | média | leitura de logs + sim | pares gera trades válidos em paper | manter dormente |
| 7 | **Ranking cross-sectional determinístico (shadow)** | ordenar aprovadas do mesmo ciclo por EV; comparar com escolha real | seleção | média | médio | médio | baixo | média | shadow, não altera escolha | ranking-shadow ≥ escolha real | ignorar ranking |
| 8 | **Anomalias determinísticas (z-score/EWMA/change-point)** | detectar mudança de funding/saldo/latência/custo | risco/ops | média | baixo | — | baixo | baixa | observer read-only | alertas verdadeiros > ruído | desligar |

## 8. Plano de ML e shadow (itens 12–14) — honesto

**Não** há model result fabricado. Um único snapshot não sustenta validação
científica. O caminho:

1. **Baselines determinísticos primeiro** (regras, z-score, EWMA) — barra a
   bater antes de qualquer modelo.
2. **Dataset append-only** (item 18): construído READ-ONLY a partir de
   `oportunidades/*.jsonl` (features da decisão, sem lookahead) + `diario.jsonl`
   (labels de outcome: pagou payback? inverteu? PnL líquido; join por
   symbol|long|short + janela temporal). Um builder read-only é entregue em
   `auditoria/ml/`.
3. **Modelos permitidos no início:** logística, árvores pequenas, GBDT,
   survival, quantílica — nunca redes/RL/LLM-preditor no começo.
4. **Validação:** split cronológico, walk-forward, common-window, holdout final
   intocado, custos reais + 2× estressado, vizinhança de parâmetros, correção
   para múltiplos testes. **Nunca shuffle temporal.** Sem declarar vencedor com
   uma única posição.
5. **Shadow:** todo modelo roda em observação, logando previsão vs realidade;
   **nunca** decide, aprova, bloqueia ou envia ordem.

**Por que ainda não há modelo treinado:** a amostra de *outcomes* é pequena
(20 fechamentos, 11 aberturas nesta janela). Treinar/validar agora seria
overfit disfarçado. A entrega desta fase é a **fundação do dataset** + os
baselines + o plano; os modelos vêm quando o dataset acumular.

## 9. Confirmação de integridade (item 25)

Champion, risco, capital e alavancagem **intactos** — nada nesta auditoria
escreve estado do Snowball, altera limiar de risco, capital ou alavancagem, ou
toca motor/execução. Verificável: `git diff` não altera `src/cli/*`,
`src/inteligencia`, `src/funding`, `src/risk`, nem `spread/`,`momentum/`,`pares/`.
