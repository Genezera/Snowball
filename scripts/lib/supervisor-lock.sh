#!/usr/bin/env bash
# LOCK DE INSTÂNCIA ÚNICA + HEARTBEAT — biblioteca sourceable, separada do
# `supervisor.sh` de propósito, pra poder ser testada isoladamente sem
# subir o laço inteiro (ver scripts/tests/supervisor-lock.test.sh).
#
# Achado real que motivou isto: durante a investigação de "o watchdog não
# religou o dashboard", descobrimos que PID 6372/20852 eram PAI/FILHO da
# MESMA invocação (bash.exe do Git for Windows reexeca via usr/bin/bash.exe),
# não duas instâncias de verdade — mas o supervisor não tinha NENHUM
# mecanismo pra impedir uma segunda instância real de subir por engano
# (ex.: alguém rodando `bash scripts/supervisor.sh` duas vezes sem querer),
# o que causaria duas instâncias escrevendo/religando os mesmos processos
# ao mesmo tempo. Este lock fecha essa lacuna.
set -u
# shellcheck source=./json-field.sh
source "$(dirname "${BASH_SOURCE[0]}")/json-field.sh"

LOCK_FILE="${LOCK_FILE:-vigilancia/supervisor.lock}"
LOCK_STALE_S="${LOCK_STALE_S:-90}" # heartbeat mais velho que isso = instância morta/travada

lock_agora_ms() { date +%s%3N; }

# Nunca mais regex pra campo JSON (mesma lição do item 1) — usa o parser
# real de scripts/lib/json-field.sh.
lock_ler_campo() { ler_campo_json "$1" "$2"; }

# PID existe de verdade no SO — sobrescrevível em teste.
#
# ACHADO REAL (ao vivo, não hipotético — consumiu boa parte desta etapa até
# ficar claro): o PID que o `bash.exe` do Git for Windows reporta via `$$`
# NEM SEMPRE bate com o número que `Get-CimInstance`/WMI enxerga pro MESMO
# processo (o runtime MSYS tem sua própria numeração de PID, traduzida na
# hora de sinalizar). Checar existência via WMI usando um PID vindo de `$$`
# dava falso-negativo (WMI não achava o processo, mesmo ele estando vivo),
# e tentar auto-localizar o PID "real" via WMI antes de qualquer coisa
# provou ser frágil por causa da janela de corrida entre o processo acabar
# de nascer e o WMI já ter o registrado. `kill -0` é NATIVO do bash — vive
# na MESMA camada de tradução que gerou o `$$` original, então nunca sofre
# esse descompasso: se `$$` conseguiu ser usado pra sinalizar o processo
# com sucesso antes (confirmado ao vivo nesta investigação), `kill -0`
# nesse mesmo PID também funciona.
lock_pid_existe() {
  local pid="$1"
  [ -z "$pid" ] && return 1
  kill -0 "$pid" 2>/dev/null
}

# Linha de comando do PID — sobrescrevível em teste.
lock_comando_do_pid() {
  local pid="$1"
  timeout 8 powershell -NoProfile -Command "(Get-CimInstance Win32_Process -Filter \"ProcessId=$pid\").CommandLine" 2>/dev/null | tr -d '\r'
}

# O PID pertence de fato ao supervisor (não foi reciclado pelo SO pra outro
# processo qualquer depois que o supervisor original morreu).
#
# ACHADO REAL: PIDs de `$$` do bash (namespace MSYS) NUNCA aparecem pro WMI
# (confirmado ao vivo: `Get-CimInstance -Filter "ProcessId=$$"` sempre
# devolve zero resultados pro próprio processo bash rodando o comando).
# São dois espaços de numeração inteiramente separados — não é o caso de
# "o PID existe mas pertence a outro processo", é "esse número nunca
# existiu no espaço de PIDs que o WMI enxerga". Nesse caso, não dá pra
# verificar a LINHA DE COMANDO por essa via — mas isso não é o mesmo que
# "reciclado por outro processo": PIDs MSYS não são reaproveitados pelo
# Windows pra processos nativos (são pools diferentes), então a única
# checagem possível e honesta é a existência via `kill -0` (já feita em
# `lock_pid_existe`). Só quando o WMI ENCONTRA um processo de verdade pro
# PID (ex.: PID de um `node.exe` nativo) é que a comparação de comando faz
# sentido e é aplicada.
lock_pid_pertence_ao_supervisor() {
  local pid="$1"
  local cmd
  cmd=$(lock_comando_do_pid "$pid")
  if [ -z "$cmd" ]; then
    # WMI não achou nada pra este PID -- provavelmente namespace MSYS, não
    # Windows nativo. `lock_pid_existe` (kill -0) já confirmou que está
    # vivo antes de chegar aqui; sem linha de comando pra comparar, confia
    # na existência (não há como um PID MSYS colidir com processo alheio).
    return 0
  fi
  case "$cmd" in *supervisor.sh*) return 0 ;; *) return 1 ;; esac
}

