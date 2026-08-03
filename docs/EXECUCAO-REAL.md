# Execução real: o que foi verificado e o que ainda é suposição

> A pergunta que este documento responde: **o que o motor simula corresponde ao
> que aconteceria com dinheiro de verdade?**
>
> Resposta curta: **a parte de mercado sim, a parte de tesouraria não.** Este
> documento separa uma da outra sem suavizar.

Última verificação contra as exchanges: **03/08/2026**.

---

## Parte 1 — verificado, lido das exchanges

Tudo abaixo foi consultado ao vivo via ccxt, não estimado.

### Taxas de negociação

`market.taker` e `market.maker`, perpétuo USDT:

| exchange | taker | maker | notional mínimo |
|---|---|---|---|
| binance | 0,0500% | 0,0200% | US$ 5 |
| okx | 0,0500% | 0,0200% | — |
| gate | 0,0500% | 0,0200% | — |
| bybit | 0,0550%* | 0,0200% | — |
| bitget | **0,0600%** | 0,0200% | US$ 5 |

\* a bybit recusou a consulta sem chave de API; valor de tabela pública.

O motor usa a média das duas exchanges do par, não 0,05% uniforme.

### Escorregamento no livro

Medido comprando US$ 250 de notional a mercado, contra o preço do meio:

| ativo | binance | bybit |
|---|---|---|
| KAITO | 0,0050% | 0,0188% |
| AAVE | 0,0054% | 0,0108% |
| HYPER | 0,0266% | 0,0220% |

O motor ignorava isso — usava o último preço como se a ordem não custasse
travessia. Agora usa 0,02% por perna, a mediana das seis medições.

Não é o maior custo, mas incide **quatro vezes** numa operação completa (duas
pernas × entrada e saída): acrescenta 0,08% ao custo de 0,20% das taxas, ou
**40% a mais de payback**.

### Saque de USDT

| item | valor medido (bitget) |
|---|---|
| taxa, rede mais barata (Plasma) | US$ 0,001 |
| taxa, redes comuns (BEP20) | US$ 0,15 |
| **mínimo de saque** | **US$ 10, em todas as 12 redes** |

O mínimo é o que importa, e ele reescreveu o desenho — ver a seção 3.

### Alavancagem máxima por ativo

| ativo | bybit |
|---|---|
| KAITO | 75x |
| AAVE | 75x |
| HYPER | 25x |

Os 5x do motor cabem com folga em todos. A binance não expõe o limite via ccxt
sem chave.

### Status operacional

`fetchStatus` funciona em binance, bybit e okx. Em 03/08/2026 a **OKX
reportou `maintenance`**, e o monitor de custódia bloqueou os pares dela —
primeira vez que a camada de detecção pegou um evento real.

### Quais exchanges realmente importam

Sobre 401 observações da vigilância:

| par de exchanges | frequência |
|---|---|
| bybit → binance | 73,3% |
| binance → bybit | 26,7% |
| **qualquer outra combinação** | **0%** |

**Cem por cento das oportunidades envolvem apenas binance e bybit.** Gate,
bitget e okx aparecem na varredura mas nunca sobrevivem ao filtro de liquidez de
US$ 10M nas duas pontas combinado com o spread mínimo.

Isso tem uma consequência operacional grande, na seção 3.

---

## Parte 2 — a sequência real de uma operação

O que o motor simula em uma linha (`ABRE KAITO`) são, na prática, estes passos:

### Antes de qualquer coisa: pré-financiar as duas exchanges

O capital precisa **já estar** nas duas exchanges, em USDT, na carteira de
futuros. Com US$ 100:

1. Comprar USDT (ou receber de outra fonte)
2. Sacar ~US$ 50 para a binance e ~US$ 50 para a bybit — **duas transferências
   on-chain**, cada uma com taxa e tempo
3. Em cada exchange, mover de **spot para futuros** — interno, instantâneo, sem
   taxa

O passo 3 é fácil de esquecer: um depósito on-chain cai na carteira **spot**, e
margem de perpétuo sai da carteira de **futuros**. São contas separadas.

### Abrir a posição

4. Definir a alavancagem no par, em cada exchange (5x)
5. Enviar as **duas ordens ao mesmo tempo** — vendida numa, comprada na outra

O passo 5 é o momento de risco de execução. Entre a primeira perna e a segunda,
a posição é **direcional**. A mercado, a janela é de segundos; com ordem limite,
pode não fechar nunca — foi o que matou a ideia do maker
([QUANTO-RENDE.md](QUANTO-RENDE.md)).

### Manter

6. A cada 8 horas o funding é creditado ou debitado automaticamente
7. Quando o preço se move, uma perna perde margem e a outra ganha
8. Se a distância de liquidação cai, transferir margem — **ou fechar**

### Fechar

9. Duas ordens a mercado, uma em cada exchange

---

## Parte 3 — o que a realidade quebrou

### A transferência de margem tem um piso, e ele reescreveu o desenho

O saque mínimo de US$ 10 não é um custo. É uma **impossibilidade** abaixo dele.

