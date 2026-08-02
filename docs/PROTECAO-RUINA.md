# Proteção contra ruína

> A estrutura delta-neutra elimina o risco de preço. Este documento é sobre o
> risco que ela **não** elimina, e o que foi construído contra ele.

Reproduzir: `npm test` e `npm run ruina`.
Código em `src/funding/protecao.ts` e `src/cli/ruina.ts`.

---

## O que estava descoberto

O motor de spread monitorava desbalanceamento e transferia margem quando metade
dela era consumida. Não tinha **circuit breaker**, **piso de capital** nem
**trava de liquidação**. O `liquidation.ts` e o ratchet construídos antes tinham
ficado na trilha direcional e nunca foram ligados a este motor.

Ou seja: a frase "sem risco de perder tudo" não descrevia o que estava rodando.

---

## A assimetria que decide a política inteira

| ação | custo a US$ 250 de notional |
|---|---|
| transferir margem | **~US$ 0,01** |
| rotacionar de par | US$ 0,50 |
| ser liquidado | **~US$ 50** |

Transferir é **mil vezes** mais barato que ser liquidado. Então a política certa
não é economizar transferência — é transferir cedo e com frequência.

Isso respeita a regra permanente do projeto: transferir **não remove nenhum
trade lucrativo**. O dinheiro só muda de exchange, a posição continua montada e
o funding continua entrando.

---

## Os três níveis

A grandeza monitorada é a **distância de liquidação** de cada perna:

```
distância = margem / notional − margem_de_manutenção
```

A margem de manutenção não é detalhe: a perna morre quando a perda consome a
margem **até** o mmr, não a margem inteira. Ignorá-lo superestima o fôlego, que
é o erro perigoso a se cometer aqui.

A 5x, com margem de US$ 50 e notional de US$ 250 por perna:

| nível | distância restante | movimento de preço | ação |
|---|---|---|---|
| ok | acima de 12% | até 7% | nada |
| **alerta** | 12% | 7% | transfere margem, igualando as pernas |
| **crítico** | 6% | 13% | fecha as duas pernas |
| liquidação | 0% | 19% | a exchange fecha, e cobra por isso |

Os limiares saem do tempo, não de preferência. Transferência entre exchanges
leva de 2 a 10 minutos; o motor acorda a cada 20. No pior caso passam 30 minutos
entre detectar e ter a margem creditada — e um alt líquido move 10% em 30
minutos em dias de stress.

**Fechar nunca espera a transferência.** Fechar é uma ordem local em cada
exchange e não depende de dinheiro chegar. Bloquear isso seria um defeito de
projeto — e foi um defeito do modelo, corrigido (ver abaixo).

---

## O piso de capital: catraca

Assimétrico de propósito. O piso sobe quando o capital sobe e **nunca desce**:

```
piso = max(piso_absoluto, pico × 0,85)
```

Travar o lado de baixo não custa nada no lado de cima — o motor segue livre para
compor enquanto estiver acima. O piso absoluto é 80% do capital inicial, e
acompanha o capital (`--piso` para mudar): fixá-lo em US$ 80 seria inócuo com
US$ 500 e paralisante com US$ 50.

Ao tocar o piso, o motor **fecha o que estiver aberto e para**. Não volta
sozinho, nem reiniciando o processo — o estado `parado` fica persistido. É
deliberado: se tocou o piso, alguma premissa quebrou, e a decisão de voltar é
humana.

Perder 20% numa estrutura sem exposição a preço não significa que o mercado
andou. Significa que algo do desenho está errado.

---

## Teste de ruína

90 dias, 20.000 simulações, US$ 100 a 5x, APR 20%, volatilidade diária de 5% e
~10 saltos por ano de 2% a 12%.

| política | liquidado | mediana | p5 | p95 |
|---|---|---|---|---|
| nenhuma | **99,97%** | $95,68 | $95,06 | $97,76 |
| só transferência | 5,63% | $111,68 | $96,82 | $111,76 |
| **completa** | **0,03%** | $111,67 | $102,26 | $111,76 |

A proteção completa custou **zero** na mediana — na verdade pagou +$15,99, porque
a política "nenhuma" perde a posição e para de coletar funding.

O fechamento de emergência é o que remove os últimos 5,6%. Só transferir não
basta, porque a transferência tem latência e o salto não espera.

### Alavancagem

| alavancagem | distância inicial | liquidado | renda/semana |
|---|---|---|---|
| 3x | 32,3% | 0,02% | $0,58 |
| 4x | 24,0% | 0,01% | $0,77 |
| **5x** | **19,0%** | **0,03%** | **$0,96** |
| 6x | 15,7% | 0,17% | $1,15 |
| 8x | 11,5% | **13,85%** | $1,53 |
| 10x | 9,0% | **54,70%** | $1,92 |

