# Continuidade

> **Para o próximo Claude que pegar este projeto.** Este documento existe para
> que nada se perca se a sessão acabar, o limite semanal for atingido, ou muito
> tempo passar. Leia isto antes de qualquer outro arquivo.

Última atualização: **03/08/2026**.

---

## 0. O essencial em dez linhas

- **Projeto:** `C:\Users\Renan\Projetos\Snowball` — motor de renda delta-neutra
  em cripto, escrito do zero em TypeScript nativo do Node 24.
- **Usuário:** Renan. Fala português. Salário de R$ 3.000/mês, capital inicial
  de US$ 100. Quer **lucro semanal** e **não perder tudo**.
- **Estado:** paper trading. **Nenhuma ordem foi enviada a nenhuma exchange, em
  nenhum momento.** Só leitura de mercado e simulação.
- **Capital de paper:** US$ 100 em CADA exchange (binance e bybit), total
  US$ 200. Declarado com `--porExchange 100`. O dinheiro NUNCA cruza entre
  exchanges: o socorro de margem vem da reserva de 30% na própria exchange.
- **Resultado até agora:** o motor perdeu US$ 2,30 num período de 9,3 horas por
  dois bugs meus, ambos corrigidos. Estado sujo arquivado em `spread/arquivo/`.
- **A conta que decide tudo:** custo de montagem = `notional × taxa × 4`,
  receita = `notional × spread` a cada 8h. **O notional se cancela.**
  Alavancagem e capital não decidem se vale a pena; só taxa, spread e tempo de
  vida.
- **Comportamento atual esperado:** o motor **não abre posição**. Isso é
  correto, não é falha.

---

## 1. Quem é o usuário e o que ele pediu

Renan pediu, em ordem cronológica, e **nada disso foi revogado**:

| Pedido | Estado |
|---|---|
| Replicar o bot de um vídeo do YouTube (5381%) | ✅ feito, e desmentido |
| Começar com o mínimo de dinheiro possível | ✅ US$ 100 |
| Snowball sem quebrar | ✅ travas de ruína implementadas |
| Pesquisa: GitHub, notícias, papers, rede aberta | ✅ feito |
| MCP trader.dev como fonte principal | ✅ usado; ver `docs/MCP.md` |
| Machine learning | ✅ meta-labeling, GBDT do zero |
| Documentar **absolutamente tudo**, vários documentos extensos | ✅ 18 documentos |
| Documento cronológico | ✅ `docs/CRONOLOGIA.md` |
| **Lucro toda semana** | ⚠️ estrutura entrega, tamanho é pequeno |
| Volatilidade **com** segurança contra perder tudo | ✅ ver `docs/PROTECAO-RUINA.md` |
| Varrer o mercado inteiro, recursivamente, sem perder oportunidade | ✅ 3.492 pares/5 min |
| Dashboard profissional, foco em UX | ✅ `localhost:8787` |
| Commitar no GitHub | ⚠️ commits locais feitos; **push pendente** |
| Pasta e nome exclusivos | ✅ `C:\Users\Renan\Projetos\Snowball` |

### Instruções permanentes dele, que valem para você também

1. **"voce não faz mais perguntas voce apenas executa o melhor caminho"** — decida
   e execute. Não peça permissão para cada passo.
2. **"eu não quero ler denovo voce falando sobre pior resultado ou que está
   piorando se algo nao da certo procure outro apenas"** — não fique repisando
   fracasso. Reporte o fato uma vez e siga para a alternativa.
3. **"qualquer coisa que começar a remover trades lucrativos voce não aplica
   apenas testa e reporta na documentação"** — **regra permanente.** Um filtro
   que remove trades comprovadamente perdedores é permitido; um que remove
   lucrativos vira experimento documentado, fora da produção.
4. Ele **checa o que você afirma**. Já mandou prints provando que eu tinha
   testado os ativos errados e implementado 3 de 5 estratégias erradas. Não
   afirme o que não mediu.

---

## 2. O que o sistema é

Quatro processos independentes que se comunicam por **arquivos em disco**, não
por chamadas. A escolha é de robustez: se um morre, os outros percebem pela
idade do dado em vez de travar.

