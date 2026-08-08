#!/usr/bin/env bash
# Watchdog: verifica os 7 processos do Snowball (motor + vigilância +
# custódia + coletor + momentum + preenchimento + pares) a cada 30s e religa
# automaticamente qualquer um que tiver caído. O dashboard LEGADO (8787) foi
# arquivado na unificação e NÃO é mais supervisionado aqui (ver bloco CMD).
# O dashboard canônico (V2, :5183/:5184) tem supervisores próprios. Existe porque o
# motor caiu uma vez (bug de import faltando) e ficou 3h30 sem ninguém
# religar -- `start` dos .cmd nao funciona neste ambiente sandboxed sem
# sessao de janela interativa, entao isto substitui o supervisor dos .cmd.
set -u
cd "$(dirname "$0")/.."
SCRIPT_PATH="$(pwd)/scripts/supervisor.sh"
# lock/mutex PRÓPRIOS deste supervisor -- nunca compartilhados com os
# outros 3 (cada supervisor tem seu diretório de mutex e arquivo de lock
# separados, Parte 2 do "Fechamento do Gate Operacional").
export LOCK_FILE="vigilancia/locks/supervisor-principal.lock"
export MUTEX_DIR="vigilancia/locks/supervisor-principal.lockdir"
source scripts/lib/supervisor-lock.sh
source scripts/lib/process-manifest.sh

declare -A CMD=(
  [vigilancia]="node src/cli/vigilancia.ts --equity 100 --intervalo 5"
  [custodia]="node src/cli/custodia.ts --intervalo 15"
  [motor]="node --env-file-if-exists=.env src/cli/spread-live.ts --porExchange 100 --alavancagem 5 --exchanges binanceusdm,bybit,okx,gate,bitget,bingx"
  # UNIFICAÇÃO (Snowball Dashboard): o dashboard LEGADO (src/dashboard/server.ts,
  # porta 8787) foi ARQUIVADO — não é mais iniciado nem supervisionado
  # automaticamente. O dashboard canônico é o V2 (frontend :5183 + API :5184),
  # supervisionado pelos scripts supervisor-dashboard-v2-*. Para subir o legado
  # em emergência: scripts/dashboard-legacy-start.sh (ver docs/dashboard-legacy-rollback.md).
  # A entrada do 'dashboard' segue no process-manifest.json só como identidade
  # para o rollback/detecção — nunca como processo supervisionado aqui.
  [coletor]="node src/cli/coletor.ts --intervalo 5"
  # modo agressivo: ts-momentum multi-ativo, papel -- roda EM PARALELO ao
  # motor delta-neutro acima, nao no lugar dele. Os dois so coletam dado.
  [momentum]="node --env-file-if-exists=.env src/cli/momentum-live.ts --equity 200 --risco 0.005 --alavancagem 2"
  # medição de preenchimento maker: só LEITURA de ticker, nenhuma ordem, roda
  # isolado dos outros -- mede se ordem limite preenche rápido o bastante
  # para trocar o custo taker (0,05-0,06%) pelo maker (~0,02%).
  [preenchimento]="node --env-file-if-exists=.env src/cli/preenchimento-live.ts --intervalo 10"
  # pares cointegrados: mercado-neutro, independente do motor delta-neutro e
  # do momentum -- capital e diário próprios. Resultado 14 (docs/RESULTADOS.md)
  # validou que misturar com o momentum corta a chance de ruína de ~46% para
  # ~15% sem perder chance de sucesso.
  [pares]="node --env-file-if-exists=.env src/cli/pares-live.ts --equity 200 --risco 0.05"
)
declare -A LOG=(
  [vigilancia]="vigilancia/live.log"
  [custodia]="vigilancia/custodia.log"
  [motor]="spread/live.log"
  [coletor]="vigilancia/coletor.log"
  [momentum]="momentum/live.log"
  [preenchimento]="preenchimento/live.log"
  [pares]="pares/live.log"
)

TIMEOUT_EXTERNO_S=8
LOG_COMANDOS_LENTOS="vigilancia/supervisor-command-timeouts.jsonl"
HEARTBEAT_FILE="vigilancia/supervisor-heartbeat.json"
SUPERVISOR_VERSION="2.0.0-lock-heartbeat-timeouts"

