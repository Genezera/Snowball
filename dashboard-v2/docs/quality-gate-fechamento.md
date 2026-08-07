# Dashboard 2.0 — Fechamento do Quality Gate de Interface

**Veredito:** suíte consolidada final **343 passed / 0 failed / 0 flaky /
13 skipped** nas 3 engines executáveis (chromium-desktop, chromium-mobile,
webkit). Firefox não executável no ambiente (`spawn UNKNOWN`), registrado à
parte. Backend 42/42. Typecheck e build limpos.

Relatório de entrega. Todos os números aqui são **medidos**, não estimados —
onde algo não pôde ser medido, está marcado explicitamente como
`não medido` com o motivo. As contagens vêm exclusivamente do
`results-final.json` da última execução.

> Nenhum motor, estratégia ou lógica econômica foi alterado nesta etapa. As
> únicas mudanças de código de produção foram no **frontend** (React/CSS) e
> na **camada de leitura da API V2** (`dashboard-v2/api`), esta última só em
> bugs comprovados pelos testes desta etapa. Os 4 supervisores, locks e
> heartbeats não foram tocados.

---

## 1. Resultado da suíte multi-browser

Fonte única: `results-final.json` (relatório JSON da última execução
consolidada, iniciada 2026-08-07 21:04 UTC — **depois** de todas as
correções: cursor, freeze/resume, Settlement Timeline, teste WebKit, escopo
canônico de regressão visual).

```text
projeto           passed  failed  skipped  duration
chromium-desktop    126      0       4       346.8s
chromium-mobile     109      0       4       324.0s
webkit              108      0       5       343.8s
--------------------------------------------------------
TOTAL               343      0      13      (~17,1 min de wall-clock)

firefox           não executado — spawn UNKNOWN no ambiente
                  (NÃO contabilizado como aprovado, falhado nem pulado pelo produto)
```

JSON `stats`: `expected: 343, unexpected: 0, flaky: 0, skipped: 13`.

Os 13 skips: 12 são o mesmo conjunto de 4 smokes dependentes de mercado
(champion "posições reais SE houver", command-center "motor fora da janela"
smoke, cost-intelligence "partial" smoke, risk-center "tabela de risco")
× 3 projetos — **cobertura funcional garantida pelas fixtures
determinísticas**; +1 é o teste de teclado do WebKit (limitação de
ambiente, ver seção 7).

Firefox: o binário `firefox.exe` falha com `spawn UNKNOWN` neste ambiente
Windows — confirmado em teste isolado, com e sem `dangerouslyDisableSandbox`.
Não é um bug do produto nem artefato de sandbox; Chromium (desktop+mobile) e
WebKit sobem e rodam normalmente. Firefox fica documentado como
não-executável aqui, **nunca** contabilizado como aprovado.

Motivo dos skips: testes-smoke com dados reais que dependem de um estado de
mercado específico no instante da execução (posição aberta real, challenger
real acima de 5x, settlement real concluído, motor real fora da janela,
decomposição `partial` real). **A cobertura funcional desses casos é
garantida por testes determinísticos com fixtures de rota** (seção 6/7) — os
smokes são cobertura adicional, não a única.

---

## 2 + 3 + 4. Cursor à prova de reset de `sequenceNumber`

### Causa raiz (real, comprovada)

O cursor incremental por fonte usava `sequenceNumber` como **posição
persistida** para challengers "modernos"
(`api/services/eventos.ts` → `lerNovosDeUmaFonte`):

```ts
const posicaoDoRegistro = temSequence ? ev.sequenceNumber : byteOffset; // ANTES
```

O orquestrador reinicia `sequenceNumber` em `1` após um restart (o contador
vive em memória do processo, não é persistido). Um cursor já avançado até
`sequenceNumber: 900` descartava **silenciosamente** os eventos novos
`1, 2, 3` (`1 <= 900`) — **perda de evento real**, não duplicação.

### Correção

```ts
const posicaoDoRegistro = byteOffset; // DEPOIS — sempre, moderna ou legada
```

