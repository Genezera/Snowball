#!/usr/bin/env bash
# RETESTE do stale-lock do supervisor (v1.1 item 13). ISOLADO: opera num diretório
# TEMP e em processos próprios — NÃO toca o supervisor vivo nem a validação em curso.
# Exercita a MESMA lógica single-instance do supervisor-challengers-timing e o kill
# por WINDOWS PID (correção do gap 27/28 da v1.0, onde $$ do MSYS não era matável).
set -u
cd "$(dirname "$0")/../../.."
PASS=0; FAIL=0
ok(){ echo "  [OK]   $1"; PASS=$((PASS+1)); }
bad(){ echo "  [FALHA] $1"; FAIL=$((FAIL+1)); }
TMP=$(mktemp -d)
now_ms(){ date +%s%3N; }
hb_of(){ node -e 'try{console.log(JSON.parse(require("fs").readFileSync(process.argv[1])).heartbeat||0)}catch(e){console.log(0)}' "$1" 2>/dev/null; }
pid_of(){ node -e 'try{console.log(JSON.parse(require("fs").readFileSync(process.argv[1])).pid||0)}catch(e){console.log(0)}' "$1" 2>/dev/null; }

# lógica single-instance IDÊNTICA à do supervisor: retorna 0=assumiu, 1=recusou (lock fresco)
single_instance(){
  local MUTEX="$1" LOCK="$2"
  if ! mkdir "$MUTEX" 2>/dev/null; then
    if [ -f "$LOCK" ]; then
      local hb; hb=$(hb_of "$LOCK")
      if [ -n "$hb" ] && [ $(( $(now_ms) - hb )) -lt 90000 ]; then return 1; fi   # lock fresco → recusa
    fi
    rmdir "$MUTEX" 2>/dev/null; mkdir "$MUTEX" 2>/dev/null || return 2
  fi
  echo '{"pid":'$$',"heartbeat":'"$(now_ms)"'}' > "$LOCK"
  rmdir "$MUTEX" 2>/dev/null
  return 0
}

echo "==== RETESTE stale-lock (isolado, Windows PID) ===="

# ── T1: lock STALE (>90s) → auto-heal / takeover ────────────────────────────
echo "T1 · lock stale → supervisor assume (auto-heal do mutex)"
MUTEX1="$TMP/t1.lockdir"; LOCK1="$TMP/t1.lock"
mkdir -p "$MUTEX1"; echo '{"pid":99999,"heartbeat":'"$(( $(now_ms) - 120000 ))"'}' > "$LOCK1"  # 120s atrás = stale
pidAntes=$(pid_of "$LOCK1")
if single_instance "$MUTEX1" "$LOCK1"; then
  pidDepois=$(pid_of "$LOCK1"); hbDepois=$(hb_of "$LOCK1"); idade=$(( $(now_ms) - hbDepois ))
  [ "$pidDepois" != "$pidAntes" ] && ok "assumiu o lock stale (pid $pidAntes -> $pidDepois)" || bad "não trocou o pid ($pidAntes)"
  [ "$idade" -lt 5000 ] && ok "heartbeat renovado (idade ${idade}ms < 5s)" || bad "heartbeat não renovado (${idade}ms)"
  [ ! -d "$MUTEX1" ] && ok "mutex liberado após takeover" || bad "mutex ainda travado"
else
  bad "recusou indevidamente um lock stale (deveria assumir)"
fi

# ── T2: lock FRESCO → single-instance recusa ────────────────────────────────
echo "T2 · lock fresco → segunda instância recusa (single-instance)"
MUTEX2="$TMP/t2.lockdir"; LOCK2="$TMP/t2.lock"
mkdir -p "$MUTEX2"; echo '{"pid":88888,"heartbeat":'"$(now_ms)"'}' > "$LOCK2"  # agora = fresco
if single_instance "$MUTEX2" "$LOCK2"; then
  bad "assumiu um lock FRESCO (deveria recusar)"
else
  pidDepois=$(pid_of "$LOCK2")
  [ "$pidDepois" = "88888" ] && ok "recusou; lock do dono preservado (pid 88888)" || bad "alterou o lock do dono ($pidDepois)"
fi

# ── T3: kill por WINDOWS PID (correção v1.0) ────────────────────────────────
echo "T3 · kill por Windows PID mata o processo (onde \$\$ do MSYS falhava)"
MARK="STALELOCK$(basename "$TMP" | tr -cd 'a-zA-Z0-9')"
# bash rodando um SCRIPT FILE marcado (análogo fiel ao supervisor real, que roda um
# arquivo). bash -c 'sleep' faria exec direto no sleep.exe e perderia o bash marcado.
SCRIPT="$TMP/$MARK.sh"; printf '#!/usr/bin/env bash\nsleep 45\n' > "$SCRIPT"
nohup bash "$SCRIPT" >/dev/null 2>&1 &
disown
# acha o Windows PID via CIM pela command-line marcada (com espera entre tentativas)
winpid=""
for i in 1 2 3 4 5 6 7 8; do
  sleep 1
  winpid=$(powershell -NoProfile -Command "@(Get-CimInstance Win32_Process -Filter \"Name='bash.exe'\" | Where-Object { \$_.CommandLine -like '*$MARK*' -and \$_.CommandLine -notlike '*Get-CimInstance*' } | Select-Object -First 1 -ExpandProperty ProcessId)" 2>/dev/null | tr -d '\r\n ')
  [ -n "$winpid" ] && [ "$winpid" != "0" ] && break
done
if [ -n "$winpid" ] && [ "$winpid" != "0" ]; then
  ok "Windows PID resolvido via CIM ($winpid)"
  powershell -NoProfile -Command "Stop-Process -Id $winpid -Force -EA SilentlyContinue" >/dev/null 2>&1
  vivo=$(powershell -NoProfile -Command "@(Get-CimInstance Win32_Process -Filter \"Name='bash.exe'\" | Where-Object { \$_.CommandLine -like '*$MARK*' -and \$_.CommandLine -notlike '*Get-CimInstance*' }).Count" 2>/dev/null | tr -d '\r\n ')
  [ "${vivo:-0}" = "0" ] && ok "processo morto pelo Windows PID (0 remanescente)" || bad "processo sobreviveu ($vivo)"
else
  bad "não resolveu o Windows PID via CIM"
fi

rm -rf "$TMP"
echo "===================================="
echo "RESULTADO stale-lock: $PASS passaram, $FAIL falharam"
[ "$FAIL" -eq 0 ] && exit 0 || exit 1