No momento do alerta, a transferência necessária é
`margem_inicial × (1 − (alerta + mmr) × alavancagem)`:

| posições | margem/perna | transferência | possível? |
|---|---|---|---|
| 1 | US$ 50,00 | US$ 17,50 | sim |
| 2 | US$ 25,00 | US$ 8,75 | **não** |
| 3 | US$ 16,67 | US$ 5,83 | **não** |

Diluir em três posições — que eu tinha construído como melhoria de segurança —
**remove a capacidade de reequilibrar**. E sem ela, medido em 90 dias:

| política | ruína | mediana | fechamentos |
|---|---|---|---|
| só fechamento | 0,01% | **US$ 89,88** | 42,5 |
| completa | 0,03% | **US$ 111,67** | 0,2 |

Segura, e perdendo dinheiro. O motor agora calcula o limite sozinho:

```
limite de posições: 1 de 3 — transferir margem exige US$ 171 para 3 posições
```

### O tempo de transferência: NÃO medido

Assumi de 2 a 10 minutos. **Não verifiquei.** O que se sabe da mecânica:

| etapa | ordem de grandeza |
|---|---|
| processamento do saque pela exchange | segundos a minutos, variável |
| confirmações da rede | TRC20 ~1 min · BEP20 ~1 min · ERC20 ~3 min |
| crédito na exchange de destino | 1 a 12 confirmações, conforme a rede |
| spot → futuros no destino | instantâneo |

O teste de ruína cobre latências de 0 a 120 minutos e a degradação é suave
(0,03% → 0,25%), então o resultado não depende criticamente desse número. Mas
ele continua sendo suposição.

### O caminho feliz das exchanges também não é medido

Riscos operacionais reais que **nenhum código deste projeto cobre**:

- **Trava de 24h após mudar segurança.** Binance e outras bloqueiam saques por
  24 horas depois de alterar 2FA, senha ou lista de endereços. No meio de um
  desbalanceamento, isso torna a transferência impossível exatamente quando ela
  é necessária.
- **Endereço não cadastrado.** Várias exchanges exigem whitelist prévia. Sem o
  endereço cadastrado antes, o saque não sai.
- **Limite diário de saque por nível de KYC.**
- **Manutenção da rede.** A exchange pode suspender uma rede específica sem
  suspender as outras — o monitor de custódia detecta quando *todas* caem, mas
  não a preferida.
- **Depósito mínimo**, separado do saque mínimo. Enviar abaixo dele pode
  significar perda total do valor enviado.

**Nenhum destes está modelado.** Todos são motivos pelos quais uma transferência
planejada pode simplesmente não acontecer — e é por isso que o fechamento de
emergência nunca espera pela transferência.

---

## Parte 4 — o que continua sendo suposição

Listado sem suavizar, porque fingir cobertura é pior que a lacuna.

| item | estado | impacto se errado |
|---|---|---|
| tempo de transferência | suposto 2–10 min | baixo — a ruína degrada suavemente |
| trava de 24h, whitelist, limites de KYC | **não modelado** | **alto** — transferência pode falhar quando mais importa |
| depósito mínimo | não verificado | alto na primeira montagem |
| intervalo de funding por par | normalizado para 8h ao comparar; 3 pagamentos/dia na renda | médio em pares de funding horário |
| horário exato de pagamento por exchange | assumido alinhado | baixo |
| escorregamento em stress | medido em mercado calmo | médio — livro afina em cascata |
| alavancagem máxima na binance | não lida via ccxt | baixo — 5x cabe em qualquer tabela |
| taxa da bybit | tabela pública, não API | baixo |
| **duração real dos spreads** | **medindo desde 03/08/2026** | **decisivo** |

---

## Parte 5 — o que muda quando for dinheiro real

Três coisas que a simulação não pode ensaiar:

**1. As duas pernas precisam abrir juntas.** O motor simula abertura atômica. Na
realidade são duas chamadas de API a duas exchanges. Precisa de código que
detecte a perna solta e desfaça — e esse código **não existe ainda**, porque
nenhuma ordem é enviada.

**2. O funding é creditado pela exchange, não calculado por mim.** O motor
estima `notional × spread`. O real depende da taxa no instante exato do
pagamento e do notional exato naquele momento. A diferença é pequena, mas o
valor real precisa ser lido, não assumido.

**3. Falha parcial é o estado normal.** API fora do ar, ordem rejeitada por
margem insuficiente, posição parcialmente preenchida. Um sistema de paper
trading nunca vê nada disso.

---

## O portão que continua de pé

**Nada vai para dinheiro real sem 90 dias de paper trading.** E antes disso,
falta escrever a camada de execução que trata perna solta e falha de API — que
é, de longe, o maior bloco de trabalho restante.

Enquanto isso, o motor lê as exchanges e simula. **Nenhuma ordem foi enviada em
nenhum momento deste projeto.**

---

## Parte 6 — o modelo novo: dinheiro por exchange, sem saque entre elas

Escrito em 03/08/2026, depois que a auditoria mostrou que a transferência de
margem entre exchanges era inviável nesta escala.

### O que mudou

