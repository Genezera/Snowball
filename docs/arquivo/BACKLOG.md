# Backlog

> **📦 Arquivado — pré-refactor.** Este documento descreve a fase anterior do projeto (pesquisa multi-estratégia: backtest, 5 estratégias, ML meta-labeling, pares/momentum ao vivo, Auditor, servidor MCP local). Boa parte do código citado aqui foi removida no refactor de 2026-08 que focou o projeto só em funding-arb de 2 exchanges. Mantido como histórico/registro de decisões — não reflete o estado atual. Para o estado atual, ver [CONTEXTO.md](../../CONTEXTO.md) e [README.md](../../README.md).


O que falta, em ordem de importância. Cada item diz **por que importa** e **como
saber que terminou**.

Última atualização: 2026-08-05

---

## Concluído nesta sessão

### B1. Conectar o MCP trader.dev — Feito em 05/08/2026

Chave rotacionada e autenticada. Rodei `body-breakout` (BTC 4h, ago/2021–ago/2026)
no engine do trader.dev (paridade TradingView, comissão forçada em 0,05%) e
cruzei com o motor próprio: **os dois batem** quando o motor próprio usa o
mesmo custo taker — ver Resultado 16 em [RESULTADOS.md](RESULTADOS.md). A
divergência inicial (trader.dev −2,1% vs. Resultado 3 do projeto +15,7%) não
era bug de tradução — era o preset **maker** (mais barato, otimista) contra
**taker** (realista). Com custo equivalente, ambos os motores concordam:
PF ~0,99, retorno ~0.

### B2. Validar `body-breakout` 4h com mais rigor — Resolvido, resultado negativo

**Não é mais "precisa validar" — já foi, e não passou.** A validação
cross-engine que o B1 previa ("pronto quando eu conseguir cruzar com o meu")
mostrou que mesmo no seu melhor caso documentado (BTC 4h, único ativo com
walk-forward "aprovado" no Resultado 3), o resultado positivo dependia do
preset de custo maker. Com taker — o custo real de quem não consegue
preenchimento garantido em ordem limite, exatamente a ressalva #2 que o
próprio `RESULTADOS.md` já registrava sem medir — o profit factor cai para
~0,99 em ambos os motores, independentemente implementados. Não há mais
motivo para reabrir este item sem um dado ou mecanismo novo.

---

## Bloqueado — depende de você

(vazio — nada bloqueado no momento)

---

## Prioridade alta

### B3. Paper trading

**Por que:** é o único teste que mede o que o backtest não consegue — latência,
preenchimento real de ordem limite, seleção adversa, barra incompleta.

**O que fazer:** rodar `src/cli/live.ts --mode paper` no candidato por **90
dias**, comparando a curva com a esperada.

**Pronto quando:** 90 dias de dados e uma comparação honesta entre esperado e
realizado. Se divergirem muito, o backtest está errado em algum lugar e o
projeto volta para a bancada.

**Falta implementar:** `src/cli/live.ts` (o executor `src/live/executor.ts` está
pronto, falta o ponto de entrada e o laço de agendamento por fechamento de
barra).

### B4. Dados de ações — F, COIN, ALTR

**Por que:** três dos cinco ativos do vídeo são ações e nunca foram testados.
`ccxt` só cobre cripto.

**O que fazer:** avaliar trader.dev (assim que conectado), Yahoo Finance (5min
só últimos 60 dias — amostra pequena demais), Alpha Vantage ou Polygon. Integrar
ao `src/data/store.ts` mantendo o mesmo formato de série.

**Cuidado específico de ações que não existe em cripto:** ajuste por
desdobramento e dividendo, e o gap de abertura. Um backtest intradiário de ação
que ignora o gap noturno mede a coisa errada.

**Pronto quando:** as 5 estratégias tiverem rodado nos 5 ativos originais.

---

## Prioridade média

### B5. Pesquisa em GitHub, notícias e papers

