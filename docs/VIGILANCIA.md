# Vigilância do mercado inteiro

> Como o projeto deixou de escolher entre 32 ativos que eu escolhi à mão e passou
> a escolher entre 3.492 pares que o mercado oferece.

---

## O problema que isso resolve

Até aqui o motor decidia assim: eu tinha listado 32 ativos considerados líquidos,
o motor varria esses 32 em 10 exchanges e operava o melhor spread entre eles.

O defeito é óbvio depois de escrito: **a lista era minha, não do mercado**. Se o
melhor funding do dia estivesse num ativo fora da lista, o motor nunca saberia.
E foi exatamente o que aconteceu — o motor operava SEI a 19,5% APR enquanto
KAITO pagava 36,2% e não havia como ele descobrir.

O pedido foi direto:

> "o mercado é completamente vasto, voce não consegue encontrar, ou ficar
> procurando e analisando recursivamente o mercado inteiro para procurar a melhor
> operação? algo que sempre está atualizando e não perdendo oportunidade, deve
> ser oportunista o projeto"

---

## Por que varrer o mercado inteiro é barato

A intuição diz que ler 3.492 pares deve ser 100× mais caro que ler 32. É falso, e
essa é a única razão pela qual isso funciona.

As exchanges expõem **endpoints em massa**. `fetchFundingRates()` sem argumento
devolve a taxa de financiamento de *todos* os perpétuos daquela exchange em uma
única requisição. Mesma coisa com `fetchTickers()` para volume. Então varrer o
mercado inteiro custa **duas requisições por exchange**, não uma por par.

Medido, com 5 exchanges:

| exchange     | pares | tempo  |
|--------------|-------|--------|
| binanceusdm  | 802   | 1,4 s  |
| okx          | 421   | 2,3 s  |
| bitget       | 733   | 3,6 s  |
| bybit        | 679   | 4,3 s  |
| gate         | 857   | 13,8 s |
| **total**    | **3.492** | **13,8 s** (em paralelo) |

A varredura inteira leva 13,8 s na primeira vez e cai para ~5,4 s depois, quando
os mercados já estão em cache. **A gate sozinha é 60% do tempo do ciclo** — as
outras quatro terminam em 4,3 s e ficam esperando por ela.

Comparação honesta: a varredura antiga, de 32 ativos, levava *minutos*, porque
buscava histórico de funding par a par. A varredura do mercado inteiro é mais
rápida que a varredura estreita. Foi por preguiça de arquitetura, não por custo,
que o projeto passou meses olhando para 32 ativos.

---

## Liquidez é obrigatória nas duas pontas

A primeira versão do filtro tratava volume ausente como "desconhecido, deixa
passar". O resultado foi um ranking liderado por pares com **US$ 0 de liquidez e
482% de APR** — spreads que existem no papel e não existem no livro de ofertas.

A regra agora:

```ts
const volMinimo = Math.min(alto.volume24h, baixo.volume24h);
if (volMinimo < volMin) continue;   // volMin = US$ 10M
```

O `Math.min` é o ponto. Uma operação delta-neutra tem duas pernas em exchanges
diferentes. Não adianta a perna vendida ter US$ 200M se a perna comprada tem
US$ 300 mil — a montagem escorrega na ponta fina. **A liquidez de uma operação
de duas pernas é a liquidez da perna pior.**

Também foi preciso um `Promise.race` com 8 s de timeout no `fetchTickers()`: a
bybit travava nessa chamada e devolvia zero pares, matando a exchange inteira da
varredura. Com o timeout, o volume dela vem vazio naquele ciclo mas o funding
continua sendo lido.

---

## Normalização: 8 h como base

Nem toda exchange paga funding no mesmo intervalo. Algumas pagam a cada 8 h,
outras a cada 4 h, outras a cada 1 h. Comparar taxas cruas é comparar coisas
diferentes: 0,01% a cada 1 h paga oito vezes mais que 0,01% a cada 8 h.

Antes de qualquer comparação, tudo é convertido para base 8 h:

```ts
const f8h = funding * (8 / (intervaloHoras || 8));
```

Sem isso, o ranking premia sistematicamente as exchanges de intervalo curto por
um motivo que não é o retorno real.

---

## Ciclo de vida: a parte que mudou o critério

Varrer o mercado dá uma foto. A foto sozinha engana.

