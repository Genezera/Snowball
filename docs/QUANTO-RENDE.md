# Quanto rende, semana a semana

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
o maior número, mas para achar um par **que dure**. Por isso o ranking pesa
consistência ao quadrado.

---

## Ainda não medido

A frequência real de rotação **ainda não tem medição válida**. O motor rodou 6,1
horas e fez 1 troca, o que daria 27,8 por semana — mas essa troca foi causada
pela mudança de fonte de dados (SEI vinha da varredura antiga de 32 ativos e não
aparece no ranking do mercado inteiro), não por uma inversão genuína de spread.

Extrapolar dela seria inventar. A vigilância registra duração de cada
oportunidade justamente para produzir esse número em alguns dias de operação.
Quando houver, esta tabela é refeita com a linha certa em vez de um cenário.

---

## O que o motor já faz para segurar a rotação

Três travas, todas já em produção:

1. **`diasMinimos = 3`** — não troca por oportunidade antes de 3 dias na posição.
2. **A troca precisa se pagar em menos de 7 dias.** O motor compara o ganho
   diário extra do candidato contra o custo de $0,50 e só troca se o payback for
   menor que uma semana.
3. **Consistência ao quadrado na seleção** — um spread visto em metade das
   observações vale um quarto de um que sempre aparece.

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
