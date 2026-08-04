#!/usr/bin/env bash
# Watchdog: verifica os 5 processos do Snowball a cada 30s e religa
# automaticamente qualquer um que tiver caído. Existe porque o motor caiu
# uma vez (bug de import faltando) e ficou 3h30 sem ninguém religar --
# `start` dos .cmd nao funciona neste ambiente sandboxed sem sessao de
# janela interativa, entao isto substitui o supervisor dos .cmd.
set -u
cd "$(dirname "$0")/.."

declare -A CMD=(
  [vigilancia]="node src/cli/vigilancia.ts --equity 100 --intervalo 5"
  [custodia]="node src/cli/custodia.ts --intervalo 15"
  [motor]="node src/cli/spread-live.ts --porExchange 100 --alavancagem 5"
  [dashboard]="node src/dashboard/server.ts"
  [coletor]="node src/cli/coletor.ts --intervalo 5"
)
declare -A LOG=(
  [vigilancia]="vigilancia/live.log"
  [custodia]="vigilancia/custodia.log"
  [motor]="spread/live.log"
  [dashboard]="spread/dashboard.log"
  [coletor]="vigilancia/coletor.log"
)

vivo() {
  # procura a linha de comando via PowerShell (mais confiavel que tasklist puro).
  # @(...) forca contexto de array -- sem isso, 1 resultado unico devolve
  # Count=$null em vez de 1, e o supervisor duplicaria o processo.
  powershell -NoProfile -Command "@(Get-CimInstance Win32_Process -Filter \"Name='node.exe'\" | Where-Object { \$_.CommandLine -like '*$1*' }).Count" 2>/dev/null | tr -d '\r\n '
}

# Telegram é opcional -- só notifica se .env tiver as duas variaveis. Nunca
# imprime o token em log nenhum, e falha em silencio se o Telegram estiver
# fora do ar (curl -s, sem checar resultado -- um aviso que falha nao pode
# travar o watchdog). Lido a cada volta do laço (nao só uma vez no início),
# pra criar o .env depois de o watchdog já estar rodando funcionar sem
# precisar reiniciar nada.
notificar_telegram() {
  if [ -f .env ]; then set -a; source .env; set +a; fi
  if [ -n "${TELEGRAM_BOT_TOKEN:-}" ] && [ -n "${TELEGRAM_CHAT_ID:-}" ]; then
    curl -s -m 8 -X POST "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage" \
      --data-urlencode "chat_id=${TELEGRAM_CHAT_ID}" \
      --data-urlencode "text=$1" \
      --data-urlencode "parse_mode=HTML" > /dev/null 2>&1 &
  fi
}

echo "[$(date '+%H:%M:%S')] supervisor iniciado — checando a cada 30s" >> vigilancia/supervisor-watchdog.log

while true; do
  for nome in "${!CMD[@]}"; do
    padrao="${CMD[$nome]#node }"       # remove o "node " pra casar com a CommandLine
    padrao="${padrao%% *}"              # só o caminho do arquivo, único o bastante
    n=$(vivo "$padrao")
    if [ "${n:-0}" -lt 1 ] 2>/dev/null; then
      echo "[$(date '+%H:%M:%S')] $nome CAIU (padrão: $padrao) — religando" >> vigilancia/supervisor-watchdog.log
      notificar_telegram "⚠️ <b>$nome caiu</b> — religando automaticamente"
      nohup ${CMD[$nome]} >> "${LOG[$nome]}" 2>&1 &
      disown
    fi
  done
  sleep 30
done
