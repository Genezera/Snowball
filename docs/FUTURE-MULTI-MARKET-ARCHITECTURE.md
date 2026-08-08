# FUTURE — Arquitetura Multi-Mercado (Ações e outros mercados)

> **STATUS: MAPA DE ARQUITETURA FUTURA — NÃO É IMPLEMENTAÇÃO.**
> Nenhuma linha deste documento executa, roteia ou autoriza ordens em ações.
> Nesta fase **não existe execução em ações**: nem paper, nem shadow com broker real,
> nem conexão a corretora. Isto é um mapa de componentes e regras de fronteira para
> uma expansão *hipotética* futura. Cripto/funding delta-neutro segue sendo o único
> mercado operacional do laboratório.

**Escopo desta fase:** `hypothetical` (desenho) + `architecture` (contratos de interface).
**Fora de escopo:** qualquer coisa `live-paper`, `shadow` ou `real` em ações.

---

## 0. Léxico de estados (obrigatório em todo componente novo)

Todo dado ou decisão descrito abaixo carrega um selo de estado. Nada muda de selo
implicitamente. A promoção de selo é sempre explícita, append-only e reversível.

| Selo | Significado | Vale em ações nesta fase? |
|---|---|---|
| `observed` | Fato de mercado capturado de fonte externa (preço, calendário, evento) | Sim (só leitura) |
| `replayed` | Reprocessamento determinístico de dados `observed` já gravados | Sim (só leitura) |
| `simulated` | Resultado de modelo/backtest sem contato com mercado | Sim (papel) |
| `shadow` | Decisão calculada em paralelo, sem enviar ordem | **Não** (proibido nesta fase) |
| `hypothetical` | Desenho/contrato ainda não implementado | Sim (é o que este doc é) |
| `live-paper` | Execução simulada contra preços reais em tempo real | **Não** (proibido nesta fase) |
| `real` | Ordem real com capital real | **Não** (proibido nesta fase) |

> Se um componente de ações não conseguir provar seu selo, ele **não roda**.

---

## 1. Regra central — SEPARAÇÃO ANTES DE COMPARAÇÃO

Esta é a regra que governa todo o resto. Cripto (funding delta-neutro em perp) e
ações (equities) são **mercados estruturalmente diferentes**. Misturá-los cedo demais
é a forma mais rápida de esconder risco. Por isso, por construção:

1. **Capital SEPARADO.**
   Existe um `crypto_book` e um `equities_book`. São ledgers distintos, com saldos,
   moeda-base e limites próprios. Não há "conta única". Transferência entre livros é
   um evento explícito, registrado e reversível — nunca um efeito colateral de uma
   estratégia.

2. **Risco SEPARADO.**
   Cada livro tem seu próprio modelo de risco, seus próprios limites de exposição,
   seu próprio circuit-breaker e sua própria definição de drawdown. O risco de ações
   **não** consome o orçamento de risco de cripto e vice-versa. Não existe VaR
   agregado "de conveniência" antes da normalização (§13).

3. **Execução SEPARADA.**
   Motores, adapters e filas de execução são independentes. O `EquitiesBrokerAdapter`
   (§4) não compartilha código de envio de ordem com o motor de cripto. Uma falha,
   pausa ou kill-switch em um mercado **não** aciona ordem no outro.

4. **Contabilidade SEPARADA.**
   PnL, fees, funding, dividendos, settlement e impostos são contabilizados por livro,
   na moeda e no calendário de cada mercado. Só há consolidação para *relatório de
   leitura* — nunca para decisão de alocação sem passar pela normalização (§13).

### 1.1 Capital Opportunity Router — só compara DEPOIS de normalizar

O **Capital Opportunity Router (COR)** é o único componente autorizado a *comparar*
oportunidades entre cripto e ações. E ele só pode fazê-lo **depois** que:

- todos os **custos** estiverem normalizados (fees, spread, slippage esperado,
  custo de carrego/borrow, custo de oportunidade, e — crucialmente — o **custo
  escondido do gap overnight** de ações, §7); e
- todos os **riscos** estiverem normalizados para uma base comum (§13): mesma
  janela, mesma unidade de risco, mesmo tratamento de cauda, mesmo horizonte de
  liquidação (settlement, §14).

Antes de a normalização existir e ser auditável, o COR opera em modo `hypothetical`
e **não emite nenhuma recomendação de mover capital entre livros**. Comparar retorno
bruto de cripto contra retorno bruto de ações sem normalizar custo/risco é
proibido por construção — é exatamente o erro que este documento existe para evitar.

