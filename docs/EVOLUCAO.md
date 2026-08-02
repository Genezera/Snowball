# Evolução do projeto

Diário cronológico. Cada entrada registra o que foi descoberto, com que
evidência, e **o que mudou no projeto por causa disso**. A ideia é que daqui a
três meses seja possível reconstruir o raciocínio inteiro sem depender de
memória.

---

## Entrada 1 — Ponto de partida e a suspeita inicial

**O material.** Um vídeo do canal DaviddTech apresentando cinco estratégias de
scalping de 5 minutos, com retornos anunciados de 103% a 5381%, mais um PDF e a
transcrição completa.

**A suspeita, antes de qualquer código.** Num scalp de 5 minutos com alvo de 3%
e stop de 1,5%, a taxa de corretagem mais o slippage consomem uma fatia enorme
da margem. Um backtest que mostra 2.396 trades e não detalha o modelo de custo
não está medindo a estratégia — está medindo o mercado.

**Decisão de projeto.** Em vez de tentar reproduzir os 5381%, construir um
backtester onde o custo é um parâmetro explícito e comparável, para que a
pergunta "quanto do resultado é edge e quanto é ausência de custo" possa ser
respondida com número em vez de opinião.

---

## Entrada 2 — Ambiente e primeira medição

**Ambiente.** Python não está instalado na máquina (só o stub da Microsoft
Store). Node.js v24 está, e tem suporte nativo a TypeScript sem etapa de build.
Decisão: Node + TypeScript. `ccxt` cobre a parte de dados de cripto.

**Dados.** 105.120 barras de 5 minutos por par (BTC, ETH, SOL), 1 ano,
cobertura 100%, zero gaps, zero OHLC inconsistente. A auditoria de integridade
foi escrita antes do backtester de propósito: dados sujos produzem backtests
bonitos e falsos.

**Primeira medição.** Rodando as cinco estratégias sob três modelos de custo:

| Custo | Momentum breakout (BTC 5m) |
|---|---|
| Zero | +12,5%, PF 1,056 |
| Binance futures (0,05%/lado) | −15,1%, PF 0,808 — **taxas = 278% do lucro bruto** |
| Stress (0,10%/lado) | −15,3%, PF 0,255 |

**O que isso ensinou.** A suspeita estava certa em direção, mas eu ainda estava
medindo a coisa errada — ver entrada 4.

---

## Entrada 3 — Walk-forward: a prova de sobreajuste

Construído o walk-forward: em cada bloco do histórico, os parâmetros são
otimizados usando **apenas** a janela in-sample anterior, e depois congelados
para operar o bloco seguinte.

**O resultado foi didático ao extremo.** `ma-cross` em SOL, 6 folds:

| Fold | In-sample | Out-of-sample |
|---|---|---|
| 0 | +0,506R | −0,103R |
| 1 | +0,145R | −0,363R |
| 2 | +0,228R | −0,204R |
| 3 | +0,796R | −0,057R |
| 4 | +0,500R | −0,044R |
| 5 | +0,201R | −0,604R |

Expectancy positiva em **todos** os 6 in-sample. Negativa em **todos** os 6
out-of-sample. Eficiência walk-forward −0,58.

**O que isso é.** É a assinatura visual do sobreajuste. A otimização encontra
parâmetros que explicam o passado e não têm nenhum poder sobre o futuro.

**O que foi adicionado por causa disso.** Sharpe deflacionado (corrige o Sharpe
pelo número de combinações testadas) e Monte Carlo (mede a distribuição de
caminhos possíveis, não o único caminho que aconteceu).

**Resultado da rodada completa:** 15 de 15 combinações reprovadas.

---

## Entrada 4 — A correção que mudou o projeto

**O que aconteceu.** Você apontou: *"se for ver o video olha na onde operou"*,
com capturas de tela. Eu estava testando BTC/ETH/SOL. O vídeo opera **F (NYSE),
COIN (NASDAQ), ALTR, DOTUSDT.P e TRXUSDT.P**.

Depois vieram cinco capturas com as **regras escritas na tela**, e elas
revelaram que eu tinha implementado três das cinco estratégias erradas — porque
a transcrição em texto estava incorreta. O caso mais grave:

- Transcrição: *"body fraction of a length of 10 that should be above 0.1"*
- Tela: `SMA(body fraction, 10) > 0.5`

E o mais conceitual: a estratégia 3 usa `EMA(range,10) > SMA(range,50)` — um
filtro de expansão de volatilidade sobre o **range do candle**, não sobre o
preço — e entra com `z ≤ −2`, ou seja, é **reversão à média**, não rompimento.
Eu tinha implementado como rompimento. Caráter oposto.

**Depois de corrigir tudo e testar em TRX perpétuo (315.360 barras, 3 anos):**