```
  VIGILÂNCIA  (5 min)      varre 3.492 pares em 5 exchanges
      │                    guarda o ciclo de vida de cada oportunidade
      │  vigilancia/ciclos.json
      ▼
  MOTOR       (5 min)      lê o ranking, decide, gere margem
      │                    NUNCA ENVIA ORDEM
      │  spread/estado.json · spread/diario.jsonl
      ▼
  DASHBOARD                painel em localhost:8787

  CUSTÓDIA    (15 min)     saúde das exchanges → vigilancia/custodia.json
                           (o motor lê e evacua se uma for sinalizada)
```

### A estratégia, em um parágrafo

Arbitragem de taxa de financiamento entre exchanges. Vende o perpétuo onde o
funding é alto, compra o mesmo perpétuo onde é baixo. As duas pernas se cancelam
em preço — **exposição direcional zero por construção**. A renda vem do funding,
que é um pagamento contratual entre traders, não uma previsão. Medido em 180
dias: 48 de 48 semanas positivas.

**Por que isso e não direcional:** o pedido era lucro semanal. Direcional dava
45,1% de semanas positivas com a semana mediana negativa. Padrão que atravessa o
projeto: **prever falhou 3 de 3 vezes, reagir funcionou 3 de 3.**

---

## 3. A conta que decide tudo

Se você só ler uma seção, leia esta.

```
custo ida e volta = notional × taxa × 4      (2 pernas × abrir e fechar)
receita por 8h    = notional × spread
```

**O notional multiplica os dois termos, então se cancela.** Consequência que
contradiz boa parte do esforço anterior do projeto:

> **Alavancagem e capital não decidem se uma operação vale a pena.**
> Só taxa, spread e tempo de vida decidem.

Quanto tempo uma posição precisa viver só para empatar:

| APR do spread | taker 0,05% | maker 0,02% |
|---|---|---|
| 20% | **3,6 dias** | 1,5 dias |
| 35% | **2,1 dias** | 0,8 dia |
| 76% | 1,0 dia | 0,4 dia |

O motor abria posições que precisavam de dois dias e as fechava em horas. É a
explicação inteira do prejuízo.

---

## 4. Os dois bugs que custaram dinheiro

Registrados em detalhe porque são o conteúdo mais útil do projeto, e porque a
tentação de "simplificar" o código pode reintroduzi-los.

### 4.1 Os pares piscam, e eu tratava piscar como morrer

A vigilância fechava o ciclo de vida de um par na **primeira** varredura em que
ele não aparecia. Medido em 44 varreduras:

```
KAITO  38/44   ●●●●●●●●●●●●●●●●●●●·●●●···●··●●●●●●●●●●●●●●●
XAUT   38/44   ·●●·●●●●·●·●●●●●●●●●●●·●●●●●●●●●●●·●●●●●●●●●
```

Os buracos são leitura que falha, exchange lenta, par abaixo do volume mínimo
por um instante. O motor lia a ausência como "spread inverteu" e fechava,
pagando US$ 0,08 a US$ 0,25 por buraco de cinco minutos.

**Correção:** `TOLERANCIA_FALTAS = 3` em `src/funding/vigilancia.ts` (15 min,
menor que o ciclo de 5 min do motor) mais uma segunda trava no motor exigindo
2 ciclos de ausência. Os padrões reais estão nos testes como literais.

**Consequência que quase passou batido:** a estatística de ciclo de vida
reportava *"duração mediana 0,1h · 100% duraram menos de 2h"* e eu apresentei
isso ao usuário como uma descoberta sobre o mercado. **Media o bug.** Todo dado
de duração anterior a 02/08/2026 é lixo.

### 4.2 Não havia portão de payback

O motor abria qualquer par com spread acima de um mínimo irrisório, sem nunca
perguntar se ele viveria o suficiente para pagar o próprio custo.

Resultado das 8 posições abertas antes do portão: **funding US$ 0,17 contra
custo US$ 2,48**. Zero lucrativas.

**Correção:** `src/funding/valor.ts`. Valor esperado em dólares substituiu a
heurística `spread × consistência²`. Ordenação e portão usam a mesma grandeza
(valor por hora de capital ocupado), então não existe o caso de a ordem preferir
um par que o filtro rejeita.

---

## 5. As travas de risco, e por que cada uma existe

Detalhe completo em `docs/PROTECAO-RUINA.md`. Resumo do que **não pode ser
removido sem medir**:

| Trava | Onde | Por quê |
|---|---|---|
| Distância de liquidação por perna | `protecao.ts` | 99,97% de liquidação sem ela, 0,03% com ela |
| Transferir a 12% de distância | `protecao.ts` | transferir custa US$ 0,01, liquidar custa US$ 50 |
| Fechar a 6% de distância | `spread-live.ts` | transferência leva minutos; salto não espera |
| Piso de capital em catraca | `protecao.ts` | trava o lado de baixo sem limitar o de cima |
| Teto de 40% por exchange | `spread-live.ts` | sem ele, 3 posições não diluem nada |
| Evacuação por saúde de exchange | `custodia.ts` | saque suspenso aparece antes da notícia |
| Portão de valor esperado | `valor.ts` | a ausência dele é o prejuízo inteiro |

**Alavancagem:** 5x. O limite medido é 7,7x. A 8x a posição já nasce dentro da
faixa de alerta e a taxa de liquidação salta de 0,17% para 13,85%.

---

## 6. Armadilhas técnicas deste repositório

Coisas que já quebraram e vão quebrar de novo se você não souber.

**Node 24 em modo strip-only.** Não existe transpilação, só remoção de tipos.
Portanto:
- ❌ `constructor(private o: Options)` — parameter properties não funcionam.
  Isso deixou o executor sem rodar por uma sessão inteira enquanto a
  documentação dizia "pronto".
- ❌ `enum` — use union de strings.
- ⚠️ `a ? [x] : []` — a sequência `?[` é ambígua com optional chaining e o
  parser recusa o arquivo. Use `a && [x] || []`.

**`src/dashboard/pagina.ts` é um template literal gigante.** O JavaScript do
navegador vive dentro de crases. **Uma crase em um comentário fecha a string** e
derruba o servidor inteiro com um erro de sintaxe apontando para o lugar errado.
Já aconteceu.

**Memória.** Duas causas já corrigidas: instâncias novas de ccxt a cada
varredura (resolvido com pool) e 28.133 mercados carregados para operar 32
ativos (resolvido podando `ex.markets`). Se a RAM crescer, é aqui.

**A gate consome 60% do tempo de varredura** sozinha. As outras quatro exchanges
terminam em 4,3s e esperam por ela.

**Windows.** `Move-Item` falha com arquivo em uso, inclusive pelo próprio shell.
Use `Set-Location` para fora e depois `robocopy /MOVE`.

---

## 7. O que fazer agora — em ordem

### 7.1 Prioridade absoluta: medir duração de spread com dado limpo

**Tudo que este projeto mediu sobre duração de spread mede o bug do piscar.** A
medição limpa começou em 02/08/2026 e leva dias.

É o número que decide se o portão de valor esperado alguma vez libera uma
posição. Sem ele, qualquer conclusão sobre lucratividade é chute.

**Como verificar:** rode `npm run custodia` e olhe `vigilancia/live.log`. A
estatística de ciclo de vida só aparece com 10 fechamentos e avisa `⚠ amostra
curta` abaixo de 100 varreduras. **Respeite o aviso.** Foi ignorá-lo que me fez
reportar um número errado com confiança.

### 7.2 Não afrouxe o portão para "ver algo acontecer"

O motor ficar sem abrir posição é o resultado correto quando o mercado não
oferece nada que pague o atrito. Afrouxar o portão foi exatamente o que custou
os US$ 2,30.

Se o usuário perguntar por que nada acontece, a resposta é a tabela de payback
da seção 3, não um ajuste de parâmetro.

### 7.3 Pendências reais

| # | O quê | Nota |
|---|---|---|
| 21 | Medir duração real de spread | bloqueado por tempo, não por código |
| 19 | Imposto de renda no simulador | 15% sobre ganho em cripto no Brasil, isenção até R$ 35 mil/mês em vendas |
| — | Push para o GitHub | `gh` não está instalado; usar GitHub Desktop |
| — | Rotacionar a chave do trader.dev | foi colada no chat: `pk_hTAB...` |

### 7.4 Ideias avaliadas e rejeitadas — não refaça

| Ideia | Por que não |
|---|---|
| Taxa maker para baratear | só compensa acima de 90% de preenchimento; abaixo disso o risco de perna solta custa mais. `npm run execucao` |
| Mais alavancagem | não muda o payback, e a 8x a ruína salta para 13,85% |
| Mais capital | não muda o payback; muda só a escala absoluta |
| Perseguir o maior APR instantâneo | INJ apareceu a 44,8% e a média real em 14 dias era 15,9% |
| Trading direcional em 5 min | edge +0,15R contra custo −0,16R |