`byteOffset` é monotônico dentro de uma geração de arquivo,
independente de qualquer restart do orquestrador. Rotação de arquivo
(truncamento/recriação) já é tratada à parte via `fileIdentity` +
`generation`. `sequenceNumber` e `cycleId` continuam existindo — mas agora só
como **metadados do evento** (auditoria, decisão de colisão de `eventId`),
nunca como posição do cursor. Preferência atendida:
`sourceId` + `fileIdentity` + `generation` + `byteOffset` para posição;
`eventId`/`sequenceNumber`/`cycleId` como metadados.

### `eventId` duplicado: renomear, nunca apagar

Quando a fonte reusa um `eventId` (mesmo eventId, `cycleId` diferente = evento
economicamente distinto), a API **não** descarta o evento. Ela mantém o
evento com um `eventId` sintético estável
(`fonte:g<generation>:b<byteOffset>`, único por construção) e preserva o
`eventId` original da fonte em **`eventIdOriginal`** (campo novo no contrato,
`src/schemas/events.ts`) para auditoria. Apagar seria perda de dado real
disfarçada de deduplicação.

### Testes de regressão (`api/tests/eventos.test.ts`) — 27/27 passando

- `CRÍTICO: reset de sequenceNumber...` — escreve seq 898/899/900, persiste
  cursor, "reinicia o orquestrador" (append de seq 1/2/3 no mesmo arquivo),
  relê com o cursor anterior: confirma os 3 novos entregues exatamente uma
  vez, nenhum antigo repetido, IDs únicos, e "reinicia a API" (relê com o
  mesmo cursor) de forma determinística. Cursor continua válido.
- `duplicata: mesmo eventId + mesmo cycleId` — mantido com ID sintético.
- `duplicata: mesmo eventId + cycleId diferente` — os dois preservados,
  `eventIdOriginal` auditável.
- `duplicata: mesmo sequenceNumber + cycleId diferente` — não é colisão de
  eventId, os dois passam direto.
- `duplicata: mesmo timestamp, eventos diferentes` — nunca colapsam.
- `duplicata: restart da API` / `restart do orquestrador` — determinístico,
  sem perda nem duplicação.

Backend inteiro: **42/42 testes passando**
(`node --experimental-strip-types --test api/tests/*.test.ts`).

---

## 5. Bug upstream registrado

`docs/bugs-upstream/sequence-number-reset.md` — relatório técnico para o Lab.
Inclui: 4 challengers afetados (varredura real em
`inteligencia/challengers/*/diario.jsonl`, 4 de 51), `cycleId`s divergentes
(`orch-1786099074873` → `orch-1786099902867`), `sequenceNumber`s repetidos
(1, 2, 3), `eventId`s repetidos, impacto sobre cursor e auditoria, mitigação
atual na API V2, e correção definitiva recomendada (persistir o contador ou
trocar sua semântica). **O Lab não foi alterado.**

---

## Bug real extra encontrado e corrigido: freeze/resume (corrida)

`src/hooks/useEventosRecentes.ts` — o desenho antigo decidia, em tempo real
dentro do poll assíncrono, se cada lote novo ia pra lista visível ou pro
buffer, lendo uma ref de "está congelado?". Isso é uma corrida por
construção: o poll é independente do clique do usuário. Redesenhado para uma
**única lista sempre-crescente** (`todosRef`) + uma **fronteira congelada**
(`fronteiraRef`, gravada de forma atômica e síncrona no clique). O visível é
`todos.slice(0, fronteira)` enquanto congelado. Não existe mais "pra onde vai
o lote" — só "até onde a tela mostra agora". Teste de freeze/resume rodado
6× seguidas contra dados ao vivo: **6/6 estável** (antes: intermitente).

---

## 6 + 7. Estados visuais determinísticos (sem depender do mercado)

`e2e/mocks.ts` — fixtures de rota que seguem exatamente os schemas Zod reais
(nenhum campo inventado). Cobertura funcional determinística adicionada,
mantendo os testes com dados reais como smokes:

- **Champion View:** 0 posições (ilustração de vazio), 1 posição (duas
  pernas + métricas de risco), 2 posições (ambas), 1 posição com risco
  elevado (distância mínima de liquidação 2% aparece, perna em risco).
- **Command Center:** motor recém-chegado com PnL altíssimo mas fora da
  janela comum NUNCA vence o ranking (item 3), e aparece na lista de
  excluídos com motivo.
