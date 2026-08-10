# Resultados medidos

> **📦 Arquivado — pré-refactor.** Este documento descreve a fase anterior do projeto (pesquisa multi-estratégia: backtest, 5 estratégias, ML meta-labeling, pares/momentum ao vivo, Auditor, servidor MCP local). Boa parte do código citado aqui foi removida no refactor de 2026-08 que focou o projeto só em funding-arb de 2 exchanges. Mantido como histórico/registro de decisões — não reflete o estado atual. Para o estado atual, ver [CONTEXTO.md](../../CONTEXTO.md) e [README.md](../../README.md).


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

---

## Resultado 9 — Funding extremo como sinal contrário: a ideia mais "ousada" da sessão, e ela não sobrevive

Depois de esgotar as variações dentro das famílias já testadas, tentei um
mecanismo genuinamente novo: usar funding extremo não como fonte de renda
(como em tudo o mais em `src/funding/`), mas como SINAL DE POSICIONAMENTO —
funding muito positivo significa mercado lotado de comprado, hipótese
clássica de fragilidade que precederia correção de preço.

Construído do zero: `src/data/funding-history.ts` (paginação de
`fetchFundingRateHistory`, 2 anos de funding real para os 57 ativos do
universo — a exchange só devolve 1000 registros por chamada, foi preciso
paginar avançando no tempo), `src/funding/contrario.ts` (threshold rolante
e CAUSAL por ativo — cada um tem faixa de funding própria, um corte
absoluto global não faria sentido).

Dois bugs reais achados construindo os testes: desigualdade não-estrita
(`>=`) fazia uma janela quase constante reabrir posição todo dia depois de
um único extremo isolado (corrigido para `>` estrita); e o desenho exige
`limiarBaixo < 0` para o lado "long" fazer sentido econômico, o que só
apareceu ao tentar testar com dado sintético mal construído (funding só
positivo nunca gera limiar negativo pra cruzar).

**Resultado, com a mesma disciplina descoberta/holdout do resto do
documento:**

| conjunto | trades | expectancy | win rate |
|---|---|---|---|
| descoberta (30 ativos) | 1.353 | -0,0017 | 50,4% |
| holdout cego (27 ativos) | 1.003 | **-0,0037** | 48,4% |

O holdout não só não confirma — piora. Win rate nos dois conjuntos fica
exatamente na faixa de moeda honesta depois do custo (não 65-70% como
`ts-momentum` e pares). Quebrando por direção no holdout: apostar CONTRA
funding muito positivo (short) tem expectancy -0,0104 — claramente
perdedor; apostar A FAVOR de funding muito negativo (long) fica em
+0,0005, essencialmente zero.

**Por que faz sentido, em retrospecto:** isto é o espelho do achado de
`ts-momentum` (item 6). Se tendência de preço persiste (o que ts-momentum
mede como real), então funding ficar elevado DURANTE uma tendência forte é
sintoma da tendência, não um sinal independente de que ela vai reverter.
"Mercado lotado de comprado" em cripto tende a continuar lotado de comprado
enquanto o preço sobe — a hipótese de fragilidade não se confirma nos dados
reais deste universo.

**Código:** `src/data/funding-history.ts`, `src/funding/contrario.ts`,
`npm run download-funding` (ou `node src/cli/download-funding.ts`).

---

## Resultado 10 — Alvo largo em `ts-momentum`: a primeira MELHORIA real da sessão

Depois de nove tentativas de achar mecanismo novo, esta foi diferente:
refinar a UM achado que já tinha vantagem estatística provada, em vez de
começar do zero.

**A pista.** A distribuição de R-múltiplos de `ts-momentum` (com o take
fixo original, 0,40) mostrava os vencedores travados quase no mesmo ponto:
p95=3,29R, p99=3,31R — praticamente idênticos. Essa é a assinatura de um
TETO ARTIFICIAL, não de uma cauda que a estratégia deixou correr. Numa
estratégia de tendência, capar o alvo em 40% contradiz a própria tese
(tendência persiste).

