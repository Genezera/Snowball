# Arquitetura

Cada módulo, por que existe, e as decisões de projeto que não são óbvias.

---

## `src/core/`

**`types.ts`** — Tipos centrais. O tipo `Signal` só carrega `side`, `stopPct`,
`takePct` e `features`. Deliberadamente não carrega preço de entrada: quem
decide o preço é o motor, na barra seguinte. Se a estratégia pudesse escolher o
preço, ela poderia escolher o passado.

**`indicators.ts`** — Todos retornam arrays alinhados ao input, com `NaN` onde
ainda não há dados suficientes. Nenhum lê `bars[j]` com `j > i`. `priorExtremes`
e `priorCloseExtremes` excluem a barra atual de propósito — incluir a própria
barra no "máximo das últimas 20" é um vazamento sutil e comum.

---

## `src/data/store.ts`

Download via ccxt com paginação para trás, merge com o cache e deduplicação por
timestamp. Formato JSON simples: inspecionável, sem dependência binária.

**`auditSeries()` foi escrita antes do backtester, de propósito.** Mede gaps,
cobertura, duplicatas e OHLC inconsistente (`high < max(open,close)` etc.).
Dados sujos produzem backtests bonitos e falsos, e a hora de descobrir isso é
antes de rodar 3.000 backtests em cima deles.

---

## `src/backtest/engine.ts`

O coração. Oito regras que existem especificamente para impedir o autoengano —
listadas no [README](../README.md). As três que mais mudam resultado:

**Sinal na barra `i` executa na abertura da barra `i+1`.** Sem isso, a
estratégia negocia dentro da barra que usou para decidir, e todo backtest fica
lucrativo.

**Ambiguidade intrabar resolvida pelo stop.** Quando `high` toca o alvo e `low`
toca o stop na mesma barra, não há como saber a ordem sem dados de tick.
Assumimos o stop. É o único erro cujo lado otimista quebra conta de verdade.

**Gap além do stop sai na abertura, não no stop.** Se a barra abriu abaixo do
stop, você não foi executado no stop — foi executado pior. Backtests que ignoram
isso subestimam a cauda esquerda.

**`sizePosition()`** merece atenção. O tamanho é escolhido para que tocar o stop
custe exatamente `riskPerTrade` do equity **incluindo taxas e slippage dos dois
lados**. Ignorar o custo nessa conta faz o risco real ser maior que o alvo, o
que é como o plano de risco silenciosamente deixa de valer. É também daqui que
sai a bola de neve: o notional cresce com o equity sozinho e encolhe sozinho
numa sequência ruim.

---

## `src/backtest/metrics.ts`

Além das métricas usuais:

**`deflatedSharpe()`** — Se você testou 864 combinações e escolheu a melhor, o
Sharpe encontrado está inflado por sorte pura. Isto corrige (Bailey & López de
Prado). Abaixo de ~0,90 de probabilidade, o "edge" é ruído.

**`riskOfRuin()`** — Simulação com LCG determinístico: o mesmo backtest sempre
dá o mesmo número, o que evita a tentação de rerodar até sair um número bonito.

**`feesAsPctOfGross`** — A métrica mais reveladora do projeto. Quando passa de
100%, a estratégia só existe sem custo. Foi ela que expôs o problema inteiro.

---

## `src/strategies/index.ts`

As 5 do vídeo, com as regras exatas transcritas das capturas de tela — não da
transcrição em texto, que tem erros. Ver [ESTRATEGIAS.md](ESTRATEGIAS.md).

Indicadores são pré-calculados uma vez por série via `WeakMap`, e `onBar` só lê
a posição `i`. É isso que permite varrer 864 combinações × 6 folds em segundos.

Cada sinal grava `features` — as mesmas que o ML consome depois. Ter isso desde
o início evitou refazer o pipeline quando o ML entrou.

---

## `src/validate/`

**`walkforward.ts`** — Fatia o histórico em blocos; em cada um, otimiza usando
só a janela in-sample anterior e opera o bloco seguinte com parâmetros
congelados.

Dois detalhes que importam:

- O equity é **composto entre folds**. É assim que a bola de neve realmente se
  comportaria, e é assim que um drawdown no fold 2 encolhe as posições no fold 3.
- A janela out-of-sample recebe 300 barras de aquecimento antes do seu início,
  para que os indicadores já estejam válidos na primeira barra negociável.

