# Listing Opportunity Lab

Laboratório **isolado** para o estudo de moedas recém-listadas (perp cripto).
Fase atual: **coleta / replay / paper**. **ZERO execução real.** Nenhuma
estratégia deste documento opera antes dos pré-requisitos da última seção
estarem todos satisfeitos — e mesmo então, só em `live-paper`.

Este lab **não toca** Champion, motores, risco ou execução. É append-only,
read-only sobre o mundo, e reversível (basta apagar os `.jsonl` coletados).

Taxonomia de evidência usada aqui (a mesma do resto do projeto):
`observed` (dado bruto carimbado que eu vi) · `replayed` (reprocessamento
determinístico de dados observed) · `simulated` (modelo sintético) · `shadow`
(decisão calculada em paralelo, sem efeito) · `hypothetical` (hipótese ainda não
medida) · `live-paper` (papel com dados ao vivo, sem ordem) · `real` (dinheiro —
**não existe** nesta fase).

---

## 1. Por que o ciclo de 5 min não serve para listing

O restante da plataforma amostra o mundo em ciclos de ~5 minutos. Isso é
suficiente para funding (que liquida a cada 1–8 h) e para spreads que se movem
em minutos. **Para uma listagem nova, é cego no exato intervalo que importa.**

O que acontece nos primeiros segundos/minutos de uma listagem:

- O preço de abertura e os primeiros trades definem a referência de todo o
  episódio. Um snapshot a cada 5 min **perde o primeiro tick, o primeiro book e
  a primeira sequência de trades** — justamente onde estão a máxima inicial e a
  volatilidade extrema.
- A **máxima** e o início da **queda** costumam ocorrer dentro da primeira janela
  de 5 min. Amostrar depois disso mede o cadáver, não o evento.
- `tempoAteMaximaMs` e `tempoAteQuedaMs` exigem resolução de sub-segundo. Um
  ciclo de 300 000 ms não consegue nem representar essas grandezas.
- Slippage e profundidade de book mudam a cada centena de milissegundos no
  primeiro minuto; um snapshot esparso registra um valor que já não existe.

**Conclusão:** a coleta de listing tem de ser por **WebSocket** (streams de
`trades` e `orderbook` da exchange nova, mais das exchanges onde a moeda já
negociava), carimbando cada mensagem com `observedAt` local em ms. O ciclo de
5 min continua válido para o resto da plataforma; ele apenas **não é a
ferramenta** para os primeiros segundos de uma listagem.

Importante: WebSocket aqui é **só leitura de dados públicos de mercado**. Não há
stream autenticado, não há credencial, não há canal de ordem. Ver
`scripts/listings/collector-placeholder.cjs`.

---

## 2. Dados a coletar (por episódio de listing)

Um "episódio" = uma moeda/símbolo listada numa exchange nova. Schema formal em
[`auditoria/listings/listing-schema.json`](../auditoria/listings/listing-schema.json).

**Cabeçalho do evento**

| Campo | Descrição | Origem esperada |
|---|---|---|
| `anuncioTs` | Horário do anúncio da listagem | observed (feed/anúncio) |
| `negociacaoTs` | Horário **real** do primeiro trade negociável | observed (stream trades) |
| `primeiraExchange` | Exchange onde a moeda começou a negociar | observed |
| `exchangesExistentes[]` | Exchanges onde a moeda **já** negociava antes | observed |

O par `anuncioTs → negociacaoTs` é o "delay anunciado vs real"; é frequente o
horário anunciado não bater com o primeiro tick negociável.

**Mercado no instante da abertura e ao longo do episódio**

| Campo | Descrição |
|---|---|
| `primeiroPreco` | Preço do primeiro trade observado |
| `orderBook{bids,asks}` | Snapshot(s) do book: níveis `[preço, tamanho]` |
| `spread` | Melhor ask − melhor bid (abs e bps) |
| `profundidade` | Liquidez agregada até X bps de cada lado |
| `trades` | Fluxo de trades (preço, tamanho, lado, ts) |
| `volume` | Volume acumulado por janela |
| `volatilidade` | Dispersão de retornos por janela (realizada) |
| `slippage` | Slippage medido para tamanhos-alvo contra o book observado |
| `maxima` / `minima` | Máxima e mínima do episódio |
| `tempoAteMaximaMs` | ms de `negociacaoTs` até a máxima |
| `tempoAteQuedaMs` | ms de `negociacaoTs` até o início da queda sustentada |

**Curva de preço pós-abertura** (âncoras fixas relativas a `negociacaoTs`):
`preco_1min`, `preco_5min`, `preco_15min`, `preco_1h`, `preco_8h`, `preco_24h`.

**Proveniência** (`provenance`): toda linha carrega `source`, `observedAt`,
`collector`, `rawHash` (hash do payload bruto) e `evidence` (um dos rótulos da
taxonomia). Sem isso, o dado não entra no dataset.

