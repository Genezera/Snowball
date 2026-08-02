# MCP — trader.dev e servidor local

---

## Parte 1 — trader.dev (terceiro)

### Estado da instalação

**Registrado.** Entrada criada em `C:\Users\Renan\.claude.json`:

```json
"mcpServers": {
  "trader-dev": {
    "type": "sse",
    "url": "https://mcp.trader.dev/sse"
  }
}
```

Backup da config anterior: `C:\Users\Renan\.claude.json.bak-snowball`
Endpoint verificado: `https://mcp.trader.dev/sse` responde HTTP 200.

### CONECTADO E EM USO (atualização 2026-07-31)

O bloqueio abaixo foi contornado: escrevi um cliente MCP que fala SSE direto
(`tools/traderdev.mjs`), então a base já está sendo usada sem precisar
reiniciar. Autenticado como `renan.ap210@gmail.com`, tier free. Servidor
`traderdev-backtester` v0.2.1, **49 ferramentas**.

Lista completa das ferramentas em `traderdev_tools.txt`.

#### CORREÇÃO — eu afirmei que era comissão zero, e estava errado

**Versão anterior deste documento dizia que o trader.dev força comissão zero.
Isso é falso.** O erro veio de ler a descrição truncada da ferramenta, que dizia
`commission=0`, sem testar. A documentação deles é genuinamente contraditória: o
texto de regras completo manda `commission_value=0.05` e avisa que *"a API
HARD-FORCES este perfil"*, enquanto a caixa de dica ao usuário diz "Commission
0%".

**O teste que resolve.** Rodei um SMA 50/200 em BTC 4h pedindo explicitamente
comissão zero. A resposta:

```json
"parityAdjustments": [{ "field": "commission",
    "requested": "pine_or_override", "applied": "0.05",
    "reason": "mcp_parity_profile_commission_0_05" }]
"commissionPaid": 636.08
```

A API **rejeitou** meu override e aplicou 0,05% por lado, cobrando US$ 636 sobre
US$ 10.000 de capital inicial. O backtester deles modela comissão corretamente.

#### O que continua verdadeiro — e é o que produz os números absurdos

Duas distorções reais permanecem, e elas bastam para explicar o leaderboard:

| Imposição | Efeito |
|---|---|
| `percent_of_equity: 100` forçado | 100% do capital em cada trade, compondo. É isto que gera `+172.575.181.377%` |
| `Slippage: 0 ticks` | nenhum custo de execução além da comissão |

A composição com 100% do capital é o mecanismo dominante. Uma sequência de
trades vencedores com o capital inteiro sempre reinvestido produz números que
não existem no mundo físico — e o leaderboard ordenado por "Best profit" põe
exatamente esses no topo.

**Leitura correta:** os números do trader.dev são líquidos de comissão mas
brutos de slippage, e assumem uma política de tamanho que ninguém deveria usar.
São comparáveis entre si, e **não** são comparáveis com os deste projeto, que
arrisca 0,5% do capital por trade e modela slippage.

#### Os filtros da API não conseguem limpar o leaderboard

Ordenar por Sharpe não resolve. O topo do ranking por `sort: "sharpe"` com
`minTrades: 100`:

| Estratégia | Sharpe | PF | Win | Trades | Janela |
|---|---|---|---|---|---|
| Adaptive Crypto Scalper V10.15 | **17,01** | 8,94 | 82% | 100 | **10 dias** |

Sharpe 17 não existe (o Medallion tem ~2–3). O campo que denuncia é
`barsEvaluated: 2881` e a diferença `toTs − fromTs` = 10 dias. **A janela de
avaliação não é um filtro da API**, então só dá para separar puxando os
resultados e filtrando do lado do cliente.

#### A peneira — `tools/td-screen.mjs`

Varre 7 eixos de ordenação, coleta centenas de backtests e filtra por: janela
≥365 dias, ≥100 trades, PF entre 1,1 e 3, Sharpe entre 0,5 e 4, drawdown ≤35%.