```
        crypto_book (isolado)                 equities_book (isolado)
      ┌───────────────────────┐            ┌───────────────────────┐
      │ capital / risco /     │            │ capital / risco /     │
      │ execução / contab.    │            │ execução / contab.    │
      └──────────┬────────────┘            └──────────┬────────────┘
                 │  métricas normalizadas             │
                 └───────────────┬────────────────────┘
                                 ▼
                   ┌─────────────────────────────┐
                   │  Capital Opportunity Router │
                   │  (só compara APÓS §13/§14)  │
                   │  saída: recomendação de     │
                   │  LEITURA, reversível        │
                   └─────────────────────────────┘
```

---

## 2. Data Provider (fonte de dados de ações) — `observed`

Camada de ingestão de dados de mercado de ações. Só leitura. Nunca envia ordem.

- **Responsabilidade:** cotações (intraday/EOD), OHLCV, book agregado quando
  disponível, e metadados de instrumento (ticker, exchange, moeda, lote, tick size).
- **Contrato de interface (`hypothetical`):**
  - `getQuote(symbol) -> {bid, ask, last, ts, source}` — carimbado `observed`.
  - `getBars(symbol, timeframe, window) -> Bar[]` — determinístico e re-`replayed`.
  - `getInstrument(symbol) -> InstrumentMeta` — lote, tick, moeda, mercado.
- **Requisitos:** timestamps com timezone explícito (nunca "hora local ambígua");
  distinção clara entre preço **ajustado** (por proventos) e **não ajustado**;
  marca d'água de atraso da fonte (delayed vs real-time) preservada no selo.
- **Providers plugáveis:** a interface é agnóstica de fornecedor. Um provider é um
  adapter que preenche o contrato; trocar de fonte não muda o resto do sistema.
- **Fronteira:** o Data Provider **não** decide nada. Ele entrega fato `observed`.

---

## 3. Market Calendar (calendário de pregão) — `observed`

Sem calendário correto, todo o resto (gaps, settlement, earnings) fica errado.

- **Responsabilidade:** dias úteis de pregão por exchange, feriados, meio-pregão
  (early close), horários de abertura/fechamento, e sessões estendidas
  (pre-market / after-hours) marcadas como tal.
- **Contrato:** `isTradingDay(exchange, date)`, `sessionBounds(exchange, date)`,
  `nextOpen/nextClose(exchange, ts)`.
- **Por que é crítico:** o **gap overnight** (§7) só existe porque o mercado de ações
  **fecha**. Cripto é 24/7 e não tem esse fechamento — essa é uma diferença estrutural
  que o calendário torna explícita e que a normalização (§13) precisa capturar.

---

## 4. Broker Adapter (adaptador de corretora) — `hypothetical` (SEM execução)

Interface de execução **desenhada, não implementada**. Nesta fase não existe nenhuma
implementação concreta conectada a corretora real; existe apenas o *contrato* e, no
máximo, uma implementação `simulated`/paper para teste de arquitetura.

- **Contrato de interface (só desenho):**
  - `submitOrder(order) -> orderId` — **stub proibido de conectar a broker real nesta fase.**
  - `cancelOrder(orderId)`, `getOrderStatus(orderId)`, `getPositions()`, `getBalances()`.
- **Isolamento obrigatório:** o `EquitiesBrokerAdapter` vive em módulo separado, com
  seu próprio kill-switch. **Não** compartilha caminho de código de envio de ordem com
  cripto. Um bug aqui não pode, por construção, tocar o `crypto_book`.
- **Modo default:** `dry-run`. Qualquer chamada de `submitOrder` nesta fase deve
  falhar fechado (recusar) ou apenas registrar em log `simulated`, nunca transmitir.
- **Fees/settlement plugáveis:** o adapter conhece o perfil de custo (§12) e o
  calendário de liquidação (§14) da corretora que representa.

---

## 5. Corporate Actions (eventos corporativos) — `observed`

Eventos que alteram preço, quantidade ou base de custo — e que **quebram séries
históricas** se ignorados.

- **Cobertura:** splits e reverse-splits, dividendos (cash e stock), spin-offs,
  fusões/aquisições, mudança de ticker, delisting.
- **Impacto no sistema:**
  - Ajuste retroativo de séries (`replayed`) para backtests coerentes.
  - Ajuste de **base de custo** e de quantidade no `equities_book` (contabilidade §1.4).
  - Dividendo é fluxo de caixa **na moeda do mercado**, no **calendário** do mercado
    (ex-date, record date, pay date) — entra na normalização de retorno (§13), não
    como "bônus" fora da conta.
- **Fronteira:** cripto **não tem** corporate actions no sentido de equities (embora
  tenha forks/airdrops, tratados no livro de cripto, jamais misturados aqui).

---

## 6. Earnings (resultados) — `observed` + fonte de risco de evento