---

## 3. Quatro sub-estratégias (estudadas SEPARADAMENTE)

Cada uma é uma **hipótese** a ser medida no dataset coletado. Nenhuma tem
número ainda; nenhuma opera. São estudadas em separado porque têm gatilhos,
janelas e riscos diferentes — misturá-las esconde qual efeito, se algum, existe.

### 3.1 Listing Momentum — continuação da alta
- **Hipótese:** após a abertura, a alta inicial tem continuação mensurável numa
  janela curta antes de esgotar.
- **O que medir:** distribuição de `tempoAteMaximaMs`; retorno da abertura até a
  máxima; fração de episódios em que o preço em `preco_1min`/`preco_5min` fica
  acima do `primeiroPreco`.
- **Risco central:** entrar já perto da máxima; slippage de entrada come o
  retorno; reversão abrupta. Só faz sentido com slippage realista e book real.

### 3.2 Listing Exhaustion — perda de força pós-subida extrema
- **Hipótese:** depois de uma subida extrema, há um ponto de exaustão em que a
  força se inverte de forma detectável.
- **O que medir:** relação entre magnitude da subida inicial e o drawdown
  seguinte; `tempoAteQuedaMs`; volatilidade e volume no topo.
- **Risco central:** "exaustão" que na verdade é pausa antes de nova alta;
  timing do sinal; custo de manter posição contra um mercado ilíquido.

### 3.3 Cross-Exchange Lead/Lag — exchange antiga vs nova
- **Hipótese:** quando a moeda **já negociava** em `exchangesExistentes[]`, uma
  ponta lidera e a outra segue com defasagem mensurável.
- **O que medir:** correlação defasada entre a série da exchange nova e as
  antigas; sinal e estabilidade do lead/lag; se a defasagem sobrevive a custos e
  latência.
- **Risco central:** a defasagem pode ser menor que a latência de coleta/decisão
  (aí não é operável); é fácil confundir ruído de book fino com sinal. Exige
  `latency measurement` honesto antes de qualquer conclusão.

### 3.4 Post-Launch Normalization — normalização pós-lançamento
- **Hipótese:** após a turbulência inicial, o preço/o spread/a profundidade
  convergem para um regime "normal" num horizonte previsível.
- **O que medir:** trajetória de `spread`/`profundidade`/`volatilidade` até
  `preco_1h`/`preco_8h`/`preco_24h`; quando a volatilidade cai abaixo de um
  limiar estável.
- **Risco central:** "normalização" é um alvo difuso; overfit a poucos
  episódios; o horizonte pode variar demais entre moedas.

---

## 4. Pré-requisitos antes de operar (todos obrigatórios)

**Nenhuma das quatro estratégias opera — nem em `live-paper` — enquanto todos
os itens abaixo não estiverem satisfeitos e auditáveis.**

1. **Dados suficientes.** Amostra de episódios `observed` grande o bastante para
   distinguir sinal de ruído (não uma dúzia de listagens sortidas).
2. **Simulador de slippage.** Modelo que converte tamanho + book observado em
   preço de fill realista. Sem ele, qualquer retorno é ficção.
3. **Order book real.** Snapshots/deltas de book coletados, não preço-mid
   presumido.
4. **Fills parciais.** O simulador precisa modelar execução parcial e o que
   sobra da ordem — no primeiro minuto de uma listagem, encher a ordem inteira
   ao topo do book é irreal.
5. **Liquidez.** Métrica de liquidez por episódio; episódios ilíquidos são
   marcados e não contam como operáveis.
6. **Latency measurement.** Medição honesta da latência coleta→decisão→(fill
   hipotético). Especialmente indispensável para Cross-Exchange Lead/Lag.
7. **Circuit breakers.** Limites de segurança do próprio lab (parar coleta/estudo
   em anomalia), independentes de qualquer execução.
8. **Amostra histórica.** Base histórica de listagens para backtest/replay
   determinístico, separada da coleta ao vivo.
9. **Paper challenger.** Um challenger que roda a estratégia em `live-paper`
   (sombra, sem ordem) e é comparado contra baseline antes de qualquer promoção
   — no mesmo espírito dos challengers já existentes no projeto.

Ordem lógica: **coletar (observed) → replay/backtest → simular com slippage e
fills → paper challenger em live-paper → só então discutir promoção.** Cada
degrau é reversível e não envia ordem.

---

## 5. O que este lab explicitamente NÃO faz

- Não envia ordem, não conecta stream autenticado, não usa credencial.
- Não altera Champion/motores/risco/execução.
- Não promete lucro. As quatro estratégias são **hipóteses sem número**.
- Não cria dashboard nem página.
- A implementação real do coletor WS só pode rodar **isolada e sem credenciais
  de execução**, atrás do guard de ambiente descrito no placeholder.