Resultado da varredura completa:

```
918 backtests únicos coletados
Sharpe>4 ou PF>3 ou retorno>10000%  : 189   (fisicamente implausível)
janela menor que 180 dias           : 204   (curta demais para concluir)
SOBREVIVEM À PENEIRA                : 154
```

**O padrão dos sobreviventes corrobora a descoberta central deste projeto:** eles
se concentram em **1D, 1h e 4h** (BTCUSDT 1D, ETHUSDT 1D, SOLUSDT 4h, AVAXUSDT
1h, forex 30m/60m). Praticamente nenhum em 5 minutos. O único 5m que passou
(`Gold Session Breakout`, XAUUSD, 8.127 trades, DD 29,9%) é justamente o caso em
que a taxa aniquilaria o resultado — 8.127 trades a custo real é imbatível pelo
lado errado.

**Ressalva sobre os sobreviventes:** vários mostram drawdown de exatamente 0,0%,
o que não é plausível. E "DIAG3 proven" em BTCUSDT 1D mostra 1.096 trades em
1.580 dias de barras **diárias** — mais de um trade por barra, o que exige
múltiplas posições simultâneas ou indica algo errado na contabilidade. Nada
disso vira candidato sem ser reimplementado e revalidado aqui, com custo.

---

### Bloqueio original (resolvido, mantido como registro)

O servidor **ainda não está utilizável**, por duas razões independentes:

**1. Precisa reiniciar o Claude Code.** Servidores MCP são conectados na
inicialização do processo. A entrada foi adicionada com a sessão já rodando,
então as ferramentas não existem nesta sessão. Confirmado por busca de
ferramentas: nenhuma ferramenta `trader-dev` está carregada.

**2. Precisa de conta e chave de API.** O trader.dev exige cadastro no
StrategyFactory.ai, de onde sai a chave de API que autentica o MCP. **Criar
conta e inserir credenciais é uma ação que eu não executo** — é você que precisa
fazer, no navegador. Eu nunca vou digitar senha, chave ou dado de pagamento em
formulário nenhum.

### O que você precisa fazer

1. Criar conta em StrategyFactory.ai / trader.dev
2. Pegar a chave de API no dashboard
3. Reiniciar o Claude Code
4. Autenticar quando o servidor pedir (o fluxo SSE normalmente abre um login no
   navegador; se ele exigir a chave num header, me avise que eu ajusto a config
   para incluir o header — sem eu ver o valor, você cola direto no arquivo)

Depois disso, me diga e eu passo a usar as ferramentas dele.

### Como pretendo usar — e como NÃO pretendo

Isto importa mais que a instalação, por causa do que foi encontrado na análise
do vídeo.

**O leaderboard do trader.dev tem 32.661 estratégias e 87.326 backtests.** É uma
base grande e genuinamente útil. Mas os resultados no topo da lista são:

| Estratégia | Par | NET P&L |
|---|---|---|
| XAUUSD Breakout v2c | PAXGUSDT 5m | **+172.575.181.377,48%** |
| XAUUSD Breakout v2c | PAXGUSDT 60m | +39.315.109.724,81% |
| XAUUSD Asia-London Breakout | XAUUSD 5m | +23.285.467.390,72% |

Retorno de 10¹¹ por cento não existe no mundo físico — é artefato de composição
(reinvestir 100% do capital a cada trade, num par de baixa liquidez). E a lista
está **ordenada por "Best profit"**, ou seja, o topo é literalmente ordenado
pelo artefato mais extremo.

**Regra de uso deste projeto:**

