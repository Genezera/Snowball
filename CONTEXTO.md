# 🧭 CONTEXTO — Snowball (handoff completo)

> Documento vivo de contexto: **o que é o projeto, o que foi feito, o que está no meio, e como parar/iniciar tudo.**
> Atualizado ao pausar o projeto (processos parados, auto-start desabilitado a pedido).
>
> **Nota (09/08, sessão seguinte):** o **Champion (6 exchanges)** foi **arquivado** —
> ver [`arquivo-6-exchanges/README.md`](arquivo-6-exchanges/README.md). Já tinha
> cumprido seu papel (validar a estratégia e medir os levers de lucro); a seção 2
> abaixo descreve o estado de ANTES do arquivamento, mantido como registro
> histórico. O motor real agora é só o `snowball-2ex`. Também nesta sessão: fix de
> liquidez do lado spot no coletor spot-perp, `SPOTPERP_NOTIONAL` reduzido, e o
> flicker "conectando/ao vivo" do dashboard corrigido.

---

## 1. O que é o projeto
**Snowball** = robô de **arbitragem de funding rate delta-neutro** (paper trading, **nunca emite ordem real**).
Fica **comprado numa exchange e vendido em outra** (mesmo ativo) → exposição a preço ≈ zero. O lucro vem do **funding** (a taxa que uma corretora paga à outra a cada 4–8h). Não aposta em direção; **cobra pela liquidez**.

**Foco atual:** o dinheiro real vai usar **2 exchanges, US$ 100 em cada** (bybit + bitget). Todo o trabalho recente é para **maximizar o lucro diário desse plano de 2 exchanges** com segurança.

---

## 2. Os dois motores (estado ao pausar)
| Motor | Arquivo | O que é | Estado |
|---|---|---|---|
| **Champion** | `src/cli/spread-live.ts` | 6 exchanges, US$ 600, referência/benchmark | **US$ 617,30 · +US$ 17,30** (paper) |
| **snowball-2ex** | `scripts/progression/forward-lab.cjs` | **O motor do dinheiro real** (2 ex) | US$ 199,85 · 3 posições · paper |

**Config do `snowball-2ex`** (a que vira dinheiro real): bybit+bitget, `--cost-model maker --persist-min 30 --maxpos 5 --reserva 0.20 --stable-yield 0.06`.
Ou seja: ordens maker (custo mínimo) + só entra após 30min de sinal + utilização máxima de capital (5 posições, reserva 20%) + rendimento na reserva ociosa (6%/ano, neutro).

---

## 3. Linha do tempo — o que foi feito (recente)
1. **Consolidação:** de 3 competidores paper → **1 motor único** `snowball-2ex` (bybit+bitget venceu o head-to-head; gate+okx ficou faminto). Aposentados baseline e gate+okx.
2. **Lever de utilização de capital:** flag `--maxpos` e `--reserva` (deploy dos ~40% de capital ocioso). +33–67% teórico no funding/dia.
3. **Rendimento da reserva** (`--stable-yield`): a reserva ociosa rende ~6%/ano no livro-caixa (campo `yieldAcum`, entra no capital/PnL e no dashboard).
4. **Telegram:** mensagens amigáveis (emojis, explicação pra leigo) ao abrir/fechar posição, rotuladas pelo par. Trava anti-replay (ciclo de largada é silencioso). Token/chat **só do `.env`**.
5. **Dashboard enxugado:** de 21 → 10 páginas úteis (removidas 11 do laboratório antigo + órfãos); depois, com o arquivamento do Champion (`53be62f`), mais 7 páginas do bloco "6 exchanges" (`ChampionView`, `OpportunityMap`, `CostIntelligence`, `RiskCenter`, `SettlementCapture`, `Historico`, `SystemHealth`) foram movidas para `arquivo-6-exchanges/dashboard-v2-src/` — **hoje ficam só 3 páginas ativas**: Command Center, Competidores 2-Ex, Maximização de Lucro. **Command Center refeito do zero** para o motor 2-ex + **radar spot-perp**. `SystemHealth` recriada pro motor 2-ex — ver `dashboard-v2/src/pages/SystemHealth.tsx`.
6. **Gráficos:** corrigido overflow (vazavam pra fora do card).
7. **README** reescrito para o foco 2-exchange.

