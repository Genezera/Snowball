# Cronologia

Registro sequencial de tudo que aconteceu no projeto, na ordem em que
aconteceu. Cada entrada tem: o que foi pedido ou descoberto, o que foi feito, o
que resultou, e o que mudou por causa disso.

Serve para reconstruir o raciocínio inteiro sem depender de memória. Onde há
número, ele veio de código deste repositório — nunca do vídeo, exceto quando
marcado como "afirmado no vídeo".

---

## Fase 1 — Fundação

### 1.1 Ponto de partida
**Pedido:** replicar o sistema do vídeo *"This Claude Fable 5-Minute Scalping
Bot"*, começando com o capital mínimo possível, fazendo bola de neve sem
quebrar. Com pesquisa, MCP de terceiros, GitHub, notícias e machine learning.

**Suspeita declarada antes de escrever código:** num scalp de 5 minutos com
alvo 3% e stop 1,5%, taxa e slippage consomem uma fatia enorme da margem. Um
backtest com 2.396 trades que não detalha o modelo de custo não está medindo a
estratégia.

**Decisão que definiu o projeto:** em vez de tentar reproduzir os 5381%,
construir um backtester onde o custo é parâmetro explícito e comparável.

### 1.2 Ambiente
Python não instalado (só o stub da Microsoft Store). Node.js v24 disponível,
com TypeScript nativo sem build. **Decisão:** Node + TypeScript, `ccxt` para
dados.

### 1.3 Dados e auditoria
Baixadas 105.120 barras de 5min por par (BTC, ETH, SOL), 1 ano. Cobertura 100%,
zero gaps, zero OHLC inconsistente.

`auditSeries()` foi escrita **antes** do backtester, de propósito: dados sujos
produzem backtests bonitos e falsos, e a hora de descobrir isso é antes de
rodar 3.000 backtests em cima deles.

### 1.4 Motor de backtest
Oito regras anti-autoengano. As três que mais mudam resultado: sinal na barra
`i` executa na abertura de `i+1`; ambiguidade intrabar resolvida pelo stop; gap
além do stop sai na abertura, não no stop.

**Primeira medição (BTC 5m, momentum-breakout):**

| Custo | Resultado |
|---|---|
| Zero | +12,5%, PF 1,056 |
| Taker 0,05% | −15,1%, PF 0,808 — **taxas = 278% do lucro bruto** |
| Stress 0,10% | −15,3%, PF 0,255 |

---

## Fase 2 — A prova de sobreajuste

### 2.1 Walk-forward
Construído: em cada bloco, parâmetros otimizados usando **apenas** a janela
in-sample anterior, depois congelados para operar o bloco seguinte.

**Resultado didático (`ma-cross` em SOL, 6 folds):** expectancy positiva em
**6 de 6** in-sample. Negativa em **6 de 6** out-of-sample. Eficiência −0,58.

É a assinatura visual do sobreajuste.

### 2.2 Ferramentas adicionadas em resposta
Sharpe deflacionado (corrige pelo número de combinações testadas), Monte Carlo
(distribuição de caminhos possíveis em vez do único caminho observado), risco
de ruína.

**Rodada completa: 15 de 15 combinações reprovadas.**

---

## Fase 3 — As correções do usuário

### 3.1 "olha na onde operou"
**Correção recebida (com capturas de tela):** eu estava testando BTC/ETH/SOL. O
vídeo opera **F (NYSE), COIN (Nasdaq), ALTR, DOTUSDT.P e TRXUSDT.P**.

Baixados TRX e DOT perpétuos, 315.360 barras de 5min, 3 anos.

### 3.2 As regras exatas
**Cinco capturas com as regras escritas na tela revelaram que eu tinha
implementado 3 das 5 estratégias erradas** — a transcrição em texto continha
erros.

| Estratégia | Eu tinha | Regra real na tela |
|---|---|---|
| 1 — momentum | `SMA(close,20) > SMA(close,50)` | `SMA(range,10) > SMA(range,50)` — filtro sobre o **range** |
| 2 — ma-cross | evento de cruzamento | **estado** (`50 > 100`) |
| 3 — z-score | `z ≤ +2` (rompimento) | `z ≤ −2` (**reversão à média**) — caráter oposto |
| 4 — body | `> 0.1` (da transcrição) | **`> 0.5`** (da tela) |
| 5 — vwma-dip | bandas de Bollinger | `VWMA(bodyfrac,10)>0.5` + `z ≤ −2` |

