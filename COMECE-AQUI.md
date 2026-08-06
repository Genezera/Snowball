# Comece aqui

Renan — o projeto em uma página, atualizado em **06/08/2026**. Para o handoff
completo (o que mudou, o que tem cuidado técnico, o que falta), leia
[CONTINUIDADE.md](CONTINUIDADE.md) — este arquivo aqui é só o resumo rápido.

---

## Onde está agora

**8 processos rodando**, supervisionados pelo watchdog. Três motores
independentes, todos paper:

- **Modo normal** (delta-neutro) — US$ 100 por exchange, nas 6 exchanges
  (~US$ 600 total), usando a que o mercado favorecer.
- **Modo agressivo** (ts-momentum) — US$ 200, experimental, só no backend.
- **Pares cointegrados** (mercado-neutro) — US$ 200, experimental, novo.

Nenhuma ordem foi enviada a nenhuma exchange, em nenhum momento deste projeto.
Tudo é leitura de mercado e simulação.

O motor normal está **barrando quase todas as candidatas** — e isso é o
comportamento correto, não uma falha. Nenhum dos 15 pares de exchange
monitorados tem spread com vida suficiente pra pagar o próprio custo agora
(folga real ~0,004–0,06, precisa de 1,5).

Uma medição real rodando desde esta sessão (item B6 do backlog): se ordem
limite (maker) preenche rápido o bastante pra valer a pena trocar pela ordem
a mercado. **Achado, com 1000+ amostras: a seleção adversa medida é maior do
que a constante de custo que ela substituiria** — o oposto do que se
esperava. Ver `docs/RESULTADOS.md` quando for atualizado com esse número.

---

## A conta que decide tudo

Levou o projeto inteiro para chegar aqui, e ela cabe em três linhas:

```
custo ida e volta = notional × taxa × 4
receita por 8h    = notional × spread
```

**O notional se cancela.** Ele multiplica os dois termos, então não muda o sinal
do resultado — só a escala.

Isso contradiz boa parte do esforço anterior: **alavancagem e capital não decidem
se uma operação vale a pena.** Só taxa, spread e tempo de vida decidem.

Quanto tempo uma posição precisa viver só para empatar:

| APR do spread | payback |
|---|---|
| 20% | **3,6 dias** |
| 35% | **2,1 dias** |
| 76% | 1,0 dia |

O motor abria posições que precisavam de dois dias e fechava em horas. Foi por
isso que perdeu dinheiro.

---

## O que aconteceu, em ordem

**1. O vídeo estava errado, mas as estratégias não eram lixo.** Profit factor
1,22–1,25, batendo com os números do autor. Só que o edge (+0,15R) era menor que
o custo (−0,16R) em 5 minutos. Em 4 horas o `body-breakout` deu expectancy
positiva out-of-sample nos 5 ativos testados; em 5 minutos, 24 de 25 testes
reprovaram.

Sobre os 5381%: a spec do trader.dev **exige** `commission=0`, o dashboard deles
admite "Proof state: BLOCKED / NO live track record", e a estratégia do número
grande tem Sharpe 0,376. Detalhes em [docs/O-QUE-FALHOU.md](docs/O-QUE-FALHOU.md).

**2. Direcional não entrega lucro semanal.** O melhor candidato dava 45,1% de
semanas positivas, com a semana mediana negativa. Não é defeito da estratégia —
é o que significa prever preço.

**3. O pivô: parar de prever, começar a cobrar.** Arbitragem de funding
delta-neutra. Duas pernas que se cancelam em preço, vendida onde o funding é
alto e comprada onde é baixo. Exposição a preço **zero por construção**. Medido
em 180 dias: 48 de 48 semanas positivas.

**4. O mercado inteiro, não uma lista minha.** 3.492 pares em 5 exchanges a cada
5 minutos, via endpoints em massa — 13,8 segundos por varredura.

