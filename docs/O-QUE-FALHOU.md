# O que foi testado e não entrou em produção

Este documento existe porque a lista de coisas que falharam é mais informativa
que a lista de coisas que funcionaram — e porque a regra do projeto é que nada
que remova trades lucrativos ou piore o resultado entra, por mais promissor que
pareça.

Cinco tentativas sérias, todas medidas, todas descartadas.

---

## 1. Meta-labeling por trade (ML)

**A ideia:** um GBDT prevê P(este trade dá lucro) a partir de features de
regime, e filtra os ruins.

**O resultado:** AUC 0,53–0,55, com 2 dos 5 folds abaixo de 0,50 — pior que o
acaso. Convertia expectancy de −0,054R para +0,066R em alguns ativos, mas o
efeito era inconsistente.

**Por que foi descartado:** removia trades lucrativos. Em ETH, escolhia a
estratégia certa e ainda entregava +34,3% contra os +56,3% que ela faz sozinha.

**Código:** `src/ml/metalabel.ts` — funcional, reexecutável, fora de produção.

---

## 2. Alocador adaptativo por regime (ML)

**A ideia:** ler o regime de mercado em tempo real e escolher qual das
estratégias aplicar agora.

**O resultado:** perdeu para a melhor estratégia isolada em **5 de 5 ativos**.
Primeira versão fez −39,3% contra +9,6% da melhor perna, escolhendo `ma-cross`
em 753 de 944 trades.

**O que sobreviveu:** o *portão de pool* — a regra de só incluir estratégias
com expectancy positiva sozinha no treino. Essa parte funciona e está em
produção como `npm run pool`. A camada de seleção por trade não.

**Código:** `src/ml/allocator.ts`, `src/backtest/multi.ts`.

---

## 3. ML para previsão de volatilidade

**A ideia:** substituir o EWMA de uma linha por um GBDT com 13 features.

**O resultado — parte 1:** o modelo é genuinamente melhor. MSE 30–39% menor
que o EWMA em todos os 4 ativos, correlação 0,40–0,57 com a volatilidade
realizada.

**O resultado — parte 2:** Calmar médio **0,41 contra 0,57 do EWMA**. Pior em
3 de 4 ativos.

**Por que:** hipótese é que a defasagem do EWMA funciona como amortecedor. O ML
reage rápido demais e corta o tamanho no pico do estresse, que é exatamente
quando a recuperação vem. O erro do EWMA é sistemático numa direção que ajuda.

**A lição que importa:** *prever melhor não é operar melhor*. Se eu tivesse
reportado só a parte 1, teria colocado em produção um modelo com número bonito
que piora o sistema. Medir as duas coisas separadamente foi o que evitou isso.

**Código:** `src/ml/volmodel.ts`, avaliação em `npm run volml`.

---

## 4. Trailing stop no `trend-rider`

**A ideia:** o `trend-rider` original usa trailing de 2,5×ATR. Minha porta sem
trailing dava PF 1,14 contra 1,98 anunciado. Implementar o trailing deveria
fechar a diferença.

**O resultado:**

| | PF sem trailing | PF com trailing | Saídas por alvo |
|---|---|---|---|
| BTC | 1,125 | **0,876** | 68 → 25 |
| ETH | 1,021 | **0,728** | 66 → 21 |

**Por que:** o trailing arma em +1×ATR e persegue a 2,5×ATR do melhor preço.
Nesse instante o stop vai para entrada −1,5×ATR, que é **mais apertado** que o
stop original de 2,0×ATR. Ele aperta antes de o trade ter espaço.

**O que ficou:** a capacidade de trailing existe agora no motor
(`src/backtest/engine.ts`, campos `trailPct` e `trailArmPct`) e outras
estratégias podem usá-la. A aplicação específica foi descartada.

**O mistério que permanece:** a diferença de PF 1,14 vs 1,98 continua sem
explicação. Não era o período (testei na janela deles: 1,14) e não era o
trailing.

---

## 5. Risco fixo alto (20%)

**A ideia:** se 20% de risco dá 23% de chance de chegar a US$ 500 em um mês,
por que não usar?

**O resultado em 24 meses com aporte:** mediana **US$ 337**, quebra em
**33,7%** dos caminhos, e **−US$ 2.163 em relação a simplesmente guardar**.

**O que sobreviveu:** a *catraca* — mesmo risco inicial, mas descendo por
marcos de capital. Mediana US$ 5.040, quebra 0,0%, retenção de 92% dos que
tocam a meta contra 72% do risco fixo.

---

## O padrão

| Tipo de decisão | Resultado |
|---|---|
| **Prever** o que vai acontecer | falhou 3 de 3 |
| **Reagir** ao que já aconteceu | funcionou 3 de 3 |

Prever direção, prever qual trade ganha, prever volatilidade com ML: nenhum
virou resultado. Portão de expectancy, catraca por marco atingido, Auditor
comparando realizado com previsto: os três funcionam.

A única exceção aparente é o EWMA de volatilidade — e ele funciona justamente
porque é ruim de previsão. Sua defasagem o torna mais reativo que preditivo.

---

## Erros de execução que só apareceram ao rodar

Cinco bugs que passaram por revisão e sobreviveram até alguém executar:

1. **Três das cinco estratégias implementadas erradas** — a transcrição do vídeo
   divergia das regras na tela.
2. **Afirmação falsa sobre a comissão do trader.dev** — repeti em 3 documentos
   que era zero; o teste mostrou 0,05% forçado.
3. **Portão de AUC invertendo decisões** — estratégias com poucos trades
   escapavam do teste e passavam por não serem examinadas.
4. **Teste de portfólio medindo rotação** — `maxConcurrent: 1` herdado fazia o
   "portfólio" nunca abrir 2 posições, e os números pareciam plausíveis.
5. **Executor que nunca rodou** — `constructor(private o: ...)` não é suportado
   pelo modo strip-only do Node. Estava documentado como "pronto" desde a
   primeira sessão.

O quinto é o mais instrutivo: código escrito, revisado e documentado não é
código que funciona. Só executar revela.
