# Delta-neutro: a virada do projeto

O projeto nasceu tentando replicar um bot de scalping de 5 minutos. Terminou
operando uma estratégia que não prevê nada e não tem exposição a preço. Este
documento explica por que essa mudança aconteceu e como o sistema funciona
hoje.

---

## Por que abandonei o trading direcional

Depois de 6 estratégias, 3 modelos de machine learning, 1.145 candidatas
mineradas e 312 combinações de ativo × estratégia × timeframe testadas, o
melhor resultado validado foi **expectancy de 0,17R por operação** — e mesmo
esse dependia de walk-forward que nunca foi confirmado por operação real.

O padrão que emergiu, documentado em [O-QUE-FALHOU.md](O-QUE-FALHOU.md):

| Tipo de decisão | Resultado |
|---|---|
| **Prever** o que vai acontecer | falhou 3 de 3 |
| **Reagir** ao que já aconteceu | funcionou 3 de 3 |

E o pedido do usuário era lucro **semanal**. A medição foi implacável: no
portfólio direcional, **45,1% das semanas eram positivas**. A semana típica
dava prejuízo. Pior sequência: 8 semanas negativas seguidas.

Nenhuma quantidade de otimização conserta isso, porque é assim que uma
estratégia com vantagem positiva se comporta — ela ganha porque as semanas boas
são maiores, não porque ganha toda semana.

---

## A estrutura que resolve

**Comprado num ativo e vendido no mesmo ativo, em exchanges diferentes.**

```
VENDIDO na exchange onde o funding é alto      → recebe
COMPRADO na exchange onde o funding é baixo    → recebe (ou paga pouco)
```

Se o preço sobe 40%, a perna vendida perde exatamente o que a comprada ganha. O
patrimônio não se move. **A exposição a preço é zero — não por calibragem, por
construção.**

O que sobra é o *funding*: o pagamento contratual que as exchanges transferem
dos comprados para os vendidos a cada 8 horas, para ancorar o preço do
perpétuo ao spot.

Isso não é previsão. É um fluxo observável, com histórico público, que ou é
positivo no período ou não é.

### Os números que justificaram a virada

Medição sobre 3.000 leituras reais de funding, 180 dias:

| | Direcional | Delta-neutro |
|---|---|---|
| Semanas positivas | 45,1% | **100%** (48 de 48) |
| Exposição a preço | total | **zero** |
| Pior semana | −1,92% | **+$0,059** |

---

## Como o capital é dividido

Com US$ 100 e alavancagem 5x nas duas pernas:

| | |
|---|---|
| US$ 50 | margem na perna vendida |
| US$ 50 | margem na perna comprada |
| **US$ 250** | notional por perna |

O notional **não é dinheiro que sai da conta** — é o tamanho da posição que a
margem sustenta. O funding é calculado sobre ele, e é daí que vem a renda: os
mesmos US$ 100 rendem sobre US$ 250 em vez de sobre US$ 50.

### Por que 5x e não mais

| Alavancagem | Notional | Desbalanceia em | Transferências/mês |
|---|---|---|---|
| 3x | $150 | ±32,9% | 1,8 |
| **5x** | **$250** | **±19,6%** | **4,4** |
| 10x | $500 | ±9,6% | 11,2 |

Alavancagem aqui **não cria risco de mercado** — as pernas se cancelam em
qualquer nível. Ela cria **risco operacional**: quando o preço se move, a
margem fica desbalanceada entre as exchanges e é preciso transferir antes que
uma delas liquide. Transferência leva minutos, e essa janela é o único caminho
para perda real nesta estrutura.

A 10x são 11 transferências por mês — 11 janelas de exposição operacional. A 5x
são 4,4, com $8,61 líquidos contra $15,51. Parei em 5x.

---

## Seleção: por que consistência vence APR

A primeira versão escolhia pelo spread **instantâneo** e pegou INJ a 44,8% de
APR. A média real dele em 14 dias era **15,9%** — eu tinha pegado um pico.

O critério atual é `spread médio × consistência²`:

| Ativo | APR | Consistência | Escolhido? |
|---|---|---|---|
| UNI | **25,3%** | 64% | não |
| ATOM | 19,4% | **100%** | sim |

O UNI rende mais no papel, mas o spread **inverte em mais de um terço dos
períodos**. Para renda diária isso significa mais de um terço dos dias sem
receita — ou pagando. A consistência entra ao quadrado justamente para
penalizar isso com força.

---

## Composição

Cada pagamento de funding vira notional novo, que gera pagamento maior.

O reinvestimento acontece **por limiar**, não a cada pagamento: montar notional
custa taxa, e com capital pequeno reinvestir toda hora gasta mais do que o
pagamento vale. A regra é reinvestir quando o acréscimo se paga em até 3 dias.

Projeção com funding real de 1000RATS (100% dos períodos positivos):

| Semana | Capital | Notional | Renda da semana |
|---|---|---|---|
| 1 | $100,30 | $75,22 | $0,2981 |
| 52 | $116,74 | $87,57 | $0,3470 |
| 104 | $136,29 | $102,25 | **$0,4052** |

A renda da semana 104 é **35,9% maior** que a da semana 1, sem aporte nenhum.

---

## O que pode dar errado

**Funding negativo prolongado.** Corrói devagar, não zera. O motor fecha a
posição quando o spread cai abaixo do mínimo.

**Spread invertido.** Quando o ativo some da varredura, o motor fecha
imediatamente — sem esperar os dias mínimos. Sem esse tratamento ele ficaria
preso pagando em vez de receber, porque tanto a coleta de funding quanto a
avaliação de troca dependiam de encontrar o ativo na lista.

**Desbalanceamento de margem.** O risco real. Exige conta nas duas exchanges
com saldo em cada, e capacidade de transferir rápido.

**Deslistagem.** Os ativos com melhor funding tendem a ser os mais novos e
menores. Se a exchange remove o par, você fecha as duas pernas e sai sem perder
capital — mas a renda para. Por isso o motor mantém candidatos alternativos.

---

## Arquivos

| Módulo | Papel |
|---|---|
| `src/funding/spread.ts` | varredura de 10 exchanges × 32 ativos, pontuação por consistência |
| `src/funding/spread-live.ts` | motor 24h: coleta, rebalanceia, reinveste, troca |
| `src/funding/engine.ts` | mecânica spot+perp (estrutura anterior, mantida) |
| `src/funding/compound.ts` | composição por limiar |
| `src/funding/liquidez.ts` | verificação de livro de ofertas antes de montar |
| `src/funding/barbell.ts` | separação núcleo/satélite (testado, ver abaixo) |
| `src/dashboard/` | painel web em tempo real |

### Comandos

```bash
npm run spread              # motor 24h
npm run spread:scan         # varredura pontual
npm run spread:verificar    # liquidez real + análise de ruína
npm run spread:maximizar    # testa alavancas de otimização
node src/dashboard/server.ts
```

---

## O barbell foi testado e descartado

A ideia era separar núcleo delta-neutro (renda) de satélite direcional
(volatilidade), com piso garantido. O piso funcionou — **0,00% de ruína em
10.000 simulações**, pior piso observado de $70,09 contra $67 previsto.

Mas o satélite destruía valor:

| Perfil | Satélite | Mediana em 1 ano |
|---|---|---|
| Fortaleza | 15% | $99 |
| Equilibrado | 30% | $73 |
| Agressivo | 50% | $51 |

Quanto mais satélite, pior o resultado típico — e ele nem melhorava a
frequência de semanas positivas. O código está em `src/funding/barbell.ts`,
reexecutável, fora de produção.