### 3.3 A descoberta central
Com as regras corretas em TRX perpétuo:

| Estratégia | PF sem custo | PF com taker | Taxas/bruto |
|---|---|---|---|
| body-breakout | 1,229 | 1,027 | 82% |
| momentum-breakout | 1,216 | 1,004 | 97% |
| vwma-dip | 1,251 | 0,954 | 137% |

Sem custo, minha implementação **reproduz os números do vídeo** (PF 1,22–1,25,
Sharpe 1,55–1,80). A portabilidade está correta, **e as estratégias têm edge
bruto real**. A aritmética:

```
edge bruto por trade    ≈ +0,15 R
custo por trade (taker) ≈ −0,16 R
                          --------
líquido                 ≈ −0,01 R
```

**Isso reformulou o projeto.** A pergunta deixou de ser "essa estratégia
presta?" e passou a ser **"como pagar menos de 0,15R por trade?"**.

---

## Fase 4 — Análise do vídeo

Extraídos 26 frames por detecção de cena e 98 frames a cada 8 segundos,
cobrindo os 784 segundos. Três achados decisivos:

**As estatísticas reais dos "5381%"** (TRXUSDT.P): **Sharpe 0,376**, lucro
total ≈280M contra perda total ≈215M, Open PnL −652.206 USDT. O título e o
Sharpe 0,376 são o mesmo backtest.

**O dashboard deles:** "forward positive 65 / forward negative 59" (cara ou
coroa), "Proof state: BLOCKED", "NO live track record yet", "0/2 honest
in-sample gates passing", *"promising — unproven"*.

**O leaderboard do trader.dev:** `+172.575.181.377,48%` em PAXGUSDT 5m,
ordenado por "Best profit" — o topo é literalmente ordenado pelo artefato mais
extremo.

---

## Fase 5 — MCP trader.dev

Registrado em `~/.claude.json`. Como servidores MCP só conectam na
inicialização, escrevi `tools/traderdev.mjs` para falar SSE direto e usar sem
reiniciar. 49 ferramentas, servidor `traderdev-backtester` v0.2.1.

**A prova definitiva está na spec deles.** `get_pine_codegen_rules` exige:

> *"Broker header MUST use **commission=0**, percent_of_equity=100"*

O backtester obriga comissão zero e 100% do capital por trade. Explica os
retornos de 10¹¹ por cento e confirma, pela especificação da própria
ferramenta, o que este projeto mediu de forma independente.

**Peneira construída** (`tools/td-screen.mjs`), porque os filtros da API não
limpam a base — o topo por Sharpe são backtests de **10 dias com Sharpe 17**.
Resultado: 918 backtests coletados, 189 fisicamente implausíveis, 204 com
janela curta, **154 sobreviveram** — concentrados em 1D/1h/4h, quase nenhum em
5 minutos.

---

## Fase 6 — A resposta: o timeframe

**A pista** veio de um frame mostrando o Claude Code do próprio autor:
**BTC 4h, +112%, PF 1,71, DD 27,5%, 65 trades, Sharpe 0,80.** O único resultado
crível do vídeo inteiro está em **4 horas**.

**Por que faz sentido:** o custo é pedágio aproximadamente fixo por trade. O
que muda com o timeframe é o tamanho do movimento capturado.

**Resultado em 4h — `body-breakout` positivo nos 5 ativos:**

| Ativo | Expectancy OOS | Retorno | DD | Eficiência WF | Veredito |
|---|---|---|---|---|---|
| BTC | +0,198R | 15,7% | 5,4% | 0,86 | **APROVADO** |
| ETH | +0,154R | 17,1% | 9,0% | 0,99 | **APROVADO** |
| TRX | +0,133R | 11,2% | 5,3% | 1,40 | **APROVADO** |
| DOT | +0,118R | 13,8% | 7,4% | 0,22 | reprovado |
| SOL | +0,042R | 4,7% | 11,4% | 0,34 | reprovado |

Consistência entre 5 ativos independentes é muito mais difícil de obter por
acaso que uma célula sortuda. É o primeiro sinal estrutural do projeto.

---

## Fase 7 — Machine learning

### 7.1 Meta-labeling por estratégia
GBDT escrito do zero, purged walk-forward CV. **SOL 5m:** o filtro vira
expectancy de −0,054R para **+0,066R**. Mas AUC 0,53–0,55, com 2 dos 5 folds
abaixo de 0,50.

**Decisão explícita: não ajustar até passar.**

