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

---

## Resultado 7 — Pares cointegrados: a investigação mais longa da sessão, e a que fechou todas as lacunas próprias

Mecanismo genuinamente novo em relação a tudo o mais neste documento — os
outros seis apostam em DIREÇÃO (um ativo sobe ou desce). Pares cointegrados
apostam em RELAÇÃO: dois ativos correlacionados se afastam, e o lucro vem de
apostar que voltam a se alinhar. Market-neutral: se os dois caem juntos 20%,
a posição não perde nada (Gatev, Goetzmann, Rouwenhorst 2006, "Pairs
Trading").

Esta seção documenta as QUATRO rodadas de correção, porque a lição
metodológica importa tanto quanto o número final — cada rodada parecia
"pronta" até a próxima pergunta honesta derrubar ou salvar o resultado.

### Rodada 1 — top-20 por meia-vida, sem restrição

descoberta +0,0073 · holdout +0,0131 (678 trades, win 70,6%). Holdout maior
que descoberta — parecia o achado mais forte da sessão.

**Pergunta que derrubou:** os pares compartilhavam perna? HOT aparecia em
FIL|HOT, KSM|HOT, 1INCH|HOT, ZEN|HOT simultaneamente — um choque nele afeta
os quatro ao mesmo tempo, e o bootstrap (que reamostra trades como sorteios
independentes) não via isso.

### Rodada 2 — sem sobreposição de perna (`selecionarSemSobreposicao`)

Corrigido: cada ativo entra em no máximo um par. Resultado: descoberta caiu
para expectancy **NEGATIVA** (-0,0022, 390 trades, win 63,6%). A rodada 1
estava inflada por apostas correlacionadas, não por vantagem real.

**Pergunta que salvou:** por quê? Decompondo por motivo de saída: trades que
revertem têm média +3,6%; trades que estouram o TIMEOUT têm média -10,6%
(o pior, -116%). Os piores pares (ZEC|ZIL, BNB|CRV, ADA|NEO) tinham
meia-vida de 25-39 dias contra um `maxBarras` de 15 — óbvio que estouravam o
prazo antes de reverter.

### Rodada 3 — filtro ex-ante de meia-vida (`meiaVidaBarras <= 20`)

Um par cuja própria calibração diz que reverte mais devagar que o prazo de
saída não deveria nem ser candidato — critério calculado na formação, não
escolhido olhando o resultado (testei também um stop de divergência por
z-score; piorava o resultado, porque corta trades que reverteriam de
verdade mais do que protege dos raros que não revertem — descartado).

| conjunto | trades | expectancy | win rate |
|---|---|---|---|
| descoberta (30 ativos) | 207 | +0,0148 | 69,6% |
| **holdout cego (27 ativos)** | **280** | **+0,0136** | **68,9%** |

Robusto em 3 dos 4 cortes formação/operação (50/60/70% positivos; 40% fica
levemente negativo, -0,0018 — sinal de que o método precisa de alguns meses
de formação antes de funcionar bem). Escorregamento medido ao vivo no livro
para os 8 pares do holdout: pior caso 0,0205%, a constante assumida no
backtest (0,03%) já cobria com folga. Correlação de mercado residual
checada: só 11% das semanas com 2+ trades simultâneos tiveram maioria
perdendo — a ausência de perna repetida já resolve a maior parte da
correlação entre pares.

### Rodada 4 — risco de liquidação por perna (a que decidiu tudo)

O `retorno` do backtest assume que a posição sempre chega ao desfecho
natural. Não checa se, no CAMINHO até lá, uma perna se moveu contra a
margem o bastante para ser liquidada primeiro. Medido nos 487 trades reais:
os piores movimentos adversos intra-trade vão de **100% a 252%** do preço
de entrada — pequenas altcoins com choques de listagem/liquidez que o
z-score do SPREAD não vê, porque olha a diferença entre as pernas, não o
nível absoluto de cada uma.

A distância até liquidação de uma perna é `1/alavancagem − mmr` —
**independente de quantos pares dividem o capital** (margem e notional
escalam juntos por 1/N; a razão entre eles, que decide liquidação, cancela
N). Uma versão anterior desta análise multiplicava `(1/N/2) × alavancagem`
e chamava o resultado de "distância até liquidação" — esse número é na
verdade NOTIONAL como fração do capital, o inverso do que o nome dizia.
Corrigido em `src/pairs/liquidacao.ts`, com teste de regressão.

| alavancagem | distância liquidação | % dos trades que liquidaria | expectancy corrigida |
|---|---|---|---|
| 1x | 99,0% | 2,1% | **+0,0018** |
| 1,5x | 65,7% | 4,1% | -0,0014 |
| 2x | 49,0% | 6,8% | -0,0069 |
| 3x | 32,3% | 14,0% | -0,0192 |
| **5x** (o padrão do resto do projeto) | 19,0% | **38,6%** | **-0,0522** |

A 5x — a alavancagem que o resto deste projeto usa para BTC/ETH, ativos bem
mais líquidos — 38,6% dos trades liquidariam, e cada liquidação custa a
margem inteira daquela perna. Isso sozinho apaga a vantagem inteira: a
expectancy corrigida fica negativa em TODA alavancagem testada acima de 1x.

**Só em 1x a expectancy corrigida continua positiva, e é quase nula
(+0,18% por trade)** — muito menos que os +1,4% que a versão sem risco de
liquidação sugeria.

Bootstrap final, em 1x (`npm run desafio`):

| pares simult. | chega na meta | QUEBRA | tempo mediano |
|---|---|---|---|
| 4 | 2,6% | 34,3% | 3,9 anos |
| 6 | 1,1% | 17,9% | 4,2 anos |
| 8 | 0,4% | 9,4% | 4,2 anos |
| 10 | 0,2% | 4,9% | 4,4 anos |

Note o padrão invertido em relação às rodadas anteriores: mais diluição
(mais pares, risco menor por um) reduz tanto a chance de chegar quanto a de
quebrar — porque a 1x a vantagem é fraca demais para compor rápido, e a
única coisa que resta fazer é não perder. Não existe combinação de N nesta
tabela com chance de sucesso relevante dentro de 5 anos.

### O veredito final sobre pares cointegrados

**Não passa.** A vantagem estatística é real (holdout confirma, robusta a
correlação de perna e de mercado, escorregamento verificado ao vivo) — mas
só existe numa alavancagem baixa demais para ser útil. Nas alavancagens que
tornariam o crescimento relevante (2x+), o risco de liquidação de altcoins
pequenas (movimentos de 100-252% observados) mais que compensa a vantagem.

Isto foi encontrado através de quatro rodadas de correção, cada uma
motivada por uma pergunta cética sobre a rodada anterior — não por desistir
na primeira dificuldade, nem por parar no primeiro resultado bonito.

**Código:** `src/pairs/cointegracao.ts`, `src/pairs/backtest.ts`,
`src/pairs/portfolio.ts`, `src/pairs/liquidacao.ts`, `src/pairs/validado.ts`,
`npm run pares`, `npm run desafio`.

---

## O veredito final da sessão

Sete classes de estratégia testadas, cada uma com a mesma disciplina
(descoberta separada de holdout cego, parâmetros fixos sem reajuste,
correção honesta quando um teste mais rigoroso derrubava um resultado
bonito):

| estratégia | melhor achado | sobrevive a holdout? | sobrevive a custo/risco real? |
|---|---|---|---|
| arbitragem de funding (cross-exchange) | — | — | 0 de 341 ciclos passariam |
| captura de liquidação | — | — | 0 operações no backtest |
| direcional cripto (múltiplos timeframes) | body-breakout, 4h | não (3 de 11 ativos) | — |
| direcional ações | momentum-breakout, 1h | não (3 de 20 ativos) | — |
| time-series momentum (cripto, 1d) | +0,049R | **sim** (38/57, p=0,008) | fraco: 23,8% sucesso / 55,6% quebra |
| pares cointegrados (cripto, 1d) | +0,014/trade | **sim** (após 2 correções) | não (só positivo a 1x, quase nulo) |

Nenhuma das sete produz um caminho com chance de sucesso alta partindo de
US$ 200 sem aporte. As duas que sobreviveram a teste cego (`ts-momentum` e
pares) têm vantagem estatística REAL — mas pequena demais, ou incompatível
com a alavancagem necessária para crescer rápido, para tornar a meta
provável dentro de um horizonte razoável. Isto é consistente com a
literatura acadêmica: anomalias de mercado sobrevivem estatisticamente após
publicação, mas perdem força prática depois de custos de transação e
restrições de execução (McLean & Pontiff 2016, Chen & Zimmermann 2020).

---

## Resultado 8 — Três mecanismos fora da família "direção/reversão", checados e descartados rápido

Depois do veredito do Resultado 7, testei três mecanismos genuinamente
diferentes de tudo o mais no documento — nenhum é "outra estratégia de
rompimento", são categorias de operação distintas.

**Basis de futuros com vencimento (calendar spread).** Diferente de funding
perpétuo: um futuro trimestral CONVERGE ao spot no vencimento por
construção, não por hipótese estatística de reversão. Medido ao vivo em
BTC/ETH na Bybit (os únicos com histórico de vencimento longo o bastante):
estrutura a termo limpa e consistente, ~4,2-4,6% ao ano anualizado no
contrato de 324 dias. É real e de baixo risco (quase arbitragem) — mas
pequeno demais para a meta: US$ 200 a 4,5%/ano rende ~US$ 9/ano, e exige
capital travado quase 1 ano. Contratos de vencimento curto (2-23 dias)
mostraram basis aparentemente enorme quando anualizado (até 180%), mas é
artefato de anualizar uma diferença minúscula sobre uma janela curtíssima —
não é capturável depois do custo de abrir/fechar duas pernas.

**Arbitragem de preço spot entre exchanges.** Medido ao vivo em 7
exchanges (binance, bybit, okx, gate, bitget, kucoin, mexc) para BTC, ETH,
SOL, DOGE, SHIB: spread entre a exchange mais barata e a mais cara ficou
entre 0,027% e 0,061% — abaixo do custo de ida e volta em duas exchanges
(~0,2-0,4%). O mercado já está eficiente demais nessa camada para um
participante de varejo com execução via REST (não colocado, não
low-latency). Descartado sem precisar de backtest.

**Sazonalidade (dia da semana).** Primeira leitura, pooled em 57 ativos:
quarta/sexta/sábado positivos, domingo/terça/quinta negativos, parecendo um
padrão real. **Armadilha estatística**: 57 ativos cripto são altamente
correlacionados entre si — o mesmo dia de alta de Bitcoin aparece 57 vezes
no pool, inflando N artificialmente. Testado do jeito certo (só BTC,
metade inicial vs metade final da amostra, 5 anos): 4 de 7 dias mantêm o
mesmo sinal entre as metades — exatamente o esperado por puro acaso
(p=0,50). Sem efeito real; a versão pooled era ruído de correlação, não
sinal.

**Por que parei aqui, e não em scalping/opções/notícias:** scalping de
verdade exige order book L2 histórico e execução de baixa latência que este
projeto não tem (só OHLCV via REST); opções cripto (venda de prêmio de
volatilidade) têm risco de perda ilimitada numa posição descoberta e
exigiriam infraestrutura de hedge de delta que não existe aqui — construir
isso sem conseguir validar direito seria pior que não tentar; sentimento/
notícias não tem fonte de dado histórico confiável disponível. Recusar
essas três não é preguiça — é o mesmo padrão do resto deste documento: não
testar o que não dá para testar com rigor.
