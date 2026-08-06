<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="assets/logo.png">
    <img src="assets/logo-fundo-branco.png" alt="Snowball" width="220">
  </picture>
</p>

<p align="center">
  <img alt="Paper trading only" src="https://img.shields.io/badge/modo-paper%20trading-38bdf8?style=flat-square">
  <img alt="Node" src="https://img.shields.io/badge/node-24%2B-38bdf8?style=flat-square">
  <img alt="Zero build" src="https://img.shields.io/badge/build-none-38bdf8?style=flat-square">
  <img alt="Testes" src="https://img.shields.io/badge/testes-302%20passing-36e3a0?style=flat-square">
</p>

# ❄️ Snowball

> Laboratório de pesquisa quantitativa que começou tentando replicar um bot de
> scalping do YouTube com 5.381% de retorno — e terminou descobrindo, com
> disciplina e alguns erros caros, que a resposta certa era parar de prever
> preço e passar a **cobrar** pela liquidez.

**TL;DR:** um motor que fica comprado e vendido no mesmo ativo em duas
exchanges diferentes ao mesmo tempo. A exposição a preço é **zero por
construção** — se o ativo sobe ou desce, as duas pernas se cancelam. A renda
vem do *funding rate*, o pagamento contratual que os perpétuos transferem
entre comprados e vendidos a cada 8 horas. Roda hoje em **paper trading**,
24 horas por dia, sem nenhuma ordem real enviada a nenhuma exchange.

---

## 🧠 O que este projeto é (e o que não é)

| É | Não é |
|---|---|
| 🔬 Uma máquina de medir se uma estratégia tem vantagem real, antes de arriscar dinheiro | 💸 Uma promessa de retorno |
| 📊 Um motor delta-neutro rodando 24h em paper trading | 🔮 Previsão de preço |
| 📚 18+ documentos registrando **tudo que foi testado**, inclusive o que falhou | 🧹 Um repositório só com os resultados bonitos |
| 🧪 Disciplina de descoberta/holdout cego em toda alegação de vantagem | ✨ Um backtest que promete 5.381% |

O nome é literal: a ideia é começar pequeno (**US$ 100–200**) e deixar o
capital **rolar feito uma bola de neve** — juros compostos sobre uma vantagem
pequena, real e medida, em vez de uma vantagem grande, fictícia e não medida.

---

## ⚙️ Como funciona — a estratégia em produção

```
                          FUNDING RATE ARBITRAGE (cross-exchange)

     Exchange A                                      Exchange B
   ┌─────────────┐                                 ┌─────────────┐
   │  VENDIDO     │◄──── mesmo ativo, mesmo -──────►│  COMPRADO    │
   │  (funding    │      tamanho, preço se          │  (funding    │
   │   alto)      │      cancela entre as duas       │   baixo)     │
   └─────────────┘      pernas                      └─────────────┘
          │                                                 │
          └──────────────────► RENDA ◄───────────────────────┘
                     funding pago a cada 8h,
                     não é aposta — é contrato
```

Se o preço do ativo sobe 20%, a perna vendida perde e a comprada ganha quase
a mesma coisa — **a direção do mercado deixa de importar.** O que sobra é a
diferença de funding entre as duas exchanges, que é cobrada de quem está
"do lado errado" da demanda por alavancagem.

### A conta que decide tudo

```
custo de ida e volta = notional × taxa × 4      (2 pernas × abrir e fechar)
receita por 8h        = notional × spread
```

O `notional` aparece nos dois lados e **se cancela** — o que decidiu o
projeto inteiro foi essa única equação:

> **Alavancagem e capital não decidem se uma posição vale a pena. Só taxa,
> spread e tempo de vida decidem.**

| APR do spread | tempo até empatar (taker) |
|---|---|
| 20% | 3,6 dias |
| 35% | 2,1 dias |
| 76% | 1,0 dia |

Por isso existe um **portão de valor esperado**: o motor só monta uma posição
se o spread já tiver *historicamente vivido* tempo suficiente para pagar o
próprio custo de montagem — não se ele parece bom agora. Na maior parte do
tempo, o log mostra isto, e é o resultado **correto**:

```
valor esperado barrou 12 candidatas · melhor: SSPC · vida 0.7h de 2.1h exigidas
```

---

## 🏗️ O que o sistema faz — arquitetura de 8 processos

