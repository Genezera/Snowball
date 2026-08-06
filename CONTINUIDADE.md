# Continuidade

> **Para a próxima IA que pegar este projeto.** Este documento existe para que
> nada se perca entre sessões. Leia isto antes de qualquer outro arquivo — a
> versão anterior deste documento (03/08/2026) está desatualizada em quase
> tudo: passou a existir MCP do trader.dev, motor operando em 6 exchanges,
> modo agressivo, motor de pares cointegrados, medição de preenchimento maker,
> um dashboard inteiramente novo, e dois scripts de start/stop. Esta versão
> reflete o estado real em **06/08/2026**.

Última atualização: **06/08/2026**.

---

## 0. O essencial em quinze linhas

- **Projeto:** `C:\Users\Renan\Projetos\Snowball` — laboratório de pesquisa
  quantitativa + motor de renda delta-neutra em cripto, TypeScript nativo do
  Node 24 (`--experimental-strip-types`, sem build step).
- **Usuário:** Renan (GitHub `Genezera`). Fala português, direto, sem
  preâmbulo. Confere o que você afirma — já pegou afirmações erradas antes.
  Repositório: `github.com/Genezera/Snowball`, branch `main`.
- **Estado:** paper trading em **8 processos** supervisionados. **Nenhuma
  ordem foi enviada a nenhuma exchange, em nenhum momento deste projeto.**
- **Capital de paper, três motores independentes, isolados:**
  - Modo normal (delta-neutro): US$ 100/exchange × 6 exchanges = ~US$ 600
  - Modo agressivo (ts-momentum): US$ 200, roda só no backend (tirado do
    dashboard por lentidão — ver seção 4)
  - Pares cointegrados (mercado-neutro): US$ 200
- **A conta que decide tudo, no motor normal:** custo = `notional×taxa×4`,
  receita = `notional×spread` a cada 8h. **O notional se cancela** — só taxa,
  spread e tempo de vida decidem se uma posição vale a pena.
- **Comportamento correto hoje:** o motor normal abre poucas posições (2-3),
  porque nenhum dos 15 pares de exchange monitorados tem spread que dure
  tempo suficiente para pagar o próprio custo (folga real ~0,004-0,06,
  precisa de 1,5). **Isso é o portão funcionando, não uma falha.**
- **Como subir/derrubar tudo:** `iniciar.cmd` / `parar.cmd` na raiz — sobem
  ou derrubam o watchdog (`scripts/supervisor.sh`), que por sua vez
  supervisiona os 8 processos. Não use os `run-*.cmd` antigos junto com o
  watchdog — foi essa dupla supervisão que já causou um bug real (seção 4).

---

## 1. Regras permanentes do usuário — não foram revogadas

1. **Decida e execute** — não peça permissão para cada passo pequeno.
2. **Não fabrique confiança.** Se não mediu, diga que não mediu. Números
   "batem" só quando batem de verdade — várias vezes nesta sessão um resultado
   bonito foi derrubado por um teste mais rigoroso, e a correção honesta foi
   documentada, não escondida (ver `docs/O-QUE-FALHOU.md`).
3. **Qualquer coisa que remova trades lucrativos vira experimento
   documentado, não vai pra produção sem holdout.** Regra que já evitou
   repetir o erro do `body-breakout` (achado bonito na descoberta, morre a
   custo taker real — Resultado 3 e 16 em `docs/RESULTADOS.md`).
4. **Nunca disrupte processos rodando sem necessidade.** Este projeto tem uma
   disciplina forte de "antes de mexer, snapshot dos PIDs; depois de mexer,
   confirma que só o processo pretendido mudou". Ver seção 6.
5. **Nada de dado inventado no dashboard.** Estado vazio com mensagem clara é
   melhor que fingir dado que não existe.
6. **Português, sem emoji a menos que pedido, direto ao ponto.**

---

## 2. Arquitetura — 8 processos, todos supervisionados

