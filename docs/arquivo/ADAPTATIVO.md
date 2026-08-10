# ML adaptativo: seletor de estratégia por regime

> **📦 Arquivado — pré-refactor.** Este documento descreve a fase anterior do projeto (pesquisa multi-estratégia: backtest, 5 estratégias, ML meta-labeling, pares/momentum ao vivo, Auditor, servidor MCP local). Boa parte do código citado aqui foi removida no refactor de 2026-08 que focou o projeto só em funding-arb de 2 exchanges. Mantido como histórico/registro de decisões — não reflete o estado atual. Para o estado atual, ver [CONTEXTO.md](../../CONTEXTO.md) e [README.md](../../README.md).


Registro completo da tentativa de construir o sistema que você descreveu — um
ML que lê o mercado em tempo real e aplica a melhor estratégia do momento.

**Resultado curto:** metade funciona, metade não. A parte que funciona é útil e
já está em produção no código. A parte que não funciona está documentada aqui
como resultado negativo, e não foi ajustada até passar.

---

## A ideia

As 5 estratégias não são intercambiáveis. `momentum-breakout` e `body-breakout`
seguem tendência — precisam que o mercado **ande**. `zscore-dip` e `vwma-dip`
são reversão à média — precisam que ele **volte**. Rodar todas o tempo todo
significa que metade está sempre no ambiente errado, pagando taxa para
descobrir isso.

A pergunta que o modelo tenta responder **não** é "o preço vai subir?". É "o
mercado agora premia continuação ou premia reversão?" — pergunta muito mais
fácil e muito mais estável.

## As features de regime

Implementadas em [`src/ml/regime.ts`](../src/ml/regime.ts). A principal:

**Efficiency Ratio de Kaufman.** Numerador: quanto o preço andou em linha reta
em n barras. Denominador: quanto ele andou no total, somando cada passo. Perto
de 1 = tendência limpa. Perto de 0 = serrote. É exatamente a distinção entre o
ambiente que paga breakout e o que paga reversão.

Mais: autocorrelação de retornos (momentum vs reversão, medida diretamente),
razão de volatilidade curta/longa (expandindo vs contraindo), distância do preço
à média em unidades de ATR, assimetria realizada, razão de volume, e ciclos de
hora/dia.

---

## Tentativa 1 — falha instrutiva

Pool aberto: qualquer estratégia podia ser escolhida. Limiar de entrada: R
esperado > 0.

**Resultado em BTC 4h: −39,3%**, contra +9,6% da melhor isolada.

A causa está nos dados de uso: o alocador escolheu `ma-cross` em **753 de 944
trades** — justamente a estratégia que falha em todos os mercados e timeframes
já testados.

Dois defeitos estruturais:

1. **Viés de frequência.** `ma-cross` é uma regra de *estado*, não de evento —
   sinaliza em quase toda barra. Ela lota o conjunto de candidatos e ocupa a
   posição, enquanto `vwma-dip` (que tinha expectancy +0,732R) quase nunca tem
   vez.
2. **Pedir a um modelo que "cronometre" uma estratégia sem edge nenhum é pedir
   o impossível.** Nenhuma quantidade de timing conserta ferramenta quebrada.

---

## A correção que funcionou: o portão de pool

Duas travas, ambas decididas **apenas com dados de treino**:

| Portão | Regra | Por quê |
|---|---|---|
| Expectancy de treino | a estratégia precisa ter expectancy ≥ +0,02R **sozinha** na janela de treino para entrar no pool | o alocador escolhe entre ferramentas que funcionam; não conserta as quebradas |
| AUC do modelo | treina em 75% do treino, mede AUC nos 25% finais; abaixo de 0,52 o modelo não vota | modelo que não distingue trade bom de ruim não deve ter voz |

**Efeito: −39,3% → +5,4% em BTC.**

E o portão faz exatamente o que deveria: excluiu `ma-cross` em todos os ativos e
todos os folds, e selecionou `momentum-breakout` e `body-breakout` — que são,
comprovadamente, as duas que funcionam ([RESULTADOS.md](RESULTADOS.md)).

**As AUCs subiram para 0,54–0,75**, contra 0,53–0,55 do meta-labeling por
estratégia em 5 minutos. As features de regime são genuinamente informativas —
esse é um achado real.

---

## Resultado final: o alocador perde em 5 de 5

Walk-forward, 4 folds, custo maker, treino usando apenas trades cuja saída
ocorreu antes do início da janela de teste.

| Ativo | Alocador | Melhor isolada | Diferença |
|---|---|---|---|
| BTC | +5,4% | vwma-dip +9,6% *(24 trades)* | perde |
| ETH | +34,3% | momentum-breakout **+56,3%** | perde |
| SOL | −1,6% | vwma-dip −0,6% *(12 trades)* | empata mal |
| TRX | +13,9% | body-breakout +18,0% | perde |
| DOT | −4,9% | momentum-breakout +12,6% | perde |

**O diagnóstico decisivo está no ETH.** Lá o alocador escolheu
`momentum-breakout` — a estratégia certa, a melhor do ativo — e ainda assim
entregou +34,3% contra os +56,3% que ela faz sozinha. Ou seja: **o filtro por
trade está removendo trades lucrativos.**