### Spot-perp (cash-and-carry no perp) — a maior descoberta
- **O que é:** comprar spot + shortar perp na **MESMA exchange** → captura o funding **ABSOLUTO** (não o diferencial). Acessa oportunidades que o cross-exchange perde. Delta-neutro.
- **Coletor pronto e rodava:** `scripts/progression/coletor-spotperp.cjs` — dados **reais** via ccxt, taxas do spot (0,10%) incluídas. Achou **253 oportunidades**; topo **TUT/bitget = 1,8%/dia líquido** (vol US$ 279M). Endpoint `/api/v2/spotperp` alimenta o radar do Command Center.
- **Perfil escolhido:** **B (equilibrado)** — vol > US$ 5M.

---

## 4. ✅ Engine spot-perp — COMPLETA e VERIFICADA (ativa quando reiniciar)
**Engine spot-perp no `forward-lab.cjs` — pronta, reconciliada ao centavo, ligada na config.**
- No arquivo:
  - `lerSpotPerp()` — lê o feed do coletor (perfil B, vol > US$ 5M, funding > 0).
  - `processaSpotPerp(est, decisoes, cycleId)` — abre/acumula/fecha spot-perp no MESMO livro-caixa (footprint = spot cheio + margem do perp = notional × 1,2).
  - `reconciliar(est)` — **garantia anti-número-falso**: checa `saldos + comprometido == capitalInicial` ao centavo a cada ciclo; loga `RECONCILIATION_BREAK` se quebrar.
  - Chamadas em `umCiclo`; spot-perp excluído dos loops cross; Telegram `tgAbreSpot/tgFechaSpot` + send-loop ramificado por `d.tipo`.
- **VERIFICADO** (teste isolado `--once`): abriu 2 posições (TUT@bitget, BICO@bybit, footprint $60); **reconciliação = saldos 80 + comprometido 120 = 200 = inicial → erro 0.000000; RECONCILIATION_BREAK = 0.** Nenhum número falso.
- **Ligada no supervisor:** `snowball-2ex` agora roda com `--spotperp --spotperp-minvol 5000000`. Quando você reiniciar (blindagem), o motor opera **cross-exchange + spot-perp juntos, um contador de capital só.**
- **Dashboard:** posições mostram o tipo (🔀 cross / 📡 spot-perp); radar spot-perp no Command Center.

### O que ainda dá pra evoluir (opcional, futuro)
1. Observar alguns dias e medir quanto o spot-perp adiciona no funding/dia real.
2. Ajustar `SPOTPERP_NOTIONAL` (hoje $50) e `SPOTPERP_MAXPOS` (hoje 2) conforme o capital cresce.
3. Considerar checar liquidez do lado SPOT (hoje filtra só volume do perp).
4. Limpar obsoletos que sobrarem do laboratório antigo.

---

## 5. Arquitetura / arquivos-chave
```
src/cli/spread-live.ts        Champion (motor real 6-ex) + Telegram
src/cli/coletor.ts            scanner cross-exchange → vigilancia/arquivo-observacoes.jsonl
src/cli/vigilancia.ts         varredura do mercado (funding de todos os pares)
src/cli/custodia.ts           custódia/verificação
src/funding/universo.ts       lerUniverso(): funding absoluto por (símbolo, exchange)
scripts/progression/forward-lab.cjs        MOTOR snowball-2ex (cross + spot-perp WIP)
scripts/progression/coletor-spotperp.cjs   coletor spot-perp (feed real via ccxt)
scripts/supervisor.sh                      supervisiona Champion + scanner (restart-on-crash)
scripts/supervisor-competidores.sh         supervisiona o snowball-2ex
scripts/blindagem.ps1                      LAUNCHER (start-on-boot; agora NÃO roda no boot)
dashboard-v2/                              frontend React (:5183) + API read-only (:5184)
.env                                       TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID (fora do git)
auditoria/progression/compete/snowball-2ex/  estado durável do motor 2-ex
vigilancia/arquivo-spotperp.jsonl          feed das oportunidades spot-perp
```
**Dados:** todo o estado financeiro é reconciliado (livro de margem + livro de P&L). Nada de número falso.