- **Responsabilidade:** calendário de divulgação de resultados por ticker
  (before-open / after-close), e marcação de janela de **risco de evento**.
- **Por que importa:** earnings concentram gaps grandes (§7). Uma posição carregada
  overnight na véspera de um earnings tem distribuição de retorno com cauda muito
  mais gorda. O modelo de risco (§13) precisa tratar "posição overnight pré-earnings"
  como classe de risco distinta, não como "mais um dia".
- **Uso arquitetural:** flag `earningsWindow(symbol, ts)` consumível pelo risco e
  pelos sinais (momentum/pairs) para vetar ou reduzir exposição — em `simulated`.

---

## 7. Gaps overnight — o CUSTO ESCONDIDO das ações

Este é o ponto que mais distingue ações de cripto delta-neutro e o que o COR
**precisa** normalizar antes de qualquer comparação.

- **O que é:** como o mercado de ações **fecha**, o preço de abertura do dia seguinte
  pode saltar em relação ao fechamento anterior. Quem carrega posição overnight
  está exposto a esse salto sem poder reagir (mercado fechado, ou só sessão estendida
  ilíquida).
- **Magnitude típica (ordem de grandeza para dimensionamento, não promessa):**
  - **Mediana** do gap absoluto overnight na faixa de **~0,45% a ~2,50%**,
    variando por ativo, volatilidade e regime.
  - **Máximos** (cauda) podem passar de **>20%** em eventos idiossincráticos
    (earnings ruins, guidance, notícia, choque setorial).
- **Consequência arquitetural:** o retorno "de tela" de uma estratégia de ações
  **superestima** o retorno realizável se ignorar o custo/risco do gap. Portanto o gap
  overnight entra explicitamente:
  1. como **componente de custo/risco** na normalização do COR (§1.1, §13);
  2. como **fator de dimensionamento** (posição overnight ≠ posição intraday);
  3. como razão para separar métricas de estratégias overnight vs intraday.
- **Contraste com cripto:** perp 24/7 **não fecha**, logo não tem esse gap de
  fechamento — pode ter choques, mas o mecanismo é diferente. Comparar Sharpe/retorno
  de cripto contra ações sem embutir o gap é comparar coisas diferentes.

> Regra: nenhuma comparação cripto↔ações no COR é válida se o custo escondido do
> gap overnight não estiver embutido no lado das ações.

---

## 8. Comissão zero no varejo dos EUA — cuidado com "de graça"

- **Fato de mercado (`observed`):** desde ~2019 as principais corretoras de varejo
  dos EUA cobram **comissão nominal zero** em ações e ETFs.
- **Por que NÃO é "custo zero":** comissão zero não significa execução gratuita. O
  custo migra para lugares menos visíveis, que o perfil de fees (§12) precisa modelar:
  - **spread bid/ask** efetivamente pago;
  - **payment for order flow (PFOF)** e qualidade de execução (price improvement
    real vs teórico);
  - **slippage** e impacto em ordens maiores;
  - **borrow fee** em vendido / hard-to-borrow;
  - **regulatórios** (ex.: taxas SEC/FINRA em vendas), pequenos mas reais;
  - custo de **conversão de moeda** para capital não-USD.
- **Consequência:** "comissão zero" **não** autoriza tratar fee como 0 no modelo. O
  custo total de transação de ações continua > 0 e precisa ser estimado honestamente
  antes de o COR comparar com cripto. Zero de comissão ≠ zero de custo.

---

## 9. Sinais — Momentum — `simulated`

- **Definição:** ranking de ativos por força relativa/tendência em janela definida.
- **Fronteira honesta:** momentum é gerador de **hipótese**, não de ordem. Nesta fase
  só produz sinais `simulated`/`shadow-de-papel` (sem broker).
- **Dependências:** séries ajustadas por corporate actions (§5); veto por
  earnings-window (§6); custo/risco de gap se a estratégia carregar overnight (§7).

## 10. Sinais — Pairs (long/short relativo) — `simulated`

- **Definição:** posições relativas entre dois ativos correlacionados/cointegrados
  (mean-reversion do spread).
- **Nota de risco:** "market-neutral" em ações **não** é o mesmo que delta-neutro de
  funding em cripto. Pairs tem risco de quebra de cointegração, custo de **borrow** na
  perna vendida, e ainda sofre gap overnight em cada perna. A neutralidade é aparente
  e precisa ser precificada como risco, não assumida como zero.

## 11. Sinais — Sector Rotation — `simulated`

- **Definição:** realocação entre setores/ETFs setoriais conforme regime.
- **Dependências:** calendário (§3), fees de ETF e rebalanceamento (§12), e
  normalização de risco setorial (§13). Também `simulated` apenas.