- **Risk Center:** challenger acima de 5x sempre mostra o selo
  `PAPER EXPERIMENT — HIGH RISK`; challenger sem alto risco não entra no selo.
- **Settlement Capture:** janela com posição aberta mostra "PnL ainda não
  concluído" (nunca número fechado); janela concluída mostra o PnL fechado
  (funding recebido − custos).

Achado no processo: um bug no **próprio teste** (fixture sem o campo
obrigatório `atualizadoEm`) produzia um falso-positivo — a validação Zod
falhava e o app caía no fallback de 0 posições, que "passava" por acidente.
Corrigido; agora a fixture valida contra o schema real.

---

## 8. Acessibilidade (axe) — desktop e mobile

Resultado da execução final, idêntico nas 3 engines (chromium-desktop,
chromium-mobile, webkit) — **todas as 6 páginas com 0/0/0/0**:

```text
Command Center     : critical=0 serious=0 moderate=0 minor=0
Champion View      : critical=0 serious=0 moderate=0 minor=0
Live Operations    : critical=0 serious=0 moderate=0 minor=0
Settlement Capture : critical=0 serious=0 moderate=0 minor=0
Cost Intelligence  : critical=0 serious=0 moderate=0 minor=0
Risk Center        : critical=0 serious=0 moderate=0 minor=0
```

Correções reais feitas nesta linha de trabalho (etapas anteriores + esta):

- **`--ink-3`**: `#5b6272` (3.03:1, reprova WCAG AA) → `#7a8294` (~4.6:1).
- **Regiões horizontais com foco** (`scrollable-region-focusable`): 3 divs de
  tabela com `overflow-x:auto` ganharam `tabIndex={0} role="region"
  aria-label`.
- **Nomes acessíveis dos selects** (`select-name`): 2 `<select>` de filtro no
  Live Operations ganharam `aria-label`.
- **Contraste do selo de alto risco**: fundo trocado de `--loss-glow`
  (medido 4.46:1, quase reprova) para `rgba(224,102,122,0.15)` local.
- **Settlement Timeline rolável em mobile** (achado NESTA execução final, só
  no `chromium-mobile`): o grid de colunas fixas da timeline não cabia em
  ~410px e forçava o `<main>` do AppShell a um scroll horizontal sem foco de
  teclado (`scrollable-region-focusable`, serious). Corrigido: a timeline
  tem seu próprio container rolável focável (`tabIndex`+`role`+`aria-label`),
  contendo o scroll. Verificado 3× isolado.

Meta atingida: `critical: 0`, `serious: 0` (na verdade `0/0/0/0`) em todas as
6 páginas, nas 3 engines — travando o teste.

---

## 9. Responsividade — matriz página × resolução

Resultado `chromium-desktop`: **44/44 asserções de overflow horizontal
passando** (6 páginas × 7 resoluções + 2 testes de prioridade mobile).

| resolução | resultado (6 páginas) |
|---|---|
| 390 × 844 | sem overflow ✓ |
| 430 × 932 | sem overflow ✓ |
| 768 × 1024 | sem overflow ✓ |
| 1366 × 768 | sem overflow ✓ |
| 1440 × 900 | sem overflow ✓ |
| 1920 × 1080 | sem overflow ✓ |
| 2560 × 1080 | sem overflow ✓ |

Bugs de responsividade corrigidos:

- **Grid com mínimo rígido** (`minmax(170px/180px/220px/260px/320px, 1fr)`):
  6 ocorrências em ChampionView/CommandCenter/CostIntelligence/RiskCenter
  passaram a `minmax(min(Xpx, 100%), 1fr)`.
- **Comparação de motores sem quebra**: grid `1fr 1fr` rígido + id de
  challenger longo sem `minWidth:0` forçava scroll horizontal — corrigido com
  colunas responsivas + `minWidth:0` + `overflowWrap:'anywhere'`.
- **Layout de gráficos**: linha `1fr 1fr` do ChampionView passou a
  `repeat(auto-fit, minmax(min(280px,100%), 1fr))`.
- **Header e status pills**: `AppShell.tsx` — header rígido sem `flex-wrap` +
  padding fixo forçava overflow da página inteira abaixo de ~430px; corrigido
  com `flexWrap:'wrap'` + `padding` responsivo (`clamp`).
