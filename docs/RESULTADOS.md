# Resultados medidos

Todos os números desta página foram produzidos pelo código deste repositório,
com a configuração indicada. Nenhum número foi copiado do vídeo, exceto onde
está explicitamente marcado como "afirmado no vídeo".

Última atualização: 2026-07-31

---

## Dados usados

| Exchange | Símbolos | Timeframes | Período | Barras | Integridade |
|---|---|---|---|---|---|
| binance (spot) | BTC, ETH, SOL /USDT | 5m | 1 ano | 105.120 cada | cobertura 100%, 0 gaps |
| binanceusdm (perp) | TRX, DOT /USDT:USDT | 5m | 3 anos | 315.360 cada | cobertura 100%, 0 gaps |
| binanceusdm (perp) | TRX, DOT, BTC, ETH, SOL | 1h | 5 anos | 43.800 cada | cobertura 100%, 0 gaps |
| binanceusdm (perp) | TRX, DOT, BTC, ETH, SOL | 4h | 5 anos | 10.950 cada | cobertura 100%, 0 gaps |

---

## Modelos de custo

| Preset | Taxa/lado | Slippage/lado | Funding 8h |
|---|---|---|---|
| `zero-cost` | 0% | 0% | 0 |
| `binance-futures-maker` | 0,020% | 0,005% | 0,01% |
| `binance-futures` (taker) | 0,050% | 0,020% | 0,01% |
| `stress` | 0,100% | 0,080% | 0,03% |

---

## Resultado 1 — O custo é a variável dominante

**TRX/USDT:USDT 5m, 3 anos, regras exatas do vídeo, uma posição por vez.**

| Estratégia | PF zero-cost | PF maker | PF taker | PF stress |
|---|---|---|---|---|
| vwma-dip | 1,251 | 1,121 | 0,954 | 0,680 |
| body-breakout | 1,229 | 1,116 | 1,027 | 0,587 |
| momentum-breakout | 1,216 | 1,133 | 1,004 | 0,859 |
| zscore-dip | 1,184 | — | 0,953 | 0,687 |
| ma-cross | 1,091 | — | 0,610 | 0,578 |

**Leitura.** Sem custo, os números batem com o que o vídeo afirma (PF 1,22–1,25,
Sharpe 1,55–1,80). A implementação está fiel. Com custo taker, quase tudo cruza
para baixo de 1. A conta:

```
edge bruto por trade     ≈ +0,15 R
custo por trade (taker)  ≈ −0,16 R
                           --------
líquido                  ≈ −0,01 R
```

Taxas como fração do lucro bruto no cenário taker: 82% (body-breakout), 97%
(momentum-breakout), 137% (vwma-dip), 145% (zscore-dip).

---

## Resultado 2 — Walk-forward em 5 minutos

**Critério de aprovação (todos obrigatórios):** ≥100 trades OOS, expectancy OOS
positiva, eficiência WF ≥0,40, Sharpe deflacionado ≥0,90, risco de ruína ≤1%,
cenário p5 melhor que −30%.

### Primeira rodada — implementação com as regras erradas, ativos errados

BTC/ETH/SOL spot, custo taker: **15 de 15 reprovadas.** Todas com expectancy OOS
negativa e eficiência walk-forward negativa.

O caso mais didático, `ma-cross` em SOL:

| Fold | In-sample | Out-of-sample |
|---|---|---|
| 0 | +0,506R | −0,103R |
| 1 | +0,145R | −0,363R |
| 2 | +0,228R | −0,204R |
| 3 | +0,796R | −0,057R |
| 4 | +0,500R | −0,044R |
| 5 | +0,201R | −0,604R |

Positiva em 6 de 6 in-sample, negativa em 6 de 6 out-of-sample. Eficiência
−0,58. É a assinatura visual do sobreajuste.

### Segunda rodada — regras corretas, ativos corretos, custo maker

TRX e DOT perpétuos, 5m: **1 de 10 aprovada.**

| Ativo | Estratégia | Expectancy OOS | Retorno | DD | Eficiência | DSR | Veredito |
|---|---|---|---|---|---|---|---|
| TRX | vwma-dip | **+0,252R** | 19,2% | 4,2% | **0,77** | 1,00 | **APROVADO** |
| TRX | momentum-breakout | +0,096R | 14,6% | 6,9% | −0,01 | 1,00 | reprovado |
| TRX | ma-cross | +0,055R | 5,0% | 8,4% | 0,11 | 0,78 | reprovado |
| TRX | body-breakout | +0,054R | 7,0% | 7,7% | 0,10 | 1,00 | reprovado |
| DOT | body-breakout | +0,043R | 5,7% | 15,4% | 0,34 | 1,00 | reprovado |
| DOT | zscore-dip | +0,010R | 0,5% | 9,5% | −0,00 | 0,01 | reprovado |
| DOT | momentum-breakout | −0,017R | −1,8% | 15,3% | −0,21 | 0,00 | reprovado |
| DOT | ma-cross | −0,105R | −13,0% | 21,5% | −0,97 | 0,00 | reprovado |
| TRX | zscore-dip | −0,143R | −9,0% | 9,9% | −0,18 | 0,00 | reprovado |
| DOT | vwma-dip | **−0,247R** | −13,1% | 14,3% | −0,58 | 0,00 | reprovado |