Na primeira observação real, o par SKHY apareceu com 41,6% de APR — o melhor do
ranking instantâneo. **Abriu, fechou e reabriu em quatro minutos.** Qualquer
sistema que decidisse pela foto teria montado uma posição em algo que já não
existia quando a segunda perna fosse enviada.

Por isso a vigilância não guarda a foto, guarda o **histórico de cada
oportunidade**:

- `vigilancia/historico.jsonl` — append-only, uma linha por observação
- `vigilancia/ciclos.json` — estado vivo: quando cada spread abriu, quantas vezes
  foi visto, se já fechou

E o ranking não ordena por spread. Ordena por:

```
pontuação = spread médio × consistência²
```

A consistência é a fração das observações em que o spread se manteve acima do
mínimo. Estar ao quadrado é deliberado: **um spread que aparece metade das vezes
vale um quarto de um spread que sempre aparece**, mesmo com o dobro do tamanho.
A penalização é agressiva de propósito, porque o custo de montar e desmontar é
fixo e come spread transitório inteiro.

Comparação observada no mesmo ciclo:

| ativo | APR   | consistência | obs | vive há | veredito |
|-------|-------|--------------|-----|---------|----------|
| SKHY  | 41,6% | 40%          | 2   | 31 min  | maior APR, **rejeitado** |
| KAITO | 36,2% | 80%          | 4   | 35 min  | **escolhido** |
| MU    | 32,0% | 100%         | 1   | 0 min   | observações insuficientes |

SKHY paga mais e perde. É o comportamento correto.

---

## Mínimo de observações

O ranking exige **3 observações** antes de considerar um par elegível. Com ciclo
de 5 minutos, isso significa que uma oportunidade precisa sobreviver ~15 minutos
para ser candidata.

Isso custa alguma coisa: spreads genuínos de vida curta passam batido. É uma
troca aceita conscientemente, porque a alternativa medida — perseguir o spread
instantâneo — paga custo de montagem em posição que morre antes do primeiro
pagamento de funding.

---

## A estatística de ciclo de vida já mentiu — e eu repeti a mentira

Vale registrar, porque foi o erro mais caro do projeto.

A vigilância fechava um ciclo na **primeira** varredura em que o par não
aparecia. Parecia conservador. Só que os pares **piscam**: uma leitura falha,
uma exchange demora a responder, um par cai abaixo do volume mínimo por um
instante. Medido em 44 varreduras:

```
KAITO  38/44   ●●●●●●●●●●●●●●●●●●●·●●●···●··●●●●●●●●●●●●●●●
XAUT   38/44   ·●●·●●●●·●·●●●●●●●●●●●·●●●●●●●●●●●·●●●●●●●●●
AAVE   31/44   ············●●●●●●●●●·●●●●●●●●●●●●●●●●●●●●●●
```

O log então reportava, com toda a confiança:

> duração mediana 0,1h · **100% duraram menos de 2h** — a maioria é
> transitória, perseguir não paga o custo de montagem

**Isso media o bug, não o mercado.** Os spreads duravam; a contabilidade deles é
que não. E eu apresentei o número como se fosse uma descoberta sobre o mercado.

Pior: o motor lia a mesma ausência como "spread inverteu" e fechava a posição.
Oito fechamentos em duas horas e meia, US$ 2,30 de prejuízo — funding de US$ 0,17
contra US$ 2,48 de custo.

### As correções

1. **Tolerância de 3 faltas seguidas** (`TOLERANCIA_FALTAS`) antes de declarar um
   par morto. São 15 minutos, menos que o ciclo de 5 do motor, então um spread
   que morre de verdade continua sendo detectado a tempo.
2. **Segunda trava no motor**, exigindo 2 ciclos de ausência — para o caso de a
   vigilância reiniciar e perder estado.
3. **O aviso de amostra curta** no próprio log: a estatística agora exige 10
   fechamentos para aparecer, e abaixo de 100 varreduras imprime
   `⚠ amostra curta — não tire conclusão sobre o mercado`.

Os padrões reais de KAITO e XAUT entraram nos testes como literais, para que a
regressão não volte.

---

## O que substituiu a heurística

A pontuação `spread × consistência²` ordenava bem entre pares parecidos e era
cega para o que decidiu o resultado real: **se o par vive o bastante para pagar
o próprio custo de montagem**.