Oito processos independentes, cada um com seu próprio supervisor, que se
falam **por arquivo em disco**, não por chamada direta — se um cai, os
outros percebem pela idade do dado em vez de travar.

```
  🔭 VIGILÂNCIA        (5 min)   varre 3.492 pares em 6 exchanges,
        │                        guarda o ciclo de vida de cada oportunidade
        ▼
  🧠 MOTOR             (5 min)   lê o ranking, aplica o portão de valor
        │                        esperado, decide — NUNCA ENVIA ORDEM
        ▼
  📈 DASHBOARD          live      painel em localhost:8787, SSE em tempo real

  🏥 CUSTÓDIA          (15 min)  saúde de cada exchange → o motor evacua
                                    sozinho se uma for sinalizada

  🗄️ COLETOR           (5 min)   arquiva o histórico de longo prazo antes
                                    da poda de 7 dias apagar, e treina o
                                    modelo de ML sozinho quando há dado
                                    suficiente

  🚀 MODO AGRESSIVO    (20 min)  ts-momentum multi-ativo em paralelo,
                                    capital e diário próprios, experimental

  ⚖️ PARES             (20 min)  pares cointegrados, mercado-neutro,
                                    capital próprio, experimental

  🎯 PREENCHIMENTO     (10 s)    mede se ordem limite (maker) preenche
                                    rápido o bastante — só leitura, sem ordem
```

Um **watchdog** (`scripts/supervisor.sh`) checa os 8 a cada 30 segundos e
religa sozinho qualquer um que cair — com log da causa, distinção entre
"caiu de verdade" e "eu apliquei uma atualização de código", e aviso opcional
no Telegram. `iniciar.cmd` e `parar.cmd` na raiz sobem/derrubam tudo com
segurança (nunca duplicam instância, nunca perdem estado).

### O painel

Centro de operações em tempo real — sidebar colapsável com 10 seções, tema
claro/escuro, identidade visual glacial baseada na logo do projeto, zero
dependência externa (SVG + JS puro, sem framework, sem build). Mostra:

- 💰 capital, funding recebido, custos pagos — com números que sobem
  contando em vez de trocar de repente
- 📉 curva de capital com marcadores reais de evento (abertura/fechamento/
  funding) desenhados em cima
- 💓 saúde dos 8 processos com pulso e ícone próprio, diagrama de
  arquitetura, log do watchdog
- 📍 posições abertas com preço ao vivo por perna e gauge de distância até
  liquidação
- 🏦 saldo por exchange, exposição, concentração, dreno direcional
- 🔍 ranking completo da varredura com o veredito do portão (passa/barra),
  com busca, filtro, ordenação e heatmap de spread
- 🏥 saúde de cada exchange, coleta de longo prazo, prontidão e treino real
  de ML, monitor de basis trade
- 📜 linha do tempo de cada decisão do motor, com o motivo — nunca só o
  resultado
- ⌨️ paleta de comandos (Ctrl+K) buscando em páginas, processos, exchanges
  e ativos, com dado real
- 📋 visualizador de logs em tempo real dos 8 processos

---

## 📍 Estado atual

**Paper trading, 24h.** Dois motores independentes, cada um só coletando
dado:

- **Modo normal** (delta-neutro) — **US$ 100 por exchange**, nas 6 exchanges
  monitoradas (binance, bybit, okx, gate, bitget, bingx), ~US$ 600 no total,
  usando a que o mercado favorecer em cada ciclo.
- **Modo agressivo** (ts-momentum multi-ativo) — **US$ 200**, experimental,
  rodando em paralelo, sem prejudicar o motor normal.

**Nenhuma ordem foi enviada a nenhuma exchange, em nenhum momento deste
projeto** — é leitura de mercado e simulação, ponto final.

O motor normal fica corretamente **sem posição aberta** boa parte do tempo:
o portão de valor esperado é rigoroso de propósito, depois de um episódio em
que a ausência dele custou US$ 2,30 reais (nunca mais que isso, e nunca de
novo — ver [`docs/O-QUE-FALHOU.md`](docs/O-QUE-FALHOU.md)).