**Primeira tentativa, errada: trailing stop.** Tentei deixar os vencedores
correrem com um stop móvel em vez de alvo fixo — mesma ideia que já tinha
falhado no `trend-rider` (docs, item 4). Falhou de novo, pelo mesmo motivo:
o trailing fecha posições MEDIANAS cedo demais numa correção normal antes
delas reverterem, mesmo armando só para trades excepcionais (>90% de
lucro): holdout caiu de 0,065 para 0,017.

**Segunda tentativa, certa: alvo fixo mais largo.** Sem trailing — só um
gatilho de saída mais distante, que não sofre do problema de fechar
prematuramente numa correção (é um limiar simples, não um mecanismo que
ratcheia). Varrendo takePct de 0,30 a 15,0:

| takePct | descoberta | holdout |
|---|---|---|
| 0,40 (original) | 0,0181 | 0,0645 |
| 1,5 | 0,0334 | 0,0785 |
| 3,0 | 0,0398 | 0,0861 |
| **5,0 (platô)** | **0,0455** | **0,0899** |
| 8,0+ | 0,0415 | 0,0809 |

Melhora monótona até 5,0, onde estabiliza (quase nenhum trade chega tão
longe — a saída passa a ser dominada por stop ou timeout, o take vira rede
de segurança rara em vez do mecanismo principal).

**Robustez ano a ano** (5 janelas de 1 ano dentro dos 5 anos de dado, take
antigo vs novo): melhora ou empata em 4 de 5 anos — só um ano ruim para as
duas versões, sem inversão de sinal em nenhum.

**Validação completa com o take novo** (`npm run momentum`): 37 de 57
positivos (65%), holdout 70% contra 60% da descoberta — não caiu, mesmo
padrão saudável de sempre. p=0,017.

**Risco de liquidação, checado de novo com os novos parâmetros** (mesma
disciplina que revelou o problema em pares): a 1x, só 0,06% dos trades
liquidariam — negligível, quase idêntico ao original. `ts-momentum` nunca
teve esse ponto cego (diferente de pares) porque o dimensionamento por
risco fixo já mantinha o notional pequeno o bastante.

**Bootstrap final, no cenário mais seguro (1x, risco 5%/operação):**

| métrica | antes (take=0,40) | **depois (take=5,0)** |
|---|---|---|
| chance de chegar à meta | 23,8% | **28,6%** |
| chance de quebrar | 55,6% | 58,1% |
| tempo mediano | 2,4 anos | 2,0 anos |

**É o melhor número que este projeto já produziu.** Não resolve — 58% de
chance de perder os US$ 200 continua sendo o resultado mais provável — mas
é uma melhoria real, medida, robusta a 3 checagens independentes (grade
completa, ano a ano, liquidação), não mais uma variação sem efeito.

**Código:** `src/strategies/index.ts` (`tsMomentum`, parâmetro `useTrail`
opcional, desligado por padrão), `src/validate/grids.ts`,
`src/data/momentum-universe.ts` (`PARAMS_VALIDADOS` atualizado).

---

## Resultado 11 — Risco adaptativo: a mesma vantagem, alocada melhor

O Resultado 10 melhorou o MECANISMO da estratégia (o take profit). Este
melhora a GESTÃO DE CAPITAL em cima do mesmo mecanismo — sem mudar a
estratégia, sem novo dado, só decidindo melhor QUANTO arriscar em cada
operação.

**O problema com fração fixa.** A tabela de risco (1% a 30%) testa um
número CONSTANTE em toda a trajetória. Isso trata "1200 operações pela
frente, capital baixo" e "poucas operações restantes, ainda longe da meta"
como a mesma situação — e não são.

**A solução: política resolvida por programação dinâmica.** Em vez de um
número fixo, `resolverPoliticaOtima` (`src/backtest/dp-risco.ts`) acha, por
indução reversa sobre uma grade de (capital × tempo restante), a fração de
risco que maximiza a chance de chegar à meta em CADA combinação possível.
A distribuição usada na indução é um histograma quantílico dos R-múltiplos
reais (250 baldes — poucos baldes achatam a cauda direita gorda e o
resultado fica artificialmente pior que a fração fixa, o que foi de fato o
que aconteceu na primeira tentativa com 40 baldes; com resolução fina o
resultado se inverte e passa a bater a fração fixa).

