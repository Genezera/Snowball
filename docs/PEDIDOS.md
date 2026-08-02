# Pedidos — rastreamento completo

Registro de tudo que foi pedido, na ordem em que foi pedido, com o que foi feito
em resposta e o status atual. Nada sai desta lista sem estar concluído ou
explicitamente marcado como pendente.

Última atualização: 2026-07-31

---

## Pedido 1 — Mensagem inicial

> "nesses dois arquivos está uma ideia para um projeto para automatização para
> gerar dinheiro no mercado financeiro, eu quero que voce replique ele mas o
> dinheiro que irá começar será o minimo possível e assim ir fazendo bola de
> neve com os lucros se sem quebrar sem perder tudo o dinheiro ao ponto de go
> broke, faça pesquisas também, adicione mcp de for necessário, terceiros,
> pesquise em github, noticias, adicione machine learning e faça tudo oque voce
> estiver ao seu alcance para atingir esse objetivo"

Decomposto em 7 itens:

| # | Item | Status | Onde está |
|---|---|---|---|
| 1.1 | Replicar o projeto do vídeo | **Feito** | `src/strategies/index.ts` — as 5 estratégias com as regras exatas transcritas da tela |
| 1.2 | Começar com o mínimo de dinheiro possível | **Feito** | `src/risk/capital.ts` + `src/cli/capital.ts` — calcula o capital mínimo viável matematicamente |
| 1.3 | Bola de neve com os lucros | **Feito** | Dimensionamento por fração do equity em `sizePosition()`, e simulador Monte Carlo em `simulateSnowball()` |
| 1.4 | Não quebrar / não perder tudo | **Feito** | Circuit breakers de perda diária e drawdown no motor e no executor ao vivo; risco de ruína medido por Monte Carlo |
| 1.5 | Fazer pesquisas | **Parcial** | Buscas web feitas (ccxt, meta-labeling, purged CV, trader.dev). Falta a varredura de GitHub e notícias — ver [BACKLOG](BACKLOG.md) |
| 1.6 | Adicionar MCP, inclusive de terceiros | **Feito** | trader.dev instalado (ver [MCP.md](MCP.md)) + servidor MCP local próprio em `src/mcp/server.ts` |
| 1.7 | Adicionar machine learning | **Feito** | GBDT escrito do zero em `src/ml/gbdt.ts` + meta-labeling com purged walk-forward CV em `src/ml/metalabel.ts` |

---

## Pedido 2 — Ativos corretos

> "se for ver o video olha na onde operou"
> *(acompanhado de capturas de tela: F/NYSE, DOTUSDT.P, COIN/NASDAQ, TRXUSDT.P, ALTR)*

**Status: Feito para cripto, pendente para ações.**

Eu tinha testado em BTC/ETH/SOL — ativos errados. O vídeo opera:

| Ativo | Tipo | Testado? |
|---|---|---|
| TRXUSDT.P | Perpétuo Binance | **Sim** — 315.360 barras de 5min, 3 anos |
| DOTUSDT.P | Perpétuo Binance | **Sim** — 315.360 barras de 5min, 3 anos |
| F (Ford) | Ação NYSE | Não — ccxt não cobre ações. Ver [BACKLOG](BACKLOG.md) |
| COIN (Coinbase) | Ação NASDAQ | Não — mesma razão |
| ALTR (Altair) | Ação | Não — mesma razão |

Essa correção mudou o resultado do projeto. Ver [EVOLUCAO.md](EVOLUCAO.md), entrada 4.

---

## Pedido 3 — Regras exatas (série de capturas de tela)

Você mandou 5 capturas com as regras escritas na tela de cada estratégia. Isso
revelou que **eu tinha implementado 3 das 5 erradas**, porque a transcrição em
texto do vídeo estava incorreta ou incompleta.