**5. As travas contra ruína.** Distância de liquidação por perna, piso de
capital em catraca, evacuação por saúde de exchange, teto de 40% de exposição
por exchange. Teste de ruína: 99,97% de liquidação sem proteção contra 0,03% com
ela — e a proteção **pagou** US$ 15,99 na mediana em vez de custar.

**6. O prejuízo, e as duas causas.** Nove horas de operação: **−US$ 2,30**.
Ambas as causas eram minhas.

---

## Os dois erros que custaram dinheiro

Registrados porque são o conteúdo mais útil do projeto.

**Os pares não invertiam — piscavam.** KAITO apareceu em 38 de 44 varreduras,
com buracos de uma e duas. A vigilância fechava o ciclo na **primeira** ausência
e o motor lia isso como "spread inverteu". Cada buraco de cinco minutos virava
um fechamento de US$ 0,08 a US$ 0,25.

Pior: a estatística que eu te apresentei com confiança — *"100% duraram menos de
2h, perseguir não paga o custo"* — **media o meu bug, não o mercado.**

**Não havia portão de payback.** O motor nunca perguntava se o par viveria o
suficiente para pagar o próprio custo. Das oito posições abertas, **zero deram
lucro** — funding de US$ 0,17 contra US$ 2,48 de custo.

---

## O que isso significa para os US$ 100

Sendo direto: **nesta escala de taxa, o mercado das últimas horas não ofereceu
nada que pague o próprio atrito.**

Não é o sistema quebrado. É o sistema medindo corretamente e dizendo não.

Três coisas mudariam isso, e nenhuma depende de escrever mais código:

1. **Um regime de funding melhor.** A 76% de APR o payback cai para 1 dia. É a
   variável que mais move o resultado e a menos controlável.
2. **Tempo de observação.** Pares que sobrevivem dias cruzam o portão sozinhos.
   A vigilância só começou a acumular dado limpo depois da correção do piscar.
3. **Taxa menor por volume.** Não acessível nesta escala de capital.

O que **não** mudaria: mais alavancagem ou mais capital.

E o maker, que eu cheguei a apresentar como a solução, **não é**: ordem limite
não garante execução, e uma perna sem a outra vira posição direcional a 5x. Só
compensa acima de 90% de preenchimento.

---

## Como ligar de volta

```bash
iniciar.cmd
```

Sobe o watchdog, que sobe e supervisiona os 8 processos sozinho. Dashboard em
`localhost:8787`. Pra parar tudo com segurança, sem perder nada:

```bash
parar.cmd
```

```bash
npm test            # 302 testes das travas de risco e seleção
npm run ruina       # 20 mil simulações contra choques de preço
npm run execucao    # maker × taker, com o risco de perna solta
npm run semanas     # projeção semana a semana
npm run desafio      # bootstrap por bloco de calendário (portfólio misto)
```

---

## Onde ler mais

| Documento | Para quê |
|---|---|
| [CONTINUIDADE.md](CONTINUIDADE.md) | handoff completo e atualizado — leia primeiro se for mexer no código |
| [docs/QUANTO-RENDE.md](docs/QUANTO-RENDE.md) | a conta de payback e as projeções |
| [docs/PROTECAO-RUINA.md](docs/PROTECAO-RUINA.md) | as travas de risco e o teste de ruína |
| [docs/VIGILANCIA.md](docs/VIGILANCIA.md) | a varredura do mercado inteiro |
| [docs/DELTA-NEUTRO.md](docs/DELTA-NEUTRO.md) | por que a estratégia é essa |
| [docs/CRONOLOGIA.md](docs/CRONOLOGIA.md) | tudo, fase a fase |
| [docs/O-QUE-FALHOU.md](docs/O-QUE-FALHOU.md) | o que foi testado e descartado |

---

## Regras permanentes deste projeto

1. **Nada vai para dinheiro real** sem 90 dias de paper trading.
2. **Nada que remova trades lucrativos** entra em produção sem medição — só
   documentado como experimento.
3. **Um número que não sobrevive ao teste não é reportado como descoberta.** O
   caso do "100% duraram menos de 2h" é o lembrete de por quê.