```
  VIGILÂNCIA      (5 min)   varre 3.492 pares em 6 exchanges, ciclo de vida
  CUSTÓDIA        (15 min)  saúde de cada exchange → motor evacua sozinho
  MOTOR           (5 min)   delta-neutro, lê a vigilância, decide, NUNCA ENVIA ORDEM
  DASHBOARD        live      localhost:8787, SSE em tempo real
  COLETOR         (5 min)   arquiva histórico de longo prazo
  MODO AGRESSIVO  (20 min)  ts-momentum multi-ativo, capital próprio, só backend
  PARES           (20 min)  cointegrados, mercado-neutro, capital próprio
  PREENCHIMENTO   (10 s)    mede se ordem limite preenche rápido o bastante
```

Todos se falam por **arquivo em disco** (JSON/JSONL), nunca chamada direta —
se um cai, os outros percebem pela idade do dado. `scripts/supervisor.sh`
checa os 8 a cada 30s por `CommandLine` (casando pelo **basename** do arquivo
`.ts`, nunca o caminho inteiro — ver pegadinha na seção 5) e religa
automaticamente, com log de causa em `vigilancia/supervisor-watchdog.log`.

**Para subir/derrubar:** `iniciar.cmd` (sobe só o watchdog, que sobe o resto;
recusa duplicar se já tiver um rodando) e `parar.cmd` (mata o watchdog
primeiro, depois os 8 processos; não apaga nenhum estado — cada motor grava
o próprio `estado.json` a cada ciclo, então religar retoma sozinho de onde
parou). Não testei rodando de verdade ainda (pararia o sistema ao vivo);
verifiquei só que os padrões de busca batem 1-para-1 com os processos reais.

---

## 3. As três estratégias em produção (paper)

### 3.1 Motor normal — arbitragem de funding cross-exchange (o núcleo)

Vende o perpétuo onde o funding é alto, compra o mesmo perpétuo onde é
baixo, em exchanges diferentes. Preço se cancela entre as pernas —
**exposição direcional zero por construção.** Renda vem do funding, pagamento
contratual a cada ~8h, não uma aposta de preço.

**A conta que decide tudo** (se só ler uma parte deste documento, seja esta):

```
custo de ida e volta = notional × taxa × 4      (2 pernas × abrir e fechar)
receita por 8h        = notional × spread
```

O notional aparece nos dois lados e se cancela — **alavancagem e capital não
decidem se vale a pena; só taxa, spread e tempo de vida decidem.** Por isso
existe o **portão de valor esperado** (`src/funding/valor.ts`): só abre se o
spread já viveu, historicamente, tempo suficiente pra pagar o próprio custo
(folga = vida esperada ÷ payback exigido ≥ 1,5x).

Opera nas 6 exchanges (binance, bybit, okx, gate, bitget, bingx), usando a
que o mercado favorecer a cada ciclo. Ranking de lucro individual por
exchange e ranking de melhor PAR de 2 exchanges (para quando for dinheiro
real) ambos no dashboard, com dado real da vigilância.

**Estado real agora (06/08/2026, ~18h):** capital US$ 603, 3 posições
abertas, folga do melhor par (bitget+bybit) ~0,06 contra 1,5 exigido — o
mercado não está oferecendo spread que dure tempo suficiente. Não é bug.

### 3.2 Modo agressivo — ts-momentum multi-ativo

A ÚNICA de 7 famílias de estratégia testadas neste projeto que sobreviveu a
holdout cego com significância real (p=0,008 — Resultado 6/10 em
`docs/RESULTADOS.md`). 57 ativos, barras diárias, `PARAMS_VALIDADOS = {
lookback: 30, minRet: 0.05, stopPct: 0.12, takePct: 5.0 }`. Risco fixo
0,5%/posição (não dividido por concorrência — é o ponto que o bootstrap por
blocos, Resultado 12, mediu como o mais defensável).

**Tirado do dashboard em 06/08/2026** (continua rodando no backend
normalmente): com 40 posições abertas, cada uma disparando fetch de candle +
render individual, a aba ficava lenta. A UI agora mostra só um resumo leve
(processo vivo/morto + 2 parágrafos de contexto) na aba Pesquisa. Estado
completo continua em `momentum/diario.jsonl`, `momentum/estado.json`.

Código: `src/live/motor-momentum.ts`, `src/cli/momentum-live.ts`.

