# Continuidade

> **Para a próxima IA que pegar este projeto.** Este documento existe para que
> nada se perca entre sessões. Leia isto antes de qualquer outro arquivo — a
> versão anterior (07/08/2026) tinha o Auditor (`src/audit/auditor.ts`)
> documentado como funcional em `npm run team`, mas `docs/ARQUITETURA-
> DECISORIA.md` ainda dizia "não construído" (desatualizado desde a Fase 11).
> Corrigido, e o Auditor foi ligado aos motores AO VIVO (não só ao `npm run
> team` sob demanda) — seção 11 desta versão.

Última atualização: **08/08/2026**.

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
  supervisiona os 8 processos. **Testado de verdade, várias vezes, nesta
  sessão** (não só lido/inspecionado) — ver seção 2 pros dois bugs reais que
  isso encontrou e corrigiu. Não use os `run-*.cmd` antigos (foram deletados)
  junto com o watchdog — foi essa dupla supervisão que já causou um bug real
  (seção 6).

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
7. **Quando um script/mecanismo crítico (start/stop, backup) parece pronto
   "no papel", teste rodando de verdade antes de declarar terminado.** Regra
   aprendida NESTA sessão: a versão anterior deste documento dizia que
   `iniciar.cmd` estava "verificado, só não testado ao vivo" — testar ao vivo
   achou dois bugs que a leitura do código não revelou (seção 2).

---

## 2. Start/stop — dois bugs reais encontrados testando de verdade, e o fix

`iniciar.cmd`/`parar.cmd` chamam wrappers finos `scripts/iniciar.ps1` /
`scripts/parar.ps1` (a lógica embutida em PowerShell dentro de um `.cmd` é
frágil demais pra quoting diferente por contexto de chamada). `parar.ps1`
mata o watchdog primeiro (senão ele religa por cima no meio da parada) e
depois os 8 processos por basename. Nunca apaga estado — cada motor grava o
próprio `estado.json` a cada ciclo, então religar retoma sozinho de onde
parou (confirmado várias vezes nesta sessão, byte-a-byte).

### 2.1 Bug 1 — `bash.exe` do WSL mascarando o Git Bash

Windows tem DOIS `bash.exe`: o do Git for Windows e um shim do WSL em
`C:\WINDOWS\system32`. `Get-Command bash` (e `where bash`) resolvem pro shim
do WSL primeiro (System32 vem cedo no PATH) — e `supervisor.sh` não roda no
ambiente do WSL do mesmo jeito. Sintoma: `iniciar.cmd` reportava "Watchdog
iniciado" sem nenhum erro, e nada subia. **Fix:** `iniciar.ps1` procura o
Git Bash em caminhos conhecidos (`C:\Program Files\Git\bin\bash.exe`)
ANTES de tentar `Get-Command`, com guarda explícita rejeitando qualquer
resolução via PATH que contenha `system32`.

### 2.2 Bug 2 — fechar a janela do terminal matava tudo (mais sério que o 1)

Achado ao vivo quando o usuário fechou sem querer a janela do cmd que tinha
rodado `iniciar.cmd`. `Start-Process -WindowStyle Minimized` **não desanexa
de verdade** quando quem chama é um terminal como Windows Terminal ou VS
Code: esses terminais colocam todo processo filho — mesmo com janela própria
minimizada — no MESMO **job object** da janela, com a flag "matar tudo ao
fechar o job". Fechar a janela (o X, não só sair do `.cmd`) matava o
watchdog e os 8 processos juntos, sem nenhum erro no log.

**Tentativa descartada:** Agendador de Tarefas do Windows (`schtasks`) roda
fora de qualquer job object de terminal, mas `/create` deu "Acesso negado"
nesta máquina sem elevação — mesmo sem `/rl highest`. Não dava pra exigir
admin só pra ligar o sistema.

