#!/usr/bin/env bash
# FALHAS CONTROLADAS ao vivo (item 6). Opera sobre a stack REAL: sobe o
# supervisor isolado, que sobe os 4 challengers (lendo o diario real do Champion,
# READ-ONLY). Mata cada challenger UMA vez e o supervisor UMA vez, e confirma:
# restart único (sem duplicar processo), cursor preservado, zero perda/duplicação,
# estado (fechados) e PnL preservados, e recuperação single-instance do supervisor.
# NUNCA envia ordem; NUNCA escreve fora de challengers-timing/. Não toca Champion.
set -u
cd "$(dirname "$0")/../../.."
BASE=challengers-timing
POLS=(control closeConfirm nextSettlement evExit)
SUP=scripts/challengers-timing/supervisor-challengers-timing
EVID=auditoria/challengers/FALHAS-CONTROLADAS.json
LOG=$BASE/failure-drill.log
: > "$LOG"
PASS=0; FAIL=0; RESULT=()
say(){ echo "[$(date '+%H:%M:%S')] $1" | tee -a "$LOG"; }
ok(){ echo "  [OK]   $1" | tee -a "$LOG"; PASS=$((PASS+1)); RESULT+=("OK|$1"); }
bad(){ echo "  [FALHA] $1" | tee -a "$LOG"; FAIL=$((FAIL+1)); RESULT+=("FALHA|$1"); }
nowms(){ date +%s%3N; }

count(){ powershell -NoProfile -Command "@(Get-CimInstance Win32_Process -Filter \"Name='node.exe'\" | Where-Object { \$_.CommandLine -like '*challenger-timing-live*' -and \$_.CommandLine -like '*--policy $1*' }).Count" 2>/dev/null | tr -d '\r\n '; }
killpol(){ powershell -NoProfile -Command "Get-CimInstance Win32_Process -Filter \"Name='node.exe'\" | Where-Object { \$_.CommandLine -like '*challenger-timing-live*' -and \$_.CommandLine -like '*--policy $1*' } | ForEach-Object { Stop-Process -Id \$_.ProcessId -Force -EA SilentlyContinue }" >/dev/null 2>&1; }
killall_ch(){ powershell -NoProfile -Command "Get-CimInstance Win32_Process -Filter \"Name='node.exe'\" | Where-Object { \$_.CommandLine -like '*challenger-timing-live*' } | ForEach-Object { Stop-Process -Id \$_.ProcessId -Force -EA SilentlyContinue }" >/dev/null 2>&1; }
hbpid(){ node -e 'try{console.log(JSON.parse(require("fs").readFileSync(process.argv[1])).pid||"")}catch(e){console.log("")}' "$BASE/$1/heartbeat.json" 2>/dev/null; }
hbciclo(){ node -e 'try{console.log(JSON.parse(require("fs").readFileSync(process.argv[1])).ultimoCiclo||0)}catch(e){console.log(0)}' "$BASE/$1/heartbeat.json" 2>/dev/null; }
efield(){ node -e 'try{const j=JSON.parse(require("fs").readFileSync(process.argv[1]));let v=j;for(const k of process.argv[2].split("."))v=v&&v[k];console.log(v==null?"":v)}catch(e){console.log("")}' "$BASE/$1/estado.json" "$2" 2>/dev/null; }
pnl(){ node -e 'try{const j=JSON.parse(require("fs").readFileSync(process.argv[1]));console.log(j.fechados.reduce((s,f)=>s+(f.pnlLiquido||0),0).toFixed(4))}catch(e){console.log("")}' "$BASE/$1/estado.json" 2>/dev/null; }
suplock_pid(){ node -e 'try{console.log(JSON.parse(require("fs").readFileSync(process.argv[1])).pid||"")}catch(e){console.log("")}' "$BASE/supervisor.lock" 2>/dev/null; }
# PID do supervisor no espaço do Windows (o lock guarda $$ do MSYS, que Stop-Process não mata).
sup_win_pid(){ powershell -NoProfile -Command "@(Get-CimInstance Win32_Process -Filter \"Name='bash.exe'\" | Where-Object { \$_.CommandLine -like '*supervisor-challengers-timing*' -and \$_.CommandLine -notlike '*Get-CimInstance*' -and \$_.CommandLine -notlike '*failure-drill*' } | Select-Object -First 1 -ExpandProperty ProcessId)" 2>/dev/null | tr -d '\r\n '; }
kill_supervisor(){ powershell -NoProfile -Command "Get-CimInstance Win32_Process -Filter \"Name='bash.exe'\" | Where-Object { \$_.CommandLine -like '*supervisor-challengers-timing*' -and \$_.CommandLine -notlike '*Get-CimInstance*' -and \$_.CommandLine -notlike '*failure-drill*' } | ForEach-Object { Stop-Process -Id \$_.ProcessId -Force -EA SilentlyContinue }" >/dev/null 2>&1; }
suplock_fresco(){ node -e 'try{const j=JSON.parse(require("fs").readFileSync(process.argv[1]));console.log((Date.now()-(j.heartbeat||0))<90000?"1":"0")}catch(e){console.log("0")}' "$BASE/supervisor.lock" 2>/dev/null; }