**Validação com holdout** (a mesma disciplina de sempre — a política nunca
pode ver os dados em que é avaliada): resolvida só com os 3427 trades da
DESCOBERTA, avaliada só com os 3394 trades do HOLDOUT, 5 sementes:

| | fração fixa (5%, melhor) | política adaptativa |
|---|---|---|
| chance de sucesso | 43,0–43,5% | **51,5–52,6%** |
| chance de quebra | 43,6–44,5% | **42,1–42,9%** |

Melhora nos DOIS eixos ao mesmo tempo — mais sucesso E menos ruína. Isso é
o sinal mais forte possível de que o ganho é real: se fosse a DP se
ajustando a ruído do próprio conjunto de treino, o holdout teria mostrado
regressão em pelo menos um dos dois.

**Número final, com o pool completo (todos os 6821 trades, mesmo padrão
que o resto deste arquivo usa para os números "de produção"):**

| | fração fixa (5%, melhor) | **política adaptativa** |
|---|---|---|
| chance de chegar à meta | 31,0% | **37,2–37,6%** |
| chance de quebrar | 54,8% | 54,9–55,4% (igual, dentro do ruído) |
| ainda tentando ao fim do horizonte | 14,2% | 7,6% |

**O formato da política:** arriscar pouco (2%) na maior parte da
trajetória — deixa a expectância positiva compor com menos variância
desperdiçada — e só aumentar o risco (até ~8%) perto do fim do horizonte,
SE ainda não tiver chegado à meta. Faz sentido: com muito tempo de sobra, a
composição lenta já é suficiente; é só quando o relógio aperta que vale a
pena trocar segurança por velocidade.

**Reproduzir:** `npm run desafio` (seção "RISCO ADAPTATIVO", logo após a
tabela de fração fixa do cenário ts-momentum).

**Código:** `src/backtest/dp-risco.ts` (`resolverPoliticaOtima`,
`simularComPolitica`, `riscoNaPolitica`), testado em
`src/backtest/dp-risco.test.ts`, integrado em `src/cli/desafio.ts`.

---

## Resultado 12 — CORREÇÃO: os Resultados 10 e 11 ignoravam concorrência real

Este item não é uma melhoria. É uma correção de um viés que os dois
resultados anteriores carregavam, encontrada continuando a procurar por
mais uma vantagem depois do Resultado 11 — e o "mais uma vantagem" acabou
sendo achar um problema no próprio método, não na estratégia.

**O que estava errado.** `bootstrap.ts` (e `dp-risco.ts` em cima dele)
reamostra os 6821 R-múltiplos como se cada trade fosse um sorteio
INDEPENDENTE, um de cada vez. Isso não é como `ts-momentum` roda de
verdade: medido nos dados reais, em média **54,5 das 57 posições do
universo ficam abertas ao mesmo tempo** (máximo: 57 — o portfólio está
essencialmente sempre 100% posicionado). Trades cujas janelas se
sobrepõem têm correlação real de **+0,13** (contra ~0 para pares
aleatórios sem controle de tempo) — um crash de mercado derruba várias
posições juntas, não uma de cada vez. Tratar 54 posições correlacionadas
como 54 sorteios independentes sequenciais é otimista por construção:
esconde exatamente o risco que mais importa (perda simultânea em massa).

**A correção: block bootstrap no calendário.** Em vez de reamostrar trades
individuais, `bootstrap-concorrente.ts` reamostra BLOCOS de ~63 dias
corridos — dentro de cada bloco, a simultaneidade e a correlação reais são
preservadas (é literalmente o que aconteceu naqueles 63 dias). A variação
Monte Carlo vem de quais blocos (e em que ordem) compõem os 60 meses
simulados. Cada posição arrisca uma fração PEQUENA e fixa do capital no
momento em que abre — não uma fatia grande "por operação" sequencial.

**Um bug no meio do caminho, pego antes de virar resultado.** A primeira
versão desse filtro de blocos exigia que a SAÍDA do trade também coubesse
no mesmo bloco de 63 dias. Isso descarta desproporcionalmente os trades
LONGOS — e numa estratégia de tendência com alvo largo (Resultado 10), os
trades longos são justamente os grandes vencedores. Medido: R médio dos
trades descartados por esse filtro = **+0,48**; R médio dos mantidos =
**-0,04**. O filtro errado teria produzido um número catastroficamente
pior (quase 100% de ruína em qualquer risco) que não seria real, só um
artefato de amostra enviesada. Corrigido: o bloco é definido pela ENTRADA
do trade; a saída pode passar da borda, o trade não é cortado.