### 3.3 Pares cointegrados — mercado-neutro (NOVO, 06/08/2026)

Construído nesta sessão a partir do Resultado 14 (`docs/RESULTADOS.md`):
misturar momentum + pares corta a chance de ruína do portfólio de ~46% para
~15% mantendo a chance de sucesso quase igual (correlação entre trades dos
dois mecanismos: +0,065, bem menor que a correlação do momentum consigo
mesmo, +0,130). Só a parte de momentum estava ao vivo até esta sessão.

Recalibra os pares semanalmente (`varrerPares`/`avaliarPar` sobre 250 barras
diárias via ccxt ao vivo — não usa dado local baixado, que ficaria velho),
seleciona sem sobreposição de ativo (`selecionarSemSobreposicao`), opera com
a MESMA regra de entrada/saída por z-score do backtest validado
(`passoZScore`, extraída de `backtestPar` sem alterar a lógica original —
duplicada de propósito pra não arriscar o código já testado). Alavancagem
fixa em 1x (o limite que `src/pairs/liquidacao.ts` documenta como seguro —
acima disso, ~13% dos trades históricos teriam liquidado uma perna).

Código: `src/live/motor-pares.ts`, `src/cli/pares-live.ts`. Estado em
`pares/estado.json`, `pares/diario.jsonl`. Card leve no dashboard (aba
Pesquisa) — capital, pares calibrados, posições abertas, taxa de vitória,
SEM candle chart por posição (mesma lição do modo agressivo).

**Estado real agora:** US$ 200, 20 pares calibrados, 0 posições abertas
(nenhum cruzou o z-score de entrada ainda desde o lançamento).

### 3.4 Medição de preenchimento maker (item B6, NOVO, 06/08/2026)

A única alavanca real identificada nesta sessão para reduzir custo sem
inventar risco novo — mas o resultado real (abaixo) é mais sóbrio do que a
expectativa inicial. Simula ordem limite "no toque" (posta no bid pra
comprar, no ask pra vender) em ambas as pernas dos 5 melhores candidatos da
vigilância, usando o preço real (`last`) como proxy de preenchimento — sem
enviar ordem nenhuma. Mede taxa de preenchimento, tempo até encher, e o que o
preço faz depois (seleção adversa).

**Achado real, com >1000 amostras:** taxa de preenchimento é ótima (~89%),
tempo mediano até encher ~12 minutos — mas a seleção adversa medida
(~0,125% de movimento médio contra quem forneceu liquidez) é **maior que a
constante de escorregamento que ela substituiria** (0,07%, `ESCORREGAMENTO_
PERNA` em `custos-reais.ts`). Ou seja: trocar taker por maker, pelos dados
reais até agora, não parece reduzir custo — pode até aumentar. Ainda cedo
(a fraçãoFavoravel está em ~48%, perto de moeda justa; mais amostra pode
mudar isso), mas é o oposto do que se esperava — registrado sem suavizar.

Código: `src/funding/preenchimento.ts` (funções puras, testadas),
`src/live/monitor-preenchimento.ts` (motor ao vivo). Estado em
`preenchimento/estado.json`, `preenchimento/diario.jsonl`. Card no dashboard
(aba Pesquisa) com taxa de preenchimento, tempo mediano, reação pós-fill.

---

## 4. O dashboard — oitava geração (reestruturado em 06/08/2026)

`src/dashboard/server.ts` + `src/dashboard/pagina.ts` (um único template
literal gigante — ver pegadinha crítica na seção 5). Sidebar colapsável com
10 seções: **Visão geral, Operações, Oportunidades, Exchanges, Risco,
Processos, Pesquisa, Histórico, Logs, Sistema.** Identidade visual glacial
(cyan/gelo/azul-marinho) baseada na logo do projeto (`assets/logo.png`,
`assets/logo-fundo-branco.png`, `assets/favicon.png`).

Novidades reais desta reestruturação: busca/filtro/ordenação na tabela de
Oportunidades; visualizador de Logs real (`/api/logs`, lista fixa de
arquivos, sem path arbitrário do cliente); página Risco consolidando
exposição + distância-até-liquidação por posição; diagrama de arquitetura
SVG estático; tabela das 8 famílias de estratégia (dado de
`docs/RESULTADOS.md`, hardcoded no client — não há endpoint que gere isso
dinamicamente).

