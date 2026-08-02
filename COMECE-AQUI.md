# Comece aqui

Renan — resumo do que aconteceu enquanto você dormia, em uma página.

---

## A resposta curta

**A premissa do vídeo está errada, mas as estratégias não são lixo.**

As 5 estratégias têm edge bruto real (profit factor 1,22–1,25 — meus números
batem com os dele). O problema é aritmético e específico:

```
edge bruto por trade          ≈ +0,15 R
custo por trade (taker)       ≈ −0,16 R
                                --------
resultado líquido em 5 min    ≈ −0,01 R
```

O edge é engolido pela taxa por uma margem mínima. Isso não se resolve mexendo
na estratégia — resolve-se **mudando o timeframe**, porque a taxa é um pedágio
fixo por trade e o que muda com o timeframe é o tamanho do movimento capturado.

**Em 4 horas, funciona.** `body-breakout` (a estratégia do COIN) deu expectancy
positiva out-of-sample nos 5 ativos testados:

| Ativo | Expectancy OOS | Retorno | Drawdown | Eficiência WF |
|---|---|---|---|---|
| BTC | +0,198R | 15,7% | 5,4% | 0,86 |
| ETH | +0,154R | 17,1% | 9,0% | 0,99 |
| TRX | +0,133R | 11,2% | 5,3% | 1,40 |
| DOT | +0,118R | 13,8% | 7,4% | 0,22 |
| SOL | +0,042R | 4,7% | 11,4% | 0,34 |

Consistência entre 5 ativos independentes é muito mais difícil de conseguir por
acaso do que uma célula sortuda. Foi exatamente isso que faltou em 5 minutos,
onde 24 de 25 testes reprovaram.

E isso bate com o único número crível do vídeo inteiro: BTC **4h**, PF 1,71,
Sharpe 0,80 — validado pelo próprio autor via trader.dev.

## E há uma segunda saída: ações

Corretora de varejo nos EUA cobra **comissão zero**. A taxa que mata o scalping
de 5 minutos em cripto simplesmente não existe lá. Em F (Ford), 5 minutos, com
spread e slippage realistas:

| Estratégia | Profit factor | Expectancy | Trades |
|---|---|---|---|
| body-breakout | **2,006** | +0,398R | 59 |
| momentum-breakout | 1,647 | +0,337R | 78 |

Amostra de 60 pregões (limite da fonte gratuita), então é indício direcional e
não conclusão. Em COIN o resultado é bem mais fraco (PF 1,008).

**O padrão que amarra tudo:** `body-breakout` é a melhor estratégia em cripto 4h
(positiva em 5 de 5 ativos) **e** em ações 5min (positiva em 2 de 2). E
`ma-cross` falha em absolutamente todos os mercados e timeframes testados.
Consistência assim, em mercados com microestrutura completamente diferente, é
muito mais informativa do que qualquer número isolado.

---

## A prova de que os 5381% não são reais

Três evidências independentes, todas encontradas nos materiais que você mandou:

1. **A spec do trader.dev exige comissão zero.** A ferramenta
   `get_pine_codegen_rules` manda: *"Broker header MUST use commission=0,
   percent_of_equity=100"*. Todo número do leaderboard deles é a custo zero com
   100% do capital composto. É isso que produz os +172 bilhões por cento.

2. **O dashboard deles admite.** "Forward positive 65 / forward negative 59"
   (cara ou coroa), "Proof state: BLOCKED", "NO live track record yet", "0/2
   honest in-sample gates passing", "promising — unproven".

3. **A estratégia dos 5381% tem Sharpe 0,376.** Está na tela do vídeo, ao lado
   do número grande. Lucro total ≈280M contra perda total ≈215M — o resultado é
   a diferença pequena entre dois números enormes.

Meu walk-forward chegou à mesma conclusão de forma independente, antes de eu ver
qualquer uma dessas três coisas.

---

## Quanto isso rende de verdade

Com $100, risco 0,5% por trade, expectancy 0,15R e o ritmo do 4h (~12
trades/mês):

| | 3 anos |
|---|---|
| Mediana | **$138** |
| Pessimista (p5) | $117 |
| Otimista (p95) | $163 |
| Risco de ruína | 0,0% |

Capital mínimo viável: **$15,50** (abaixo disso a posição não atinge o notional
mínimo da Binance e você é forçado a arriscar mais do que o plano permite — é
assim que conta pequena morre).

A bola de neve é real, mas lenta com capital mínimo. **A alavanca certa para
acelerar é rodar em vários ativos em paralelo** (BTC+ETH+TRX triplica o número
de trades), **não aumentar o risco por trade.**