**Replay único da história real (sem bootstrap, sem ruído de amostragem —
o que literalmente teria acontecido rodando com posições concorrentes de
verdade):** em risco por posição de 0,01% a 0,2%, o capital cresce
modestamente (US$200→US$208-285 ao longo dos ~4,9 anos de dado). A partir
de ~0,3-0,5%, a variância agregada das posições correlacionadas passa a
dominar e o capital começa a cair; a partir de ~0,8% o replay único já
quebra.

**Bootstrap por blocos, risco ótimo (~0,5% por posição):**

| | fração fixa i.i.d. (Resultado 11) | **concorrência real corrigida** |
|---|---|---|
| chance de chegar à meta | 37,2–37,6% | **~9%** |
| chance de quebrar | 54,9–55,4% | **~45%** |
| ainda tentando ao fim | 7,6% | ~46% |

**Sensibilidade ao tamanho do bloco** (63 dias foi uma escolha razoável
mas arbitrária — testado 21 a 126 dias, risco fixo em 0,5%):

| dias/bloco | 21 | 42 | 63 | 90 | 126 |
|---|---|---|---|---|---|
| chance de sucesso | 14,1% | 14,0% | 8,6% | 2,9% | 1,8% |

Blocos maiores capturam mais risco de regime prolongado (ex.: o mercado
bear/choppy de 2022) mas com menos blocos totais (14 a 28), então mais
ruído de amostragem por caminho. A faixa honesta é **~2% a ~14%**, não um
número único — bem abaixo dos 37% do Resultado 11, que agora deve ser lido
como um limite superior otimista, não uma estimativa central.

**Tentativa de correção adicional testada e descartada:** freio de risco
por drawdown do portfólio (reduzir a fração arriscada quando o capital
está em queda desde o pico). Não ajudou — piora a chance de sucesso mais
rápido do que reduz a chance de ruína (ex.: risco base 0,8% com freio:
0,5-0,8% de sucesso, contra 8-9% sem freio). O motivo: o problema não é
"não reagir rápido o bastante a uma perda", é a perda ACONTECER
simultaneamente em dezenas de posições antes que qualquer freio reativo
tenha chance de agir.

**O que isso muda:** os Resultados 10 e 11 continuam válidos como
melhorias RELATIVAS (alvo largo é melhor que alvo estreito; risco
adaptativo é melhor que risco fixo, dentro do mesmo modelo) — mas o número
ABSOLUTO de chance de sucesso que eles produziam era otimista por ignorar
concorrência. A busca continua a partir da faixa corrigida (~2-14%), não
dos 37% anteriores.