**Pedido original do usuário era uma spec de 49 seções** (paleta de
comandos, replay histórico, heatmaps, ferramentas de desenho em candle,
monitor de drift de ML, ilustrações SVG temáticas — ver a mensagem completa
dele se precisar do texto exato). Só a Fase 1 (fundação: estrutura, dados
reais, visual) foi entregue. As demais foram deliberadamente **não**
inventadas por falta de dado real pra sustentar — próxima fase, se o usuário
pedir.

**Lição que já custou uma remoção:** nunca coloque uma lista de N posições
com gráfico de candle individual sem lazy-load. O modo agressivo (até 40
posições) deixou a aba inteira lenta até isso ser corrigido/removido do
painel. O padrão certo, se reaparecer: `observarCandle()` em `pagina.ts`
(checagem síncrona de visibilidade + `IntersectionObserver` + timeout de
segurança de 4s).

**Limitação de teste conhecida:** o Browser pane desta ferramenta de
automação não composita frames quando não está em foco — `screenshot`,
`IntersectionObserver` e `requestAnimationFrame` não funcionam de forma
confiável nele. Isso já gerou falsos alarmes nesta sessão (candles pareciam
não carregar, números pareciam não animar) que eram só limitação da
ferramenta, não bug real — confirmado inspecionando o DOM/estado
diretamente em vez de confiar no screenshot.

---

## 5. Armadilhas técnicas — já quebraram, vão quebrar de novo

**Node 24 strip-only.** Sem transpilação, só remoção de tipos.
- ❌ `constructor(private o: Options)` — parameter properties não funcionam.
- ❌ `enum` — use union de strings.
- ⚠️ `a ? [x] : []` — ambíguo com optional chaining, parser recusa. Use
  `a && [x] || []`.

**`src/dashboard/pagina.ts` é um template literal gigante.** O JS do cliente
vive dentro de crases. **Uma única crase solta — mesmo dentro de um
comentário — fecha a string e derruba o servidor**, com erro de sintaxe
apontando pro lugar errado. Regra: **NENHUMA crase fora da abertura/fechamento
do template literal**; o JS do cliente nunca usa template literal, só
concatenação com `+`. Verificação obrigatória depois de QUALQUER edição:
`grep -c '`' src/dashboard/pagina.ts` deve devolver exatamente **2**.

**`Promise.race` não cancela a promessa perdedora.** Bug real encontrado e
corrigido em `monitor-preenchimento.ts`: se a promessa mais lenta rejeitar
DEPOIS que o timeout já resolveu a corrida, essa rejeição fica sem handler —
Node mata o processo inteiro num `unhandledRejection` não tratado. Correção:
anexar um `.catch(()=>{})` vazio na promessa original dentro de qualquer
helper `comTimeout`. Vale para qualquer novo código que use esse padrão.

