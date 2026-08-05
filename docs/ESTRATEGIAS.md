# As 5 estratégias

Regras transcritas **das capturas de tela do vídeo**, não da transcrição em
texto — a transcrição contém erros que mudam o comportamento das estratégias.
Onde os dois divergem, a tela vence e a divergência está anotada.

Implementação: [`src/strategies/index.ts`](../src/strategies/index.ts)

---

## 1. Momentum + breakout com filtro de volatilidade

Ativo no vídeo: **F (Ford, NYSE), 5 minutos**

```
Long, quando TODAS forem verdadeiras:
  SMA(range, 10) > SMA(range, 50)      volatilidade expandindo
  close > close de 20 barras atrás
  close > maior fechamento das últimas 20 barras
  candle verde (close > open)

Short = espelho exato

Saída (ambas as direções): stop −1,5%, take-profit +3%
```

**Detalhe que eu errei na primeira implementação:** o filtro é sobre o
**range do candle** (`high − low`), não sobre o preço de fechamento. É um filtro
de expansão de volatilidade, não de tendência. Eu tinha implementado
`SMA(close,20) > SMA(close,50)`, que é uma coisa completamente diferente.

Nome no código: `momentum-breakout`

---

## 2. Cruzamento duplo de médias

Ativo no vídeo: **ALTR (Altair Group), 5 minutos**

```
SMA(close, 50) > SMA(close, 100)  →  Long
SMA(close, 50) < SMA(close, 100)  →  Short

Saída: stop −1%, take-profit +2%
```

A mais crua das cinco.

**Detalhe importante:** a regra é um **estado**, não um evento de cruzamento.
Enquanto a média rápida estiver acima da lenta, a estratégia reentra assim que a
posição anterior fecha. É isso que explica os 534 trades do backtest do vídeo.
O parâmetro `useCross=true` troca para comportamento de evento, que negocia
muito menos e paga muito menos taxa.

Nome no código: `ma-cross`

**Resultado:** é a única estratégia que falha em todos os ativos e em todos os
timeframes testados. O resultado mais consistente do projeto, no sentido ruim.

---

## 3. Buy the dip in uptrend

Ativo no vídeo: **DOTUSDT.P (perpétuo Binance), 5 minutos**

```
Long, quando TODAS forem verdadeiras:
  EMA(range, 10) > SMA(range, 50)      volatilidade expandindo
  close > close de 20 barras atrás      tendência de alta
  z-score ≤ −2,  onde z = (close − SMA(close,20)) / stdev(close,20)
                                        preço caiu forte abaixo da média

Short, espelho:
  EMA(range, 10) > SMA(range, 50)
  close < close de 20 barras atrás      tendência de baixa
  z-score ≥ +2

Saída: stop −1,7%, take-profit +3%
```

**Dois detalhes que eu errei:**

1. O filtro de volatilidade usa o **range**, não o close.
2. A entrada é com z-score **negativo** (−2), ou seja, comprando a queda. Eu
   tinha implementado como `z ≤ +2`, o que a transformava num rompimento. É o
   caráter oposto da estratégia: isto é reversão à média **dentro** de uma
   tendência, não continuação de movimento.

Nome no código: `zscore-dip`

---

## 4. Trend-following breakout

Ativo no vídeo: **COIN (Coinbase Global, NASDAQ), 5 minutos**

```
Long, quando TODAS forem verdadeiras:
  SMA(body fraction, 10) > 0,5     candles recentes decididos, sem pavio grande
  close > SMA(close, 100)          acima da linha de tendência lenta
  close > maior fechamento das últimas 20 barras

Short, espelho:
  SMA(body fraction, 10) > 0,5
  close < SMA(close, 100)
  close < menor fechamento das últimas 20 barras

Saída (ambas as direções): stop −1,5%, take-profit +3%
```

onde `body fraction = |close − open| / (high − low)`, ou seja, quanto do range
do candle é corpo. Perto de 1 significa movimento decidido; perto de 0,
indecisão.

**Divergência entre a transcrição e a tela:** a transcrição diz *"body fraction
of a length of 10 that should be above 0.1"*. A tela diz **0,5**. A diferença é
enorme: 0,1 aceita praticamente todo candle, 0,5 exige que metade do range seja
corpo. Adotado 0,5.

**Estatísticas mostradas no vídeo (COIN 5m, Abr/2022–Jun/2026):** Total PnL
+1.159,04%, max drawdown 60,28%, trades lucrativos 35,39% (848 de 2.396).

Nome no código: `body-breakout`

**Resultado:** foi o candidato do projeto por um tempo — em 4 horas, teve
expectancy positiva out-of-sample nos 5 ativos testados com custo **maker**.
Não sobrevive a custo **taker**: confirmado por dois motores de backtest
independentes (o deste projeto e o do trader.dev, via MCP), profit factor
cai para ~0,99. Ver Resultado 16 em [RESULTADOS.md](RESULTADOS.md). Não é
mais candidato ativo.

---

## 5. VWAP buy the dip

Ativo no vídeo: **TRXUSDT.P (perpétuo Binance), 5 minutos** — é a estratégia
dos "5381%"

```
Long, quando TODAS forem verdadeiras:
  VWMA(body fraction, 10) > 0,5    candles decididos, ponderado por volume
  close > VWMA(close, 100)         acima da linha de tendência ponderada
  z-score ≤ −2                     preço caiu forte abaixo da média

Short: desabilitado (allowShort = false). Nunca vende, em nenhuma circunstância.

Saída: stop −1%, take-profit +2%
```

Descrição do próprio vídeo: *estratégia long-only de reversão à média com filtro
de tendência, perfil de stop largo e alvo pequeno*.

**Observação sobre o perfil de risco:** stop apertado com alvo maior **em
reversão à média** exige win rate alto para fechar a conta. É a estratégia mais
frágil das cinco a qualquer aumento de custo — e foi de fato a que mostrou
taxas de 137% do lucro bruto no cenário taker.

**Estatísticas reais mostradas no vídeo** (Jan/2020–Jun/2026): **Sharpe 0,376**,
lucro total ≈280M contra perda total ≈215M, Open PnL −652.206 USDT.

Nome no código: `vwma-dip`

---

## Resumo de nomes e defaults

| Nome no código | Stop | Take | Short? | Origem |
|---|---|---|---|---|
| `momentum-breakout` | 1,5% | 3% | sim | F, NYSE |
| `ma-cross` | 1% | 2% | sim | ALTR |
| `zscore-dip` | 1,7% | 3% | sim | DOTUSDT.P |
| `body-breakout` | 1,5% | 3% | sim | COIN, NASDAQ |
| `vwma-dip` | 1% | 2% | **não** | TRXUSDT.P |

Todos os parâmetros são sobrescrevíveis via `--params "stopPct=0.02,takePct=0.04"`.
