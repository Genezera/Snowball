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

LOCK_FILE="${LOCK_FILE:-vigilancia/supervisor.lock}"
LOCK_STALE_S="${LOCK_STALE_S:-90}" # heartbeat mais velho que isso = instância morta/travada

lock_agora_ms() { date +%s%3N; }

lock_ler_campo() {
  local arquivo="$1" campo="$2"
  [ -f "$arquivo" ] || return 1
  grep -o "\"$campo\"[[:space:]]*:[[:space:]]*[^,}]*" "$arquivo" 2>/dev/null \
    | head -1 | sed -E "s/\"$campo\"[[:space:]]*:[[:space:]]*//; s/^\"//; s/\"\$//"
}

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

# ACHADO REAL (ao rodar de verdade, não hipotético): `$$` dentro do script
# NÃO bate confiavelmente com o PID que o Windows/WMI enxerga pra este
# mesmo processo lógico — o bash.exe do Git for Windows pode reexecutar a
# si mesmo internamente (Git\bin\bash.exe → Git\usr\bin\bash.exe), e
# dependendo de COMO o script foi lançado, o `$$` capturado no início do
# script às vezes reflete um PID que já não existe mais pro WMI (a
# instância registrou o lock com PID 60126 via `$$`, mas o processo de
# verdade, confirmado pelo StartTime batendo com o log, era o PID 17724 —
# nunca reconciliados sozinhos). Guardar `$$` no lock e confiar nele quebra
# a garantia inteira de single-instance (uma segunda instância consultaria
# um PID morto e concluiria "recuperar", mesmo com a primeira ainda viva).
# Correção: sempre AUTO-LOCALIZAR o PID real via WMI logo depois de
# iniciar, usando um padrão que só bate com uma invocação de verdade do
# script (termina exatamente em "supervisor.sh", nunca embutido no meio de
# um comando de diagnóstico maior).
pid_real_do_processo_atual() {
  local script_path="$1"
  local nome_script
  nome_script=$(basename "$script_path")
  local candidatos
  candidatos=$(timeout 8 powershell -NoProfile -Command "@(Get-CimInstance Win32_Process -Filter \"Name='bash.exe'\") | Where-Object { \$_.CommandLine -match '$nome_script\$' } | Select-Object -ExpandProperty ProcessId" 2>/dev/null | tr -d '\r')
  # se houver mais de um candidato (par pai/filho do reexec), fica com o
  # que NÃO é pai de nenhum outro candidato -- esse é o interpretador real
  # rodando o corpo do script, não o wrapper fino que só reexecutou.
  local pid
  for pid in $candidatos; do
    local eh_pai_de_outro=false
    local outro
    for outro in $candidatos; do
      [ "$outro" = "$pid" ] && continue
      local ppid_outro
      ppid_outro=$(timeout 8 powershell -NoProfile -Command "(Get-CimInstance Win32_Process -Filter \"ProcessId=$outro\").ParentProcessId" 2>/dev/null | tr -d '\r\n ')
      [ "$ppid_outro" = "$pid" ] && eh_pai_de_outro=true
    done
    [ "$eh_pai_de_outro" = false ] && { echo "$pid"; return; }
  done
  # fallback: nenhum candidato encontrado (WMI lento/vazio) -- usa $$ mesmo,
  # é melhor que um lock sem PID nenhum
  echo "$$"
}

lock_escrever() {
  local pid="$1" started_at="$2" heartbeat="$3" script_path="$4"
  local tmp="$LOCK_FILE.tmp"
  printf '{\n  "pid": %s,\n  "startedAt": %s,\n  "hostname": "%s",\n  "workingDirectory": "%s",\n  "scriptHash": "%s",\n  "heartbeat": %s\n}\n' \
    "$pid" "$started_at" "$(hostname 2>/dev/null || echo desconhecido)" "$(pwd)" "$(script_hash "$script_path")" "$heartbeat" > "$tmp"
  mv "$tmp" "$LOCK_FILE"
}

lock_atualizar_heartbeat() {
  [ -f "$LOCK_FILE" ] || return 1
  local pid started hn wd hash tmp
  pid=$(lock_ler_campo "$LOCK_FILE" pid)
  started=$(lock_ler_campo "$LOCK_FILE" startedAt)
  hn=$(lock_ler_campo "$LOCK_FILE" hostname)
  wd=$(lock_ler_campo "$LOCK_FILE" workingDirectory)
  hash=$(lock_ler_campo "$LOCK_FILE" scriptHash)
  tmp="$LOCK_FILE.tmp"
  printf '{\n  "pid": %s,\n  "startedAt": %s,\n  "hostname": "%s",\n  "workingDirectory": "%s",\n  "scriptHash": "%s",\n  "heartbeat": %s\n}\n' \
    "$pid" "$started" "$hn" "$wd" "$hash" "$(lock_agora_ms)" > "$tmp"
  mv "$tmp" "$LOCK_FILE"
}

lock_liberar() { rm -f "$LOCK_FILE"; }

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