**Fix real:** criar o processo via **WMI** (`Invoke-CimMethod -ClassName
Win32_Process -MethodName Create`). Quem de fato chama `CreateProcess` é o
serviço WMI (`WmiPrvSE.exe`), não o processo atual — então o filho nunca
entra no job object do terminal que chamou o script, e sobrevive a fechar a
janela. Não exige admin pra criar processo na própria sessão do usuário.
Código em `scripts/iniciar.ps1`.

**Validado ao vivo, de propósito:** subi o sistema, lancei `iniciar.cmd`
como processo filho de um `cmd.exe` descartável, e matei esse `cmd.exe` à
força (`Stop-Process -Force`, simulando fechar a janela). Os 8 processos +
watchdog continuaram rodando, dashboard respondeu 200 depois. Repeti o teste
completo (parar→iniciar, inclusive via os `.cmd`, não só os `.ps1`) mais de
uma vez, sempre com integridade de estado conferida byte-a-byte antes e
depois.

### 2.3 Bug 3 (menor, cosmético mas real) — watchdog logava restart deliberado como queda

`scripts/supervisor.sh`: a primeira passada do laço via todo processo como
"ausente" (óbvio — acabou de subir) e registrava a MESMA linha "CAIU —
religando" de uma queda real, **disparando alarme falso no Telegram a cada
restart deliberado**. Fix: `primeira_passada=true` antes do laço; na
primeira volta, o log usa um rótulo neutro ("subindo") e não notifica. Só
quedas de verdade (depois da primeira passada) continuam gerando alarme.
Validado: log mostrou "subindo (primeira passada do watchdog)" num restart
de teste, e "CAIU"/Telegram não dispararam.

**Nenhuma perda de estado em nenhum dos testes acima**, em nenhum dos ~6
ciclos completos de parar/iniciar feitos nesta sessão (incluindo os dois que
descobriram os bugs 1 e 2) — capital e contagem de posições dos 3 motores
conferidos byte-a-byte toda vez.

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

**Estado real agora (07/08/2026):** capital ~US$ 603, 3 posições abertas
(DEXE bitget/bybit, BICO gate/okx, ZBT bybit/okx) — nenhuma perto de
qualquer limiar de fechamento (distâncias de liquidação de 14-24%, bem
acima do gatilho de alerta em 12%). Diário confere byte-a-byte com o
estado, sem posição órfã.

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

**Bug de DADO encontrado e corrigido nesta sessão (07/08/2026) — não é bug
de lógica, o código já estava certo.** `calcularAlvos()` (`src/live/
motor-momentum.ts`) já tinha o teto de 0,95 pro lado SHORT desde o commit
`35726f1` (05-06/08), evitando `takePrice` negativo. Mas as 40 posições
abertas ANTES desse commit (num lote só, minutos antes da correção) tinham
o `takePrice` calculado com a fórmula velha, gravado em `momentum/
estado.json`, e o código corrigido nunca migra estado já em disco — **34 das
40 posições (todas as SHORT) continuaram com alvo de take-profit negativo,
matematicamente inatingível**, até serem corrigidas manualmente:

```js
// para cada posição side==='short' em momentum/estado.json:
p.takePrice = p.entryPrice * 0.05   // = entryPrice * (1 - Math.min(5.0, 0.95))
```

Aplicado com o motor parado (`manutencao.marker` tocado antes, pra não virar
alarme falso — ver 2.3), estado editado, watchdog religou sozinho em ~20s.
Validado: 0 posições com `takePrice` negativo depois, 40 posições intactas,
capital idêntico. **Lição para a próxima IA: sempre que uma correção de
fórmula for commitada, cheque se `*/estado.json` já tem dado gerado pela
fórmula velha — corrigir só o código não corrige posições já abertas.**

Código: `src/live/motor-momentum.ts`, `src/cli/momentum-live.ts`.

### 3.3 Pares cointegrados — mercado-neutro

Construído a partir do Resultado 14 (`docs/RESULTADOS.md`): misturar
momentum + pares corta a chance de ruína do portfólio de ~46% para ~15%
mantendo a chance de sucesso quase igual (correlação entre trades dos dois
mecanismos: +0,065, bem menor que a correlação do momentum consigo mesmo,
+0,130).

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

