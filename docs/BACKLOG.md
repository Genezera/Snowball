# Backlog

O que falta, em ordem de importância. Cada item diz **por que importa** e **como
saber que terminou**.

Última atualização: 2026-07-31

---

## Bloqueado — depende de você

### B1. Conectar o MCP trader.dev

**Estado:** registrado na config, não utilizável.

**O que falta:** (a) reiniciar o Claude Code, (b) você criar conta no
StrategyFactory.ai e pegar a chave de API. Eu não crio contas nem digito
credenciais.

**Por que importa:** você definiu como fonte principal. Além disso é o caminho
mais direto para os dados de ações (F, COIN, ALTR) que hoje faltam.

**Pronto quando:** as ferramentas `trader-dev` aparecerem na sessão e eu
conseguir rodar um backtest lá para cruzar com o meu.

Detalhes em [MCP.md](MCP.md).

---

## Prioridade alta

### B2. Validar o candidato `body-breakout` 4h com mais rigor

**Por que:** é o único resultado com sinal estrutural (expectancy positiva nos 5
ativos). Mas foi encontrado depois de 75 combinações testadas, e isso não está
corrigido em lugar nenhum.

**O que fazer:**
- Rodar em ativos **fora** do conjunto usado para descobrir (ADA, LINK, AVAX,
  XRP, BNB). Se o padrão se mantiver em ativos nunca vistos, é edge.
- Testar estabilidade dos parâmetros: se `minBody=0.5` funciona e `0.45` e
  `0.55` não, é ruído. Edge real tem platô, não pico.
- Testar em 2h e 6h. Se só 4h funciona, é sorte; se a curva é suave no
  timeframe, é estrutura.
- Aplicar o filtro de ML sobre ele (ainda não foi feito em 4h).

**Pronto quando:** houver ou não um platô consistente em ativos e parâmetros
não usados na descoberta.

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

### B6. Modelar seleção adversa em ordem limite

**Por que:** é a maior fonte de otimismo não medido do projeto. Todo o resultado
com custo maker depende disso.

**O que fazer:** simular preenchimento condicional — a ordem limite só executa
se o preço tocar o nível **e** a barra seguinte não tiver ido embora. Comparar
com o preenchimento otimista atual. A diferença é o tamanho do autoengano.

**Pronto quando:** o preset maker tiver uma versão pessimista e a distância
entre as duas estiver medida.

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