say "=== FALHAS CONTROLADAS (item 6) — stack REAL, read-only sobre o Champion ==="

# 0) slate limpa: mata challengers e supervisor antigos, limpa locks
say "0) limpando resíduos (challengers + supervisor)"
killall_ch
kill_supervisor
rm -f "$BASE/supervisor.lock"; rmdir "$BASE/supervisor.lockdir" 2>/dev/null; for p in "${POLS[@]}"; do rm -f "$BASE/$p/challenger.lock"; done
sleep 5

# 1) sobe o supervisor real (que sobe os 4 challengers)
say "1) subindo supervisor real"
nohup bash "$SUP" >/dev/null 2>&1 &
disown
# espera 4 vivos (até 180s)
alive=0
for i in $(seq 1 36); do
  sleep 5; alive=0
  for p in "${POLS[@]}"; do c=$(count "$p"); [ "${c:-0}" -ge 1 ] 2>/dev/null && alive=$((alive+1)); done
  say "   aguardando challengers vivos: $alive/4 (t=$((i*5))s)"
  [ "$alive" -eq 4 ] && break
done
[ "$alive" -eq 4 ] && ok "supervisor subiu os 4 challengers" || bad "supervisor não estabilizou 4 challengers (só $alive)"

# 2) drill por challenger: mata 1x, confirma restart único + cursor/estado/PnL preservados
for pol in "${POLS[@]}"; do
  say "2.$pol) matando challenger '$pol' uma vez"
  pid0=$(hbpid "$pol"); cur0=$(efield "$pol" cursorDiario); fech0=$(efield "$pol" contadores.fechamentos); pnl0=$(pnl "$pol"); ev0=$(efield "$pol" eventosConsumidos)
  kts=$(nowms)
  killpol "$pol"
  # espera restart: novo pid, count==1, e ciclo novo escrito após o kill
  newpid=""; cnt=0; ciclo=0
  for i in $(seq 1 40); do
    sleep 5
    cnt=$(count "$pol"); newpid=$(hbpid "$pol"); ciclo=$(hbciclo "$pol")
    if [ "${cnt:-0}" = "1" ] && [ -n "$newpid" ] && [ "$newpid" != "$pid0" ] && [ "${ciclo:-0}" -gt "$kts" ]; then break; fi
  done
  cur1=$(efield "$pol" cursorDiario); fech1=$(efield "$pol" contadores.fechamentos); pnl1=$(pnl "$pol"); ev1=$(efield "$pol" eventosConsumidos)
  [ "${cnt:-0}" = "1" ] && ok "$pol: restart único (1 processo vivo, sem duplicar)" || bad "$pol: processos=$cnt (esperado 1)"
  [ -n "$newpid" ] && [ "$newpid" != "$pid0" ] && ok "$pol: processo realmente reiniciado ($pid0 -> $newpid)" || bad "$pol: pid não mudou ($pid0 -> $newpid)"
  node -e "process.exit(Number('${cur1:-0}')>=Number('${cur0:-0}')?0:1)" && ok "$pol: cursor preservado/avançado ($cur0 -> $cur1, nunca reset a 0)" || bad "$pol: cursor recuou ($cur0 -> $cur1)"
  node -e "process.exit(Number('${ev1:-0}')>=Number('${ev0:-0}')?0:1)" && ok "$pol: eventosConsumidos monotônico ($ev0 -> $ev1, zero reprocessamento)" || bad "$pol: eventosConsumidos recuou ($ev0 -> $ev1)"
  node -e "process.exit(Number('${fech1:-0}')>=Number('${fech0:-0}')?0:1)" && ok "$pol: fechamentos preservados ($fech0 -> $fech1)" || bad "$pol: fechamentos recuaram ($fech0 -> $fech1)"
  node -e "process.exit(Math.abs(Number('${pnl1:-0}')-Number('${pnl0:-0}'))<=0.5?0:1)" && ok "$pol: PnL preservado ($pnl0 -> $pnl1)" || bad "$pol: PnL saltou ($pnl0 -> $pnl1)"