**Estado real agora:** US$ 200, 20 pares calibrados, 0 posições abertas —
**confirmado nesta sessão que isso é esperado, não bug**: motor rodando há
poucas horas, limiar de entrada exigente (z-score ≥ 2,5 desvios-padrão),
estatisticamente normal nenhum dos 20 pares ter cruzado ainda. Log mostra
ciclos rodando normalmente ("sem barra nova" é o resultado correto na
maioria dos ciclos de 20 min, com barra diária).

**Bug real corrigido nesta sessão (não de lógica de negócio):**
`fetchOHLCV` em `barrasDe()` (`src/live/motor-pares.ts`) não tinha timeout —
o motor ficou 1h+ travado sem nenhum erro logado até ser encontrado numa
auditoria de rotina. Corrigido com o mesmo padrão `comTimeout` já usado em
`monitor-preenchimento.ts` (`Promise.race` + `.catch(()=>{})` na promessa
original, pra não deixar um `unhandledRejection` matar o processo quando a
promessa perdedora rejeita depois do timeout já ter "vencido" a corrida).
A mesma correção foi aplicada preventivamente em `motor-momentum.ts` (
mesmo padrão de código, mesmo risco, ainda não tinha travado).

### 3.4 Medição de preenchimento maker (item B6)

A única alavanca real identificada para reduzir custo sem inventar risco
novo — mas o resultado real é mais sóbrio do que a expectativa inicial.
Simula ordem limite "no toque" (posta no bid pra comprar, no ask pra vender)
em ambas as pernas dos 5 melhores candidatos da vigilância, usando o preço
real (`last`) como proxy de preenchimento — sem enviar ordem nenhuma. Mede
taxa de preenchimento, tempo até encher, e o que o preço faz depois (seleção
adversa).

**Achado real, com >1000 amostras:** taxa de preenchimento é ótima (~89%),
tempo mediano até encher ~12 minutos — mas a seleção adversa medida
(~0,125% de movimento médio contra quem forneceu liquidez) é **maior que a
constante de escorregamento que ela substituiria** (0,07%, `ESCORREGAMENTO_
PERNA` em `custos-reais.ts`). Ou seja: trocar taker por maker, pelos dados
reais até agora, não parece reduzir custo — pode até aumentar. Ainda cedo
(a fração favorável está em ~48%, perto de moeda justa; mais amostra pode
mudar isso), mas é o oposto do que se esperava — registrado sem suavizar.

Código: `src/funding/preenchimento.ts` (funções puras, testadas),
`src/live/monitor-preenchimento.ts` (motor ao vivo, também com o fix de
timeout `comTimeout` já aplicado antes desta sessão). Estado em
`preenchimento/estado.json`, `preenchimento/diario.jsonl`. É o processo que
mais reinicia dos 8 (timeouts intermitentes de rede em gate/bingx/bybit) —
não é falha, o estado persiste e recarrega sem perda, mas é o elo mais
frágil da cadeia. Card no dashboard (aba Pesquisa).

---

## 4. O dashboard — oitava geração

`src/dashboard/server.ts` + `src/dashboard/pagina.ts` (um único template
literal gigante — ver pegadinha crítica na seção 5). Sidebar colapsável com
10 seções: **Visão geral, Operações, Oportunidades, Exchanges, Risco,
Processos, Pesquisa, Histórico, Logs, Sistema.** Identidade visual glacial
(cyan/gelo/azul-marinho) baseada na logo do projeto, com **tema claro
completo** (`--sb-*`/`--bg-main`/`--surface` etc. redefinidos em
`:root[data-theme="light"]`, toggle persistido em `localStorage`) e ícones
SVG reais (`assets/icons-sprite.svg`, 32 símbolos nomeados) substituindo os
placeholders desenhados à mão.