> Momentum, Pairs e Sector Rotation são **estratégias candidatas de ações**. Nenhuma
> executa nesta fase. Todas competem por capital **apenas** dentro do `equities_book`
> e só chegam ao COR depois de normalizadas.

---

## 12. Fees & modelo de custo de transação (ações) — `simulated`

Perfil de custo plugável por corretora/mercado, usado em backtest e na normalização.

- **Componentes:** comissão (≈0 no varejo EUA, §8), spread efetivo, slippage/impacto,
  PFOF/qualidade de execução, borrow fee (vendido), taxas regulatórias, conversão de
  moeda, e — para overnight — o custo/risco de gap (§7).
- **Contrato:** `estimateCost(order, marketState) -> {explicit, spread, slippage,
  borrow, regulatory, fxConv}` — sempre com selo `simulated` e premissas versionadas.
- **Regra:** custo nunca é constante mágica; é estimado a partir de estado de mercado
  e revisado com dados `observed`. Otimismo de custo é tratado como bug.

---

## 13. Risk Model (modelo de risco de ações) + Normalização — `simulated`

- **Risco isolado do `equities_book`:** limites de exposição, concentração por ativo/
  setor, drawdown próprio, circuit-breaker próprio, tratamento de **overnight** como
  classe de risco distinta (por causa de §7 e §6).
- **Normalização (pré-requisito do COR):** para o COR comparar cripto↔ações, ambos
  precisam ser expressos na **mesma base**:
  - mesma **unidade de risco** (ex.: retorno por unidade de risco de cauda, não só
    volatilidade média);
  - mesma **janela** e mesmo **horizonte de liquidação** (settlement, §14);
  - **custo total** já descontado (fees §12 + gap §7);
  - tratamento explícito de **24/7 (cripto) vs pregão com fechamento (ações)** — o
    fato de cripto não fechar e ações fecharem muda a distribuição de risco e não pode
    ser apagado na média.
- **Saída:** métricas comparáveis, auditáveis e reversíveis. Enquanto essa
  normalização não existir e não for verificável, **o COR não recomenda mover capital**.

---

## 14. Settlement rules (liquidação) — `observed` / regra estrutural

- **Ações (EUA):** liquidação em **T+1** (regime atual, pós-maio/2024; antes T+2).
  O capital não está livre instantaneamente; há prazo entre trade e liquidação.
- **Cripto:** liquidação praticamente **instantânea / on-chain / na exchange**, 24/7.
- **Consequência arquitetural:** o **horizonte de liquidação** diferente afeta custo
  de oportunidade e disponibilidade de capital. O COR precisa embutir isso — capital
  "preso" em settlement de ações não é equivalente a capital líquido de cripto.
  Ignorar settlement infla artificialmente a atratividade das ações.

---

## 15. Fractional shares (frações de ação) — `hypothetical`

- **Definição:** compra de frações de uma ação (ex.: 0,1 ação), comum no varejo EUA.
- **Uso arquitetural:** permite dimensionamento fino de posição em ativos de preço
  alto, útil para paridade de tamanho em pairs (§10) e sector rotation (§11) — em
  `simulated`.
- **Cuidados:** frações podem ter execução/rota diferente (às vezes só a mercado, às
  vezes internalizadas pela corretora), tratamento próprio em corporate actions (§5)
  e possíveis restrições de transferência entre corretoras. Modelar como caso à parte
  no fees (§12) e no broker adapter (§4), nunca assumir simetria com lote inteiro.

---

## 16. Fronteiras invioláveis (resumo de guarda)

1. **Nada de execução em ações nesta fase** — sem broker real, sem `shadow` de ordem,
   sem `live-paper`. Só `observed` (leitura), `replayed`, `simulated`, `hypothetical`.
2. **Não tocar** Champion, motores, risco, execução ou contabilidade de **cripto**.
   Este documento não altera nenhum componente operacional existente.
3. **Capital, risco, execução e contabilidade permanecem SEPARADOS** entre cripto e
   ações. Sem conta única, sem risco agregado de conveniência.
4. **O COR só compara após normalização auditável** de custo (incl. gap overnight §7,
   custo real sob comissão zero §8) e risco (§13) e settlement (§14).
5. **Reversível e append-only:** toda decisão do COR é recomendação de **leitura**,
   registrada, reversível. Nenhuma move capital sozinha.
6. **Sem promessa de lucro futuro.** As magnitudes citadas (gap 0,45%–2,50% mediana,
   >20% máximo) são para **dimensionar risco**, não para prometer retorno.

---

*Este é um mapa de arquitetura futura (`hypothetical`). Não implementa, não conecta
corretora e não executa nada em ações. Cripto/funding delta-neutro segue como o único
mercado operacional do laboratório.*