# ── comando externo com timeout OBRIGATÓRIO — nenhuma chamada de SO deste
# script roda sem um teto de tempo. Se estourar, registra evidência
# completa (nunca só "travou") e devolve pra quem chamou como se tivesse
# saído vazio -- o chamador trata isso como "não sei", nunca como "morto"
# nem como "vivo", explicitamente. ────────────────────────────────────────
com_timeout() {
  local timeout_s="$1"; shift
  local inicio_ms saida rc fim_ms
  inicio_ms=$(date +%s%3N)
  saida=$(timeout "$timeout_s" "$@" 2>&1)
  rc=$?
  fim_ms=$(date +%s%3N)
  if [ "$rc" -eq 124 ]; then
    local cmd_escapado
    cmd_escapado=$(printf '%s' "$*" | sed 's/\\/\\\\/g; s/"/\\"/g')
    local saida_escapada
    saida_escapada=$(printf '%s' "$saida" | head -c 500 | sed 's/\\/\\\\/g; s/"/\\"/g; s/\n/\\n/g')
    printf '{"command":"%s","startedAt":%s,"timeoutMs":%s,"terminatedAt":%s,"outputParcial":"%s"}\n' \
      "$cmd_escapado" "$inicio_ms" "$((timeout_s * 1000))" "$fim_ms" "$saida_escapada" >> "$LOG_COMANDOS_LENTOS"
  fi
  echo "$saida"
  return "$rc"
}

vivo() {
  # procura a linha de comando via PowerShell (mais confiavel que tasklist puro).
  # @(...) forca contexto de array -- sem isso, 1 resultado unico devolve
  # Count=$null em vez de 1, e o supervisor duplicaria o processo.
  #
  # ACHADO REAL (investigação do "log parado por >1h" / "dashboard não
  # religa"): o padrão do dashboard é só o nome do arquivo, "server.ts" (ver
  # comentário mais abaixo sobre por quê é só o nome, não o caminho inteiro).
  # Isso colidia com `dashboard-v2/api/server.ts` — a API exclusiva e
  # somente-leitura do Dashboard 2.0, que também roda `node ... server.ts`.
  # Com os dois processos vivos ao mesmo tempo, `vivo("server.ts")` contava
  # os DOIS; matando só o dashboard antigo, a contagem nunca caía abaixo de
  # 1 (o processo da V2 sozinho já bastava), e o watchdog concluía "ainda
  # vivo" — nunca detectava a queda, nunca religava, nunca logava nada.
  # `dashboard-v2/` é um subsistema à parte, somente-leitura, nunca deveria
  # ser confundido com nenhum dos 8 processos supervisionados aqui —
  # excluído sempre, não só pro padrão do dashboard, como rede de segurança
  # contra a mesma colisão em qualquer padrão futuro.
  #
  # TIMEOUT: nenhuma chamada de PowerShell trava o laço inteiro mais —
  # com_timeout garante um teto, e uma saída vazia (por timeout) é tratada
  # pelo chamador como "não deu pra confirmar", nunca como "confirmado morto"
  # (ver uso abaixo: `[ "${n:-0}" -lt 1 ]` com n vazio cai no `-eq` seguro
  # via `${n:-0}`, e por padrão NÃO reinicia num caso ambíguo de timeout,
  # porque n vazio vira 0... na verdade isso reiniciaria por engano. Por
  # isso `vivo()` retorna um sentinela distinto em caso de timeout: "?").
  local saida rc
  saida=$(com_timeout "$TIMEOUT_EXTERNO_S" powershell -NoProfile -Command "@(Get-CimInstance Win32_Process -Filter \"Name='node.exe'\" | Where-Object { \$_.CommandLine -like '*$1*' -and \$_.CommandLine -notlike '*dashboard-v2*' }).Count")
  rc=$?
  if [ "$rc" -eq 124 ]; then echo "?"; return; fi
  echo "$saida" | tr -d '\r\n '
}

# ── manutenção POR PROCESSO (substitui o marker global) ──────────────────
# Um arquivo por processo: vigilancia/manutencao-<nome>.json, com
# target/startedAt/expiresAt/reason/requestedBy. NUNCA impede o restart —
# documentado explicitamente abaixo, igual o comportamento original do
# marker global fazia (o religamento sempre acontecia; só o RÓTULO no log e
# o alarme do Telegram mudavam). Uma manutenção de "dashboard" nunca toca o
# arquivo de nenhum outro processo, então nunca mascara queda de motor,
# vigilância, custódia, momentum, pairs, coletor ou preenchimento.
arquivo_manutencao() { echo "vigilancia/manutencao-$1.json"; }

registrar_manutencao() {
  local alvo="$1" motivo="${2:-atualização de código}" solicitante="${3:-supervisor.sh}"
  local agora_ms
  agora_ms=$(date +%s%3N)
  printf '{\n  "target": "%s",\n  "startedAt": %s,\n  "expiresAt": %s,\n  "reason": "%s",\n  "requestedBy": "%s"\n}\n' \
    "$alvo" "$agora_ms" "$((agora_ms + 90000))" "$motivo" "$solicitante" > "$(arquivo_manutencao "$alvo")"
}

