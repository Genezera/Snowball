# Arquitetura decisória — a equipe

Resposta à pergunta "seria uma ideia bacana? como seria essa implementação?",
e o desenho do sistema como uma equipe de módulos autônomos que se comunicam.

---

## Parte 1 — A ideia do scanner de universo é boa? Sim, e por quê

**É melhor fundamentada que o filtro de ML por trade que falhou.**

Tudo que este projeto mediu aponta na mesma direção: o retorno está nas
decisões estruturais de baixa frequência (qual timeframe, qual estratégia, qual
mercado) e o ruído está nas de alta frequência (tomar ou não este sinal
específico). Escolher o mercado é uma decisão estrutural — está do lado certo
dessa divisa.

**E corrige um viés real do material de origem.** O vídeo operou F (NYSE), COIN
(Nasdaq), ALTR (ação, hoje deslistada), DOT e TRX (perpétuos cripto). Ações e
cripto misturadas, sem critério declarado, uma delas já nem existe. Isso é
escolha a dedo. Varrer o universo com regra fixa não é só funcionalidade nova —
é correção de rigor.

### Onde a ideia quebra, e as defesas

**O perigo central: teste múltiplo.** 679 ativos × 5 estratégias = 3.395 testes.
O melhor deles vai parecer excelente por puro acaso. Um scanner ingênuo é uma
máquina industrial de gerar falso positivo — e é literalmente o que produz o
`+172.575.181.377%` no leaderboard do trader.dev.

Três defesas, em ordem de importância:

| Defesa | Mecanismo | Efeito medido |
|---|---|---|
| **Filtrar antes de testar** | portões de liquidez, qualidade de dado e viabilidade econômica não rodam backtest nenhum | 679 → 12. **3.335 testes evitados** |
| **Consistência transversal** | uma estratégia precisa funcionar numa *família* de ativos, não num só | `body-breakout` 8/12; `ma-cross` 0/12 |
| **Contabilizar os testes** | o número de testes efetivos é reportado junto do resultado | 60 testes efetivos, entregues ao Sharpe deflacionado |

**A métrica que faz o trabalho pesado: custo-para-movimento.** Movimento típico
no horizonte do trade dividido pelo custo de ida e volta. Resume a descoberta
central do projeto — o custo é pedágio quase fixo, o que muda é o tamanho do
movimento capturável. Abaixo de ~8x não existe estratégia possível ali, e isso
dá para saber **antes** de rodar qualquer backtest.

Foi exatamente isso que condenou o scalping de 5 minutos: custo ~0,14% ida e
volta contra movimento típico de ~0,3% em 12 barras → custo-para-movimento ~2x.

### O achado que muda o mapa: ações tokenizadas

A varredura revelou que a Binance lista ações e ETFs como perpétuos — SNDK
(SanDisk), SOXL (ETF de semicondutores), MU (Micron), SKHYNIX, KORU. Custo e
execução idênticos aos de cripto, mesma API, mesmo código.

| Ativo | Custo-para-movimento | vs. BTC |
|---|---|---|
| SOXL | **199,2x** | 5,2× melhor |
| SNDK | 104,0x | 2,7× melhor |
| MU | 90,1x | 2,4× melhor |
| SOL | 76,1x | 2,0× melhor |
| BTC | 38,3x | referência |

São de longe os ativos mais atraentes economicamente. Foram **reprovados** pelo
portão de histórico (468–696 barras, listagem recente) — o que é o
comportamento correto, não um defeito. Mas resolve elegantemente a sua
observação sobre o vídeo misturar ações e cripto: **dá para cobrir os dois no
mesmo venue, com o mesmo modelo de custo, sem fonte de dados separada.**

Quando acumularem ~2.000 barras em 4h (cerca de um ano), entram na varredura
automaticamente.

---

## Parte 2 — A equipe

O sistema é desenhado como módulos decisórios autônomos que se comunicam, cada
um com uma pergunta própria, autoridade definida e evidência obrigatória.
Nenhum deles substitui o módulo de operação original — todos **alimentam** ele.

