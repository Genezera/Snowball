# A equipe — o laço fechado

Documentação do orquestrador (`npm run team`), do Auditor, e da restrição dos
US$ 100.

Antes disto, os módulos eram seis scripts que eu rodava à mão e cujos
resultados eu lia e interpretava. Não era uma equipe, era um organograma com
seis funcionários que não se falavam. Agora a saída de cada um é a entrada do
próximo, sem interpretação humana no meio.

---

## A restrição dos US$ 100

Tratada como restrição de primeira classe, não como configuração. Com capital
pequeno o limite não é a estratégia — é a aritmética da exchange.

| Equity | Notional/posição | Posições | Operável? |
|---|---|---|---|
| $200 | $64,52 | 3 | sim |
| $100 | **$32,26** | **3** | sim ← ponto de partida |
| $50 | $16,13 | 3 | sim |
| $35 | $11,29 | 2 | sim |
| $25 | $8,06 | 1 | sim |
| $20 | $6,45 | 1 | sim |
| **$15** | $4,84 | 0 | **NÃO** |
| $10 | $3,23 | 0 | NÃO |

**Três leituras que importam:**

**1. US$ 100 suportam 3 posições simultâneas.** E o limite que morde não é o
notional mínimo nem a alavancagem — é o **risco simultâneo contra o limite de
perda diária**. Três posições a 0,5% somam 1,5% de risco de uma vez; o teto que
adotei é 60% do limite diário de 3%, ou seja 1,8%. A quarta posição
estouraria. Isso preserva folga para o dia continuar operável depois de uma
sequência ruim.

**2. A alavancagem é 0,32x.** Com US$ 100 e stop de 1,5%, cada posição usa
US$ 32,26 de notional — menos de um terço do capital. Não há alavancagem
nenhuma envolvida, e isso é deliberado.

**3. O piso é US$ 15,50.** Abaixo disso o notional cai sob o mínimo de US$ 5 da
exchange e a conta simplesmente para de operar. Isso é uma perda de **85%** do
capital — muito depois do circuit breaker de 15% de drawdown ter desligado
tudo. Ou seja: **você nunca deve chegar perto do piso.** Se chegar, algo já
falhou catastroficamente antes.

O perigo que este módulo recusa: com equity baixo, a saída fácil é operar assim
mesmo com notional maior que o plano permite. O operador não percebe que trocou
0,5% de risco por 3%, e uma sequência normal de 10 perdas vira 30% da conta em
vez de 5%. É o mecanismo exato pelo qual contas pequenas morrem. O Gestor de
Risco veta em vez de arredondar.

---

## A ordem de fala

O Gestor de Risco fala **primeiro**, não por último. Se o capital não comporta a
operação, não faz sentido pesquisar nada. Depois:

```
RISCO (o que o capital suporta)
  ↓
ANALISTA (quais ativos merecem atenção)
  ↓
PESQUISADOR (quais pares têm edge fora da amostra)
  ↓
RISCO de novo (veto assimétrico sobre cada aprovado)
  ↓
ALOCADOR (o que opera, respeitando o teto de posições)
  ↓
AUDITOR (o realizado bate com o prometido?)
  ↓
volta ao ANALISTA quando algo degrada
```

Cada mensagem carrega **evidência, não só conclusão** (`src/team/messages.ts`).
Um módulo nunca diz "aprovado" — diz "aprovado, com estes números, medidos
assim". É o que permite ao módulo seguinte discordar com base em algo.

---

## O Auditor

O papel que faltava. Responde: **o realizado bate com o que o backtest
prometeu?**

A dificuldade real é distinguir "a estratégia parou de funcionar" de "a
estratégia está numa sequência ruim normal". Toda estratégia com 37% de acerto
passa por sequências de 10 perdas. Desligar na primeira é tão destrutivo quanto
nunca desligar.

A defesa contra os dois erros: comparar o realizado com a **distribuição**
simulada pelo Monte Carlo do próprio par, não com a média. Dentro do que a
simulação previa como possível → sequência ruim. Fora → outra coisa.