em_manutencao() {
  # DOCUMENTAÇÃO EXPLÍCITA (pedido explícito desta etapa) do que a
  # manutenção faz e não faz:
  #   - Apenas muda o log:        SIM — rótulo "religado — atualização de
  #                                código aplicada" em vez de "CAIU".
  #   - Impede o restart:         NÃO — o processo é religado de qualquer
  #                                jeito, sempre, dentro ou fora de manutenção.
  #   - Atrasa o restart:         NÃO — mesma volta do laço, sem espera extra.
  #   - Silencia alerta:          SIM — não dispara notificação no Telegram.
  local alvo="$1" arquivo
  arquivo=$(arquivo_manutencao "$alvo")
  [ -f "$arquivo" ] || return 1
  local expires_at agora_ms
  expires_at=$(lock_ler_campo "$arquivo" expiresAt)
  agora_ms=$(date +%s%3N)
  [ -n "$expires_at" ] && [ "$expires_at" -gt 0 ] 2>/dev/null && [ "$agora_ms" -le "$expires_at" ]
}

notificar_telegram() {
  if [ -f .env ]; then set -a; source .env; set +a; fi
  if [ -n "${TELEGRAM_BOT_TOKEN:-}" ] && [ -n "${TELEGRAM_CHAT_ID:-}" ]; then
    curl -s -m 8 -X POST "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage" \
      --data-urlencode "chat_id=${TELEGRAM_CHAT_ID}" \
      --data-urlencode "text=$1" \
      --data-urlencode "parse_mode=HTML" > /dev/null 2>&1 &
  fi
}

# ── heartbeat do supervisor — prova que o processo não só está vivo, mas
# está COMPLETANDO ciclos (não travado num meio de volta) ────────────────
declare -g HB_LAST_LOOP_STARTED=0 HB_LAST_LOOP_COMPLETED=0 HB_LOOP_DURATION_MS=0
declare -g HB_PROCESSES_CHECKED=0 HB_PROCESSES_MISSING=0 HB_PROCESSES_RESTARTED=0
declare -g HB_LAST_ERROR="" HB_CONSECUTIVE_ERRORS=0

escrever_heartbeat_supervisor() {
  local tmp="$HEARTBEAT_FILE.tmp"
  local erro_escapado
  erro_escapado=$(printf '%s' "$HB_LAST_ERROR" | sed 's/\\/\\\\/g; s/"/\\"/g')
  printf '{\n  "pid": %s,\n  "startedAt": %s,\n  "lastLoopStarted": %s,\n  "lastLoopCompleted": %s,\n  "loopDurationMs": %s,\n  "processesChecked": %s,\n  "processesMissing": %s,\n  "processesRestarted": %s,\n  "lastError": "%s",\n  "consecutiveErrors": %s,\n  "version": "%s"\n}\n' \
    "${SUPERVISOR_PID_REAL:-$$}" "$SUPERVISOR_STARTED_AT" "$HB_LAST_LOOP_STARTED" "$HB_LAST_LOOP_COMPLETED" "$HB_LOOP_DURATION_MS" \
    "$HB_PROCESSES_CHECKED" "$HB_PROCESSES_MISSING" "$HB_PROCESSES_RESTARTED" "$erro_escapado" "$HB_CONSECUTIVE_ERRORS" "$SUPERVISOR_VERSION" \
    > "$tmp"
  mv "$tmp" "$HEARTBEAT_FILE"
}

mkdir -p vigilancia vigilancia/locks

lock_iniciar_ou_sair "$SCRIPT_PATH" "vigilancia/supervisor-watchdog.log" || exit 1
SUPERVISOR_PID_REAL="$$"
SUPERVISOR_STARTED_AT="$LOCK_STARTED_AT"

shutdown_limpo() {
  lock_liberar
  echo "[$(date '+%H:%M:%S')] supervisor encerrado (shutdown limpo) — lock liberado" >> vigilancia/supervisor-watchdog.log
  exit 0
}
trap shutdown_limpo INT TERM

echo "[$(date '+%H:%M:%S')] supervisor iniciado — checando a cada 30s — PID real $SUPERVISOR_PID_REAL (\$\$=$$)" >> vigilancia/supervisor-watchdog.log
escrever_heartbeat_supervisor

# Primeira volta do laço, logo após `iniciar.cmd`: todo processo começa
# "ausente" até subir pela primeira vez, e sem essa distinção isso batia na
# mesma linha "CAIU" de uma queda de verdade -- inclusive disparando alarme
# falso no Telegram a cada restart deliberado (achado rodando de verdade:
# testar parar.cmd/iniciar.cmd em sequência gerava 8 alarmes de "caiu" sem
# nada ter caído). primeira_passada some depois da primeira volta completa.
primeira_passada=true