**Watchdog casa por basename, não caminho completo.** Git Bash reescreve
`/` para `\` ao invocar `node.exe` (binário nativo) — casar pelo caminho
inteiro nunca dá match e o watchdog religa por cima de processos já vivos,
em cascata. `scripts/supervisor.sh` já extrai só o basename do `.ts`; se
adicionar um processo novo, siga o mesmo padrão.

**bybit carrega mercado de opções por padrão no `loadMarkets()`** — endpoint
que trava ~10s por request neste ambiente e nunca é usado no projeto (só
perpétuo). Se instanciar um novo `new ccxt.bybit(...)`, passe `options:
{fetchMarkets:{types:['spot','linear','inverse']}}`. **Cuidado:** essa opção
é ESPECÍFICA da bybit — aplicá-la a outras exchanges (okx, bitget) quebra
elas (convenção de tipo diferente). Já corrigido uma vez depois de quebrar
em produção por 2 ciclos.

**Barra "fechada" nunca é `bars[bars.length-1]`.** `fetchOHLCV` sempre
devolve a barra em formação como último elemento. Use
`indiceUltimaBarraFechada()` (`src/live/motor-momentum.ts`, reusada por
`motor-pares.ts`) — anda pra trás até achar a barra cujo fechamento já
passou. Bug real: o modo agressivo ficou ~8h sem processar nada por isso,
antes de ser achado e corrigido.

**Fórmula de take-profit para SHORT com `takePct >= 1` dá preço negativo.**
`entryPrice*(1-takePct)` — corrigido com teto de 0,95 no multiplicador, em 7
arquivos. Qualquer fórmula nova de alvo de posição precisa desse teto.

**Reservar diretório antes de redirecionar log.** `nohup cmd >> pasta/log 2>&1`
falha SILENCIOSAMENTE se `pasta/` não existir — o processo nem chega a
iniciar, e o watchdog loga "morte sem erro registrado" (confundível com
crash real). Sempre `mkdir -p` a pasta de estado antes do primeiro start de
um processo novo.

---

## 6. Como mexer sem quebrar o que está rodando

Padrão usado ao longo de toda esta sessão, sempre que uma mudança precisa de
restart de um processo específico:

1. `powershell -Command "Get-CimInstance Win32_Process -Filter \"Name='node.exe'\" | Where-Object { $_.CommandLine -match 'PADRÃO' } | Select ProcessId, CreationDate"` — snapshot ANTES.
2. Editar, verificar sintaxe (`node --experimental-strip-types -e "await import('./arquivo.ts')"`), rodar `npm test`.
3. Matar só o processo pretendido (`Stop-Process -Id X -Force`).
4. Esperar o watchdog religar (`until curl ... | grep -q 200; do sleep 2; done` para o dashboard, ou `until` no count de processos para os outros).
5. Repetir o snapshot dos OUTROS processos e confirmar PIDs idênticos aos do passo 1.

Isso já pegou, ao vivo, uma instância duplicada acidental (dois processos de
pares escrevendo no mesmo `estado.json` ao mesmo tempo) e foi corrigido antes
de virar problema real.

---

## 7. Pendências e próximos passos honestos

| # | O quê | Estado |
|---|---|---|
| 1 | Fase 2 do dashboard (paleta de comandos, marcadores de evento na curva, heatmap de spread) | feita — tema claro e ícones SVG reais também entraram |
| 2 | Testar `iniciar.cmd`/`parar.cmd` rodando de verdade | feito — 3 ciclos reais de parar/iniciar (achou e corrigiu um bug real: `bash.exe` do WSL em `system32` mascarando o Git Bash). Estado conferido byte-a-byte antes/depois em todos os ciclos |
| 3 | Decidir se maker vale a pena (item B6) | precisa de mais amostra — sinal atual é NEGATIVO pra troca, ao contrário do esperado |
| 4 | Rotacionar a chave do trader.dev | pendente, depende do usuário (exige login que a IA não faz) |
| 5 | Memória do dashboard/preenchimento subindo aos poucos (~450MB) | monitorado (`diagnostico` no payload), não é crítico ainda, sem causa raiz confirmada |
| 6 | Push do trabalho desta sessão pro GitHub | commits locais feitos incrementalmente; confirme com o usuário antes de cada push (ele pede explicitamente às vezes) |

### Ideias já avaliadas e descartadas — não refaça sem dado novo

| Ideia | Por que não |
|---|---|
| Afrouxar o portão de valor esperado | é exatamente o que já custou dinheiro uma vez (histórico documentado em `docs/O-QUE-FALHOU.md`) |
| Mais alavancagem no motor normal | não muda o payback; a 8x a ruína salta de 0,17% pra 13,85% |
| `body-breakout` e as outras 4 estratégias direcionais originais | não sobrevivem a custo taker real — confirmado por 2 motores independentes (Resultado 16) |
| Aplicar `options.fetchMarkets` da bybit a todas as exchanges | quebra okx/bitget — já corrigido uma vez |

---

## 8. Como rodar e verificar

```bash
bash scripts/supervisor.sh    # produção — sobe e supervisiona os 8 processos
# ou, no Windows, clique duplo em iniciar.cmd
```

```bash
npm test                      # 287 testes das travas de risco, seleção, motores
npm run ruina                 # simulações contra choques de preço
npm run desafio                # bootstrap por bloco de calendário (portfólio misto)
npm run momentum · npm run pares   # as duas frentes de pesquisa em backtest
```

**Sinais de saúde:**
```
fonte: vigilância · N varreduras · dado de M min · K candidatos
```
Se disser "varredura própria", a vigilância caiu.

```
valor esperado barrou N candidatas · mais perto: X · vida Ah de Bh exigidas
```
Normal e correto — significa que nada compensa o custo agora.

**Sinais de problema real:** `vigilancia/supervisor-watchdog.log` mostrando
"CAIU" sem você ter mexido em nada; memória subindo sem parar por horas;
`fonte: varredura própria` persistente.

---

## 9. Mapa dos arquivos principais

### Núcleo do motor normal

| Arquivo | Papel |
|---|---|
| `src/funding/valor.ts` | valor esperado — o critério de decisão |
| `src/funding/custos-reais.ts` | taxas, escorregamento, saque medidos |
| `src/funding/protecao.ts` | distância de liquidação, piso, catraca |
| `src/funding/vigilancia.ts` | ciclo de vida, Wilson, tolerância a faltas |
| `src/funding/spread-live.ts` | o motor: abre, gere, apara, fecha |
| `src/funding/ponte.ts` | vigilância → motor, com guarda de idade |
| `src/funding/preenchimento.ts` | lógica pura da medição de fill (item B6) |

### Motores ao vivo (paralelos, isolados)

| Arquivo | Papel |
|---|---|
| `src/live/motor-momentum.ts` | ts-momentum multi-ativo |
| `src/live/motor-pares.ts` | pares cointegrados, mercado-neutro |
| `src/live/monitor-preenchimento.ts` | medição de fill maker vs taker |
| `src/pairs/backtest.ts` | `passoZScore`/`calcularZ` — a regra que o motor de pares usa ao vivo |

### Dashboard

| Arquivo | Papel |
|---|---|
| `src/dashboard/server.ts` | monta o payload, SSE, `/api/logs`, `/api/candles` |
| `src/dashboard/pagina.ts` | tudo — HTML+CSS+JS num template literal só |

### Documentos

| Documento | Para quê |
|---|---|
| `README.md` | visão geral atualizada (7→8 processos já refletido) |
| `docs/RESULTADOS.md` | todos os números medidos, 16 resultados |
| `docs/O-QUE-FALHOU.md` | testado e descartado, e por quê |
| `docs/BACKLOG.md` | prioridades — B6 (preenchimento) já resolvido nesta sessão, backlog um pouco desatualizado sobre isso |
| `docs/PEDIDOS.md` | rastreio dos pedidos do usuário |

### Estado em disco — fora do git (`.gitignore`)

```
spread/estado.json, spread/diario.jsonl        motor normal
momentum/estado.json, momentum/diario.jsonl    modo agressivo
pares/estado.json, pares/diario.jsonl          pares cointegrados
preenchimento/estado.json, preenchimento/diario.jsonl   medição de fill
vigilancia/ciclos.json, vigilancia/historico.jsonl      vigilância
vigilancia/supervisor-watchdog.log             log do watchdog
```

---

## 10. A honestidade do estado atual

Se o usuário perguntar "isso vai dar lucro?", a resposta verdadeira hoje é:

> A estrutura elimina risco de preço — isso é matemática, não previsão. O
> modo normal está correndo com o portão fechado a maior parte do tempo
> porque o mercado agora não oferece spread que dure o suficiente — não é
> falha, é o resultado certo dado o custo real medido. O modo agressivo tem
> vantagem estatística real (p=0,008) mas ~9-13% de chance de bater a meta
> em anos e ~15-45% de chance de perder capital, dependendo do risco
> escolhido — a mistura com pares (Resultado 14) melhora isso, e agora está
> ao vivo pela primeira vez. A ideia de reduzir custo com ordem maker
> (item B6), que parecia a alavanca mais promissora, não está se confirmando
> nos dados reais até agora — seleção adversa maior que o ganho de taxa.

Nada aqui foi inventado para soar melhor. Isso é o que os dados medidos até
06/08/2026 realmente dizem.