| Estratégia | PF sem custo | PF com custo taker | Taxas / lucro bruto |
|---|---|---|---|
| body-breakout | 1,229 | 1,027 | 82% |
| momentum-breakout | 1,216 | 1,004 | 97% |
| vwma-dip | 1,251 | 0,954 | 137% |
| zscore-dip | 1,184 | 0,953 | 145% |
| ma-cross | 1,091 | 0,610 | — |

**A descoberta.** Sem custo, minha implementação reproduz os números do vídeo
(PF 1,22–1,25, Sharpe 1,55–1,80). Ou seja, a portabilidade está correta **e as
estratégias têm um edge bruto real**. A aritmética é:

```
edge bruto por trade      ≈ +0,15 R
custo por trade (taker)   ≈ −0,16 R
                            --------
líquido                   ≈ −0,01 R
```

**Isso reformulou o projeto inteiro.** A pergunta deixou de ser "essa estratégia
presta?" e passou a ser **"como pagar menos de 0,15R por trade?"**. Duas
alavancas óbvias: taxa menor, ou menos trades.

---

## Entrada 5 — O que o próprio vídeo admite

Extraídos 26 frames por detecção de cena e depois 98 frames a cada 8 segundos,
cobrindo os 784 segundos completos. Três frames importam mais que o resto.

**Frame A — as estatísticas reais da estratégia dos "5381%"** (TRXUSDT.P,
Jan/2020 a Jun/2026):

- **Sharpe ratio: 0,376**
- Lucro total ≈ 280M vs perda total ≈ 215M — o resultado é a diferença pequena
  entre dois números enormes, que é a definição de frágil
- Open PnL: −652.206 USDT (posição aberta no prejuízo)

Um Sharpe de 0,376 com drawdown de 47–60% não é uma estratégia operável. O
título "5381%" e o Sharpe 0,376 são o mesmo backtest.

**Frame B — o dashboard deles mesmos** ("Incubation Library"):

- **FORWARD POSITIVE: 65 / FORWARD NEGATIVE: 59** — cara ou coroa
- **Proof state: BLOCKED**, 2 blockers, "forward maturity 12/90 days"
- **"NO live track record yet"**
- **"0/2 honest in-sample gates passing"**, "PIN1 exact costs pending"
- Aviso próprio: *não é uma alegação de edge, lucratividade, alpha validado ou
  prontidão para operar ao vivo*

A ferramenta deles classifica as próprias estratégias como *"promising —
unproven"*, sem histórico ao vivo e com os testes de custo pendentes. Isso
corrobora exatamente o resultado do meu walk-forward.

**Frame C — o leaderboard do trader.dev** (32.661 estratégias, 87.326 backtests):

- `XAUUSD Breakout v2c` em PAXGUSDT 5m: **NET P&L +172.575.181.377,48%**
- Outra: +39.315.109.724,81%
- Outra: +23.285.467.390,72%

Retorno de 10¹¹ por cento não existe — é artefato de composição. E a lista está
ordenada por *"Best profit"*, ou seja, o topo é literalmente ordenado pelo
artefato mais extremo.

**Consequência para o projeto.** O MCP trader.dev é útil como **fonte de dados**
e inútil — perigoso, na verdade — como **critério de seleção**. Um agente em
loop otimizando contra aquele leaderboard converge para lixo. Ver
[MCP.md](MCP.md).

---

## Entrada 6 — Machine learning: meta-labeling

**A ideia.** Não tentar prever o mercado. Deixar a estratégia decidir a
**direção** e usar o ML só para decidir **se vale a pena tomar** o trade. Isso
transforma um problema impossível de regressão num problema de classificação
binária com rótulo objetivo: este trade deu lucro?

**A implementação.** GBDT escrito do zero (`src/ml/gbdt.ts`): boosting com passo
de Newton nas folhas, regularização L2, subsample e colsample, cortes por
quantis. Nada de rede neural — com ~800 exemplos e 11 features, uma rede
decora. Validação por **purged walk-forward CV**: trades se sobrepõem no tempo,
então um split ingênuo vaza futuro para o treino.

**Resultado (SOL 5m, out-of-sample):**

| Estratégia | AUC médio | Expectancy sem filtro | Com filtro |
|---|---|---|---|
| momentum-breakout | 0,546 | −0,054R | **+0,066R** |
| ma-cross | 0,530 | −0,009R | **+0,066R** |

**Leitura honesta.** O filtro vira o sinal de negativo para positivo, o que é um
resultado real. Mas AUC 0,53–0,55 é fraco, e dois dos cinco folds ficaram abaixo
de 0,50. É estrutura de verdade, não é edge suficiente. Features mais usadas:
`atrPct`, `bodyFrac`, `volRatio`, `hourCos`.

**Decisão.** Não ajustar o modelo até ele passar. Isso seria exatamente o
sobreajuste que o projeto inteiro existe para detectar.

---

## Entrada 7 — A alavanca do custo: maker em vez de taker