```
   ┌──────────────┐   candidatos     ┌──────────────┐   veredictos
   │  ANALISTA    │ ───────────────► │  PESQUISADOR │ ───────────────┐
   │  DE MERCADO  │                  │    (quant)   │                │
   │  scan.ts     │ ◄─────────────── │ validate.ts  │                │
   └──────────────┘  "refaça a       └──────────────┘                ▼
          ▲           varredura"                              ┌──────────────┐
          │                                                   │   GESTOR DE  │
          │ "o regime virou,                                  │    RISCO     │
          │  procure outro"                                   │  capital.ts  │
          │                                                   └──────┬───────┘
   ┌──────┴───────┐   alarme         ┌──────────────┐   pool aprovado │ veto
   │   AUDITOR    │ ◄─────────────── │   ALOCADOR   │ ◄───────────────┘
   │  (monitor)   │                  │   pool.ts    │
   └──────────────┘                  └──────┬───────┘
          ▲                                 │ ordem de operação
          │      desempenho realizado       ▼
          │                          ┌──────────────┐
          └───────────────────────── │   OPERADOR   │
                                     │ executor.ts  │
                                     └──────────────┘
```

### Os seis papéis

| Módulo | Pergunta que responde | Autoridade | Estado |
|---|---|---|---|
| **Analista de Mercado** | quais ativos do universo merecem atenção? | propõe candidatos; não aprova nada | `src/scan/universe.ts` — **pronto** |
| **Pesquisador** | este par ativo×estratégia tem edge fora da amostra? | emite veredicto com motivos | `src/validate/` — **pronto** |
| **Gestor de Risco** | o capital suporta isso? qual tamanho? | **poder de veto**, sobrepõe todos | `src/risk/capital.ts` — **pronto** |
| **Alocador** | o que deve estar rodando agora? | decide o pool ativo | `src/cli/pool.ts` — **pronto** |
| **Operador** | executar as ordens | executa; não decide | `src/live/executor.ts` — **pronto** |
| **Auditor** | o realizado bate com o esperado? | dispara realarme e reavaliação | `src/audit/auditor.ts` — **pronto**, ligado a `npm run team` desde a Fase 11 (ver [EQUIPE.md](EQUIPE.md)) e, desde 08/2026, também aos motores ao vivo via `src/audit/auditor-live.ts` (ver nota abaixo) |

### Os protocolos de comunicação

**Toda mensagem carrega evidência, não só conclusão.** Um módulo nunca diz
"aprovado" — diz "aprovado, com estes números, testados assim, com estas
ressalvas". É o que permite ao módulo seguinte discordar com base em algo.

**Frequências deliberadamente diferentes.** É a lição mais cara do projeto
aplicada à arquitetura:

| Módulo | Frequência | Por quê |
|---|---|---|
| Analista de Mercado | mensal | rotação de universo é decisão estrutural |
| Pesquisador | ao receber candidato | caro, roda sob demanda |
| Alocador | mensal ou trimestral | trocar estratégia toda barra foi o que produziu −39% |
| Gestor de Risco | a cada trade | barato e precisa ser sempre |
| Operador | a cada barra fechada | é a única coisa que roda em alta frequência |
| Auditor | diário | precisa detectar degradação rápido |

**O veto é assimétrico.** O Gestor de Risco pode barrar qualquer decisão de
qualquer módulo. Nenhum módulo pode sobrepor o Gestor de Risco. Assimetria
deliberada: o custo de deixar passar um trade bom é pequeno; o de deixar passar
um trade que quebra a conta é terminal.

**"Não operar" é uma resposta válida e frequente.** A saída de hoje do Alocador
recomenda **não operar nada** em BTC e TRX. Um sistema que sempre encontra algo
para fazer não é um sistema de decisão, é um gerador de atividade.

### O ciclo de rotação que você descreveu

> *"se ela ver que o mercado vai ficar ruim ou ficou ruim ela troca, procura
> outro e assim vai indo"*

Implementado como laço fechado entre Auditor e Analista:

1. **Auditor** compara o desempenho realizado com a distribuição esperada do
   Monte Carlo do par em operação.