**Estado:** buscas web feitas sobre ccxt, meta-labeling, purged CV e trader.dev.
A varredura sistemática de GitHub não foi feita.

**O que procurar:**
- Implementações abertas dessas regras (Pine Script, freqtrade, backtrader) para
  cruzar com a minha
- Resultados publicados de scalping intradiário **com modelo de custo explícito**
- Literatura sobre decaimento de edge em alta frequência para varejo

**Pronto quando:** houver uma nota comparando meus resultados com pelo menos 3
fontes independentes.

### B6. Modelar seleção adversa em ordem limite — RESOLVIDO (06/08/2026)

**Por que:** era a maior fonte de otimismo não medido do projeto. Todo o
resultado com custo maker dependia disso.

Em vez de simular seleção adversa em backtest, foi construído um motor ao
vivo (`src/live/monitor-preenchimento.ts`) que mede de verdade: posta ordem
limite "no toque" nas duas pernas dos 5 melhores candidatos da vigilância,
usando preço real (`last`) como proxy — sem enviar ordem nenhuma — e mede
taxa de preenchimento, tempo até encher, e o que o preço faz depois.

**Resultado real, >1000 amostras:** taxa de preenchimento ótima (~89%),
tempo mediano ~12 min, mas a seleção adversa medida (~0,125% de movimento
médio contra quem forneceu liquidez) é **maior** que o escorregamento que
ela substituiria (0,07%). Trocar taker por maker não parece reduzir custo
com o dado real até agora — o oposto do esperado. Ver `CONTINUIDADE.md`
seção 3.4 e `docs/RESULTADOS.md`.

### B7. Portfólio em vez de posição única

**Por que:** o motor opera um ativo por vez. Operar `body-breakout` em BTC, ETH
e TRX simultaneamente diversifica — mas os três são cripto e caem juntos, então
o benefício é menor do que a matemática ingênua sugere.

**O que fazer:** motor multi-ativo com risco alocado no nível da carteira e
correlação medida, não assumida.

---

## Prioridade baixa

### B8. Imposto de renda — Feito em 03/08/2026

`src/funding/imposto.ts` modela a regra de pessoa física (IN RFB 1.888/2019):
isenção para vendas até R$ 35.000/mês, 15% sobre o ganho do mês quando ultrapassa
isso. Integrado em `npm run semanas`.

**Resultado medido, não suposto:** nesta escala de capital (US$ 100–200), o
volume mensal vendido fica em torno de R$ 10.000–21.000 — abaixo da isenção.
**O imposto é zero, não porque foi ignorado, mas porque a escala não o
ativa.** Isso muda se o capital crescer o suficiente para que as rotações
somem mais de R$ 35 mil/mês em vendas.

Limitação registrada no próprio módulo: não é claro na lei se funding de
perpétuo é ganho de capital ou outra categoria de rendimento; o simulador
assume ganho de capital, que é a leitura mais comum entre corretoras, não uma
opinião jurídica. Não compensa prejuízo entre meses.

### B9. Dashboard

O vídeo mostra um dashboard bonito. É a última coisa que importa: gráfico não
melhora estratégia. Fica para depois de B2 e B3.

---

## Concluído

| Item | Onde |
|---|---|
| Motor de backtest com custos, slippage, funding, gaps | `src/backtest/engine.ts` |
| As 5 estratégias com as regras exatas da tela | `src/strategies/index.ts` |
| Walk-forward + Sharpe deflacionado + Monte Carlo + risco de ruína | `src/validate/` |
| Gestão de risco, capital mínimo viável, simulador da bola de neve | `src/risk/capital.ts` |
| ML: GBDT do zero + meta-labeling com purged CV | `src/ml/` |
| Executor paper/testnet/live com kill switches e estado persistido | `src/live/executor.ts` |
| Servidor MCP local | `src/mcp/server.ts` |
| Análise completa do vídeo (124 frames + transcrição) | [EVOLUCAO.md](EVOLUCAO.md) |
| Documentação | `docs/` |