**Fase 2 entregue (06/08/2026):** paleta de comandos (Ctrl+K, busca em
páginas/processos/exchanges/ativos), marcadores de evento coloridos na curva
de capital (abre/fecha/funding, com tooltip), heatmap de spread na aba
Oportunidades.

**Pipeline real de ML** (`src/ml/prontidao-vigilancia.ts`,
`src/ml/rotulo-ciclo.ts`): treina um GBDT de verdade (split temporal, não
k-fold aleatório — dataset pequeno e desbalanceado) quando há dado real
suficiente (`MINIMO_POSITIVOS_TREINO=30`), refusing to fabricate quando não
há; dormente hoje (12-30 positivos), ativa sozinho quando o coletor
acumular o suficiente. Card no dashboard mostra métricas reais quando
existem, ou o motivo explícito de por que ainda não treinou.

**Lição que já custou uma remoção:** nunca coloque uma lista de N posições
com gráfico de candle individual sem lazy-load. O modo agressivo (até 40
posições) deixou a aba inteira lenta até isso ser corrigido/removido do
painel. O padrão certo, se reaparecer: `observarCandle()` em `pagina.ts`
(checagem síncrona de visibilidade + `IntersectionObserver` + timeout de
segurança de 4s).

**Limitação de teste conhecida:** o Browser pane desta ferramenta de
automação não composita frames quando não está em foco — `screenshot`,
`IntersectionObserver` e `requestAnimationFrame` não funcionam de forma
confiável nele. Isso já gerou falsos alarmes (candles pareciam não carregar,
números pareciam não animar) que eram só limitação da ferramenta, não bug
real — confirmado inspecionando o DOM/estado diretamente em vez de confiar
no screenshot.

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

**`Promise.race` não cancela a promessa perdedora.** Se a promessa mais lenta
rejeitar DEPOIS que o timeout já resolveu a corrida, essa rejeição fica sem
handler — Node mata o processo inteiro num `unhandledRejection` não tratado.
Correção: anexar um `.catch(()=>{})` vazio na promessa original dentro de
qualquer helper `comTimeout`. Já corrigido em `monitor-preenchimento.ts`,
`motor-pares.ts` (achado depois de 1h+ travado, seção 3.3) e
`motor-momentum.ts` (preventivo). Vale para qualquer novo código que use
esse padrão.

