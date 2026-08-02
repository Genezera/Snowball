# Quanto rende, semana a semana

> **Leia primeiro.** As projeções deste documento assumem que a posição
> sobrevive o tempo todo, e essa premissa provou ser falsa em operação. A conta
> que realmente decide está na seção
> [O portão de valor esperado](#o-portão-de-valor-esperado), no fim — e ela é
> muito mais restritiva que qualquer cenário abaixo. As tabelas continuam aqui
> porque a análise de rotação segue válida, não porque o resultado se confirmou.


> Com US$ 100, depois com mais US$ 100 no mês seguinte. E por que o número que
> decide isso não é o APR.

Reproduzir: `npm run semanas` — código em `src/cli/semanas.ts`.

---

## O custo que a projeção antiga não contava

A `projecao.ts` modelava montagem inicial, reinvestimento e transferência de
margem. Não modelava **rotação** — o que acontece quando o spread do par em
carteira inverte e o motor precisa trocar de ativo.

Isso não é um detalhe. Uma rotação custa **duas montagens completas**: fechar as
duas pernas e abrir outras duas.

```
custo de rotação = notional × taxa × 2 pernas × 2 (sair + entrar)
                 = 250 × 0,0005 × 2 × 2
                 = US$ 0,50
```

No cenário central de 20% de APR, a renda bruta da semana é **US$ 0,96**. Uma
única rotação come **metade dela**. Duas rotações e a semana fecha no vermelho.

Omitir isso não era um arredondamento — era a diferença entre um sistema que
compõe e um que sangra devagar.

---

## As três premissas de APR

Nenhuma é chute, e nenhuma é promessa.

| cenário | APR | de onde vem |
|---|---|---|
| favorável | 36% | o que a vigilância do mercado inteiro está encontrando agora (KAITO, consistência 83%) |
| central | 20% | mediana das medições de 180 dias |
| comprimido | 12% | regime de funding baixo, que acontece quando o mercado esfria |

O aviso que vale repetir, porque o projeto já caiu nele: **INJ apareceu a 44,8%
de APR instantâneo e a média real dele em 14 dias era 15,9%.** Pico não é média.
Por isso o cenário "favorável" usa 36% e não os 44,8% que aparecem em picos.

---

## Semana a semana — cenário central (20%, 1 rotação/semana)

Aporte de US$ 100 na semana 4.

| sem | começa | notional/perna | bruto | rotação | margem | líquido | aporte | termina |
|---|---|---|---|---|---|---|---|---|
| 1 | $99,75 | $249 | +$0,957 | −$0,499 | −$0,031 | **+$0,427** | — | $100,18 |
| 2 | $100,18 | $250 | +$0,961 | −$0,501 | −$0,031 | +$0,428 | — | $100,60 |
| 3 | $100,60 | $252 | +$0,965 | −$0,503 | −$0,031 | +$0,430 | — | $101,03 |
| 4 | $101,03 | $253 | +$0,969 | −$0,505 | −$0,032 | +$0,432 | **+$100** | **$201,21** |
| 5 | $201,21 | $503 | +$1,929 | −$1,006 | −$0,063 | +$0,860 | — | $202,07 |
| 6 | $202,07 | $505 | +$1,938 | −$1,010 | −$0,063 | +$0,864 | — | $202,93 |
| 7 | $202,93 | $507 | +$1,946 | −$1,015 | −$0,063 | +$0,868 | — | $203,80 |
| 8 | $203,80 | $509 | +$1,954 | −$1,019 | −$0,064 | +$0,872 | — | **$204,67** |

**Mês 1:** depositado $100, motor gerou **+$1,21**
**Mês 2:** depositado $200, motor gerou **+$4,67**

O capital dobra na semana 4 porque você depositou, não porque o motor rendeu. O
que o motor gerou em dois meses foram **$4,67** — 2,3% sobre os $200.

---

## Os três cenários lado a lado

| cenário | fim do mês 1 | fim do mês 2 | motor gerou em 2 meses |
|---|---|---|---|
| favorável 36% | $204,34 | $214,26 | **+$14,26** |
| central 20% | $201,21 | $204,67 | **+$4,67** |
| comprimido 12% | $199,68 | $200,03 | **+$0,03** |

No regime comprimido o motor **empata**. Não perde — mas trabalha dois meses de
graça. Isso é informação, não fracasso: significa que abaixo de ~12% de APR a
estrutura não paga o próprio atrito nesta escala de capital.

---

## O ponto de empate

Quantas rotações por semana zeram a renda:

| APR | rotações de empate | leitura |
|---|---|---|
| 36% | 3,39 | aguenta rotação normal |
| 20% | 1,86 | frágil — 2 trocas na semana apagam o lucro |
| 12% | 1,09 | frágil — 1 troca já quase apaga |

**O ponto de empate não melhora com aporte.** Com $100 ou com $200 ele é o mesmo
1,86, porque custo e renda crescem juntos com o notional. É um teto estrutural.

A única forma de subir esse teto é **trocar menos**.

---

## A alavanca real: rotação, não APR

Cenário central (20%), variando só a frequência de rotação:

| rotações/semana | fim do mês 1 | fim do mês 2 | renda da semana 8 | gerado em 2 meses |
|---|---|---|---|---|
| 0 | $203,24 | $210,87 | +$1,938 | **+$10,87** |
| 0,25 (1/mês) | $202,73 | $209,30 | +$1,667 | +$9,30 |
| 0,5 | $202,22 | $207,75 | +$1,398 | +$7,75 |
| 1 | $201,21 | $204,67 | +$0,872 | +$4,67 |
| 2 | $199,21 | $198,64 | −$0,144 | **−$1,36** |
| 3 | $197,24 | $192,76 | −$1,110 | **−$7,24** |

Ir de 1 rotação por semana para 1 por mês **quase triplica** o resultado, sem
tocar no APR. Subir o APR de 20% para 36% dá $14,26; baixar a rotação de 1/semana
para zero dá $10,87 — **da mesma ordem de grandeza, e muito mais sob controle.**

É exatamente para isso que a vigilância do mercado inteiro existe: não para achar
o maior número, mas para achar um par **que dure**.

---

## Ainda não medido

A frequência real de rotação **continua sem medição válida**, e por um motivo
diferente do que eu supunha quando escrevi esta seção.

A primeira suspeita era que a única troca observada tinha vindo da mudança de
fonte de dados. Depois vieram oito trocas em 9,3 horas, e a causa real apareceu:
**a vigilância fechava um par na primeira varredura em que ele não aparecia, e
os pares piscam.** Detalhes em [VIGILANCIA.md](VIGILANCIA.md).

Ou seja, tudo que este projeto mediu sobre duração de spread até 02/08/2026 mede
um bug. A medição limpa começa depois da correção, e leva dias.

---

## O que o motor já faz para segurar a rotação

Três travas, todas já em produção:

1. **`diasMinimos = 3`** — não troca por oportunidade antes de 3 dias na posição.
2. **A troca precisa se pagar em menos de 7 dias.** O motor compara o ganho
   diário extra do candidato contra o custo de $0,50 e só troca se o payback for
   menor que uma semana.
3. **Portão de valor esperado na entrada** — não monta um par que não viva o
   suficiente para pagar o próprio custo. É a trava que faltava, e a ausência
   dela é o que explica o prejuízo. Ver a seção final.

A exceção, deliberada: quando o spread **inverte** (o par some da varredura, que
só devolve spreads positivos), o motor fecha na hora, sem esperar os 3 dias.
Nesse caso quem recebia passa a pagar, e esperar custa mais que sair.

---

## Como isso se compara com o pedido

O pedido era **lucro toda semana**. O que a tabela mostra:

- No cenário central, **toda semana fecha positiva** — mas em centavos: $0,43
  na primeira, $0,87 na oitava.
- No cenário comprimido, positiva por uma margem tão fina ($0,044/semana) que
  qualquer atrito não modelado a apaga.
- A promessa de "semana sempre positiva" é estrutural (funding é pagamento
  contratual, não aposta) — mas **o tamanho dela é pequeno nesta escala**, e é
  honesto dizer isso em vez de projetar o cenário favorável como se fosse o
  esperado.

O que faz o número crescer, em ordem de impacto:

1. **Rotacionar menos** — até 2,3× no resultado de dois meses.
2. **Capital** — o ganho escala linear com o notional, e o ponto de empate não
   piora.
3. **APR** — o menos controlável dos três. Depende do mercado, não do código.

---

## O portão de valor esperado

Tudo acima assume que a posição fica montada a semana inteira. Em operação real
isso não aconteceu — e a conta que explica por quê é mais simples que qualquer
projeção.

```
custo ida e volta = notional × taxa × 4
receita por 8h    = notional × spread
```

**O notional se cancela.** Ele multiplica os dois termos, então não muda o sinal
do resultado — só a escala. Isso tem uma consequência que contradiz boa parte do
esforço anterior do projeto: **alavancagem e capital não decidem se uma operação
vale a pena.** Só taxa, spread e tempo de vida decidem.

Quanto tempo uma posição precisa viver só para empatar:

| APR | payback com taker 0,05% | com maker 0,02% |
|---|---|---|
| 20% | **3,6 dias** | 1,5 dias |
| 35% | **2,1 dias** | 0,8 dia |
| 50% | 1,5 dias | 0,6 dia |
| 76% | 1,0 dia | 0,4 dia |

O motor abria posições que precisavam de dois dias e as fechava em horas. Nunca
perguntou se o par duraria o suficiente. Resultado das oito posições abertas
antes do portão existir:

| | |
|---|---|
| funding recebido | **+US$ 0,17** |
| custos pagos | **−US$ 2,48** |
| resultado | **−US$ 2,30** em 9,3 horas |

Nenhuma das oito deu lucro. Nenhuma exceção — é por isso que o portão remove
apenas perdedoras e não fere a regra de nunca remover trade lucrativo.

### A regra atual

```
valor = notional × spread × pagamentos(vida esperada) − notional × taxa × 4
```

A vida esperada usa Lindy amortecido pela consistência: um spread vivo há T
horas com consistência c tende a viver mais `T × c`. É grosseiro, e é
conservador na direção certa — subestima pares bons e não superestima pares
ruins, que é o erro que custa dinheiro.

O motor só monta se a folga for de 1,5× o payback. Ordenação e portão usam a
mesma grandeza (valor por hora de capital ocupado), então não existe o caso de a
ordem preferir um par que o filtro rejeita.

### O que isso produz na prática

```
valor esperado barrou 5 candidatas · melhor candidata AAVE ·
vida esperada 2.1h contra payback de 84.8h · valor esperado −US$ 0,163
```

Capital intacto, nenhuma posição montada. **Não abrir é um resultado, não uma
falha.** Afrouxar o portão para "ver algo acontecer" é exatamente o que custou
os US$ 2,30.

### E o maker, que eu tinha vendido como a solução

Modelado em `npm run execucao`. Ordem limite não garante execução, e uma perna
executada sem a outra deixa uma posição **direcional a 5x** — o oposto do que a
estrutura existe para fazer.

| preenchimento | custo esperado | vs taker |
|---|---|---|
| 70% | $0,6786 | **+171%** |
| 80% | $0,4375 | +75% |
| 90% | $0,2500 | **0%** — empata |
| 95% | $0,1711 | −32% |
| 100% | $0,1000 | −60% |

Com 80% de preenchimento, **32% das tentativas** terminam com uma perna solta
para desfazer, e o seguro come o desconto inteiro. Os 2,5× de melhoria só
existem com execução quase certa.

---

## O que mudaria o resultado

Em ordem de impacto, e nenhum depende de escrever mais código:

1. **Um regime de funding melhor.** A 76% de APR o payback cai para 1 dia. É a
   variável que mais move o resultado e a menos controlável.
2. **Tempo de observação.** Pares que sobrevivem dias cruzam o portão sozinhos.
   A vigilância precisa acumular dado limpo, o que só começou depois da correção
   do piscar.
3. **Taxa menor por volume.** As exchanges reduzem taker com volume mensal. Não
   é acessível nesta escala de capital, mas é o caminho que não carrega o risco
   de perna solta do maker.

O que **não** mudaria: mais alavancagem ou mais capital. O payback não depende
de nenhum dos dois.