| Uso | Permitido? | Por quê |
|---|---|---|
| Fonte de **dados** de mercado | **Sim** | Dados são dados |
| Fonte de **ideias** de regras de estratégia | **Sim** | Ideia é barata; a validação é que decide |
| Rodar backtests **lá** para comparar com os meus | **Sim** | Discordância entre dois backtesters é informação valiosa |
| Usar o ranking deles como **critério de seleção** | **Não** | Converge para artefato de composição |
| Aceitar um "NET P&L" de lá sem revalidar aqui | **Não** | Sem modelo de custo explícito, o número não significa nada |

Um agente em loop otimizando contra aquele leaderboard produz lixo convincente.
Foi exatamente isso que o vídeo demonstrou sem querer.

**O contra-exemplo honesto:** um frame do vídeo mostra o Claude Code do próprio
autor usando o trader.dev com disciplina — rejeitando candidatos ("all rejected,
honesty rule respected"), identificando um filtro que gerava zero trades, e
chegando a números modestos e críveis (BTC 4h, PF 1,71, Sharpe 0,80). Usado
assim, com um portão de validação por fora, o MCP é ótimo. Foi essa pista que
levou à descoberta central do projeto — que o timeframe certo é 4 horas, não 5
minutos. Ver [EVOLUCAO.md](EVOLUCAO.md), entrada 8.

### Plano de uso assim que estiver conectado

1. **Validação cruzada do candidato.** Rodar `body-breakout` em 4h no trader.dev
   e comparar com meu resultado (BTC +0,198R, ETH +0,154R, TRX +0,133R). Dois
   backtesters independentes concordando é evidência muito mais forte que um só.
2. **Buscar estratégias em 4h+** no browse, ignorando o ranking por lucro e
   filtrando por profit factor moderado (1,2–1,8) com drawdown baixo e número de
   trades razoável — o perfil de coisa real, não de artefato.
3. **Portar os candidatos interessantes** para este projeto e submetê-los ao
   mesmo portão: custo explícito, walk-forward, Sharpe deflacionado, Monte Carlo.
4. **Usar como fonte de dados** para ativos que o ccxt não cobre — em especial
   as ações do vídeo (F, COIN, ALTR), que hoje são um buraco no projeto.

---

## Parte 2 — Servidor MCP local do Snowball

Implementação: [`src/mcp/server.ts`](../src/mcp/server.ts)

Expõe o backtester, o walk-forward, o ML e a análise de capital como ferramentas
para o Claude, para você poder conversar com o laboratório em vez de decorar
comandos.

### Instalação

```bash
claude mcp add --scope user snowball -- node "C:/Users/Renan/Nova pasta/snowball/src/mcp/server.ts"
```

### Ferramentas

| Ferramenta | O que faz |
|---|---|
| `list_data` | Lista as séries em cache com auditoria de integridade (gaps, cobertura, OHLC inválido) |
| `download_data` | Baixa OHLCV de qualquer exchange do ccxt |
| `backtest` | Backtest com custo explícito. Sempre devolve as taxas como fração do lucro bruto |
| `compare_costs` | Mesma estratégia sob zero / maker / taker / stress. **A ferramenta mais útil do conjunto** |
| `walk_forward` | Otimiza in-sample, testa out-of-sample, devolve eficiência WF + Sharpe deflacionado + veredito |
| `ml_meta_label` | Treina o filtro de meta-labeling com purged CV e mede se ele torna a expectancy positiva |
| `capital_analysis` | Capital mínimo viável + projeção Monte Carlo da bola de neve |

### A diferença de projeto em relação ao trader.dev

Nenhuma ferramenta daqui devolve "retorno total" sozinho. Toda resposta vem
acompanhada do custo pago, do drawdown e — no caso do walk-forward — de um
veredito com os motivos da reprovação escritos por extenso. Isso é deliberado: o
objetivo é tornar **difícil se enganar**, não fácil se animar.

Exemplo do que o `compare_costs` devolve junto com os números:

> *Se profitFactor cai abaixo de 1 entre zero-cost e o preset que você realmente
> paga, não existe estratégia — existe um backtest sem custo.*