### 7.2 Ações (F, COIN)
Yahoo Finance, 60 pregões. ALTR **deslistada** (Altair adquirida pela Siemens)
— lembrete de viés de sobrevivência.

Comissão de varejo nos EUA é zero, então o problema do 5min some. **F:
`body-breakout` PF 2,006, expectancy +0,398R.** COIN muito mais fraco (PF
1,008).

### 7.3 Capital e bola de neve
$100, risco 0,5%/trade, expectancy 0,15R, ritmo do 4h (~12 trades/mês) →
**mediana $138 em 3 anos**, p5 $117, p95 $163, ruína 0%. Capital mínimo viável
**$15,50**.

---

## Fase 8 — O seletor adaptativo

**Pedido:** um ML que lê o mercado em tempo real e aplica a melhor estratégia.

**Tentativa 1:** pool aberto. **BTC 4h: −39,3%** contra +9,6% da melhor
isolada. Causa: escolheu `ma-cross` em **753 de 944 trades**. Dois defeitos —
viés de frequência (regra de *estado* sinaliza em quase toda barra e sufoca as
seletivas) e pedir a um modelo que cronometre uma estratégia sem edge nenhum.

**Correção — portão de pool:** só entra estratégia com expectancy positiva
sozinha no treino. **−39,3% → +5,4%.** AUCs subiram para 0,54–0,75 com as
features de regime (Efficiency Ratio de Kaufman, autocorrelação de retornos).

**Resultado final: o alocador perde em 5 de 5 ativos.** O diagnóstico está no
ETH — escolheu a estratégia certa e entregou +34,3% contra os +56,3% que ela faz
sozinha. **O filtro estava removendo trades lucrativos.**

**Bug encontrado e corrigido:** o teste de AUC só rodava com amostra suficiente,
então estratégias com poucos trades **passavam por não serem examinadas**. No
DOT isso rejeitava `momentum-breakout` (+0,198R) e aprovava `body-breakout`
(+0,041R). Correção: separar "entra no pool?" (expectancy) de "o modelo tem
voto?" (AUC).

**Veredito separado por camada:**

| Camada | Veredito |
|---|---|
| Seleção de estratégia | **funciona** — descartou `ma-cross` em 100% dos casos |
| Filtro por trade | **não funciona** — ajuda num ativo, atrapalha em outro |

A metade que funciona virou `npm run pool`.

---

## Fase 9 — Scanner de universo

**Pedido:** uma IA que varre o mercado inteiro, aprova ativos viáveis, e troca
quando o mercado piora.

**Avaliação:** boa ideia, e melhor fundamentada que o filtro por trade — é uma
decisão estrutural de baixa frequência, do lado certo da divisa que o projeto
identificou. E corrige o cherry-picking do vídeo.

**Perigo central:** 679 ativos × 5 estratégias = 3.395 testes. Defesa em três
camadas: filtrar antes de testar, exigir consistência transversal, contabilizar
os testes.

**Métrica nova: custo-para-movimento** — movimento típico no horizonte do trade
dividido pelo custo de ida e volta. Resume a descoberta central do projeto e
elimina ativos **antes** de qualquer backtest.

**Primeira varredura (4h):**

```
universo total       679
após liquidez         30
após viabilidade      12
TESTES EFETIVOS       60
testes evitados    3.335
```

**Consistência transversal:**

| Estratégia | Positivos | Fração | Expectancy mediana |
|---|---|---|---|
| body-breakout | 8 de 12 | **67%** | +0,064R |
| momentum-breakout | 4 de 12 | 33% | −0,042R |
| ma-cross | **0 de 12** | 0% | −0,080R |

**Par novo encontrado:** XRP + body-breakout, **+0,230R**.

**Achado que muda o mapa:** a Binance lista ações e ETFs como perpétuos.
Custo-para-movimento **SOXL 199x, SNDK 104x, MU 90x** contra 38x do BTC — de
longe os ativos mais atraentes. Reprovados só por histórico curto (listagem
recente), o que é o comportamento correto. Resolve a mistura ações+cripto do
vídeo dentro de um único venue.

---

---

## Fase 10 — O laço fechado, com os US$ 100 como restrição

**Pedido:** seguir o melhor caminho, com a ideia de começar com apenas US$ 100.

**O que faltava, admitido explicitamente:** os módulos existiam mas não se
comunicavam. Eram seis scripts que eu rodava à mão e cujos resultados eu lia e
interpretava. Um organograma com seis funcionários que não se falavam.