A frente de pesquisa mais avançada — fora do que já está em produção — é um
**portfólio misto de time-series momentum + pares cointegrados**, dois
mecanismos com vantagem estatística confirmada em holdout cego, combinados
porque a correlação entre eles é baixa o suficiente para reduzir risco de
ruína sem apagar o retorno. O ts-momentum já roda ao vivo no modo agressivo;
a combinação com pares ainda está em backtest, não em paper.

Rodando também: uma medição ao vivo de **se ordem limite (maker) preenche
rápido o bastante** para trocar o custo taker (0,05–0,06%) pelo maker
(~0,02%) sem risco de perna — a única alavanca identificada até agora para
reduzir custo sem inventar risco novo. Ver o card "Ordem limite vs. mercado"
no painel.

### 🔬 Sete famílias de estratégia testadas, com a mesma disciplina

Descoberta separada de holdout cego, parâmetros fixos sem reajuste,
correção honesta sempre que um teste mais rigoroso derrubava um resultado
bonito. Este é o placar:

| Família | Melhor achado | Sobrevive a holdout? | Sobrevive a custo/risco real? |
|---|---|---|---|
| Arbitragem de funding (cross-exchange) | — | — | ✅ em produção (paper) |
| Direcional cripto (múltiplos timeframes) | `body-breakout`, 4h | ⚠️ parcial | ❌ não a custo taker — confirmado por 2 motores independentes |
| Direcional ações | `momentum-breakout`, 1h | ⚠️ parcial | — |
| Time-series momentum (cripto, 1d) | +0,049R | ✅ p=0,008 | ⚠️ fraco isolado |
| Pares cointegrados (cripto, 1d) | +0,014/trade | ✅ após 2 correções | ⚠️ só a baixa alavancagem |
| **Momentum + pares (portfólio misto)** | ~9–12% chance de sucesso | ✅ | ⚠️ melhor resultado do projeto até agora |
| Basis trade (spot+perp) | −0,249%/ciclo | — | ❌ estrutural, custo &gt; funding capturável |
| Captura de liquidação | — | — | ❌ 0 operações no dado real |

Nenhuma das sete dá chance alta de bater a meta original sem aporte — e
essa é a conclusão honesta, não uma que soa bem. Números completos, com
metodologia, em [`docs/RESULTADOS.md`](docs/RESULTADOS.md) (16 resultados
documentados e contando).

---

## 🧪 O que separa este projeto de um backtest de YouTube

1. ⏱️ **Sinal na barra `i` executa na abertura da barra `i+1`** — nunca
   negocia dentro da barra que usou para decidir.
2. 💸 **Taxa e slippage nos dois lados, sempre.** O preset `zero-cost` existe
   só para mostrar quanto o custo importa.
3. 🎯 **Stop e alvo tocados na mesma barra assumem o stop** — o único erro
   otimista que de fato quebra conta real.
4. 🛑 **Circuit breakers param o backtest** como parariam a conta de verdade.
5. 🔒 **Walk-forward escolhe parâmetros usando só o passado** de cada bloco;
   o holdout nunca é visto até a validação final.
6. 📐 **Sharpe deflacionado** pelo número de combinações testadas.
7. 🚫 **Nada que remova trades lucrativos entra em produção** sem virar
   experimento documentado primeiro — regra permanente do usuário.