**Reproduzir:** `npm run desafio` (seção "CENÁRIO CORRIGIDO: ts-momentum
com CONCORRÊNCIA REAL"). `--blocoDias` e `--caminhosConcorrente` ajustam a
granularidade e o número de caminhos.

**Código:** `src/backtest/bootstrap-concorrente.ts`
(`construirBlocos`, `simularPortfolioConcorrente`, `replayHistoricoReal`),
testado em `src/backtest/bootstrap-concorrente.test.ts` (inclui teste de
regressão que prova que a correlação intra-bloco aumenta ruína de verdade
— se um refactor futuro voltar a tratar blocos como i.i.d., esse teste
quebra), integrado em `src/cli/desafio.ts`.

---

## Resultado 13 — Quatro tentativas de mitigar a concorrência, todas descartadas

Continuando a busca a partir do Resultado 12 (~9% de sucesso / ~45% de
ruína no risco ótimo), testei quatro formas de atacar diretamente o
problema identificado (54 posições correlacionadas abrindo juntas). As
quatro foram implementadas e medidas no mesmo bootstrap por blocos —
nenhuma superou a fração fixa simples.

**1. Orçamento de risco total dividido pelas posições abertas** (em vez de
cada posição arriscar uma fatia fixa, um orçamento total é dividido pelo
número de posições abertas no momento — reduz automaticamente cada posição
quando o mercado está "lotado" de sinais correlacionados). Resultado:
10,1% sucesso / 43,5% ruína no orçamento ótimo (20%) — dentro do ruído do
resultado com fração fixa (9,3%/44,7%). Não ajuda porque, com ~54 posições
tipicamente abertas, `orçamento/N` já converge para quase o mesmo valor que
uma fração fixa a maior parte do tempo.

**2. Teto rígido de posições concorrentes** (nunca deixar mais que K
posições abertas ao mesmo tempo, com o mesmo orçamento total de risco).
Piorou — de 9,6% sucesso/46,1% ruína sem teto para 7,2%/85,9% com teto de
3. Motivo: um teto baixo concentra o mesmo orçamento em menos apostas
maiores, removendo a diversificação que a própria concorrência (mesmo
correlacionada a +0,13) ainda oferecia.

**3. Freio por drawdown do portfólio** (reduzir o risco quando o capital
cai desde o pico — já reportado no Resultado 12, repetido aqui pelo
contexto). Falha porque reage tarde: quando o drawdown aparece, as
posições que causaram a perda correlacionada já foram abertas no tamanho
antigo.

**4. Freio por resultado realizado recente** (pausar novas entradas
quando a média móvel dos últimos K trades fechados fica abaixo de um
limiar — mais rápido que o freio por drawdown, porque não depende de
acumular perda no capital). Falhou de um jeito diferente: é gatilho
demais. A variância de um R individual é alta (desvio-padrão ~1,9), então
a média de 5 a 20 trades fica negativa com frequência mesmo em períodos
calmos — o freio pausa a estratégia quase o tempo todo (sucesso E ruína
caem para perto de 0%, a estratégia simplesmente para de operar).

**Conclusão:** os ~9% de sucesso / ~45% de ruína do Resultado 12 não são
um artefato de como o risco é dimensionado — são um platô real para esta
estratégia dado o nível de correlação medido entre as 57 posições. Escapar
dele exigiria reduzir a correlação de verdade (universo mais diversificado
fora de cripto, ou um sinal que discrimine crash sistêmico de sinal
individual ANTES do trade abrir, não depois) — não apenas outro jeito de
alocar o mesmo risco entre os mesmos trades correlacionados.

**Também confirmado nesta rodada:** o alvo largo do Resultado 10
(`takePct=5.0`) continua sendo melhor que o original (`takePct=0.40`)
mesmo sob o modelo de concorrência corrigido — em todo nível de risco
testado, sucesso maior e ruína menor (ex.: a 0,5%/posição, 8,6%/46,8%
contra 6,5%/53,1%). A melhoria do Resultado 10 é real e sobrevive à
correção do Resultado 12; não é a causa do problema de concorrência.

Nenhum código novo — as quatro tentativas foram descartadas antes de
qualquer uma justificar formalização.

---

## Resultado 14 — Portfólio misto (momentum + pares): a saída real do platô

Depois de quatro tentativas descartadas de realocar risco DENTRO da mesma
estratégia (Resultado 13), esta funcionou porque ataca a causa raiz:
diversificação de verdade exige um mecanismo estruturalmente diferente, não
outro jeito de dividir o mesmo risco entre os mesmos trades correlacionados.

**A ideia.** Pares cointegrados sozinho não escala — só fica com
expectância positiva a 1x de alavancagem (Resultado 7), lento demais para
a meta sozinho. Mas pares é MERCADO-NEUTRO: aposta na convergência de um
spread entre dois ativos, não na direção do mercado. Um crash sistêmico
(que derruba dezenas de posições de momentum juntas, Resultado 12) afeta
pares de um jeito diferente — as duas pernas se movem juntas na maioria
dos casos, o spread continua fazendo sentido.

**Medido:** correlação entre trades de momentum e trades de pares que se
sobrepõem no tempo = **+0,065** — menos da metade da correlação interna do
momentum (+0,130, Resultado 12). Pares não é independente de momentum
(ambos são cripto), mas é BEM menos correlacionado que momentum consigo
mesmo.

**Uma armadilha no caminho, pega antes de virar resultado.** Um teste
inicial sem a correção de liquidação de pares (Resultado 7) mostrou
sucesso de até 41,9% em risco de pares alto (30%) — parecia bom demais.
Era: em 30% de risco por posição, com `PARES_SIMULTANEOS_MEDIO=6,6`, a
alavancagem implícita é `0,30×6,6≈2x` — exatamente a faixa onde o
Resultado 7 já tinha mostrado a expectância de pares virar NEGATIVA por
liquidação. Sem a correção, o retorno cru de `backtestPar` (que assume que
toda posição chega ao desfecho natural) inflava o resultado do mesmo jeito
que já tinha acontecido uma vez antes com pares sozinho. Corrigido
aplicando `distanciaLiquidacaoPorPerna` dinamicamente por trade, dado o
risco testado — depois da correção, risco de pares acima de ~15-20%
(alavancagem >1-1,3x) volta a piorar o resultado, como esperado.

**Número final** (universo completo, block bootstrap, alavancagem de pares
sempre <1x — dentro da faixa seguramente validada no Resultado 7):

| combinação | chance de sucesso | chance de quebra |
|---|---|---|
| só momentum (Resultado 12, baseline) | ~9-10% | ~44-46% |
| momentum 0,35% + pares 5% | ~10,5% | **~14-16%** |
| momentum 0,4% + pares 5% | ~11,5-11,8% | ~23-25% |
| momentum 0,5% + pares 5% | ~12,6-12,8% | ~40-42% |

Melhora em AMBOS os eixos ao mesmo tempo, robusto em múltiplas sementes —
o mesmo tipo de sinal que confirmou o Resultado 11. O ponto mais defensável
depende do apetite a risco: `momentum 0,35% + pares 5%` corta a chance de
quebra em dois terços (46%→15%) mantendo a chance de sucesso praticamente
igual; `momentum 0,5% + pares 5%` melhora sucesso em ~30% relativo mantendo
a quebra igual à baseline.

**Reproduzir:** `npm run desafio` (seção "PORTFÓLIO MISTO").

**Código:** `src/backtest/portfolio-misto.ts` (`construirBlocosMistos`,
`simularPortfolioMisto` — correção de liquidação de pares aplicada
dinamicamente por trade, dado o risco testado), testado em
`src/backtest/portfolio-misto.test.ts` (inclui teste de regressão que
prova que a diversificação reduz ruína de verdade, e que a correção de
liquidação dispara quando deveria). `src/pairs/validado.ts` ganhou
`poolComTempo()` (trades de pares com timestamps reais, para bootstrap por
calendário) e `ResultadoPares.tempos`, aditivo — não muda nenhum resultado
existente. Integrado em `src/cli/desafio.ts`.

---

## Resultado 15 — Basis trade: fecha a lacuna de dado que `basis.ts` deixava em aberto

`src/funding/basis.ts` documentava explicitamente uma lacuna: os números ali
("payback em N horas") dizem quanto tempo um funding favorável PRECISARIA
viver pra cobrir o custo, não quanto tempo ele COSTUMA viver de verdade —
"as duas coisas são diferentes, e só a segunda decide se vale a pena".

Usando o histórico de funding já baixado (57 ativos, o mesmo do Resultado 9),
reconstruí ciclos causais reais: entra quando o funding atual E a média
móvel de 6 períodos (~2 dias) são positivos, sai quando o funding vira
negativo ou estoura 30 períodos (~10 dias).

**10.977 ciclos reais, duração média 2,4 dias:**

| | valor |
|---|---|
| funding bruto capturado (médio) | +0,051% por ciclo |
| custo de ida e volta (2 pernas × entrada/saída) | 0,300% por ciclo |
| expectância líquida | **-0,249%** |
| win rate | 2,3% |

O funding bruto é ~6x MENOR que o custo de round-trip — não é um resultado
marginal, é estrutural: ciclos de funding favorável, na prática, não vivem
tempo suficiente pra cobrir nem de longe o custo de abrir e fechar as duas
pernas. Confirma quantitativamente, com dado real de persistência (que
antes não existia), a decisão original do projeto (do início desta sessão)
de abandonar funding arb como caminho — e explica por que: o problema nunca
foi escala, foi a própria unidade econômica do ciclo.

Diferente de pares (Resultado 14), que tinha expectância PEQUENA MAS
POSITIVA e por isso serviu como diversificador mesmo sem escalar sozinho,
basis trade tem expectância NEGATIVA — misturar um fluxo com expectância
negativa não reduz risco de portfólio, só dilui retorno. Descartado como
candidato a terceiro fluxo, sem precisar formalizar em código de produção.

---

## Resultado 16 — Cruzamento com trader.dev: `body-breakout` não sobrevive a custo taker, confirmado por dois motores independentes

Fecha o item B1 do backlog ("rodar lá e cruzar com o meu"), pendente desde o
início do projeto porque a chave de API dependia do usuário.

**Primeira tentativa — divergência alarmante.** Rodei `body-breakout` (regra
exata: `SMA(bodyFraction,10)>0.5`, `close>SMA(close,100)`, rompimento de 20
barras, stop 1,5%/take 3%) em BTCUSDT 4h (ago/2021–ago/2026) no engine do
trader.dev (paridade TradingView, comissão forçada em 0,05%, sizing 100% do
equity): **retorno −2,1%, PF 0,98, 197 trades, win rate 26,4%**. Isso
contradizia tanto o Resultado 3 deste documento (BTC 4h, walk-forward
aprovado, +15,7%) quanto o número alegado no vídeo original ("validado no
trader.dev pelo próprio autor": +112%, PF 1,71, 65 trades).

**Investigação, não conclusão precipitada.** Rodei o motor próprio
(`npm run backtest -- --exchange binanceusdm --symbol BTC/USDT:USDT
--timeframe 4h --strategy body-breakout`) nas duas configurações de custo:

| Preset de custo | Trades | PF | Retorno | Win rate |
|---|---|---|---|---|
| `binance-futures-maker` (0,02%/lado) | 145 | 1,093 | +4,71% | 37,9% |
| `binance-futures` (0,05%/lado, **taker**) | 145 | **0,992** | **−0,40%** | 37,2% |
| trader.dev (0,05%/lado forçado, engine independente) | 197 | **0,98** | **−2,1%** | 26,4% |

**A divergência não era bug de tradução Pine — era comparar maker com
taker.** O Resultado 3 original (+15,7%, "aprovado") usava o preset maker,
mais barato. Colocando o motor próprio no MESMO custo que o trader.dev força
(taker, 0,05%/lado), os dois motores — implementados de forma totalmente
independente, um em TypeScript próprio, outro em Pine Script v6 rodando
noutro provedor — **convergem para a mesma conclusão: profit factor em
torno de 0,99, retorno essencialmente zero ou negativo.**

A contagem de trades ainda diverge (145 vs. 197) — provavelmente por causa
do timing de preenchimento (o motor próprio executa o sinal na ABERTURA da
barra seguinte, o Pine no trader.dev fecha a ordem no FECHAMENTO da própria
barra de sinal, por `process_orders_on_close`). Não investiguei essa
diferença residual porque ela não muda a conclusão: nenhum dos dois motores,
sob custo realista, aprova a estratégia.

**Por que isso importa mais do que "mais uma estratégia reprovada".** É a
primeira vez neste projeto que uma conclusão é confirmada por uma
implementação **genuinamente independente** (outro motor, outra linguagem,
outro provedor de dado), não só por variar parâmetros dentro do próprio
código. Isso fecha com evidência concreta a ressalva #2 que já estava
registrada sem medir ("seleção adversa em ordem limite não modelada — o
preset maker é um teto otimista"): agora sabemos que, no caso de
`body-breakout` BTC 4h, esse teto otimista era a diferença inteira entre
"aprovado" e "não sobrevive".

**Consequência para o backlog:** B2 ("validar `body-breakout` com mais
rigor") está resolvido — não com mais rigor dentro do mesmo método, mas com
uma fonte de validação categoricamente diferente. Fechado, resultado
negativo. Não há motivo para retestar sem um mecanismo ou dado novo.

**Reproduzir:** `npm run backtest -- --exchange binanceusdm --symbol
BTC/USDT:USDT --timeframe 4h --strategy body-breakout --cost
binance-futures` (motor próprio) e `quick_backtest` via MCP trader-dev com o
Pine acima (símbolo `BTCUSDT`, timeframe `240`, mesma janela).