**Construído:** o Auditor (`src/audit/auditor.ts`), os contratos de mensagem
(`src/team/messages.ts`), o Gestor de Risco com veto (`src/team/risk-officer.ts`)
e o orquestrador (`src/cli/team.ts`).

**O que US$ 100 realmente suportam:** 3 posições simultâneas, notional de
US$ 32,26 cada, alavancagem 0,32x. O limite que morde é o **risco simultâneo
contra o limite de perda diária**, não o notional mínimo. A conta deixa de ser
operável abaixo de **US$ 15,50** — perda de 85%, muito depois do circuit
breaker já ter desligado tudo.

**Primeira reunião completa — o funil:**

| Estágio | Entrou | Saiu |
|---|---|---|
| Pesquisador (walk-forward) | 31 pares | 5 |
| Gestor de Risco (veto) | 5 | **1** |
| Alocador | 1 | 1 |
| Auditor | 1 | **0** |

**Zero pares operáveis.** E cada portão pegou algo que o anterior deixou passar:
o Pesquisador aprovou `DOGE ma-cross` com eficiência 4,73 e DSR 1,00; o Risco
vetou por drawdown p95 de 27% contra desligamento em 15%; o Auditor rebaixou o
único sobrevivente (`DOT body-breakout`) porque a expectancy realizada nos
últimos 40 trades foi −0,278R contra +0,174R prometida.

**Também nesta fase:** `Trend Rider` portada do trader.dev — a primeira
estratégia de fora do vídeo, e a primeira com stop em ATR em vez de porcentagem
fixa. PF 1,125 nos 5 anos, 1,178 no bear, 1,140 no bull. Edge pequeno mas
estável entre regimes opostos.

**Correção importante:** eu havia afirmado em três documentos que o trader.dev
força comissão zero. Testei e **estava errado** — a API rejeita override e
aplica 0,05% por lado. O que produz os números absurdos é `percent_of_equity:
100` e slippage zero, não a comissão. Ver [MCP.md](MCP.md).

---

---

## Fase 11 — Pesquisa contínua, o plano, e a proteção contra ruína

**Pedido:** pesquisar constantemente estratégias/moedas/métodos; um plano para
snowballar US$ 100 que se adapte durante a execução; garantir que não haja
ruína.

### Mineração da base

1.145 estratégias coletadas → 508 plausíveis → **58 assinaturas
estruturalmente distintas** (`tools/td-mine.mjs`, fila em
`research/queue.json`). Priorizadas por **novidade de mecanismo, não por
lucro**, porque o problema diagnosticado é a concentração em `body-breakout`.

Indicadores que o projeto não tinha e apareceram: `macd, stoch, bb, bbw,
linreg, mfi, cmo, pivothigh/low, percentrank, barssince, highest/lowest`.

**Ressalva registrada:** o gargalo do projeto nunca foi falta de ideias — 31
pares testados produziram zero aprovações. Por isso o Batedor mede a própria
taxa de aproveitamento e avisa quando está trazendo lixo.

### O plano como máquina de estados

`src/team/snowball-plan.ts` — cinco estágios (S0 paper → S4 escala), com faixas
derivadas da aritmética da exchange, não arbitrárias. Cada estágio tem gatilho
de avanço **e de recuo**. Não é cronograma: nunca diz "no mês 6 você terá X".

**Projeção em 24 meses, US$ 100, 36 trades/mês:**

| Cenário | p5 | mediana | p95 | chega $400 | morre |
|---|---|---|---|---|---|
| edge medido (0,15R) | $149 | $189 | $241 | 0% | 0% |
| edge fraco (0,07R) | $100 | $134 | $169 | 0% | 7% |
| sem edge (0,00R) | $85 | $96 | $125 | 0% | 53% |

Nenhum cenário chega a US$ 400 em 24 meses. A bola de neve é real e é lenta.

### Motor de portfólio e a proteção contra ruína

Correlação medida entre BTC/ETH/DOT/XRP: **0,71 em média** (BTC-ETH: 0,84).
Quatro posições a 0,5% dão risco efetivo de **1,768%**, não 1,000%.
Diversificação capturada: **23% do máximo teórico**.

**Dimensionamento ajustado por correlação** reduz o risco por trade de 0,500%
para **0,181%**, igualando o risco efetivo de 3 posições ao de uma isolada:

| | Sem ajuste | Com ajuste |
|---|---|---|
| CAGR | 13,7% | 6,1% |
| Max drawdown | 11,2% | **4,7%** |
| Calmar | 1,22 | **1,32** |
| **Prob. de bater o circuit breaker** | **57,6%** | **0,2%** |

