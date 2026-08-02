# Portfólio e proteção contra ruína

Documentação do motor multi-ativo (`npm run portfolio`) e do mecanismo que
impede que "diversificar" vire alavancagem disfarçada.

---

## O problema que este módulo cria — e depois resolve

O motor de posição única tinha uma proteção implícita que ninguém precisava
escrever: era impossível estar exposto a duas coisas ao mesmo tempo. O motor de
portfólio remove essa proteção, e com ela some a garantia que sustentava toda a
matemática de risco do projeto.

A conta "3 posições × 0,5% = 1,5% de risco" **só vale se as três forem
independentes**. E elas não são.

### A correlação medida

| | BTC | ETH | DOT | XRP |
|---|---|---|---|---|
| **BTC** | 1,00 | 0,84 | 0,71 | 0,63 |
| **ETH** | 0,84 | 1,00 | 0,76 | 0,65 |
| **DOT** | 0,71 | 0,76 | 1,00 | 0,66 |
| **XRP** | 0,63 | 0,65 | 0,66 | 1,00 |

Correlação média: **0,71**.

O que isso faz com o risco de 4 posições a 0,5% cada:

| Hipótese | Risco efetivo |
|---|---|
| Se fossem independentes | 1,000% |
| **Com a correlação real** | **1,768%** |
| Somando ingenuamente (corr = 1) | 2,000% |

**Diversificação capturada: 23% do máximo teórico.** Quatro ativos entregam
menos de um quarto do benefício que quatro apostas independentes entregariam.

---

## A defesa: dimensionamento ajustado por correlação

O risco efetivo de N posições é `√(wᵀ · C · w)`, onde `w` são os riscos
individuais e `C` a matriz de correlação. Com correlação zero isso devolve a
raiz da soma dos quadrados; com correlação 1, a soma simples.

O ajuste reduz o risco por trade até que **N posições correlacionadas tenham o
mesmo risco efetivo que UMA isolada**.

Na prática, com 3 posições e correlação 0,71: risco efetivo é **2,76×** o de
uma posição. Para igualar, o risco por trade cai de **0,500% para 0,181%**.

### O resultado, medido

| | Sem ajuste | Com ajuste |
|---|---|---|
| Retorno (5 anos) | 89,6% | 34,7% |
| CAGR | 13,7% | 6,1% |
| Max drawdown | 11,2% | **4,7%** |
| Calmar | 1,22 | **1,32** |
| Sharpe | 1,08 | **1,27** |
| Retorno p5 | 20,7% | 12,8% |
| Drawdown p95 | 26,1% | **9,8%** |
| **Prob. de bater o circuit breaker** | **57,6%** | **0,2%** |

**A versão ajustada rende metade e é superior em tudo que importa.** Calmar e
Sharpe são melhores — ou seja, ela entrega mais retorno por unidade de risco,
não apenas menos risco.

E o número decisivo é o último. Um sistema com 57,6% de chance de bater o
circuit breaker **não compõe**: ele desliga na metade dos caminhos possíveis, e
uma bola de neve que para de rolar não é uma bola de neve. Com 0,2%, ela rola.

---

## As três defesas do motor

| Defesa | O que impede |
|---|---|
| **Teto de calor** | a soma do risco aberto nunca passa do limite, independentemente de quantos sinais apareçam |
| **Correlação medida** | a exposição efetiva é calculada com a matriz real, não assumindo independência |
| **Uma posição por ativo** | dois pares no mesmo símbolo é alavancagem disfarçada de diversificação |

---

## Um defeito que encontrei no meu próprio teste

A primeira execução reportou **pico de 1 posição** — o portfólio nunca rodou
multi-posição. A causa: o perfil de risco `seed` traz `maxConcurrent: 1`,
herdado de quando o motor só suportava uma posição. Os 536 sinais contados como
"barrados por calor" foram, na verdade, barrados por esse limite.

O que eu tinha medido era rotação entre 4 ativos, não portfólio. Corrigido com
override explícito (`--concurrent`), e registrado aqui porque um teste que mede
a coisa errada e reporta números plausíveis é mais perigoso que um que quebra.

---

## Ressalvas que continuam de pé

**Concentração de lucro.** Das contribuições por perna, `ETH
momentum-breakout` responde por US$ 61 dos US$ 90 de lucro — 68% do total. Não
é um portfólio equilibrado; é uma perna boa acompanhada de três pequenas. Se a
perna do ETH for artefato, o portfólio inteiro cai junto.

**Estes números não são walk-forward.** São o histórico completo, com
parâmetros fixos. Os resultados out-of-sample do walk-forward foram
consistentemente mais modestos. Este módulo mede o efeito do portfólio sobre o
risco, não valida as estratégias que o compõem.

**Correlação não é estática.** Ela sobe justamente nas crises, que é quando a
diversificação mais importaria. Os 0,71 medidos são a média de 5 anos; em
março de 2020 ou maio de 2022, cripto inteira anda como um ativo só. O ajuste
deveria ser recalculado periodicamente, não fixado uma vez.

**Ainda falta trailing stop.** Sem ele, uma família inteira de estratégias
(as que deixam o vencedor correr) não pode ser avaliada com honestidade.

---

## Como rodar

```bash
node src/cli/portfolio.ts --equity 100 --concurrent 3
```

`--autoscale false` desliga o ajuste por correlação, para comparação.
`--pairs "BTC/USDT:USDT=body-breakout,ETH/USDT:USDT=momentum-breakout"` define
os pares. Relatório em `reports/portfolio-4h.json`.