O critério agora é valor esperado em dólares, descrito em
[QUANTO-RENDE.md](QUANTO-RENDE.md#o-portão-de-valor-esperado). A consistência
continua entrando — mas como insumo da estimativa de vida, não como um expoente
escolhido a dedo.

---

## A ponte: como o motor consome isso

São **dois processos separados**, e a separação é deliberada.

```
  vigilância (5 min)                     motor (20 min)
  ─────────────────                      ──────────────
  varre 3.492 pares         escreve      lê ranking
  em 5 exchanges       ──►  ciclos.json  ──►  gerencia posição
  guarda histórico                       coleta funding
  ranqueia                               transfere margem
```

Varrer é lento (5–14 s) e gerenciar posição precisa ser rápido. Juntar os dois
num processo só faria o gerenciamento esperar a varredura. Separados, cada um
roda no seu ritmo.

A ponte é **um arquivo em disco, não uma chamada de função**. Isso parece menos
elegante e é mais seguro: se a vigilância morrer, o motor percebe pela idade do
dado.

```ts
export const IDADE_MAXIMA_MS = 20 * 60_000;
```

Acima de 20 minutos, `lerVigilancia()` devolve `disponivel: false` e o motor cai
para a própria varredura estreita — que é pior, mas é fresca. **Operar às cegas
com informação velha é o pior dos dois mundos**, e é o único caso que a ponte
existe para impedir.

O motor loga qual fonte está usando, e só loga quando ela muda:

```
[2026-08-02T18:57:11] fonte: vigilância · 4 varreduras · dado de 1 min · 1 candidatos
```

Se aparecer `fonte: varredura própria`, a vigilância caiu.

---

## O que aconteceu quando ligou

Primeiro ciclo do motor com a vigilância ligada:

```
[18:57:11] fonte: vigilância · 4 varreduras · dado de 1 min · 1 candidatos
[18:57:14] FECHA SEI — spread INVERTEU (sumiu da varredura)
           custo US$ 0.250 · funding acumulado US$ 0.045
```

O motor estava em SEI (19,5% APR, escolhido pela varredura de 32 ativos). Ao
enxergar o mercado inteiro, SEI não apareceu mais entre os candidatos com
qualidade sustentada — e a posição foi fechada no mesmo ciclo, sem esperar o
prazo mínimo.

Esse fechamento imediato é uma correção anterior que só agora fez efeito: quando
o ativo da posição some da varredura, o motor não espera `diasMinimos`. Ficar
preso num spread que inverteu é pagar para perder.

---

## Ficheiros

| ficheiro | papel |
|----------|-------|
| `src/funding/universo.ts` | varredura em massa das 5 exchanges |
| `src/funding/vigilancia.ts` | ciclo de vida, ranking, poda do histórico |
| `src/funding/ponte.ts` | conversão vigilância → motor + guarda de idade |
| `src/cli/vigilancia.ts` | processo contínuo |
| `run-vigilancia.cmd` | supervisor da vigilância |
| `run-tudo.cmd` | sobe os três processos na ordem certa |

Estado em `vigilancia/` (fora do git — é dado de execução, não código).

---

## Como subir

```bat
run-tudo.cmd
```

A ordem importa. A vigilância sobe primeiro e o script espera 25 s antes de subir
o motor, para que o primeiro ciclo do motor já encontre dado fresco em vez de
cair para a varredura estreita.

O dashboard em `http://localhost:8787` mostra qual fonte está no ar, quantas
varreduras já correram e quantos spreads estão vivos.

---

## O que ainda não está resolvido

- **A gate domina o tempo de ciclo** (60%). Vale medir se ela paga o que custa,
  ou se sai da lista.
- **Uma posição por vez.** A vigilância enxerga vários spreads bons ao mesmo
  tempo e o motor só consegue montar um. Diversificar entre 2–3 pares
  descorrelacionados reduziria a dependência de um único par continuar pagando.
- **20 minutos de ociosidade** entre fechar e abrir. Fechar e abrir acontecem em
  ciclos diferentes por causa de um `return` cedo. Não é errado — evita decidir a
  abertura com o estado da posição pela metade — mas é renda deixada na mesa.
- **Cinco exchanges na vigilância, contra dez na varredura antiga.** Só entram as
  que expõem endpoint em massa de funding. As outras cinco exigiriam uma
  requisição por par, o que quebraria o custo.

---

*Nenhuma ordem é enviada. As exchanges são apenas lidas.*