script_hash() {
  sha256sum "$1" 2>/dev/null | awk '{print $1}'
}

# ── PIDs EM DOIS NAMESPACES (Parte 3) ────────────────────────────────────
# ACHADO REAL, confirmado empiricamente nesta investigação:
#   - `$$` do bash (namespace MSYS) NUNCA aparece pro WMI — testado direto:
#     `Get-CimInstance -Filter "ProcessId=$$"` sempre devolve zero
#     resultados pro próprio bash rodando o comando. São dois espaços de
#     numeração TOTALMENTE separados, não uma questão de tradução 1:1.
#   - `kill -0` (nativo do bash) funciona pra existência de um PID MSYS.
#   - WMI/CIM funciona pra existência e linha de comando de um PID Windows
#     nativo (ex.: node.exe lançado diretamente, não via job control do
#     bash).
# Este lock NUNCA mistura os dois silenciosamente: grava os dois campos
# separados, e quando o PID nativo não pode ser resolvido com segurança
# (não é possível provar que um PID MSYS corresponde a um PID Windows
# específico sem uma correlação por evidência, e tentar adivinhar via
# múltiplas consultas WMI provou ser uma corrida frágil nesta mesma
# investigação), `pidWindows` fica explicitamente `null` — nunca um
# palpite apresentado como se fosse confiável.
pid_windows_resolver_best_effort() {
  # Tentativa ÚNICA, com timeout curto, nunca bloqueia o startup. Só serve
  # pra registro informativo — NADA na lógica de lock depende do
  # resultado disto (lock_pid_existe usa kill -0, sempre, pra PID MSYS).
  local pid_msys="$1"
  timeout 3 powershell -NoProfile -Command "(Get-CimInstance Win32_Process -Filter \"ProcessId=$pid_msys\").ProcessId" 2>/dev/null | tr -d '\r\n '
}

lock_escrever() {
  local pid_msys="$1" started_at="$2" heartbeat="$3" script_path="$4"
  local pid_windows
  pid_windows=$(pid_windows_resolver_best_effort "$pid_msys")
  local pid_namespace="msys"
  local tmp="$LOCK_FILE.tmp"
  printf '{\n  "pid": %s,\n  "pidMsys": %s,\n  "pidWindows": %s,\n  "pidNamespace": "%s",\n  "startedAt": %s,\n  "hostname": "%s",\n  "workingDirectory": "%s",\n  "scriptHash": "%s",\n  "heartbeat": %s\n}\n' \
    "$pid_msys" "$pid_msys" "${pid_windows:-null}" "$pid_namespace" \
    "$started_at" "$(hostname 2>/dev/null || echo desconhecido)" "$(pwd)" "$(script_hash "$script_path")" "$heartbeat" > "$tmp"
  mv "$tmp" "$LOCK_FILE"
}

lock_atualizar_heartbeat() {
  [ -f "$LOCK_FILE" ] || return 1
  local pid_msys pid_windows pid_namespace started hn wd hash tmp
  pid_msys=$(lock_ler_campo "$LOCK_FILE" pidMsys)
  pid_windows=$(lock_ler_campo "$LOCK_FILE" pidWindows)
  pid_namespace=$(lock_ler_campo "$LOCK_FILE" pidNamespace)
  started=$(lock_ler_campo "$LOCK_FILE" startedAt)
  hn=$(lock_ler_campo "$LOCK_FILE" hostname)
  wd=$(lock_ler_campo "$LOCK_FILE" workingDirectory)
  hash=$(lock_ler_campo "$LOCK_FILE" scriptHash)
  tmp="$LOCK_FILE.tmp"
  printf '{\n  "pid": %s,\n  "pidMsys": %s,\n  "pidWindows": %s,\n  "pidNamespace": "%s",\n  "startedAt": %s,\n  "hostname": "%s",\n  "workingDirectory": "%s",\n  "scriptHash": "%s",\n  "heartbeat": %s\n}\n' \
    "$pid_msys" "$pid_msys" "${pid_windows:-null}" "${pid_namespace:-msys}" "$started" "$hn" "$wd" "$hash" "$(lock_agora_ms)" > "$tmp"
  mv "$tmp" "$LOCK_FILE"
}