2. Se o realizado cair abaixo do percentil 5 da distribuição esperada, ou se a
   expectancy da janela recente virar negativa, ele **rebaixa** o par.
3. O rebaixamento dispara nova varredura no **Analista**.
4. Candidatos novos passam pelo **Pesquisador** e pelo **Gestor de Risco**
   antes de qualquer troca.
5. A troca só acontece se o novo candidato for materialmente melhor que o atual
   — senão o custo de girar supera o ganho.

**Atualização (08/2026): o Auditor foi construído** em `src/audit/auditor.ts`
(as 5-6 checagens descritas acima, mais `replayAudit()`) e usado por
`npm run team` desde a Fase 11 — ver [EQUIPE.md](EQUIPE.md) para o resultado
da primeira reunião completa. Esta seção descrevia corretamente o desenho
antes de existir; ficou desatualizada quanto ao "falta construir" e foi
corrigida aqui.

O que ainda faltava até esta correção: o Auditor só rodava sob demanda,
nunca contra os motores que estão de fato rodando ao vivo (`momentum-live`,
`pares-live`). `src/audit/auditor-live.ts` fecha essa lacuna — compara os
trades fechados de cada motor (lidos de `*/diario.jsonl`) contra a
expectativa dos backtests validados (Resultado 10 para momentum, Resultado
7/14 para pares), exposto no payload do dashboard (`auditoria`, ver
`src/dashboard/server.ts`). É só leitura/relato — não fecha posição nem troca
par sozinho, mesma divisão de trabalho de custódia/motor no resto do
projeto. Mesma disciplina do pipeline de ML (`src/ml/prontidao-vigilancia.ts`):
recusa fabricar veredito sem os 25 trades mínimos. Em 07-08/08/2026 os dois
motores ainda não têm dado suficiente (momentum: 1 trade fechado; pares: 0)
— `EVIDENCIA_INSUFICIENTE` é a resposta correta agora, não um bug.

---

## Parte 3 — Multi-ativo

> *"ou até mesmo multi moeda"*

Sim, e é provavelmente mais valioso que a rotação. O motor atual opera **uma
posição por vez**, o que desperdiça a maior parte dos sinais — no scan, 12
ativos viáveis produziram sinais simultâneos que foram descartados.

Além disso, ataca diretamente o modo de falha diagnosticado no alocador
adaptativo: ele perdeu porque **ficava de fora de trades bons** ao escolher um
único candidato. Um portfólio não tem esse problema — ele pega os dois.

A ressalva que não pode ser esquecida: **correlação**. BTC, ETH, SOL e DOGE
caem juntos. Operar quatro deles não é quatro apostas independentes; é
aproximadamente uma aposta com quatro nomes. O risco tem que ser alocado no
nível da carteira, com correlação **medida**, não assumida. As ações
tokenizadas são o que realmente diversifica, porque respondem a outra coisa.

Está no [BACKLOG](BACKLOG.md) como B7, agora com prioridade elevada.

---

## Parte 4 — A regra do não-aplicar

> *"qualquer coisa que começar a remover trades lucrativos você não aplica,
> apenas testa e reporta na documentação"*

Adotada como regra permanente do projeto, e já aplicada retroativamente:

**O filtro de ML por trade removia trades lucrativos** — em ETH escolheu a
estratégia certa e ainda entregou +34,3% contra os +56,3% que ela faz sozinha.
Ele **não está em produção**. O código existe, é reexecutável, e o resultado
negativo está documentado em [ADAPTATIVO.md](ADAPTATIVO.md).

A regra generalizada, que agora vale para tudo:

> Um módulo que **reduz** o conjunto de operações precisa provar que o que ele
> removeu era pior que a média. Se ele remove trades lucrativos em qualquer
> ativo testado, ele fica documentado como experimento e fora da produção — por
> mais que melhore o resultado agregado em outros.

Isso é mais rígido que o padrão da indústria de propósito. A alternativa é
descobrir com dinheiro real que o filtro cortava justamente os trades bons.