- **Scroll horizontal de tabelas**: as tabelas largas rolam dentro do próprio
  container (`overflow-x:auto` + região focável), o body nunca rola lateral.

---

## 10. Screenshots (visual regression)

```text
engine canônico    : Chromium (chromium-desktop)
viewports capturados: desktop (1440×900) E mobile (390×844)
baselines canônicos : 17
```

17 baselines (`e2e/visual-regression.spec.ts`): 6 páginas desktop + 6 mobile
+ 5 estados (loading, error, corrupted, reduced-motion, tema escuro).

**Escopo canônico:** a regressão visual roda SÓ no chromium-desktop — pixel
baselines são específicos por engine (WebKit/Firefox antialiasam texto
diferente), então difar pixels entre engines não é asserção significativa. O
spec já captura desktop E mobile internamente via `setViewportSize`, então
uma engine basta. Os baselines paralelos de mobile/webkit (criados por
engano em runs anteriores) foram removidos; sobraram os 17 canônicos.

**Primeira execução** = criação de baseline (não conta como aprovação).
**Execução posterior contra os baselines: 17/17 sem diferença inesperada**
(tolerância `maxDiffPixelRatio: 0.02`), confirmada em 2 execuções idênticas —
determinístico, não flaky. Na suíte consolidada final, os 17 rodaram como
`passed` no chromium-desktop.

---

## 11. Performance — números medidos

| métrica | valor | condição | status |
|---|---|---|---|
| Bundle inicial bruto | 904.4 KB | build de produção | **medido** |
| Bundle inicial gzip | 273.0 KB | build de produção | **medido** |
| Bundle por rota | index 488.4/150.5 KB, PnLWaterfall 346.1/100.1 KB, ChampionView 40/11.4 KB, LiveOperations 12.3/4.5 KB, SettlementCapture 6.5/2.5 KB, CostIntelligence 5.6/1.9 KB, RiskCenter 5.1/1.6 KB (bruto/gzip) | build | **medido** |
| FCP | 327–556 ms (webkit ~327, chromium ~484–556) | cache frio, 3 engines | **medido** |
| DOMContentLoaded | 246–395 ms | cache frio, 3 engines | **medido** |
| load | 246–440 ms | cache frio, 3 engines | **medido** |
| Recarregamento | 418–815 ms | cache quente, 3 engines | **medido** |
| Memória inicial | 23–25 MB (Command Center), 29–40 MB (Live Operations); `null` no WebKit (sem `performance.memory`) | desktop/mobile | **medido** (onde a engine expõe) |
| Render 100 eventos | 389–603 ms | dados reais, 3 engines | **medido** |
| Render 1.000 eventos | 796–1.469 ms | dados reais (o sistema acumulou 1.188 eventos reais na execução final) | **medido** — antes indisponível por falta de volume; agora medido de verdade |
| Render 10.000 eventos | 1.139–1.548 ms / 24 nós DOM / 29 MB | mock sintético, 3 engines | **medido** |
| Filtro com 10k | 309–489 ms | mock sintético | **medido** |
| LCP | não medido | — | **não medido** — sem `PerformanceObserver('largest-contentful-paint')` instrumentado; FCP medido como proxy de first paint |
| CLS | não medido | — | **não medido** — sem `layout-shift` observer instrumentado |
| Tempo de interação (INP) | não medido | — | **não medido** — requer interação real medida com `event`-timing; freeze/filtro medidos como proxies (448 ms filtro, freeze < 1 tick) |
| FPS durante animação | não medido | — | **não medido** — sem captura de `requestAnimationFrame` sustentada instrumentada |
| Memória após período medido | não medido em 30 min reais | — | **não medido** — teste automatizado de 30 min inviável aqui; memória inicial + após 10k (29 MB, estável) medidas |
| Requests/min | não medido como agregado | — | **não medido** — poll champion 5s + profit-lab 10s + events por cursor; auditável, não cronometrado como taxa |
| Bytes/min | não medido | — | **não medido** |

Oportunidade futura registrada (sem obrigação de otimizar agora): chunk
**`PnLWaterfall ≈ 346 KB bruto / 100 KB gzip`** — candidato a lazy-load /
troca de lib de chart.

---

## 12. Live Operations com 10.000 eventos