while true; do
  HB_LAST_LOOP_STARTED=$(date +%s%3N)
  HB_PROCESSES_CHECKED=0
  HB_PROCESSES_MISSING=0
  HB_PROCESSES_RESTARTED=0

  lock_atualizar_heartbeat

  for nome in "${!CMD[@]}"; do
    HB_PROCESSES_CHECKED=$((HB_PROCESSES_CHECKED + 1))
    # DETECÇÃO POR CAMINHO NORMALIZADO (Parte 4) — substitui o antigo
    # reconhecimento por basename puro ("server.ts" + exceção manual "não
    # contém dashboard-v2"), que colidia sempre que dois processos
    # supervisionados por scripts diferentes rodassem arquivos de mesmo
    # nome (foi exatamente isso que causou o dashboard antigo nunca ser
    # detectado como caído enquanto a API V2 também existia). O entrypoint
    # vem do manifesto (scripts/process-manifest.json), comparado por
    # COMPONENTE de caminho inteiro, tolerando barra invertida/normal,
    # aspas, maiúsculas do Windows, caminho absoluto ou relativo, e
    # argumentos adicionais depois do entrypoint.
    padrao=$(entrypoint_do_manifesto "$nome")
    if [ -z "$padrao" ]; then
      # chave sem entrada no manifesto -- nunca devia acontecer (todo nome
      # em $CMD tem uma linha correspondente), mas se acontecer, cai pro
      # basename como rede de segurança, nunca trava o ciclo.
      for palavra in ${CMD[$nome]}; do
        case "$palavra" in *.ts) padrao="${palavra##*/}"; break;; esac
      done
      [ -z "$padrao" ] && padrao="${CMD[$nome]%% *}"
      n=$(vivo "$padrao")
    else
      n=$(processo_vivo_por_entrypoint "$padrao")
    fi
    if [ "$n" = "?" ]; then
      # timeout na checagem — não sabemos se está vivo ou morto. NUNCA
      # religa num caso ambíguo (evitaria duplicar instância se só a
      # CHECAGEM tiver falhado, não o processo em si); registra e segue.
      HB_LAST_ERROR="checagem de $nome deu timeout — pulando esta volta pra este processo"
      HB_CONSECUTIVE_ERRORS=$((HB_CONSECUTIVE_ERRORS + 1))
      continue
    fi
    if [ "${n:-0}" -lt 1 ] 2>/dev/null; then
      HB_PROCESSES_MISSING=$((HB_PROCESSES_MISSING + 1))
      if [ "$primeira_passada" = true ]; then
        echo "[$(date '+%H:%M:%S')] $nome subindo (primeira passada do watchdog)" >> vigilancia/supervisor-watchdog.log
      elif em_manutencao "$nome"; then
        echo "[$(date '+%H:%M:%S')] $nome religado — atualização de código aplicada (manutenção direcionada)" >> vigilancia/supervisor-watchdog.log
      else
        # CAUSA, nao so o fato. Ate aqui o watchdog registrava que o processo
        # sumiu e religava -- e uma investigacao posterior nao tinha com o que
        # trabalhar. As ultimas linhas do log do proprio processo sao onde o
        # stack trace de uma excecao nao tratada aparece; capturar na hora,
        # antes de religar (o religamento escreve por cima no mesmo arquivo).
        causa=$(tail -n 6 "${LOG[$nome]}" 2>/dev/null | tr -d '\r' | grep -v '^\s*$' | tail -n 3)
        echo "[$(date '+%H:%M:%S')] $nome CAIU (padrão: $padrao) — religando" >> vigilancia/supervisor-watchdog.log
        if [ -n "$causa" ]; then
          echo "$causa" | sed 's/^/    | /' >> vigilancia/supervisor-watchdog.log
        else
          echo "    | (log vazio — morte sem erro registrado: sinal externo, OOM ou suspensão)" >> vigilancia/supervisor-watchdog.log
        fi
        notificar_telegram "⚠️ <b>$nome caiu</b> — religando automaticamente"
      fi
      nohup ${CMD[$nome]} >> "${LOG[$nome]}" 2>&1 &
      disown
      HB_PROCESSES_RESTARTED=$((HB_PROCESSES_RESTARTED + 1))
    else
      HB_CONSECUTIVE_ERRORS=0
    fi
  done
  primeira_passada=false

  HB_LAST_LOOP_COMPLETED=$(date +%s%3N)
  HB_LOOP_DURATION_MS=$((HB_LAST_LOOP_COMPLETED - HB_LAST_LOOP_STARTED))
  escrever_heartbeat_supervisor

  sleep 30
done