---

## O ML adaptativo: metade funciona

Você pediu um ML que lê o mercado em tempo real e aplica a melhor estratégia.
Construí, testei em 5 ativos, e o resultado se separa limpo em duas camadas:

| Camada | Pergunta | Veredito |
|---|---|---|
| **Seleção de estratégia** | qual estratégia rodar neste mercado? | **funciona** — descartou `ma-cross` em 100% dos casos e apontou as que prestam usando só dados passados |
| **Filtro por trade** | tomar ou não este sinal? | **não funciona** — ajuda num ativo, atrapalha em outro |

O alocador completo perdeu para a melhor estratégia isolada em **5 de 5 ativos**.
O diagnóstico está no ETH: ele escolheu a estratégia certa
(`momentum-breakout`) e ainda entregou +34,3% contra os +56,3% que ela faz
sozinha — o filtro estava removendo trades lucrativos.

**Não ajustei até passar.** Seria o sobreajuste que o projeto inteiro existe
para detectar.

A metade que funciona virou ferramenta utilizável:

```bash
node src/cli/pool.ts
```

Ela responde "qual estratégia deveria estar rodando agora", por ativo. Rode uma
vez por mês ou trimestre — não a cada barra. Saída de hoje: ETH →
`momentum-breakout`; SOL e DOT → `body-breakout`; **BTC e TRX → não operar
nada**. Detalhes em [docs/ADAPTATIVO.md](docs/ADAPTATIVO.md).

Descoberta técnica relevante: as features de regime (Efficiency Ratio de
Kaufman, autocorrelação de retornos, razão de volatilidade) levaram a AUC a
0,54–0,75, contra 0,53–0,55 do meta-labeling anterior. Elas são informativas —
o problema é convertê-las em decisão de trade individual.

---

## O que fazer quando acordar, em ordem

1. **Rotacione a chave de API do trader.dev.** Você colou uma chave no chat,
   então ela está no histórico da conversa. Gere outra no dashboard.

2. **Reinicie o Claude Code.** O MCP trader.dev está registrado e vai conectar
   sozinho. (Eu já consegui usá-lo nesta sessão via `tools/traderdev.mjs`, que
   fala SSE direto — mas com o restart fica nativo.)

3. **Leia `docs/RESULTADOS.md`.** Todos os números, com a configuração exata que
   os produziu.

4. **Decida sobre o paper trading.** O candidato é `body-breakout` em 4h. O
   comando está abaixo. São 90 dias — não tem atalho, e é o único teste que mede
   o que o backtest não consegue (preenchimento real de ordem limite, latência,
   seleção adversa).

```bash
node src/cli/live.ts --symbol "BTC/USDT:USDT" --timeframe 4h --strategy body-breakout --mode paper
```

---

## O que eu não fiz, e por quê

- **Nada foi aprovado para dinheiro real.** O portão de paper trading não foi
  cumprido, e ele não pode ser pulado.
- **Não ajustei o modelo de ML até ele passar.** AUC ficou em 0,53–0,55 (fraco
  mas real). Continuar mexendo até passar seria exatamente o sobreajuste que o
  projeto inteiro existe para detectar.
- **Não testei as ações (F, COIN, ALTR).** O ccxt só cobre cripto. É o maior
  buraco do projeto — está em `docs/BACKLOG.md` como B4.
- **Não modelei seleção adversa em ordem limite.** Todo o resultado com custo
  maker depende de você ser preenchido, e ordem limite perde justamente os
  rompimentos bons. É a maior fonte de otimismo não medido. Backlog B6.

---

## Documentação

| Documento | Conteúdo |
|---|---|
| [README.md](README.md) | O que é o projeto, como usar, arquitetura |
| [docs/PEDIDOS.md](docs/PEDIDOS.md) | Cada coisa que você pediu, com status |
| [docs/EVOLUCAO.md](docs/EVOLUCAO.md) | Diário: cada descoberta e o que mudou por causa dela |
| [docs/RESULTADOS.md](docs/RESULTADOS.md) | Todos os números medidos |
| [docs/ESTRATEGIAS.md](docs/ESTRATEGIAS.md) | As 5 estratégias, regras exatas da tela |
| [docs/MCP.md](docs/MCP.md) | trader.dev: como usar e o que não acreditar |
| [docs/ARQUITETURA.md](docs/ARQUITETURA.md) | Cada módulo e as decisões não óbvias |
| [docs/BACKLOG.md](docs/BACKLOG.md) | O que falta, priorizado |