Da entrada 4: o edge é 0,15R e o custo é 0,16R. Alavanca mais direta: **ordem
limite (maker, 0,02%/lado)** em vez de ordem a mercado (taker, 0,05% + slippage).
É 3,5× mais barato.

**Resultado em TRX 5m, 3 anos:**

| Estratégia | Retorno | CAGR | Sharpe | DD | Taxas/bruto |
|---|---|---|---|---|---|
| momentum-breakout | +50,6% | 14,6% | 1,17 | 12,6% | 36% |
| body-breakout | +40,9% | 12,1% | 1,00 | 14,3% | 40% |
| vwma-dip | +25,3% | 7,8% | 0,83 | 13,9% | 47% |

Todas viram positivas. **Mas o walk-forward com custo maker reprovou 9 de 10.**
A única aprovada foi `vwma-dip` em TRX (expectancy OOS +0,252R, eficiência 0,77,
Sharpe deflacionado 1,00) — e a **mesma** `vwma-dip` em DOT deu −0,247R. Mesma
estratégia, ativo diferente, resultado oposto. Com 10 testes, uma aprovação está
dentro do acaso.

**Ressalva estrutural sobre o preset maker.** Ordem limite nem sempre executa.
Você só é preenchido quando o preço volta até você, e portanto perde exatamente
os rompimentos que dispararam sem olhar para trás — os melhores trades. Isso é
**seleção adversa**, não está modelado em lugar nenhum, e é a razão pela qual o
preset maker é um teto otimista, não uma previsão. Só paper trading mede isso.

---

## Entrada 8 — A resposta: o timeframe estava errado

**A pista.** Num frame do vídeo aparece o Claude Code do próprio autor, com
resultados validados via MCP trader.dev:

- **BTC 4h: +112% | PF 1,71 | DD 27,5% | 65 trades | Sharpe 0,80**
- ETH 4h: +99% | PF 1,48 | Sharpe 0,67
- SOL 4h: +79% | PF 1,39 | Sharpe 0,53
- OOS 2024-26: +11,4% | PF 1,26

O único resultado crível do vídeo inteiro está em **4 horas**, não em 5 minutos.
E o agente dele se comportou honestamente: *"all rejected (honesty rule
respected)"*, *"Donchian = 0 trades, dead on arrival"*.

**Por que isso faz sentido.** O custo é um pedágio aproximadamente fixo por
trade (~0,04% a 0,14% ida e volta). O que muda com o timeframe é o **tamanho do
movimento capturado**. Em 5 minutos, um alvo de 3% é uma exceção rara e o
pedágio pesa 5–15% da margem. Em 4 horas, o mesmo pedágio é trivial diante do
movimento típico. Não é que a estratégia seja melhor — é que ela para de pagar
imposto proporcionalmente maior que o lucro.

**O teste.** Baixados 5 anos de 1h e 4h para os 5 perpétuos. Walk-forward
completo com custo maker.

**Resultado em 4h — `body-breakout` com expectancy positiva nos 5 ativos:**

| Ativo | Expectancy OOS | Retorno | DD | Eficiência WF | Veredito |
|---|---|---|---|---|---|
| BTC | +0,198R | 15,7% | 5,4% | 0,86 | **APROVADO** |
| ETH | +0,154R | 17,1% | 9,0% | 0,99 | **APROVADO** |
| TRX | +0,133R | 11,2% | 5,3% | 1,40 | **APROVADO** |
| DOT | +0,118R | 13,8% | 7,4% | 0,22 | reprovado |
| SOL | +0,042R | 4,7% | 11,4% | 0,34 | reprovado |

Também aprovados em 4h: `momentum-breakout` em BTC (+0,189R, eficiência 0,59) e
em SOL (+0,108R).

**Por que isto é diferente de tudo que veio antes.** Uma célula aprovada pode
ser sorte. **Consistência entre cinco ativos independentes com a mesma
estratégia é muito difícil de obter por acaso.** Isso é o que faltava em 5
minutos, e é o primeiro sinal estrutural do projeto.

`ma-cross` falha em todos os ativos e em todos os timeframes — o resultado mais
consistente do projeto, no sentido oposto.

**Consequência.** A premissa "bot de scalping de 5 minutos" está errada. As
mesmas regras funcionam em 4 horas porque o custo deixa de dominar.

---

## Estado atual e o que vem

O candidato é `body-breakout` em 4h. **Nada foi aprovado para dinheiro real.**

Próximos passos e ressalvas em [BACKLOG.md](BACKLOG.md). O número que mais
preocupa: foram testadas 5 estratégias × 5 ativos × 3 timeframes = 75
combinações. O Sharpe deflacionado corrige pelas combinações de parâmetro dentro
de cada rodada, mas **não** corrige por essas 75 tentativas. A consistência
entre ativos é o que sustenta o resultado, não o veredito individual.