**Ressalva importante.** A mesma `vwma-dip` que passou em TRX (+0,252R) reprovou
em DOT (−0,247R). Com 10 testes, uma aprovação isolada está dentro do acaso.

---

## Resultado 3 — O timeframe (a descoberta principal)

**4 horas, 5 anos, 5 perpétuos, custo maker: 5 de 16 aprovadas.**

O que importa não é a contagem de aprovações — é o padrão. **`body-breakout`
teve expectancy positiva out-of-sample em todos os 5 ativos:**

| Ativo | Expectancy OOS | Retorno | DD | Eficiência WF | DSR | Veredito |
|---|---|---|---|---|---|---|
| BTC | **+0,198R** | 15,7% | 5,4% | 0,86 | 1,00 | **APROVADO** |
| ETH | **+0,154R** | 17,1% | 9,0% | 0,99 | 1,00 | **APROVADO** |
| TRX | **+0,133R** | 11,2% | 5,3% | 1,40 | 1,00 | **APROVADO** |
| DOT | +0,118R | 13,8% | 7,4% | 0,22 | 1,00 | reprovado (eficiência) |
| SOL | +0,042R | 4,7% | 11,4% | 0,34 | 0,45 | reprovado |

Também aprovados em 4h: `momentum-breakout` em BTC (+0,189R, retorno 22,0%,
eficiência 0,59) e em SOL (+0,108R, eficiência 0,43).

`ma-cross` reprovou em todos os 5 ativos, com expectancy entre −0,036R e
−0,604R.

### Por que 4 horas funciona e 5 minutos não

O custo é um pedágio aproximadamente fixo por trade. O que muda com o timeframe
é o tamanho do movimento capturado. Em 5 minutos, um alvo de 3% é raro e o
pedágio pesa 5–15% da margem. Em 4 horas, o mesmo pedágio é trivial diante do
movimento típico. A estratégia não ficou melhor — ela parou de pagar imposto
proporcionalmente maior que o lucro.

Isso é consistente com o único resultado crível mostrado no vídeo (afirmado no
vídeo, validado via trader.dev pelo próprio autor): **BTC 4h, +112%, PF 1,71,
DD 27,5%, 65 trades, Sharpe 0,80.**

### 1 hora — intermediário e ruidoso

5 de 25 aprovadas, sem padrão consistente entre ativos. Melhores: `zscore-dip`
em ETH (+0,166R) e SOL (+0,133R), `vwma-dip` em SOL (+0,122R). Nenhuma
estratégia positiva nos 5 ativos.

---

## Resultado 4 — Ações (F, COIN)

Fonte: Yahoo Finance, 5 minutos, **60 pregões apenas** (limite da fonte
gratuita). Amostra pequena demais para walk-forward — serve como checagem
direcional.

**Por que ação é diferente:** corretora de varejo nos EUA cobra **comissão
zero**. A taxa que mata o scalping de 5 minutos em cripto simplesmente não
existe aqui. Sobram spread e slippage, modelados em 0,10%/lado no preset
`stock-realistic`.

### F (Ford, NYSE) — 4.681 barras, 60 pregões

| Estratégia | PF sem custo | PF realista | Expectancy realista | Trades |
|---|---|---|---|---|
| **body-breakout** | 2,500 | **2,006** | **+0,398R** | 59 |
| **momentum-breakout** | 1,937 | **1,647** | **+0,337R** | 78 |
| vwma-dip | 2,691 | 2,287 | +0,570R | 9 (amostra insuficiente) |
| ma-cross | 1,076 | 0,896 | −0,068R | 149 |
| zscore-dip | — | — | — | 1 (não dispara) |

### COIN (Coinbase, NASDAQ) — 4.681 barras, 60 pregões

| Estratégia | PF sem custo | PF realista | Expectancy realista | Trades |
|---|---|---|---|---|
| body-breakout | 1,234 | 1,008 | +0,010R | 95 |
| momentum-breakout | 1,181 | 0,884 | −0,073R | 107 |
| ma-cross | 0,985 | 0,448 | −0,437R | 75 |
| vwma-dip | 0,805 | 0,673 | −0,237R | 16 |

**Gaps overnight** (que não existem em cripto): F tem mediana de 0,65% e máximo
de 4,33%; COIN tem mediana 1,85% e máximo 6,40%. Um stop de 1,5% em COIN é
rompido por gap com frequência — o motor sai na abertura, não no stop, o que é o
tratamento correto e também o mais caro.

**ALTR não é mais testável.** A Altair Engineering foi adquirida pela Siemens e
o ativo está deslistado. Isso é, em si, um lembrete de viés de sobrevivência:
só é possível fazer backtest em ativos que ainda existem.

---

## Resultado 5 — Machine learning (meta-labeling)

**SOL 5m, GBDT próprio, purged walk-forward CV com 5 folds, embargo 1%.**