O penhasco está entre 6x e 8x, e não é coincidência: **a 8x a posição já nasce
dentro da faixa de alerta** (11,5% < 12%). Não há pista de reação — ela começa o
jogo em estado de emergência.

O limite calculado é `1 / (alerta + mmr) = 7,7x`. 5x fica confortavelmente
abaixo, com 19% de distância inicial contra 12% de gatilho.

### Latência de transferência

| latência | liquidado |
|---|---|
| 0 min | 0,03% |
| 20 min | 0,03% |
| 40 min | 0,06% |
| 60 min | 0,07% |
| 120 min | 0,25% |

Degradação suave. O fechamento de emergência é o que segura isso — sem ele, a
latência viraria um penhasco.

---

## Dois erros do próprio modelo, e o que eles revelaram

Um teste de ruína que erra para melhor é pior que nenhum teste. Os dois erros
abaixo foram encontrados olhando para resultados que não faziam sentido físico.

### 1. Fechar bloqueado por transferência em trânsito

A primeira versão exigia que nenhuma transferência estivesse em trânsito para
tomar **qualquer** ação. O resultado foi um degrau absurdo: 0,08% de liquidação
com 20 minutos de latência e **42,27%** com 40 minutos.

A causa não era a latência — era a posição ficar paralisada esperando um saque
enquanto o preço corria. Fechar não depende de transferência. Corrigido no
modelo **e** confirmado como comportamento correto no motor.

### 2. Reset de referência apagando a deriva

A versão inicial reconstruía a margem a partir de um `precoRef`, resetado a cada
transferência. Quando o valor transferido era **zero** — o que acontece quando a
posição nasce em alerta, de 8x para cima, com as pernas já iguais — o reset
apagava a deriva acumulada sem mover nada.

O sintoma: **8x e 10x apareciam com 0,00% de liquidação e mediana maior que 5x**.
O oposto da física.

A correção foi trocar a reconstrução por **contabilidade incremental**: o
movimento de cada ciclo é aplicado direto na margem de cada perna. Isso elimina
a classe inteira de erro.

**O mesmo bug estava no motor**, herdado do mesmo desenho. Corrigido lá também,
mais uma guarda: transferir menos de 0,1% do notional não faz nada e agora é
registrado como `ALERTA sem ação — a alavancagem é alta demais para o limiar`
em vez de fingir que agiu.

---

## O ranking também estava causando perda

Descoberto em operação, no mesmo dia. O motor montou MU e o par sumiu **doze
minutos depois**, custando US$ 0,50 — mais de meia semana de renda.

A causa estava na seleção:

| par | spread | consistência | observações | pontuação antiga |
|---|---|---|---|---|
| MU | 0,0313% | **100%** | **3** | 3,13e−4 ← venceu |
| KAITO | 0,0331% | 86% | 6 | 2,45e−4 |

**Cem por cento de três amostras não é cem por cento; é ignorância.**

A correção usa o limite inferior do intervalo de Wilson, que responde "qual a
menor consistência que esta amostra sustenta com 95% de confiança":

| observações | consistência bruta | ajustada |
|---|---|---|
| 1 | 100% | 20,7% |
| 3 | 100% | 43,8% |
| 6 | 100% | 61,0% |
| 12 | 100% | 75,7% |
| 30 | 100% | 88,6% |
| 6 | 86% | 46,1% |

Com o ajuste, KAITO passa a vencer — e o teste guarda a regressão com os números
reais do caso.

O ajuste **não remove nenhum candidato**: o mesmo conjunto entra no ranking, só
em ordem melhor. Isso importa porque a projeção mostrou que reduzir rotação de
1/semana para 1/mês quase triplica o resultado.

---

## O que continua sem trava

Nenhum código protege contra:

- **Falência de exchange ou congelamento de saque.** Metade do capital está em
  cada uma. O único mitigante é dividir entre mais exchanges — não implementado.
- **Gap sem negociação.** Se o preço salta sem livro no meio, não há como fechar
  no caminho.
- **Falha de API.** O motor cego não protege nada.

E o mais importante: **nada disso enviou uma ordem ainda.** Todos os números
acima vêm de leitura de exchange e simulação. Execução real, escorregamento
real, atraso de transferência real e queda de API ainda não foram enfrentados.

---

## Parâmetros

```bash
node src/cli/spread-live.ts --equity 100 --alavancagem 5 --piso 80 --fracaoPico 0.85
npm run ruina                                    # teste padrão
node src/cli/ruina.ts --alavancagem 8 --vol 0.08 # regime de stress
```