**`objective()`** não usa retorno total de propósito. Retorno total premia a
combinação que pegou um rally, não a que tem edge. Usa expectancy ponderada pela
raiz do número de trades e penalizada por drawdown.

**`montecarlo.ts`** — A curva de equity de um backtest é UM caminho entre
milhões. Dois modos: `shuffle` (mesma distribuição, ordem diferente — "e se a
sorte tivesse vindo em outra ordem?") e `bootstrap` (reamostragem — "e nos
próximos N trades?").

**`grids.ts`** — Grades deliberadamente pequenas. Grade de 5.000 combinações não
produz estratégia melhor, produz overfit mais convincente. Os valores originais
do vídeo estão sempre dentro da grade, para que o walk-forward possa escolhê-los
se forem realmente os melhores.

---

## `src/ml/`

**`gbdt.ts`** — Gradient boosting escrito do zero. Por quê, em vez de uma
biblioteca: o dataset é pequeno (centenas a milhares de trades) e tabular,
árvores impulsionadas são o estado da arte nesse regime, e a implementação
inteira cabe em um arquivo sem adicionar dependência binária. Folhas usam passo
de Newton (`-g/h`), que é o que dá a qualidade do XGBoost. Cortes por quantis,
não por todos os valores únicos — mais rápido e menos propenso a decorar um
valor específico. Ganho mínimo positivo obrigatório para criar um split.

**Nada de rede neural.** Com ~800 exemplos e 11 features, uma rede decora.

**`metalabel.ts`** — A ideia central: não tente prever o mercado. Deixe a
estratégia decidir a **direção** e use o ML só para decidir **se vale a pena
tomar** o trade. Isso vira um problema de classificação binária com rótulo
objetivo.

`purgedWalkForwardCV()` — Trades se sobrepõem no tempo, então um split ingênuo
vaza futuro para o treino. **Purge** remove do treino todo trade cuja saída
invade o período de teste; **embargo** remove uma margem extra.

`pickThreshold()` exige um mínimo de trades retidos, senão o otimizador escolhe
um limiar que sobreviveu por ter 8 amostras.

---

## `src/risk/capital.ts`

Responde matematicamente "qual o mínimo possível" — a pergunta original do
projeto.

A restrição real não é o depósito mínimo da exchange. É: `notional = risco ×
equity / distância ao stop`. Com equity pequeno demais, esse número fica abaixo
do notional mínimo. Aí sobram duas opções ruins: não operar, ou operar com risco
maior que o planejado. **A segunda é como contas pequenas morrem.**

`simulateSnowball()` modela os dois freios que nenhum vídeo menciona: trades
perdidos quando a conta é pequena demais para o notional mínimo, e a redução
automática de tamanho durante drawdown, que atrasa a recuperação.

---

## `src/live/executor.ts`

Três modos em progressão obrigatória: `paper` (nenhuma ordem sai) → `testnet` →
`live` (exige `--i-understand`).

**A regra que mais importa:** só age em barras **fechadas**. Uma barra de 5min
em formação muda de forma e dispara sinais que depois desaparecem. É o bug
número um de bot de scalping, e ele faz o robô ao vivo divergir do backtest de
maneira inexplicável.

Estado persistido em disco: reiniciar o processo não ressuscita uma posição
fantasma nem esquece uma real. Chaves de API só via variável de ambiente, nunca
no código.

---

## `src/mcp/server.ts`

Expõe o laboratório como ferramentas MCP. **Nenhuma ferramenta devolve "retorno
total" sozinho** — toda resposta vem com o custo pago, o drawdown, e no caso do
walk-forward um veredito com os motivos da reprovação por extenso. Deliberado:
tornar difícil se enganar, não fácil se animar.

---

## `tools/`

**`traderdev.mjs`** — Cliente MCP falando SSE direto com o trader.dev. Existe
porque servidores MCP só são conectados na inicialização do Claude Code; este
script permite usar a base sem reiniciar nada.

**`td-screen.mjs`** — Peneira para o leaderboard deles. Varre vários eixos de
ordenação, coleta centenas de backtests e filtra do lado do cliente por janela
de avaliação, número de trades e plausibilidade física. Necessário porque os
filtros da API não conseguem separar sinal de artefato — a janela de avaliação
não é filtrável, e o topo do ranking por Sharpe são backtests de 10 dias com
Sharpe 17. Ver [MCP.md](MCP.md).