---

## 6. ▶️ Como INICIAR o projeto (auto-start DESABILITADO — tem de rodar à mão)
**Tudo de uma vez (windowless):**
```
powershell -File scripts/blindagem.ps1
```
Isso sobe: supervisor.sh (Champion+scanner) · supervisor-competidores.sh (snowball-2ex) · coletor-spotperp · API (:5184) · vite (:5183). É idempotente (não duplica).

**Ou peça por peça** (se quiser só o dashboard, por exemplo):
```
# API do dashboard
node --experimental-strip-types dashboard-v2/api/server.ts
# frontend
npm --prefix dashboard-v2 run dev        # abre http://localhost:5183
# motor 2-ex (sozinho, sem supervisor)
FORWARD_ROOT=auditoria/progression/compete node scripts/progression/forward-lab.cjs \
  --mode control --exchanges bybit,bitget --label snowball-2ex \
  --close-policy economic_inversion --persist-min 30 --cost-model maker \
  --maxpos 5 --reserva 0.20 --stable-yield 0.06 --intervalo 300
# coletor spot-perp
node scripts/progression/coletor-spotperp.cjs --intervalo 600
```
> O motor 2-ex **precisa** de `FORWARD_ROOT=auditoria/progression/compete` (senão grava na pasta errada). O `supervisor-competidores.sh` já seta isso.

---

## 7. ⏹️ Como PARAR o projeto
Matar supervisores primeiro (senão relançam), depois os workers:
```
# no Git Bash, dentro da pasta do projeto:
for p in $(powershell -NoProfile -Command "Get-CimInstance Win32_Process | Where-Object { (\$_.Name -eq 'bash.exe' -or \$_.Name -eq 'node.exe') -and \$_.CommandLine -like '*supervisor*' } | ForEach-Object { \$_.ProcessId }" | tr -d '\r'); do taskkill //F //PID \$p; done
for p in $(powershell -NoProfile -Command "Get-CimInstance Win32_Process | Where-Object { \$_.Name -eq 'node.exe' -and (\$_.CommandLine -like '*forward-lab*' -or \$_.CommandLine -like '*coletor*' -or \$_.CommandLine -like '*spread-live*' -or \$_.CommandLine -like '*vigilancia*' -or \$_.CommandLine -like '*custodia*' -or \$_.CommandLine -like '*api/server.ts*') } | ForEach-Object { \$_.ProcessId }" | tr -d '\r'); do taskkill //F //PID \$p; done
# vite (frontend)
powershell -NoProfile -Command "Get-CimInstance Win32_Process | Where-Object { \$_.CommandLine -like '*vite*' } | ForEach-Object { Stop-Process -Id \$_.ProcessId -Force }"
```

---

## 8. 🔌 Auto-start no boot (DESABILITADO a pedido)
- Antes: um atalho **`snowball-blindagem.vbs`** na pasta **Startup** do Windows rodava a `blindagem.ps1` no logon.
- **Agora:** esse atalho foi **removido** da pasta Startup → nada sobe sozinho ao ligar o PC.
- Pasta Startup: `%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup`
- Para **reativar** o auto-start no futuro: recriar um `.vbs` lá que chame `powershell -File <caminho>\scripts\blindagem.ps1` (ou registrar no Task Scheduler).

---

## 9. Segurança / princípios (não violar)
- **Paper trading:** nenhuma ordem real, nunca.
- **Segredos:** token do Telegram só via `.env` (nunca commitado).
- **Reconciliação exata:** todo número passa pelo livro-caixa; `RECONCILIATION_BREAK` trava número falso.
- **Delta-neutro:** exposição a preço zero por construção.
- **Champion intacto:** não quebrar o motor que já funciona.