8. 🔁 **Confirmação cross-engine.** A alegação mais recente (`body-breakout`
   não sobrevive a custo taker) foi validada rodando o motor próprio *e*
   uma implementação Pine Script independente no [trader.dev](https://trader.dev),
   sob o mesmo custo — os dois bateram.

E, registrado sem vaidade, a seção de bugs mais abaixo — porque código
revisado e documentado não é código que funciona; só executar revela.

---

## 🛠️ Stack — o que usa, e onde

| Camada | Ferramenta | Uso |
|---|---|---|
| **Runtime** | Node.js 24, TypeScript nativo (`strip-only`, zero build step) | todo o motor, sem `tsc`, sem bundler |
| **Conectividade de exchange** | [ccxt](https://github.com/ccxt/ccxt) | preço, funding rate, saldo, ordens (não usadas) — 5+ exchanges |
| **Exchanges monitoradas** | Binance, Bybit, OKX, Gate, Bitget, BingX | vigilância varre todas; motor normal opera nas 6, financiadas e ranqueadas por lucro individual |
| **Persistência** | JSON + JSONL em disco | sem banco de dados — cada processo lê/escreve arquivo, robusto a queda |
| **Painel** | HTML + CSS + SVG + JS puro, servido por `node:http` | sem framework, sem build, sem CDN — abre offline |
| **Validação quantitativa** | Motor de backtest próprio (`src/backtest/`) | custos, slippage, funding, gaps, bootstrap por blocos de calendário |
| **Machine learning** | GBDT implementado do zero + meta-labeling com purged CV | `src/ml/` — sem scikit-learn, sem PyTorch |
| **Cruzamento externo** | [MCP](https://modelcontextprotocol.io) do trader.dev | backtest Pine Script independente, engine de paridade TradingView |
| **Servidor MCP próprio** | `src/mcp/server.ts` | expõe o motor deste projeto como ferramenta MCP |
| **Confiabilidade** | Watchdog em bash (`scripts/supervisor.sh`) | religa os 8 processos sozinho, notifica Telegram (opcional) |
| **Notificação** | Telegram Bot API (opcional) | alerta de queda/religamento, sem dependência de terceiro no caminho crítico |

Zero dependências além de `ccxt` e o SDK do MCP — de propósito, para que
qualquer pessoa consiga ler o código-fonte sem instalar meio ecossistema
primeiro.

---

## 🚀 Como rodar

Requer **Node.js 22+** (usa suporte nativo a TypeScript — sem etapa de
build).

```bash
npm install
```

### Tudo de uma vez (recomendado — Windows)

```bash
iniciar.cmd
```

Sobe o watchdog, que sobe e supervisiona os 8 processos sozinho, na ordem
certa. Recusa duplicar se já tiver uma instância rodando. Pra parar tudo com
segurança (sem apagar nenhum estado — cada motor salva o próprio a cada
ciclo, então `iniciar.cmd` depois retoma de onde parou):

```bash
parar.cmd
```

### Com o watchdog direto (Linux/Mac, ou Windows via Git Bash)

```bash
bash scripts/supervisor.sh
```

Checa os 8 processos a cada 30s e religa sozinho o que cair.

### Separadamente

```bash
node src/cli/vigilancia.ts --equity 100 --intervalo 5   # varre o mercado inteiro
npm run custodia                                        # saúde das exchanges
npm run spread                                          # motor normal, US$ 100/exchange, 5x
node src/dashboard/server.ts                            # painel em :8787
node src/cli/coletor.ts --intervalo 5                    # arquivo de longo prazo
npm run momentum-live                                    # modo agressivo, ts-momentum, US$ 200
npm run pares-live                                        # pares cointegrados, mercado-neutro, US$ 200
npm run preenchimento-live                                # mede preenchimento de ordem maker
```

> ⚠️ **O motor pode ficar sem abrir posição — e isso é esperado.** Ele só
> monta um par que já tenha vivido o suficiente para pagar o próprio custo.
> Ver [`docs/QUANTO-RENDE.md#o-portão-de-valor-esperado`](docs/QUANTO-RENDE.md#o-portão-de-valor-esperado).

### Análise e testes

```bash
npm test                    # 302 testes das travas de risco e seleção
npm run quanto               # quanto rende, por exchange
npm run semanas              # projeção semana a semana, com custo de rotação
npm run ruina                # 20 mil simulações contra choques de preço
npm run execucao              # maker × taker, com o risco de perna solta
npm run desafio                # bootstrap por blocos de calendário, risco de ruína
npm run momentum · npm run pares   # as duas frentes de pesquisa mais avançadas
```

### Trilha direcional (validada, não operada)

```bash
npm run backtest -- --symbol "BTC/USDT:USDT" --timeframe 4h --compare-costs
npm run validate             # walk-forward + Sharpe deflacionado + Monte Carlo
npm run scan                  # varredura de universo com custo-para-movimento
```

---

## 📁 Estrutura do projeto

```
src/
├── funding/       motor de arbitragem de funding — o núcleo em produção
├── pairs/         pares cointegrados (pesquisa)
├── strategies/     as 5 estratégias direcionais originais + ts-momentum
├── backtest/       motor de backtest, bootstrap, portfólio, métricas
├── validate/        walk-forward, Sharpe deflacionado, Monte Carlo
├── ml/               GBDT do zero, meta-labeling, purged CV, treino real sobre o arquivo da vigilância
├── risk/             capital mínimo viável, simulador da bola de neve
├── live/             modo agressivo (ts-momentum), pares cointegrados, monitor de preenchimento
├── dashboard/        painel em tempo real (server.ts + pagina.ts)
├── mcp/               servidor MCP próprio
├── data/              carregamento e cache de séries históricas
├── core/              tipos, indicadores, volatilidade
└── cli/               ~70 pontos de entrada, um por análise/operação
scripts/
└── supervisor.sh      watchdog dos 8 processos
docs/                  18+ documentos — cada decisão, cada bug, cada número
```

---

## 📚 Documentação completa

| Documento | Conteúdo |
|---|---|
| [`CONTINUIDADE.md`](CONTINUIDADE.md) | **handoff completo** — leia isto primeiro se está pegando o projeto agora |
| [`COMECE-AQUI.md`](COMECE-AQUI.md) | resumo em uma página do estado mais recente |
| [`docs/DELTA-NEUTRO.md`](docs/DELTA-NEUTRO.md) | por que a estratégia em produção é essa |
| [`docs/VIGILANCIA.md`](docs/VIGILANCIA.md) | como o mercado inteiro é varrido e ranqueado |
| [`docs/QUANTO-RENDE.md`](docs/QUANTO-RENDE.md) | a conta de payback e as projeções |
| [`docs/PROTECAO-RUINA.md`](docs/PROTECAO-RUINA.md) | travas de risco e teste de ruína |
| [`docs/EXECUCAO-REAL.md`](docs/EXECUCAO-REAL.md) | o que foi verificado nas exchanges vs. suposição |
| [`docs/RESULTADOS.md`](docs/RESULTADOS.md) | **todos os números medidos**, 16 resultados documentados |
| [`docs/O-QUE-FALHOU.md`](docs/O-QUE-FALHOU.md) | o que foi testado e descartado, e por quê |
| [`docs/ESTRATEGIAS.md`](docs/ESTRATEGIAS.md) | as 5 estratégias direcionais originais |
| [`docs/CRONOLOGIA.md`](docs/CRONOLOGIA.md) | diário do projeto, fase a fase |
| [`docs/ARQUITETURA.md`](docs/ARQUITETURA.md) | cada módulo e as decisões não óbvias |
| [`docs/MCP.md`](docs/MCP.md) | integração com o trader.dev |
| [`docs/BACKLOG.md`](docs/BACKLOG.md) | o que falta, priorizado, com critério de "pronto" |
| [`docs/PEDIDOS.md`](docs/PEDIDOS.md) | rastreamento de tudo que foi pedido pelo usuário |

---

## 🐛 Sete bugs que só apareceram executando

Registrados porque o padrão importa mais que os casos individuais:

1. **3 de 5 estratégias implementadas erradas** — a transcrição do vídeo
   divergia das regras mostradas na tela.
2. **Afirmação falsa sobre comissão do trader.dev**, repetida em 3
   documentos antes de ser checada contra a spec real.
3. **Portão de AUC invertido** — estratégias com poucos trades escapavam do
   teste por não serem examinadas, não por serem boas.
4. **Teste de portfólio medindo rotação, não diversificação** —
   `maxConcurrent: 1` fazia o "portfólio" nunca abrir 2 posições, e os
   números pareciam plausíveis mesmo assim.
5. **Executor documentado como pronto que nunca havia rodado** — sintaxe
   incompatível com o modo `strip-only` do Node.
6. **Marcos de semana fixos quebrando em horizontes menores.**
7. **Vazamento de memória** — 28.133 mercados carregados para operar 32
   ativos.
8. *(bônus, desta sessão)* **Watchdog com falso positivo em cascata** — Git
   Bash reescreve `/` para `\` ao invocar `node.exe`, e o padrão de busca
   original nunca casava, religando os 5 processos por cima dos que já
   estavam vivos a cada 30 segundos.

Código escrito, revisado e documentado não é código que funciona. Só
executar revela.

---

## ⚠️ Aviso

Este software **não é recomendação de investimento**. Backtest não é
previsão. Operar alavancado em contratos perpétuos pode custar mais do que o
depósito inicial. O motor delta-neutro **não envia ordens** — ele lê as
exchanges e simula. Nada aqui vai para dinheiro real sem 90 dias de paper
trading, por regra permanente deste projeto. A decisão de arriscar dinheiro
é sua.