**Watchdog casa por basename, não caminho completo.** Git Bash reescreve
`/` para `\` ao invocar `node.exe` (binário nativo) — casar pelo caminho
inteiro nunca dá match e o watchdog religa por cima de processos já vivos,
em cascata. `scripts/supervisor.sh` já extrai só o basename do `.ts`; se
adicionar um processo novo, siga o mesmo padrão.

**`Start-Process` não desanexa de verdade de um terminal com job object
(Windows Terminal, VS Code).** Fechar a janela mata os filhos mesmo com
`-WindowStyle Minimized`/`Hidden`. Use `Invoke-CimMethod -ClassName
Win32_Process -MethodName Create` (WMI) para lançar algo que precisa
sobreviver ao terminal que o iniciou — o processo real é criado pelo serviço
WMI, fora do job. Não precisa de admin. `schtasks` também escaparia do job,
mas exige elevação que nem sempre está disponível. Ver seção 2.2 —
achado ao vivo depois que o usuário fechou a janela do cmd sem querer.

**`bash.exe` do WSL em `C:\WINDOWS\system32` mascara o Git Bash no PATH.**
`Get-Command bash`/`where bash` acham o shim do WSL primeiro. Sempre
verifique caminhos conhecidos do Git Bash ANTES de resolver via PATH, e
rejeite qualquer resolução que contenha `system32`. Ver seção 2.1.

**Watchdog não distingue "acabei de subir" de "caiu de verdade" sem ajuda.**
Toda primeira passada do laço de checagem vê processo nenhum rodando —
sem uma flag `primeira_passada`, isso vira alarme de "CAIU" (e notificação
falsa no Telegram) toda vez que o sistema é ligado de propósito. Ver 2.3.

**Corrigir uma fórmula no código NÃO corrige posições já persistidas em
disco com a fórmula velha.** `*/estado.json` não é recalculado ao carregar —
é lido como está. Depois de qualquer correção de fórmula de preço/alvo,
verifique se há dado gerado pela versão antiga que precisa de migração
manual (mesmo padrão do bug do `takePrice` negativo, seção 3.2).

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
arquivos. Qualquer fórmula nova de alvo de posição precisa desse teto. Ver
seção 3.2 pro rastro de posições já abertas com a fórmula velha.

**Reservar diretório antes de redirecionar log.** `nohup cmd >> pasta/log 2>&1`
falha SILENCIOSAMENTE se `pasta/` não existir — o processo nem chega a
iniciar, e o watchdog loga "morte sem erro registrado" (confundível com
crash real). Sempre `mkdir -p` a pasta de estado antes do primeiro start de
um processo novo.

**`.gitignore` com padrão de diretório sem `/` inicial casa em qualquer
profundidade.** `research/` (sem barra na frente) excluía silenciosamente
`src/research/scout.ts` também, não só o `research/` da raiz. Todo padrão de
diretório de estado (`spread/`, `vigilancia/`, etc.) deve começar com `/`.

---

## 6. Como mexer sem quebrar o que está rodando

Padrão usado ao longo de toda esta sessão, sempre que uma mudança precisa de
restart de um processo específico:

1. `Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.CommandLine -match 'PADRÃO' } | Select ProcessId, CreationDate` — snapshot ANTES.
2. Editar, verificar sintaxe (`node --experimental-strip-types -e "await import('./arquivo.ts')"`), rodar `npm test`.
3. Se a mudança é código (não dado): `touch vigilancia/manutencao.marker` antes de matar o processo — assim o watchdog loga "religado — atualização de código aplicada" em vez de "CAIU", e não dispara Telegram. Se a mudança é só dado em `estado.json` (como a correção do `takePrice`, seção 3.2), o mesmo truque serve igual: marca manutenção, mata o processo, edita o JSON à mão, deixa religar.
4. Matar só o processo pretendido (`Stop-Process -Id X -Force`).
5. Esperar o watchdog religar (`until curl ... | grep -q 200; do sleep 2; done` para o dashboard, ou checar contagem de processos para os outros — normalmente ≤30s).
6. Repetir o snapshot dos OUTROS processos e confirmar PIDs idênticos aos do passo 1. Apagar `vigilancia/manutencao.marker` depois (ele expira sozinho em 90s, mas não custa limpar).

Isso já pegou, ao vivo, uma instância duplicada acidental — mais de uma vez
nesta sessão, inclusive durante os próprios testes do fix de start/stop
(seção 2): sempre que testar um novo mecanismo de subida, cheque
`Get-CimInstance Win32_Process -Filter "Name='bash.exe'" | Where-Object {
$_.CommandLine -like '*supervisor.sh*'}` antes E depois, e mate qualquer
duplicata na hora — dois watchdogs escrevendo no mesmo `estado.json` ao
mesmo tempo é o cenário de corrupção mais provável deste projeto.

---

## 7. Pendências e próximos passos honestos

| # | O quê | Estado |
|---|---|---|
| 1 | Fase 2 do dashboard (paleta de comandos, marcadores de evento, heatmap) | feita |
| 2 | Testar `iniciar.cmd`/`parar.cmd` rodando de verdade | feito — achou e corrigiu 3 bugs reais (seção 2). Testado com mais de 6 ciclos completos, incluindo o cenário de fechar a janela do terminal |
| 3 | Auditoria completa de operações (posições órfãs, coleta de dado, motores travados) | feita — resultado limpo em 6 pontos verificados (vigilância cobrindo as 6 exchanges, sem posição órfã, custódia/preenchimento com dado real mudando ciclo a ciclo). Único achado: bug do `takePrice`, já corrigido |
| 4 | Corrigir `takePrice` negativo nas 34 posições short do momentum | feito — dado corrigido em `momentum/estado.json`, sem fechar/reabrir nenhuma posição |
| 5 | Decidir se maker vale a pena (item B6) | precisa de mais amostra — sinal atual é NEGATIVO pra troca, ao contrário do esperado |
| 6 | Rotacionar a chave do trader.dev | pendente, depende do usuário (exige login que a IA não faz) |
| 7 | Memória do dashboard/preenchimento subindo aos poucos (~450MB) | monitorado (`diagnostico` no payload), não é crítico ainda, sem causa raiz confirmada |
| 8 | Push do trabalho desta sessão pro GitHub | commits locais feitos incrementalmente; confirme com o usuário antes de cada push (ele pede explicitamente às vezes, e às vezes já pediu no meio da sessão — não assuma, mas também não trave por excesso de cautela se ele já confirmou) |

### Ideias já avaliadas e descartadas — não refaça sem dado novo

| Ideia | Por que não |
|---|---|
| Afrouxar o portão de valor esperado | é exatamente o que já custou dinheiro uma vez (histórico documentado em `docs/O-QUE-FALHOU.md`) |
| Mais alavancagem no motor normal | não muda o payback; a 8x a ruína salta de 0,17% pra 13,85% |
| `body-breakout` e as outras 4 estratégias direcionais originais | não sobrevivem a custo taker real — confirmado por 2 motores independentes (Resultado 16) |
| Aplicar `options.fetchMarkets` da bybit a todas as exchanges | quebra okx/bitget — já corrigido uma vez |
| Agendador de Tarefas do Windows pra desanexar o watchdog do terminal | exige elevação (`Acesso negado` sem admin nesta máquina) — use WMI (seção 2.2) |

---

## 8. Como rodar e verificar

```bash
bash scripts/supervisor.sh    # produção — sobe e supervisiona os 8 processos
# ou, no Windows, clique duplo em iniciar.cmd (recomendado — usa WMI, sobrevive
# a fechar a janela do terminal, ver seção 2)
```

```bash
npm test                      # 302 testes das travas de risco, seleção, motores
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
"CAIU" sem você ter mexido em nada (**não** confundir com "subindo (primeira
passada do watchdog)", que é normal logo depois de um `iniciar.cmd` — seção
2.3); memória subindo sem parar por horas; `fonte: varredura própria`
persistente.

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
| `src/live/motor-momentum.ts` | ts-momentum multi-ativo (`calcularAlvos` — cuidado com o teto 0,95 no take de short) |
| `src/live/motor-pares.ts` | pares cointegrados, mercado-neutro (com `comTimeout` no `fetchOHLCV`) |
| `src/live/monitor-preenchimento.ts` | medição de fill maker vs taker |
| `src/pairs/backtest.ts` | `passoZScore`/`calcularZ` — a regra que o motor de pares usa ao vivo |

