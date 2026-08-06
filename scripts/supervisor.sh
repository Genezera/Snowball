#!/usr/bin/env bash
# Watchdog: verifica os 6 processos do Snowball a cada 30s e religa
# automaticamente qualquer um que tiver caído. Existe porque o motor caiu
# uma vez (bug de import faltando) e ficou 3h30 sem ninguém religar --
# `start` dos .cmd nao funciona neste ambiente sandboxed sem sessao de
# janela interativa, entao isto substitui o supervisor dos .cmd.
set -u
cd "$(dirname "$0")/.."

declare -A CMD=(
  [vigilancia]="node src/cli/vigilancia.ts --equity 100 --intervalo 5"
  [custodia]="node src/cli/custodia.ts --intervalo 15"
  [motor]="node --env-file-if-exists=.env src/cli/spread-live.ts --porExchange 100 --alavancagem 5 --exchanges binanceusdm,bybit,okx,gate,bitget,bingx"
  [dashboard]="node src/dashboard/server.ts"
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
  [dashboard]="spread/dashboard.log"
  [coletor]="vigilancia/coletor.log"
  [momentum]="momentum/live.log"
  [preenchimento]="preenchimento/live.log"
  [pares]="pares/live.log"
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
# Distingue "eu atualizando o código" de "algo quebrou sozinho" -- os dois
# pareciam idênticos no log (mesma linha "CAIU"), e isso confundiu o usuário
# olhando o painel achando que o sistema estava instável quando na verdade
# era só redeploy. Antes de derrubar um processo de propósito pra aplicar
# código novo, toca vigilancia/manutencao.marker; se um processo sumir
# dentro de 90s desse toque, é tratado como atualização, não queda -- sem
# alarme no Telegram, com rótulo diferente no log.
em_manutencao() {
  local marcador="vigilancia/manutencao.marker"
  [ -f "$marcador" ] || return 1
  local agora mtime
  agora=$(date +%s)
  mtime=$(stat -c %Y "$marcador" 2>/dev/null || echo 0)
  [ $((agora - mtime)) -le 90 ]
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

echo "[$(date '+%H:%M:%S')] supervisor iniciado — checando a cada 30s" >> vigilancia/supervisor-watchdog.log

# Primeira volta do laço, logo após `iniciar.cmd`: todo processo começa
# "ausente" até subir pela primeira vez, e sem essa distinção isso batia na
# mesma linha "CAIU" de uma queda de verdade -- inclusive disparando alarme
# falso no Telegram a cada restart deliberado (achado rodando de verdade:
# testar parar.cmd/iniciar.cmd em sequência gerava 8 alarmes de "caiu" sem
# nada ter caído). primeira_passada some depois da primeira volta completa.
primeira_passada=true

while true; do
  for nome in "${!CMD[@]}"; do
    # o padrao de busca e o BASENAME do token que termina em .ts -- nao o
    # caminho inteiro. Motivo (achado ao vivo, causava falso positivo em
    # cascata nos 5 processos a cada ciclo): o Git Bash reescreve caminhos
    # estilo POSIX (src/cli/vigilancia.ts) para estilo Windows
    # (src\cli\vigilancia.ts) ao invocar node.exe, um binario nativo -- e a
    # CommandLine que o Windows registra fica com contrabarra. Casar pelo
    # caminho completo com barra normal nunca dava match, entao TODO ciclo
    # achava que os 5 processos tinham morrido e tentava religar por cima
    # dos que ja estavam vivos (risco real: duas instancias escrevendo no
    # mesmo ciclos.json/estado.json ao mesmo tempo). O nome do arquivo
    # sozinho (sem separador) e imune a qual barra o SO usa, e continua
    # unico o bastante entre os 5 processos.
    padrao=""
    for palavra in ${CMD[$nome]}; do
      case "$palavra" in *.ts) padrao="${palavra##*/}"; break;; esac
    done
    [ -z "$padrao" ] && padrao="${CMD[$nome]%% *}"
    n=$(vivo "$padrao")
    if [ "${n:-0}" -lt 1 ] 2>/dev/null; then
      if [ "$primeira_passada" = true ]; then
        echo "[$(date '+%H:%M:%S')] $nome subindo (primeira passada do watchdog)" >> vigilancia/supervisor-watchdog.log
      elif em_manutencao; then
        echo "[$(date '+%H:%M:%S')] $nome religado — atualização de código aplicada" >> vigilancia/supervisor-watchdog.log
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
    fi
  done
  primeira_passada=false
  sleep 30
done