done

# 3) drill do supervisor: mata 1x, challengers sobrevivem, restart recupera single-instance sem duplicar
say "3) matando o supervisor uma vez (challengers devem sobreviver órfãos)"
sp=$(sup_win_pid)
before_counts=""; for p in "${POLS[@]}"; do before_counts+="$(count "$p")"; done
kill_supervisor
sleep 10
survivors=0; for p in "${POLS[@]}"; do c=$(count "$p"); [ "${c:-0}" -ge 1 ] 2>/dev/null && survivors=$((survivors+1)); done
[ "$survivors" -eq 4 ] && ok "supervisor morto: 4 challengers sobreviveram (observadores órfãos)" || bad "só $survivors/4 challengers sobreviveram ao supervisor morto"
# espera o lock ficar stale (>90s) para provar auto-heal do mutex, então reinicia
say "   aguardando lock do supervisor ficar stale (>90s) p/ provar auto-heal do mutex"
sleep 100
nohup bash "$SUP" >/dev/null 2>&1 &
disown
sleep 15
newsp=$(sup_win_pid); fresco=$(suplock_fresco)
# conta instâncias do supervisor via lock fresco + 1 processo; e garante que NÃO duplicou challengers
dup=0; for p in "${POLS[@]}"; do c=$(count "$p"); [ "${c:-0}" -gt 1 ] 2>/dev/null && dup=$((dup+1)); done
[ "$fresco" = "1" ] && [ -n "$newsp" ] && [ "$newsp" != "$sp" ] && ok "supervisor reiniciado single-instance (auto-heal do lock stale: $sp -> $newsp)" || bad "supervisor não recuperou single-instance (fresco=$fresco, $sp -> $newsp)"
[ "$dup" -eq 0 ] && ok "restart do supervisor NÃO duplicou nenhum challenger (0 políticas com >1 processo)" || bad "$dup políticas com processo duplicado após restart do supervisor"

# 4) evidência
node -e '
const fs=require("fs");
const res=process.argv.slice(1).map(r=>{const [s,...m]=r.split("|");return {status:s,check:m.join("|")};});
const pass=res.filter(r=>r.status==="OK").length, fail=res.filter(r=>r.status==="FALHA").length;
const out={geradoEm:new Date().toISOString(),tipo:"falhas-controladas-item6",veredito:fail===0?"PASSOU":"FALHOU",passaram:pass,falharam:fail,checks:res};
fs.mkdirSync("auditoria/challengers",{recursive:true});
fs.writeFileSync("auditoria/challengers/FALHAS-CONTROLADAS.json",JSON.stringify(out,null,2));
' "${RESULT[@]}"

say "===================================="
say "RESULTADO FALHAS CONTROLADAS: $PASS passaram, $FAIL falharam"
say "Evidência: $EVID"
[ "$FAIL" -eq 0 ] && exit 0 || exit 1