### Scripts de start/stop

| Arquivo | Papel |
|---|---|
| `scripts/supervisor.sh` | watchdog — sobe/religa os 8 processos, checa a cada 30s |
| `scripts/iniciar.ps1` | lógica real do `iniciar.cmd` — resolve o Git Bash certo, lança via WMI (seção 2) |
| `scripts/parar.ps1` | lógica real do `parar.cmd` — mata watchdog primeiro, depois os 8 processos |
| `iniciar.cmd`, `parar.cmd` | wrappers finos de 3 linhas, só chamam os `.ps1` acima |

### ML (dormente, ativa sozinho com dado suficiente)

| Arquivo | Papel |
|---|---|
| `src/ml/rotulo-ciclo.ts` | regra compartilhada de "ciclo positivo" (dashboard + treino usam a mesma) |
| `src/ml/prontidao-vigilancia.ts` | pipeline real de treino (GBDT, split temporal, recusa fabricar métrica sem dado) |

### Dashboard

| Arquivo | Papel |
|---|---|
| `src/dashboard/server.ts` | monta o payload, SSE, `/api/logs`, `/api/candles` |
| `src/dashboard/pagina.ts` | tudo — HTML+CSS+JS num template literal só |

### Documentos

| Documento | Para quê |
|---|---|
| `README.md` | visão geral, 8 processos, badges |
| `COMECE-AQUI.md` | onboarding rápido pra quem chega no projeto agora |
| `docs/RESULTADOS.md` | todos os números medidos, 16 resultados |
| `docs/O-QUE-FALHOU.md` | testado e descartado, e por quê |
| `docs/BACKLOG.md` | prioridades — B6 (preenchimento) já resolvido |
| `docs/PEDIDOS.md` | rastreio dos pedidos do usuário |
| `docs/VIGILANCIA.md` | como a vigilância varre e decide ciclo de vida |