### As cinco checagens

| Checagem | Erro que previne |
|---|---|
| Evidência mínima (25 trades) | julgar cedo demais — o erro mais comum |
| Expectancy vs esperado (z-score) | confundir média abaixo do esperado com quebra |
| Drawdown vs p95 simulado | tolerar drawdown que o modelo dizia ser improvável |
| Retorno vs cenário p5 | ignorar que estamos abaixo do que 95% das simulações previam |
| Regime atual vs regimes de aprovação | operar num ambiente onde o par nunca foi testado |
| Sequência de perdas vs esperada | pânico com sequência estatisticamente normal |

### Validação do próprio Auditor

`replayAudit()` roda o Auditor ao longo do histórico e responde "quando ele
teria puxado o freio?". Isso existe porque **um auditor que rebaixa cedo demais
destrói estratégias boas, e um que rebaixa tarde demais não serve para nada** —
e não dá para saber em qual dos dois erros ele cai sem testar.

No DOT: 7 janelas avaliadas, 2 gerariam alerta, o primeiro em 2024-07-14. Taxa
de alarme razoável — nem histérico nem dormindo.

---

## O resultado da primeira reunião completa

Rodado com US$ 100, 8 ativos, 6 estratégias, 4h, custo maker:

| Estágio | Entrou | Saiu | O que foi cortado |
|---|---|---|---|
| Pesquisador | 31 pares | 5 | eficiência WF < 0,40 ou Sharpe deflacionado < 0,90 |
| Gestor de Risco | 5 | **1** | 4 vetados por drawdown p95 acima do circuit breaker |
| Alocador | 1 | 1 | dentro do teto de 3 posições |
| Auditor | 1 | **0** | DOT body-breakout marcado como **REBAIXAR** |

**O sistema inteiro, rodado de ponta a ponta com US$ 100, produz zero pares
operáveis hoje.**

### Por que isso é um bom resultado para o sistema

Cada portão pegou algo que o anterior deixou passar:

- O **Pesquisador** aprovou `DOGE ma-cross` com eficiência WF 4,73 e Sharpe
  deflacionado 1,00 — números excelentes.
- O **Gestor de Risco** vetou: drawdown p95 de 27% contra desligamento em 15%.
  O par bateria o circuit breaker antes de entregar o resultado. O Pesquisador
  não olha para isso; o Risco olha só para isso.
- O **Auditor** rebaixou o único sobrevivente: expectancy realizada nos últimos
  40 trades foi **−0,278R** contra **+0,174R** prometida, e o retorno está
  abaixo do cenário p5.

Sem o Risco, quatro pares teriam ido para operação e quebrado o circuit
breaker. Sem o Auditor, o quinto teria operado enquanto degradava.

### Por que é um resultado sóbrio para a operação

Não há o que operar. E a leitura honesta é que isso provavelmente está certo:
`ma-cross` aparecendo com eficiência 4,73 depois de falhar em 0 de 12 ativos na
varredura anterior é sinal de janela in-sample com poucos trades, não de
descoberta. O Risco o matou por outro motivo, mas ele deveria ter morrido antes.

---

## Lacuna conhecida: multi-ativo é gated, não simulado

O Gestor de Risco calcula o teto de 3 posições e o Alocador o respeita. Mas o
motor de backtest (`runBacktest`) **ainda opera uma posição por vez**.

Ou seja: o plano diz "até 3 simultâneas", e nenhum número deste projeto foi
medido com 3 simultâneas. O efeito de correlação entre majors de cripto — que
caem juntas — está **avisado mas não medido**.

Enquanto isso não for implementado, o teto de 3 deve ser lido como limite
superior teórico, não como recomendação validada. Está em
[BACKLOG.md](BACKLOG.md) como B7.

---

## Como rodar

```bash
node src/cli/team.ts --equity 100
```

Opções: `--timeframe`, `--cost`, `--risk`, `--symbol`, `--verbose`.
Saída completa em `reports/team-4h.json`, incluindo a conversa entre módulos.