---

## 8. Como rodar e verificar

```bash
run-tudo.cmd          # sobe os quatro processos com supervisor
```

```bash
npm test              # 56 testes das travas de risco e seleção
npm run ruina         # 20 mil simulações contra choques de preço
npm run execucao      # maker × taker, com risco de perna solta
npm run semanas       # projeção semana a semana
npm run custodia      # saúde das exchanges
```

**Sinais de que está saudável:**

```
[hh:mm:ss] fonte: vigilância · N varreduras · dado de M min · K candidatos
```
Se disser `fonte: varredura própria`, a vigilância caiu.

```
valor esperado barrou N candidatas · melhor candidata X · vida esperada Ah
contra payback de Bh
```
Isto é **normal e correto**. Significa que nada compensa agora.

**Sinais de problema:**
- `fonte: varredura própria` de forma persistente → vigilância morta
- RAM de qualquer processo crescendo sem parar → ver seção 6
- `ALERTA sem ação` repetido → alavancagem alta demais para o limiar

---

## 9. Mapa dos arquivos

### Núcleo — mexer aqui exige entender as seções 3 e 4

| Arquivo | Papel |
|---|---|
| `src/funding/valor.ts` | valor esperado; **o critério de decisão** |
| `src/funding/tesouraria.ts` | dinheiro por exchange, reserva e socorro interno |
| `src/funding/custos-reais.ts` | taxas, escorregamento e saque medidos das exchanges |
| `src/funding/protecao.ts` | distância de liquidação, piso, catraca |
| `src/funding/vigilancia.ts` | ciclo de vida, Wilson, tolerância a faltas |
| `src/funding/spread-live.ts` | o motor: abre, gere, apara, fecha |
| `src/funding/ponte.ts` | vigilância → motor, com guarda de idade |
| `src/funding/custodia.ts` | saúde de exchange, peso, evacuação |
| `src/funding/universo.ts` | varredura em massa das 5 exchanges |
| `src/funding/execucao.ts` | modelo maker × taker |

### Documentos

| Documento | Para quê |
|---|---|
| `COMECE-AQUI.md` | resumo de uma página para o usuário |
| `docs/QUANTO-RENDE.md` | a conta de payback e as projeções |
| `docs/PROTECAO-RUINA.md` | travas de risco e teste de ruína |
| `docs/EXECUCAO-REAL.md` | verificado × suposto contra as exchanges reais |
| `docs/VIGILANCIA.md` | a varredura e o bug do piscar |
| `docs/DELTA-NEUTRO.md` | por que esta estratégia |
| `docs/CRONOLOGIA.md` | tudo, fase a fase |
| `docs/O-QUE-FALHOU.md` | testado e descartado |
| `docs/PEDIDOS.md` | rastreio dos pedidos do usuário |

### Estado em disco — fora do git

```
spread/estado.json        posições e capital
spread/diario.jsonl       todo evento, append-only
spread/arquivo/           estados anteriores, arquivados
vigilancia/ciclos.json    ciclo de vida vivo
vigilancia/historico.jsonl toda observação, append-only
vigilancia/custodia.json  saúde das exchanges
```

---

## 10. Como falar com o Renan

- **Português.** Direto, sem preâmbulo.
- **Números medidos, não estimados.** Se não mediu, diga que não mediu.
- **Quando errar, corrija de uma vez e siga.** Sem ruminar.
- **Ele quer ver o projeto rodando.** Deixe processos no ar quando ele pedir, e
  confirme com evidência do log, não com "deve estar funcionando".
- **Não invente resultado positivo.** Ele confere.

---

## 11. A honestidade do estado atual

Se o usuário perguntar "isso vai dar lucro?", a resposta verdadeira hoje é:

> Ainda não sei, e ninguém pode saber com o dado que existe. A estrutura entrega
> semana positiva por construção — funding é pagamento contratual, não aposta.
> Mas o tamanho depende de os spreads viverem mais que o payback, e essa medição
> começou do zero em 02/08/2026 porque tudo que veio antes media um bug.

O que **é** sólido:

- A estrutura elimina risco de preço. Isso é matemática, não previsão.
- As travas de ruína foram testadas em 20 mil simulações.
- O portão impede repetir o prejuízo conhecido.

O que **não** é:

- Que exista spread suficiente, com vida suficiente, nesta escala de taxa.
