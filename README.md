# Snowball

Laboratório de pesquisa quantitativa que começou tentando replicar um bot de
scalping de 5 minutos e terminou operando uma estratégia sem exposição a preço.

**O que este projeto é:** uma máquina de medir se uma estratégia tem vantagem
real, e um motor de renda delta-neutra que roda 24h.

**O que ele não é:** promessa de retorno. Nenhum número aqui é previsão, e a
maior parte do código existe para descobrir que algo *não* funciona antes de
custar dinheiro.

---

## Estado atual

O projeto tem duas metades, e a segunda nasceu do fracasso da primeira.

### Trilha 1 — trading direcional (validada, não operada)

Seis estratégias, três modelos de machine learning, 1.145 candidatas mineradas,
312 combinações testadas. O melhor resultado validado por walk-forward:
**expectancy de 0,17R**, com **45,1% de semanas positivas**.

Funciona no papel. Mas a semana típica dá prejuízo, e a pior sequência foi de
8 semanas negativas seguidas — o que torna a estratégia incompatível com o
objetivo declarado de renda semanal.

### Trilha 2 — renda delta-neutra (em operação)

Comprado e vendido no mesmo ativo, em exchanges diferentes. Exposição a preço
**zero por construção**. A renda vem do funding — o pagamento contratual que as
exchanges transferem dos comprados para os vendidos a cada 8 horas.

Medição sobre 3.000 leituras reais, 180 dias: **100% das semanas positivas**
(48 de 48).

Documentação completa em [docs/DELTA-NEUTRO.md](docs/DELTA-NEUTRO.md).

---

## Como rodar

Requer Node.js 22+ (usa o suporte nativo a TypeScript, sem etapa de build).

```bash
npm install
```

### Motor de renda + dashboard

```bash
npm run spread                  # motor 24h, US$ 100, 5x
node src/dashboard/server.ts    # painel em http://localhost:8787
```

Ou supervisionados com reinício automático:

```bash
run-spread.cmd
run-dashboard.cmd
```

### Análise

```bash
npm run spread:scan         # varredura de 10 exchanges × 32 ativos
npm run spread:verificar    # liquidez real no livro + análise de ruína
npm run spread:maximizar    # testa alavancas de otimização
npm run projecao            # projeção semana a semana com aportes
```

### Trilha direcional

```bash
npm run backtest -- --symbol "BTC/USDT:USDT" --timeframe 4h --compare-costs
npm run validate            # walk-forward + Sharpe deflacionado + Monte Carlo
npm run scan                # varredura de universo com custo-para-movimento
npm run team                # a equipe de módulos decisórios
```

---

## Documentação

| Documento | Conteúdo |
|---|---|
| [COMECE-AQUI.md](COMECE-AQUI.md) | resumo em uma página |
| [docs/DELTA-NEUTRO.md](docs/DELTA-NEUTRO.md) | a estratégia em operação hoje |
| [docs/CRONOLOGIA.md](docs/CRONOLOGIA.md) | diário do projeto, fase a fase |
| [docs/O-QUE-FALHOU.md](docs/O-QUE-FALHOU.md) | o que foi testado e descartado |
| [docs/RESULTADOS.md](docs/RESULTADOS.md) | todos os números medidos |
| [docs/ESTRATEGIAS.md](docs/ESTRATEGIAS.md) | as 5 estratégias do vídeo original |
| [docs/ARQUITETURA.md](docs/ARQUITETURA.md) | cada módulo e as decisões não óbvias |
| [docs/ARQUITETURA-DECISORIA.md](docs/ARQUITETURA-DECISORIA.md) | o desenho em módulos decisórios |
| [docs/MCP.md](docs/MCP.md) | integração com trader.dev |
| [docs/ROADMAP.md](docs/ROADMAP.md) | o que falta, priorizado |
| [docs/PEDIDOS.md](docs/PEDIDOS.md) | rastreamento de tudo que foi pedido |

---

## As regras que impedem o autoengano

O que separa este backtester dos que produzem 5381%:

1. **Sinal na barra `i` executa na abertura de `i+1`.** A estratégia nunca
   negocia dentro da barra que usou para decidir.
2. **Taxa e slippage nos dois lados, sempre.** O preset `zero-cost` existe só
   para demonstrar quanto o custo importa.
3. **Stop e alvo tocados na mesma barra assumem o stop.** Sem dados de tick não
   dá para saber a ordem, e o erro otimista aqui é o único que quebra conta.
4. **Circuit breakers param o backtest** como parariam a conta real.
5. **O walk-forward escolhe parâmetros usando só o passado** de cada bloco.
6. **O Sharpe é deflacionado pelo número de combinações testadas.**
7. **Nada que remova trades lucrativos entra em produção**, por mais que
   melhore o agregado.

---

## Sete bugs que só apareceram executando

Registrados porque o padrão importa mais que os casos:

1. Três das cinco estratégias implementadas erradas — a transcrição do vídeo
   divergia das regras na tela.
2. Afirmação falsa sobre a comissão do trader.dev, repetida em 3 documentos.
3. Portão de AUC invertendo decisões: estratégias com poucos trades escapavam
   do teste e passavam por não serem examinadas.
4. Teste de portfólio medindo rotação: `maxConcurrent: 1` fazia o "portfólio"
   nunca abrir 2 posições, e os números pareciam plausíveis.
5. Executor documentado como pronto que nunca havia rodado — sintaxe não
   suportada pelo modo strip-only do Node.
6. Marcos de semana fixos (26, 52) quebrando em horizontes menores.
7. Vazamento de memória: 28.133 mercados carregados para operar 32 ativos.

Código escrito, revisado e documentado não é código que funciona. Só executar
revela.

---

## Aviso

Este software não dá recomendação de investimento. Backtest não é previsão.
Operar alavancado em perpétuos pode custar mais do que o depósito inicial. O
motor delta-neutro **não envia ordens** — ele lê as exchanges e simula. A
decisão de arriscar dinheiro é sua.