O motor tratava capital como **um número**. Agora trata como o que é: **contas
separadas, em exchanges separadas, que não se comunicam.**

```
saldos: { binanceusdm: 100, bybit: 100 }
```

Uma posição consome margem dos saldos das duas exchanges dela. O que sobra em
cada conta é **reserva de socorro**, e é dela que sai o reforço quando uma perna
aperta — transferência interna de spot para futuros.

**Nenhum dinheiro cruza entre exchanges. Nunca.**

### Por que isso é estritamente melhor

| | saque entre exchanges | socorro interno |
|---|---|---|
| tempo | 2 a 10 minutos | **instantâneo** |
| taxa | US$ 0,15 fixos | **zero** |
| valor mínimo | **US$ 10** | nenhum |
| trava de 24h após mudar segurança | sim | **não** |
| whitelist de endereço | exigida | **não** |
| limite diário de KYC | sim | **não** |

Todas as restrições operacionais que eu **não conseguia modelar** desaparecem,
porque o dinheiro nunca sai da exchange.

### Quanto deixar de reserva — medido, não escolhido

20 mil simulações de 90 dias, com US$ 100 em cada exchange:

| reserva | liquidado | mediana |
|---|---|---|
| 0% | 0,00% | US$ 203,39 |
| 15% | 0,01% | US$ 213,07 |
| **25%** | 0,04% | **US$ 214,59** |
| 35% | 0,01% | US$ 214,11 |
| 50% | 0,00% | US$ 211,79 |
| 65% | 0,01% | US$ 208,51 |

Sem reserva o motor fecha demais e perde renda. Com reserva demais, capital fica
parado. A curva é plana entre 15% e 35%; **30% é o padrão**, perto do ótimo e do
lado seguro dele.

### O bug latente que isso eliminou

O teto de 40% por exchange era **insatisfazível**. Cem por cento das
oportunidades usam apenas binance e bybit, e com duas exchanges a concentração
mínima é 50% — sempre.

| posições | margem/perna | teto de 40% | resultado |
|---|---|---|---|
| 1 | US$ 100 | US$ 80 | **bloqueava a primeira abertura** |

Nunca apareceu no log porque o portão de valor esperado roda antes e barrava
tudo primeiro. No dia em que uma candidata passasse no payback, o teto barraria —
e o motor ficaria parado sem motivo aparente.

O teto foi removido. Com apenas duas exchanges viáveis, a concentração de 50% é
uma decisão sua ao depositar, não algo que o motor possa otimizar.

### Um erro meu no caminho

A primeira medição da reserva deu US$ 100,62 contra US$ 111,67 sem ela, e eu
quase reportei "reserva local rende menos". Não fechava com a física: mesmo
notional tem de dar a mesma renda.

O funding ia para uma variável de capital separada, e o fechamento fazia
`capital = margem + reserva − custo`, **sobrescrevendo o valor e descartando
todo o funding acumulado**. A política sem reserva fecha 0,2 vezes em 90 dias e
mal sentia; a com reserva fecha 3 vezes e perdia quase toda a renda.

Era erro de contabilidade. A reserva **rende o mesmo** para o mesmo notional; o
que ela custa é capital parado, não renda.

---

## Parte 7 — os dois cenários de alocação

Reproduzir: `npm run cenarios`

### Uma exchange, US$ 100

Sem uma segunda casa não há spread de funding para arbitrar. A estrutura
possível é **spot + perpétuo na mesma exchange** (cash and carry): compra-se o
ativo à vista e vende-se o perpétuo dele.

```
depositado             US$ 100,00  (só binance)
reserva livre          US$  30,00
comprado à vista       US$  58,33   ← capital PARADO, não é margem
margem do perpétuo     US$  11,67
notional neutro        US$  58,33
renda semanal a 10%    US$   0,112
payback                10,2 dias
```

O spot come 58% do depósito sem gerar alavancagem. E a renda vem do funding
**absoluto** do perpétuo, que é menor que o spread entre duas casas.

### Duas exchanges, US$ 100 em cada

```
depositado             US$ 200,00  (US$ 100 em cada)
reserva livre por casa US$  30,00
margem por perna       US$  70,00
notional por perna     US$ 350,00   ← capital parado: ZERO
distância até liquidar 19,0% → 27,6% usando a reserva
renda semanal a 20%    US$   1,342
payback                 5,3 dias
```

### Por dólar depositado

| cenário | depositado | notional | renda/semana | por dólar | fôlego |
|---|---|---|---|---|---|
| uma exchange | US$ 100 | US$ 58 | US$ 0,112 | 0,112% | 19% |
| **duas exchanges** | US$ 200 | US$ 350 | US$ 1,342 | **0,671%** | 28% |

Seis vezes mais por dólar. A razão não é alavancagem — é que no cash and carry
58% do dinheiro fica parado no spot, e o retorno vem do funding absoluto em vez
do spread entre casas.

**Mas o cenário de uma exchange não é inferior em tudo:** ele elimina
completamente o risco de perna solta entre exchanges, que é o maior buraco de
execução ainda aberto. Se a camada de execução nunca for escrita, é a única
estrutura que dá para operar com segurança.