Em BTC o mesmo filtro ajudou (+4,1% → +5,4%, com 33% menos trades). Em ETH
atrapalhou muito. Efeito inconsistente entre ativos é a assinatura de ruído, não
de edge.

---

## O que se aprende, separando as duas camadas

O experimento tem duas camadas independentes, e elas têm veredictos opostos:

| Camada | Pergunta | Veredito |
|---|---|---|
| **Seleção de estratégia** | qual estratégia rodar neste mercado? | **funciona** — o portão de expectancy identifica corretamente as que prestam e descarta `ma-cross` em 100% dos casos |
| **Filtro por trade** | tomar ou não este sinal específico? | **não funciona** — melhora num ativo, piora em outro |

Isso é consistente com o resto do projeto: decisões de baixa frequência e alta
estrutura (qual timeframe, qual estratégia, qual mercado) são onde está o
retorno. Decisões de alta frequência (tomar ou não este trade) são onde está o
ruído.

**Uma ressalva sobre a comparação.** "Melhor isolada" é escolhida com o
benefício da retrospectiva sobre toda a janela out-of-sample. Na vida real você
não sabe qual será. O portão de pool **sabe** — ele apontou
`momentum-breakout`/`body-breakout` usando só dados passados, e acertou. Então a
camada de seleção tem valor preditivo real mesmo com o alocador completo
perdendo.

Além disso, `vwma-dip` "ganha" em BTC e SOL com **24 e 12 trades**. Expectancy
de 0,732R em 24 amostras não é resultado, é ruído.

---

## Um bug que inverteu as decisões (e a lição dele)

Ao transformar o portão em ferramenta, ele produziu um resultado absurdo no DOT:
`momentum-breakout` com expectancy **+0,198R e +22,6%** ficou **fora** do pool,
enquanto `body-breakout` com **+0,041R** entrou.

**Causa.** O teste de AUC só rodava quando havia amostra suficiente
(`cut > 60`). Com 70 trades, `body-breakout` escapava do teste inteiro e passava
com AUC nominal 0,50. Com 194 trades, `momentum-breakout` era testada de verdade
— e reprovava. **Estratégias com menos dados passavam por não serem
examinadas.** É o oposto do que um portão deve fazer.

**Correção.** As duas perguntas estavam indevidamente acopladas. Separadas:

| Pergunta | Depende de |
|---|---|
| a estratégia entra no pool? | expectancy dela sozinha no treino |
| o modelo de ML tem voto? | AUC medida em holdout |

Quando não há amostra para medir AUC, `modelTrusted = false` e o alocador usa a
taxa-base histórica da estratégia em vez de uma previsão não verificada. A
estratégia continua elegível — ela passou no portão que importa — mas um modelo
não auditado não decide por ela.

Na prática quase nenhuma estratégia recebe o selo `+ML`, o que é exatamente
coerente com o resultado principal: a seleção funciona, o filtro por trade não.

---

## Saída atual da ferramenta

`node src/cli/pool.ts` sobre os últimos 540 dias em 4h:

| Ativo | Regime atual | Recomendação |
|---|---|---|
| ETH | misto-calmo | momentum-breakout |
| SOL | lateral-calmo | body-breakout |
| DOT | lateral-calmo | momentum-breakout, body-breakout |
| BTC | lateral-calmo | **não operar** |
| TRX | misto-calmo | **não operar** |

Que BTC e TRX apareçam vazios é um bom sinal, não um defeito: significa que o
portão não força uma recomendação quando os dados recentes não a sustentam.

---

## O que está em produção

**Em uso:** o portão de pool. A regra prática que sai daqui é:

> Rode `momentum-breakout` ou `body-breakout` em 4h. Reavalie o pool a cada
> trimestre com `trainAllocator` sobre a janela mais recente. Se uma delas
> perder a expectancy positiva no treino, tire-a do ar.

**Não está em uso:** o filtro por trade. O código existe
([`src/ml/allocator.ts`](../src/ml/allocator.ts),
[`src/backtest/multi.ts`](../src/backtest/multi.ts)) e é reexecutável a qualquer
momento, mas não deve receber dinheiro enquanto o efeito for inconsistente entre
ativos.

```bash
node src/cli/adaptive.ts --symbol "BTC/USDT:USDT" --timeframe 4h
```

---

## O que tentaria a seguir

Em ordem de promessa, e nenhuma testada ainda:

1. **Alocador de portfólio em vez de seletor.** Em vez de escolher UMA
   estratégia por barra, rodar as aprovadas em paralelo com risco dividido. A
   perda de retorno do alocador vem de ficar de fora de trades bons; um
   portfólio não tem esse problema.
2. **Regime no nível macro, não por trade.** Decidir o pool uma vez por semana
   em vez de a cada barra. Reduz drasticamente as chances de sobreajuste e é
   coerente com a lição de que o retorno está nas decisões de baixa frequência.
3. **Mais ativos no treino.** Treinar o modelo de regime com dados de todos os
   ativos juntos, em vez de um por vez, multiplica a amostra e força o modelo a
   aprender regime em vez de decorar um ativo.