`e2e/live-operations-10k.spec.ts` — 4 testes, todos passando:

| aspecto | resultado |
|---|---|
| Tempo até 10k na lista lógica | 1.137 ms |
| Nós no DOM (virtualização) | **24** (nunca 10.000 simultâneos) |
| Memória | 29 MB |
| Tempo de filtro | 448 ms |
| Freeze/resume com 10k | funciona |
| IDs duplicados | 0 (índices únicos no DOM) |
| Eventos perdidos | 0 (total lógico = 10.000) |
| Scroll até o fim | virtualizer recalcula, < 200 nós |
| Troca de página e retorno | virtualização se reestabelece, total lógico volta a 10.000 (não dobra), zero duplicado |

Virtualização implementada com `@tanstack/react-virtual` em
`EventTimeline.tsx` (não existia antes desta linha de trabalho).

---

## 13. Rede e console

Fixture compartilhado (`e2e/fixtures.ts`) falha qualquer teste com:
`request para :8787`, `console.error` inesperado, `pageerror`/unhandled
rejection, ou 404 não esperado. Allowlist documentada e restrita a erros de
REDE esperados nos testes de falha da API (item 16), nunca erros de aplicação.

```text
requests para 8787       : 0   (travado em todo teste via fixture)
erros de console inesperados : 0
unhandled rejections     : 0
React duplicate keys     : 0   (eventId único por construção, testado)
loops de request         : 0   (testes de falha confirmam sem retry-storm)
```

Mensagens esperadas (só nos cenários simulados de falha da API): `Failed to
fetch` (o app trata como estado `erro`), banner do React DevTools.

---

## 14. Checklist de entrega

1. Resultado consolidado da suíte — seção 1 + final.
2. Resultado por navegador — seção 1.
3. Correção do cursor após reset de sequência — seção 2/3/4.
4. Testes de regressão do cursor — seção 2/3/4 (27/27).
5. Issue do bug upstream — `docs/bugs-upstream/sequence-number-reset.md`.
6. Relatório axe — seção 8.
7. Relatório de teclado — `e2e/keyboard.spec.ts` (14 testes).
8. Matriz responsiva — seção 9.
9. Screenshots e baselines — seção 10.
10. Métricas de performance — seção 11.
11. Resultado de 10.000 eventos — seção 12.
12. Falhas da API — `e2e/api-failure.spec.ts` (8 testes: 500, timeout, JSON
    inválido, schema incompatível, resposta parcial, conexão recusada +
    recuperação, resposta lenta, cursor preservado).
13. Bugs encontrados — cursor/sequenceNumber (perda de evento); eventId
    apagando evento economicamente distinto; freeze/resume (corrida); 6 grids
    com overflow; comparação de motores com overflow; header AppShell com
    overflow; `--ink-3`/selo/selects/regiões (axe); + bugs no próprio teste
    (fixture sem `atualizadoEm`, baseline de freeze medido cedo demais,
    igualdade estrita num feed ao vivo, `__dirname`/`require` em ESM,
    timeout do teste menor que o do `waitForFunction`).
14. Bugs corrigidos — todos os acima.
15. Skips e limitações — 13 skips (12 smokes dependentes de mercado × 3
    projetos, cobertos por fixtures determinísticas; +1 teclado WebKit,
    limitação de ambiente); Firefox `spawn UNKNOWN`; LCP/CLS/INP/FPS/
    bytes-por-min não instrumentados; memória-30min não medida. (1.000
    eventos deixou de ser limitação — foi medido na execução final.)
16. Testes totais — backend 42/42; E2E: ver contagem consolidada final.
17. Build — `npx tsc -b` limpo; `npm run build` gera os chunks medidos.
18. Working tree — arquivos modificados listados no relatório; novos:
    `e2e/`, `playwright.config.ts`, `docs/bugs-upstream/`.
19. PIDs e portas — API V2 pid 14900 na 5184 (health ok); frontend na 5183
    (HTTP 200). Supervisores vivos: api 74975, frontend 74976, principal
    72669, profit-lab 73824 (todos anteriores ao restart da API — nunca
    caíram).
20. Confirmação: **nenhum motor, estratégia ou lógica econômica foi
    alterado.** Mudanças só em frontend e na leitura da API V2.

Nenhuma página nova foi construída.
