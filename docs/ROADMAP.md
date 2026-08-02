# Roadmap

Estado em 2026-08-02. Ordenado por **valor-tempo**, não por importância — o
critério é "atrasar isto custa quanto?".

---

## Fase A — Agora (dias 0–3)

### A1. Paper de ações no ar ← EM EXECUÇÃO

**Por que é o primeiro:** é a única tarefa com decaimento temporal. Cada dia de
atraso é um dia de dados não coletados, e os 90 dias já estão correndo na
trilha de cripto. Documentação não perde valor esperando; medição perde.

**Escopo reduzido, deliberadamente:** MU e COIN apenas.

| Par | Walk-forward | Parâmetros padrão | Evidência |
|---|---|---|---|
| MU/body-breakout | +0,153R | +0,073R | **dupla** |
| COIN/momentum-breakout | +0,122R | −0,012R | só WF |
| F, SOXL, NVDA, TSLA, AMD | — | — | reprovados |

Só o MU é positivo nos dois testes independentes. COIN entra marcado como
evidência de segunda classe, para que aos 90 dias dê para separar os dois casos.

**Complicação técnica:** o orquestrador assume mercado 24/7. Ação fecha às 16h
e reabre com gap. Precisa respeitar horário de pregão e tratar barras ausentes
sem confundir com falha de rede.

### A2. Documentação sincronizada

Vários documentos descrevem um projeto que não existe mais: falam em 5
estratégias (são 6), não mencionam a trilha de ações, a catraca, o
vol-targeting, nem os três ML que falharam. O `BACKLOG.md` ainda lista o
executor como "pronto" — o mesmo que descobri que nunca tinha rodado.

**Por que importa:** é o que sobrevive se eu não estiver aqui. Documentação
errada é pior que documentação nenhuma, porque induz confiança falsa.

---

## Fase B — Análise sem pressa (dias 3–10)

### B1. Seleção adversa modelada

Todo resultado com custo maker assume preenchimento garantido. Ordem limite só
executa quando o preço volta até você — e portanto perde exatamente os
rompimentos que dispararam sem olhar para trás.

**É a maior fonte de otimismo não medido do projeto.** O paper vai medir na
prática, mas modelar permite saber ANTES quanto edge sobra em cada cenário, em
vez de descobrir em 90 dias.

**Método:** simular preenchimento condicional — a ordem só executa se a barra
seguinte tocar o nível E não fugir. Comparar com o preenchimento otimista atual.
A diferença é o tamanho do autoengano.

### B2. Imposto de renda

Nenhuma projeção desconta imposto. Todos os números de lucro estão brutos.
Operação em cripto no Brasil é tributada, e numa conta que rende ~6% ao ano
isso não é detalhe.

---

## Fase C — A espera (dias 10–90)

**Nada é alterado no sistema.** Mexer no meio invalida a medição, e a medição é
a única coisa que este período produz.

O que acontece:

| Marco | O que se torna possível |
|---|---|
| 25 trades fechados | o Auditor começa a julgar |
| ~30 dias | primeira leitura de seleção adversa com amostra útil |
| 90 dias | a resposta |

Monitoramento: `npm run watch` a qualquer momento, sem interferir.

**A regra dura:** se aos 40 dias os números estiverem feios, não se ajusta nada.
Ajustar no meio significa recomeçar do zero com 40 dias perdidos. Já recusei
ajustar-até-passar quatro vezes neste projeto; esta é a quinta e a mais cara.

---

## Fase D — A decisão (dia 90)

Três desfechos possíveis, e os três já têm resposta definida:

**1. O edge se confirma** (expectancy realizada dentro de 1 desvio da prevista,
seleção adversa dentro do modelado). Então a pergunta deixa de ser "qual
estratégia" e passa a ser "vale aportar capital de verdade nisto". Com US$ 100
o retorno é US$ 6/ano; o sistema escala, a conta é que não.

**2. O edge some** (expectancy realizada negativa, ou seleção adversa comendo
mais que 0,005%). Então o projeto respondeu sua pergunta corretamente por US$ 0
e três meses. Isso é sucesso, não fracasso — descobrir com paper é
infinitamente mais barato que descobrir com dinheiro.

**3. Ambíguo** (poucos trades, ou resultado dentro do ruído). Então estende-se
por mais 90 dias. Não se decide no ambíguo.

---

## Fora do roadmap, por decisão

**Mais estratégias.** Testei 6 e minerei 1.145 candidatos. O gargalo nunca foi
suprimento de ideias — 31 pares testados produziram zero aprovações no funil
completo. Adicionar candidatos gera trabalho, não lucro.

**Mais machine learning.** Três tentativas, três falhas: meta-labeling (removia
trades lucrativos), alocador adaptativo (perdeu em 5 de 5), ML de volatilidade
(previu 37% melhor, operou pior). O único que funcionou foi um EWMA de uma
linha. O padrão está documentado em [O-QUE-FALHOU.md](O-QUE-FALHOU.md): prever
falhou 3 de 3, reagir funcionou 3 de 3.

**Dashboard.** Gráfico não melhora estratégia.

---

## O mistério que continua aberto

`trend-rider`: PF 1,14 na minha porta contra 1,98 anunciado. Descartei período
(testei na janela deles: 1,14) e trailing (piorou: 0,876). Continua sem
explicação, e isso significa que há algo na tradução Pine → meu motor que eu
não entendo. Não bloqueia nada, mas é uma dívida intelectual registrada.