A versão ajustada rende metade e é superior em Calmar e Sharpe. Um sistema com
57,6% de chance de desligar não compõe — e bola de neve que para de rolar não é
bola de neve.

**Defeito encontrado no próprio teste:** a primeira execução reportou pico de 1
posição, porque o perfil `seed` trazia `maxConcurrent: 1`. O que eu tinha
medido era rotação entre ativos, não portfólio. Registrado em
[PORTFOLIO.md](PORTFOLIO.md) porque um teste que mede a coisa errada e devolve
números plausíveis é mais perigoso que um que quebra.

---

## Fase 12 — O pivô delta-neutro

O pedido tinha ficado impossível de contornar: **lucro toda semana**. Direcional
não entrega isso. Medido, o melhor candidato dava 45,1% de semanas positivas com
a semana mediana negativa. Não é um defeito da estratégia, é o que significa
prever preço: a distribuição tem cauda dos dois lados.

A saída foi trocar a natureza da fonte de retorno. Em vez de **prever** um preço,
**cobrar** um pagamento contratual: arbitragem de taxa de financiamento, duas
pernas que se cancelam em preço, vendida onde o funding é alto e comprada onde é
baixo. Exposição ao preço: zero.

Medido em 180 dias: **48 de 48 semanas positivas**. Não porque acertou, mas
porque não tentou acertar.

A progressão do motor de renda:

| versão | estrutura | renda semanal |
|--------|-----------|---------------|
| spot + perp 3x | uma exchange | US$ 0,298 |
| spread entre exchanges | duas pernas de perpétuo | US$ 0,383 |
| 10 exchanges | mais pares candidatos | US$ 1,28 |
| 5x de alavancagem | mesma estrutura, mais notional | US$ 2,11 |

Isso consolidou o padrão que atravessa o projeto inteiro: **prever falhou 3 de 3
vezes, reagir funcionou 3 de 3.**

---

## Fase 13 — O mercado inteiro

Mesmo com o motor delta-neutro rodando, ele decidia entre **32 ativos que eu
tinha escolhido à mão**. Enquanto operava SEI a 19,5% de APR, KAITO pagava 36,2%
e o motor não tinha como descobrir.

O pedido:

> "o mercado é completamente vasto, voce não consegue encontrar, ou ficar
> procurando e analisando recursivamente o mercado inteiro... deve ser oportunista
> o projeto"

A descoberta que destravou: as exchanges expõem **endpoints em massa**. Ler o
funding do mercado inteiro custa duas requisições por exchange, não uma por par.
**3.492 pares em 5 exchanges, em 13,8 s** — mais rápido que a varredura antiga de
32 ativos, que buscava histórico par a par e levava minutos.

Três coisas quebraram no caminho e cada uma ensinou algo:

1. **O filtro de liquidez deixava passar volume zero.** O topo do ranking virou
   pares com US$ 0 de liquidez e 482% de APR. Corrigido exigindo volume nas
   **duas** pernas — a liquidez de uma operação de duas pernas é a da perna pior.
2. **A bybit travava no `fetchTickers()`** e zerava a exchange inteira. Resolvido
   com `Promise.race` de 8 s: perde o volume naquele ciclo, mantém o funding.
3. **A foto instantânea engana.** SKHY apareceu com 41,6% — o melhor do ranking —
   e abriu, fechou e reabriu em quatro minutos.

O item 3 mudou o critério de decisão. A vigilância deixou de guardar a foto e
passou a guardar o **ciclo de vida** de cada oportunidade, ranqueando por
`spread médio × consistência²`. O quadrado é deliberado: um spread que aparece
metade das vezes vale um quarto de um que sempre aparece. SKHY, com 41,6% e 40%
de consistência, perde para KAITO com 36,2% e 80%. É o comportamento correto.

Detalhes em [VIGILANCIA.md](VIGILANCIA.md).

---

## Fase 14 — Ligando os olhos às mãos

Vigilância e motor eram dois processos cegos um para o outro. A ligação é um
arquivo em disco, não uma chamada — e a escolha é de segurança, não de
elegância: se a vigilância morrer, o motor percebe pela **idade do dado**. Acima
de 20 minutos ele recusa o ranking e cai para a própria varredura estreita, que é
pior mas é fresca. Operar às cegas com informação velha é o pior dos dois mundos.

O primeiro ciclo com a ponte ligada:

```
[18:57:11] fonte: vigilância · 4 varreduras · dado de 1 min · 1 candidatos
[18:57:14] FECHA SEI — spread INVERTEU (sumiu da varredura)
```

O motor largou SEI no mesmo ciclo em que enxergou o mercado inteiro pela primeira
vez.

---

## Fase 15 — Proteção contra ruína, e dois erros do próprio teste

O motor eliminava risco de preço e deixava o operacional descoberto: nenhum
circuit breaker, nenhum piso, nenhuma trava de liquidação.

A política saiu de uma assimetria de custo: transferir margem custa ~US$ 0,01,
ser liquidado custa ~US$ 50. Mil vezes. Então transfere-se cedo e sempre, e isso
não remove trade lucrativo nenhum — o dinheiro só muda de exchange.

O teste de ruína (20 mil simulações) deu 99,97% de liquidação sem proteção
contra 0,03% com ela, e a proteção **pagou** US$ 15,99 na mediana em vez de
custar.

Mas o teste errou duas vezes, e as duas foram achadas olhando resultados sem
sentido físico:

1. Fechar estava bloqueado por transferência em trânsito, produzindo um degrau
   de 0,08% para 42,27% entre 20 e 40 min de latência.
2. A margem era reconstruída a partir de um preço de referência resetado a cada
   transferência. Com valor zero transferido, o reset apagava a deriva — e 8x e
   10x apareciam **mais seguros** que 5x. O mesmo bug estava no motor.

---

## Fase 16 — Custódia e diluição

O risco que a estrutura não cobre: metade do capital em cada exchange. Não há
hedge, mas há **detectar** (saque suspenso aparece nos dados antes da notícia),
**preferir** (exchange maior entre spreads parecidos) e **diluir**.

A diluição exigiu descobrir que "três posições" não dilui nada por si só — as
três poderiam usar as mesmas duas exchanges. Quem dilui é o **teto de 40% por
exchange**. Concentração caiu de 50% para 33,7%.

---

## Fase 17 — O prejuízo, e as duas causas

Nove horas de operação limpa: **−US$ 2,30**. Funding de US$ 0,17 contra US$ 2,48
de custo. Oito posições, todas no vermelho, nenhuma exceção.

**Primeira causa: os pares não invertiam, piscavam.** KAITO apareceu em 38 de 44
varreduras, com buracos de uma e duas. A vigilância fechava o ciclo na primeira
ausência e o motor lia isso como "spread inverteu".

Isso contaminou mais que o resultado. A estatística que eu havia apresentado com
confiança — *"100% duraram menos de 2h, perseguir não paga o custo"* — **media o
bug, não o mercado.**

**Segunda causa: não havia portão de payback.** Montar e desmontar custa
`notional × taxa × 4`; cada funding rende `notional × spread`. O notional se
cancela, então **alavancagem e capital não decidem se uma operação vale a pena.**
Só taxa, spread e tempo de vida. A 35% de APR, uma posição precisa viver 2,1
dias só para empatar — e elas viviam horas.

O critério de seleção passou a ser valor esperado em dólares, substituindo a
heurística `spread × consistência²`. Ordenação e portão passaram a usar a mesma
grandeza.

**E o maker, que eu tinha vendido como a solução, não é.** Modelado: ordem
limite não garante execução, e uma perna sem a outra é posição direcional a 5x.
Com 80% de preenchimento, 32% das tentativas terminam com perna solta, e o
seguro come o desconto. Maker só compensa acima de 90% de preenchimento.

---

## Estado atual

**Nada aprovado para dinheiro real.** O portão de 90 dias de paper trading
continua de pé.

**Tudo parado** em 02/08/2026, a pedido, com capital intacto em US$ 100,00 e o
motor barrando todas as candidatas por valor esperado negativo.

**A medição limpa ainda não existe.** Tudo que o projeto mediu sobre duração de
spread até 02/08/2026 media o bug do piscar. O relógio começa do zero na próxima
execução.

**Candidato principal:** `body-breakout` em 4h, agora com suporte de 8 de 12
ativos numa varredura sistemática — não mais em 5 ativos escolhidos a dedo.

**Regra permanente adotada:** qualquer módulo que remova trades lucrativos em
qualquer ativo testado fica documentado como experimento e **fora da produção**.

**Único papel da equipe ainda vazio:** o Auditor, que fecha o laço de rotação.
Ver [ARQUITETURA-DECISORIA.md](ARQUITETURA-DECISORIA.md) e [BACKLOG.md](BACKLOG.md).