lock_liberar() { rm -f "$LOCK_FILE"; }

# ── MUTEX ATÔMICO (Parte 2) — fecha a corrida do check-then-write do lock
# JSON. `mkdir` é atômico neste filesystem (falha se já existir); usado
# como portão de entrada ANTES de avaliar/escrever o lock. Achado ao vivo:
# sem isto, duas instâncias lançadas em rápida sucessão passaram pela
# avaliação do lock ao mesmo tempo e concluíram "pode iniciar" — chegaram a
# rodar 5 processos reais simultâneos numa das investigações desta etapa.
MUTEX_DIR="${MUTEX_DIR:-$LOCK_FILE.mutex}"
mutex_adquirir() {
  local tentativas=0
  while ! mkdir "$MUTEX_DIR" 2>/dev/null; do
    tentativas=$((tentativas + 1))
    if [ "$tentativas" -ge 10 ]; then return 1; fi
    sleep 0.3
  done
  return 0
}
mutex_liberar() { rmdir "$MUTEX_DIR" 2>/dev/null; }

# ── INICIALIZAÇÃO PADRÃO — usada por todos os 4 supervisores, cada um com
# seu próprio LOCK_FILE/MUTEX_DIR (nunca compartilhados entre si). Devolve
# 0 e deixa o lock escrito se pode prosseguir; devolve 1 e não escreve nada
# se outra instância saudável já existe ou o mutex está ocupado.
# Uso: `lock_iniciar_ou_sair "$0" "$LOG_HUMANO" || exit 1`
lock_iniciar_ou_sair() {
  local script_path="$1" log_humano_arquivo="$2"
  mkdir -p "$(dirname "$LOCK_FILE")" "$(dirname "$MUTEX_DIR")" 2>/dev/null
  if ! mutex_adquirir; then
    echo "[$(date '+%H:%M:%S')] supervisor NÃO iniciado — mutex ocupado após 10 tentativas (outra instância no meio da própria inicialização)" >> "$log_humano_arquivo"
    return 1
  fi
  local avaliacao
  avaliacao=$(lock_avaliar)
  case "$avaliacao" in
    recusar:*)
      echo "[$(date '+%H:%M:%S')] supervisor NÃO iniciado — outra instância saudável já rodando (${avaliacao#recusar:})" >> "$log_humano_arquivo"
      mutex_liberar
      return 1
      ;;
    recuperar:*)
      echo "[$(date '+%H:%M:%S')] lock anterior recuperado — motivo: ${avaliacao#recuperar:}" >> "$log_humano_arquivo"
      ;;
  esac
  LOCK_STARTED_AT=$(lock_agora_ms)
  lock_escrever "$$" "$LOCK_STARTED_AT" "$LOCK_STARTED_AT" "$script_path"
  mutex_liberar
  return 0
}

# Devolve (via echo, em stdout) uma destas formas:
#   ok:sem_lock                          -- nenhum lock existe, pode iniciar
#   recusar:instancia_saudavel_pid_<N>   -- outra instância viva e legítima, NÃO iniciar
#   recuperar:<motivo>                   -- lock stale/órfão/inválido, pode assumir (com evidência do motivo)
lock_avaliar() {
  if [ ! -f "$LOCK_FILE" ]; then echo "ok:sem_lock"; return; fi

  local pid heartbeat agora_ms idade_s
  pid=$(lock_ler_campo "$LOCK_FILE" pid)
  heartbeat=$(lock_ler_campo "$LOCK_FILE" heartbeat)
  agora_ms=$(lock_agora_ms)
  idade_s=999999
  if [ -n "$heartbeat" ] && [ "$heartbeat" -gt 0 ] 2>/dev/null; then
    idade_s=$(( (agora_ms - heartbeat) / 1000 ))
  fi

  if [ -z "$pid" ]; then echo "recuperar:lock_ilegivel_ou_vazio"; return; fi
  if ! lock_pid_existe "$pid"; then echo "recuperar:pid_${pid}_nao_existe"; return; fi
  if ! lock_pid_pertence_ao_supervisor "$pid"; then echo "recuperar:pid_${pid}_reutilizado_por_outro_processo"; return; fi
  if [ "$idade_s" -gt "$LOCK_STALE_S" ]; then echo "recuperar:heartbeat_stale_${idade_s}s"; return; fi
  echo "recusar:instancia_saudavel_pid_${pid}"
}