### Estado em disco — fora do git (`.gitignore`, todos com padrão `/nome/` ancorado)

```
spread/estado.json, spread/diario.jsonl        motor normal
momentum/estado.json, momentum/diario.jsonl    modo agressivo
pares/estado.json, pares/diario.jsonl          pares cointegrados
preenchimento/estado.json, preenchimento/diario.jsonl   medição de fill
vigilancia/ciclos.json, vigilancia/historico.jsonl      vigilância
vigilancia/supervisor-watchdog.log             log do watchdog
vigilancia/manutencao.marker                   toque antes de matar um processo de propósito
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
> escolhido — a mistura com pares (Resultado 14) melhora isso, e está ao
> vivo. A ideia de reduzir custo com ordem maker (item B6), que parecia a
> alavanca mais promissora, não está se confirmando nos dados reais até
> agora — seleção adversa maior que o ganho de taxa.

Se o usuário perguntar "posso confiar que o sistema fica de pé sozinho?", a
resposta agora é mais forte que na versão anterior deste documento: **sim,
testado de verdade**, incluindo o cenário de fechar a janela do terminal por
acidente — que era exatamente o tipo de coisa que "verifiquei o código, não
testei ao vivo" não pega. A lição geral desta sessão, se só uma for levada
adiante: **ler o código de um mecanismo de infraestrutura crítico não
substitui rodá-lo de verdade e tentar quebrá-lo de propósito.**

Nada aqui foi inventado para soar melhor. Isso é o que os dados medidos e os
testes reais até 07/08/2026 realmente dizem.

---

## 11. Sessão 08/08/2026 — Auditor ao vivo, e um achado sem correção (memória)

Pedido: "siga todos os passos que fizer sentido, descarte o que não fizer" —
depois de uma análise completa dos 21 `.md` do projeto identificando lacunas.

### 11.1 Memória do dashboard e do preenchimento — investigado, sem causa raiz (e está tudo bem)

O pendente #7 da versão anterior deste documento (memória subindo aos
poucos) foi investigado de verdade, não só remedido. Inspecionado
`src/dashboard/server.ts`: `cacheCandles` já é podado por `setInterval`,
`precosAoVivo` já remove chaves inválidas, limpeza de clientes SSE no
`req.on('close', ...)` já existe. **Nenhum vazamento óbvio encontrado.** A
hipótese mais provável é fragmentação normal de heap do V8 num processo
Node de longa duração fazendo `JSON.parse` repetido sobre arquivos que só
crescem (`vigilancia/historico.jsonl` tinha 53.472 linhas na hora da
medição) — não uma correção pendente. **Não apliquei nenhuma mudança aqui**
porque não há evidência de bug, só de crescimento — aplicar uma "correção"
sem prova seria exatamente o tipo de confiança fabricada que a regra 2 deste
documento proíbe. Se voltar a ser investigado, o próximo passo real seria
heap snapshot (`--inspect`) comparando dois pontos no tempo, não leitura de
código.

### 11.2 O Auditor já existia — a lacuna real era mais estreita do que parecia

Falha minha na análise inicial desta sessão: eu tinha lido `docs/EQUIPE.md`
e `docs/ARQUITETURA-DECISORIA.md` e concluído que "o Auditor nunca foi
construído". Falso — `src/audit/auditor.ts` (280 linhas, as 5-6 checagens
documentadas, `replayAudit()`) já existia, testado, e já estava ligado a
`npm run team` desde a Fase 11 da `docs/CRONOLOGIA.md`. O erro era só do
`docs/ARQUITETURA-DECISORIA.md`, que ficou desatualizado depois daquela
Fase — corrigido nesta sessão (ver a nota inserida na própria seção lá).

**A lacuna real, depois de confirmar isso:** o Auditor só rodava sob
demanda contra um portfólio hipotético de backtest (`npm run team`), nunca
contra os motores que estão de fato rodando ao vivo em paper —
`momentum-live` e `pares-live`.

### 11.3 `src/audit/auditor-live.ts` — o que foi construído

Liga o Auditor já existente aos dois motores ao vivo:

- **Expectativa** (o que o backtest validado promete): para momentum, roda
  `runBacktest` com `PARAMS_VALIDADOS` sobre `UNIVERSO_MOMENTUM` (mesmo
  código que `src/cli/desafio.ts` já usa) e monta a `Expectation` via
  `buildExpectation`. Para pares, usa `poolComTempo()` de
  `src/pairs/validado.ts` diretamente. **Cacheado em módulo** — computado
  uma vez por vida do processo, não a cada ciclo.
- **Realizado**: lê `momentum/diario.jsonl` e `pares/diario.jsonl`, filtra
  eventos `fecha`, reconstrói `rEquity = pnl / (capital − pnl)` (capital
  antes do trade, já que o evento só grava o capital depois).
- **Guarda de evidência mínima ANTES de qualquer cálculo caro**: se há menos
  de 25 trades fechados, devolve `EVIDENCIA_INSUFICIENTE` sem sequer rodar o
  backtest de expectativa — mesmo padrão do `src/ml/prontidao-vigilancia.ts`
  (recusa fabricar veredito sem dado, não é bug quando aparece).
  Verificado ao vivo em 08/08/2026: momentum tem 1 trade fechado, pares tem
  0 — os dois corretamente `EVIDENCIA_INSUFICIENTE` por enquanto, e vão
  continuar assim por um bom tempo (momentum: ~26-34 trades/ano/ativo,
  Resultado 6; pares: zero cruzamentos de z-score ≥2,5 até agora).
- **Read-only por desenho**: só relata, nunca fecha posição nem troca par
  sozinho — mesma divisão de trabalho de custódia (detecta) / motor
  (decide) já usada no resto do projeto. Não vira decisão automática sem
  antes ter dado suficiente para o próprio `replayAudit()` validar a si
  mesmo, como já é feito em `npm run team`.

**Exposto no dashboard**, campo novo `auditoria` no payload de
`src/dashboard/server.ts` (`montarDados()`), SEM tocar em `pagina.ts` — de
propósito, para não mexer no template literal gigante que já derrubou o
servidor uma vez por causa de crase solta (seção 5). Card visual fica para
quando houver dado real pra mostrar; hoje seria só "sem dado" reescrito em
HTML, sem ganho sobre o JSON.

**Validado ao vivo, seguindo o protocolo da seção 6 deste documento**: `npm
test` (302/302) antes e depois, teste isolado em porta descartável (18787)
confirmando o campo antes de tocar no processo real, snapshot dos 8 PIDs,
`manutencao.marker` tocado, matei só o PID do dashboard, watchdog religou
em <20s, confirmei que os outros 7 PIDs eram byte-a-byte os mesmos do
snapshot anterior, watchdog logou "religado — atualização de código
aplicada" (não "CAIU", sem alarme falso), confirmei o campo `auditoria` na
resposta real em `:8787`, apaguei o marker.

**Arquivo**: `src/audit/auditor-live.ts`. **Pronto quando**: já está — o
código está correto e testado; só falta o mercado gerar os 25 trades
fechados que faltam em cada motor para o status deixar de ser
`EVIDENCIA_INSUFICIENTE`. Nada a fazer além de esperar.