| Estratégia | O que eu tinha feito (errado) | Regra real na tela | Status |
|---|---|---|---|
| 1 — momentum breakout | `SMA(close,20) > SMA(close,50)` | `SMA(range,10) > SMA(range,50)` — filtro sobre o **range** do candle | **Corrigido** |
| 2 — ma-cross | Evento de cruzamento | **Estado** (`50 > 100`), não evento | **Corrigido** (param `useCross` mantém as duas opções) |
| 3 — z-score | `EMA(close,10)>SMA(close,50)`, `z ≤ +2` (rompimento) | `EMA(range,10)>SMA(range,50)`, `z ≤ −2` (**reversão à média**) | **Corrigido** — mudou o caráter da estratégia inteira |
| 4 — body breakout | `body fraction > 0.1` (da transcrição) | `body fraction > 0.5` (da tela) | **Corrigido** — a transcrição estava errada |
| 5 — vwma dip | Bandas de Bollinger | `VWMA(bodyfrac,10)>0.5`, `close>VWMA(close,100)`, `z ≤ −2` | **Corrigido** |

Regras completas em [ESTRATEGIAS.md](ESTRATEGIAS.md).

---

## Pedido 4 — MCP trader.dev

> "e lembre de instalar o mcp trader.dev diz que la tem muitos backtest"

**Status: Feito.** Registrado em `C:\Users\Renan\.claude.json` como servidor SSE
apontando para `https://mcp.trader.dev/sse` (endpoint verificado, HTTP 200).
Backup da configuração anterior em `.claude.json.bak-snowball`.

Requer reiniciar o Claude Code e criar conta em StrategyFactory.ai para obter a
chave de API. Detalhes de uso em [MCP.md](MCP.md).

---

## Pedido 5 — Análise do vídeo

> "acho que voce deveria passar pelo video tanto do link quando oque eu mandie
> para voce em video baixado e tirart alguns prints e ir analisando
> completamente tudo"
>
> "além disso voce tem que ir tirando frames e transcrevendo o video que eu te
> mandei para voce entender legal, do video inteiro"

**Status: Feito.** Duas varreduras com ffmpeg:

- 26 frames por detecção de mudança de cena
- 98 frames a cada 8 segundos, cobrindo os 784 segundos completos

Combinados com a transcrição em `transcript.txt`. Achados em
[EVOLUCAO.md](EVOLUCAO.md), entradas 5 e 7. Os três frames mais importantes do
vídeo inteiro estão documentados lá.

---

## Pedido 6 — Não atropelar

> "mas não esqueça das coisas que te pedi anteriormente não saia atropelando"

**Status: Atendido.** Este documento existe por causa desse pedido. A lista de
tarefas do projeto também foi expandida para incluir os itens que estavam
implícitos e correm risco de se perder.

---

## Pedido 7 — Documentação

> "lembra, documente tudo oque eu te pedi, documente oque está sendo esse
> projeto, e documente a evolução dele, e documente absolutamente tudo oque eu
> pedi, e o uso do mcp trader.dev é major, então utilize com maestria e
> documente tudo para não se perder nas tarefas"
>
> "acho que voce nção documentou direito, são varios documentos completamente e
> extremamente detalhados, suas atividades, minhas ideias, oque foi feito, oque
> precisa fazer, oque eu pedi, oque já tem e etc"

**Status: Feito.** Conjunto de documentos:

| Documento | Cobre |
|---|---|
| [../README.md](../README.md) | O que é o projeto, como usar, arquitetura |
| PEDIDOS.md (este) | Tudo que você pediu, item a item |
| [EVOLUCAO.md](EVOLUCAO.md) | Diário: cada descoberta, quando, e o que mudou por causa dela |
| [RESULTADOS.md](RESULTADOS.md) | Todos os números medidos, com a configuração que os produziu |
| [ESTRATEGIAS.md](ESTRATEGIAS.md) | As 5 estratégias, regras exatas da tela |
| [MCP.md](MCP.md) | trader.dev + servidor MCP local |
| [BACKLOG.md](BACKLOG.md) | O que ainda falta, priorizado |
| [ARQUITETURA.md](ARQUITETURA.md) | Cada módulo, por que existe, decisões de projeto |

---

## Resumo do status

**Concluído:** 1.1, 1.2, 1.3, 1.4, 1.6, 1.7, 2 (cripto), 3, 4, 5, 6, 7

**Pendente:** 1.5 (pesquisa GitHub/notícias), 2 (ações F/COIN/ALTR)

Detalhes e prioridades em [BACKLOG.md](BACKLOG.md).