| Estratégia | AUC por fold | AUC médio | Expectancy sem filtro | Com filtro | Trades retidos |
|---|---|---|---|---|---|
| momentum-breakout | 0,494 / 0,636 / 0,490 / 0,535 / 0,574 | 0,546 | −0,054R | **+0,066R** | 189 de 854 |
| ma-cross | 0,583 / 0,511 / 0,478 / 0,517 / 0,561 | 0,530 | −0,009R | **+0,066R** | 362 de 626 |

Features mais usadas nos cortes: `atrPct`, `bodyFrac`, `volRatio`, `hourCos`,
`z20`, `ret5`.

**Leitura.** O filtro vira o sinal de negativo para positivo — resultado real,
medido em folds onde o modelo nunca viu aqueles trades. Mas AUC 0,53–0,55 é
fraco, e 2 dos 5 folds ficaram abaixo de 0,50 (pior que o acaso). É estrutura de
verdade, não é edge suficiente.

**Decisão explícita:** não ajustar o modelo até ele passar. Isso seria o
sobreajuste que o projeto inteiro existe para detectar.

---

## Ressalvas que valem para tudo acima

1. **Múltiplos testes.** Foram testadas 5 estratégias × 5 ativos × 3 timeframes
   = 75 combinações. O Sharpe deflacionado corrige pelas combinações de
   parâmetro **dentro** de cada rodada, mas **não** pelas 75 tentativas. É por
   isso que a consistência do `body-breakout` entre 5 ativos importa mais que
   qualquer veredito individual.

2. **Seleção adversa no preset maker.** Ordem limite nem sempre executa. Você só
   é preenchido quando o preço volta até você, e portanto perde exatamente os
   rompimentos que dispararam sem olhar para trás — os melhores trades. Isso
   **não está modelado**. O preset maker é um teto otimista.

3. **Uma posição por vez, sem custo de capital, sem impostos.** O motor não
   modela imposto de renda, que no Brasil incide sobre operações em cripto.

4. **Sobrevivência de ativo.** Os 5 perpétuos testados existem hoje. Testar só
   em ativos que sobreviveram até 2026 é uma forma sutil de viés.

5. **Nada foi aprovado para dinheiro real.** O único portão que resta é paper
   trading, e ele mede justamente o que o backtest não consegue.

---

## Resultado 6 — Time-series momentum (Moskowitz/Ooi/Pedersen), a primeira vantagem que sobreviveu holdout cego

**A classe é diferente de tudo o mais neste documento.** As estratégias acima
leem padrão de vela (corpo, rompimento, zscore) e saem por stop/alvo em
minutos-horas. `ts-momentum` lê só o retorno acumulado num lookback longo
(30 dias), entra na direção dele, e sai por TEMPO (maxBarsInTrade), não por
preço. É o resultado mais replicado da literatura de factor investing — 58
mercados, 25+ anos, positivo em todos os 58 (Moskowitz, Ooi, Pedersen 2012).

**Metodologia, para não repetir o erro do item 6 abaixo:** universo de 57
perpétuos binanceusdm (1d, 5 anos), dividido ANTES de qualquer ajuste em
DESCOBERTA (30 ativos, onde a grade de parâmetros foi buscada) e HOLDOUT (27
ativos, nunca tocados até o teste final, parâmetros fixos sem reajuste).

| conjunto | positivos | fração | expectancy mediana |
|---|---|---|---|
| descoberta (30) | 18 | 60% | +0,03R |
| **holdout cego (27)** | **20** | **74%** | **+0,049R** |
| combinado (57) | 38 | 67% | — |

P sob H0 de moeda justa: **0,008**. O holdout não caiu em relação à
descoberta — é o padrão OPOSTO ao de um falso positivo (comparar com o item
6: 100% → 15%).

**O que isso NÃO é:** uma estratégia rápida. Frequência real ~26-34
trades/ano por ativo, CAGR individual de 0-4% ao ano com dimensionamento por
risco fixo de 0,5%. O ganho é a ROBUSTEZ da vantagem, não a velocidade dela.

**Bootstrap contra a meta de viagem** (`npm run desafio`, `npm run momentum`):
reamostrando os 7.634 trades reais (não um modelo binário — a distribuição
tem cauda direita gorda, poucos trades grandes carregam o resultado), o
melhor ponto de risco fracionário (5% por operação, portfólio de ~8 ativos)
dá 23,8% de chance de chegar a US$ 2.234 partindo de US$ 200 sem aporte, e
55,6% de chance de quebrar antes.

**Leitura honesta:** é a vantagem mais robusta já medida neste projeto, e
ainda assim modesta demais para tornar a meta provável sem aporte. Expectancy
real (~0,04-0,05R) é isto: real, mas pequena — consistente com a literatura
de que anomalias sobrevivem estatisticamente mas perdem força prática após
custos (McLean & Pontiff 2016, Chen & Zimmermann 2020).

**Código:** `src/strategies/index.ts` (`tsMomentum`, `xsMomentum`),
`src/data/momentum-universe.ts`, `src/backtest/bootstrap.ts`,
`npm run momentum`, `npm run desafio`.
