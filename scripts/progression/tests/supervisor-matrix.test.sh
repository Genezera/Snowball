#!/usr/bin/env bash
# v1.7 — ITEM 6. Matriz do supervisor (ISOLADA, determinística). Para cada alvo
# (trial/control/observer-max3/4/5 + supervisor) prova as invariantes que o supervisor
# garante: restart único, recuperação de checkpoint, cursor/posição/saldo preservados,
# WAL consistente, nenhuma duplicata. Complementa o drill AO VIVO (v1.6 + fresco) do
# supervisor real. Nenhuma ordem; nenhum saldo real.
set -u
export FORWARD_TEST_MODE=1; FWROOT=".forward-test-tmp/supervisor-matrix"; export FORWARD_TEST_ROOT="$FWROOT"; rm -rf "$FWROOT"; mkdir -p "$FWROOT"
cd "$(dirname "$0")/../../.."
PROC="scripts/progression/forward-lab.cjs"; SUP="scripts/progression/supervisor-forward"
PASS=0; FAIL=0
ok(){ echo "  [OK]   $1"; PASS=$((PASS+1)); }
bad(){ echo "  [FALHA] $1"; FAIL=$((FAIL+1)); }
TMP=$(mktemp -d); OBS="$TMP/o.jsonl"; EP="$TMP/ep.json"
echo '{"forwardEpochId":"supmx","byteOffset":0,"lineNumber":0,"timestamp":0}' > "$EP"
T=$(node -e 'console.log(Date.now())')
printf '%s\n%s\n%s\n' \
 "{\"ts\":$T,\"k\":\"AAA/USDT:USDT|bitget|bybit\",\"apr\":3.0,\"spread\":0.0003,\"vol\":1000}" \
 "{\"ts\":$((T+1)),\"k\":\"BBB/USDT:USDT|okx|gate\",\"apr\":2.8,\"spread\":0.0003,\"vol\":900}" \
 "{\"ts\":$((T+2)),\"k\":\"CCC/USDT:USDT|bybit|okx\",\"apr\":2.6,\"spread\":0.0002,\"vol\":800}" > "$OBS"

field(){ node -e 'try{const e=require("./"+process.argv[2]+"/estado.json");let v=e;for(const k of process.argv[1].split("."))v=(v||{})[k];console.log(typeof v==="object"?JSON.stringify(v):v)}catch(x){console.log("ERR")}' "$1" "$2"; }
recstate(){ node -e 'try{console.log(require("./'"$1"'/recovery.json").recoveryState)}catch(e){console.log("NONE")}'; }
walstat(){ node -e 'try{console.log(require("./'"$1"'/wal.json").status)}catch(e){console.log("NONE")}'; }

echo "==== SUPERVISOR MATRIX (item 6, isolada) ===="
# ── invariantes por processo forward (kill = crash antes do WAL COMMITTED; restart = boot limpo) ──
for target in trial control observer-max3 observer-max4 observer-max5; do
  case "$target" in                       # SÓ mode/maxpos aqui; o --label é único (supmx-*), nunca toca dir de produção
    trial) A="--mode trial";;
    control) A="--mode control";;
    observer-max3) A="--mode control --maxpos 3";;
    observer-max4) A="--mode control --maxpos 4";;
    observer-max5) A="--mode control --maxpos 5";;
  esac
  D="$FWROOT/supmx-$target"; rm -rf "$D"; mkdir -p "$D"
  boot(){ local crash="$1"; rm -f "$D/lock.json"; FORWARD_OBS="$OBS" FORWARD_EPOCH="$EP" FORWARD_CRASH_AT="$crash" node "$PROC" $A --label "supmx-$target" --once >/dev/null 2>&1; }
  boot ""                              # ciclo normal → abre posição, WAL COMMITTED
  bo0=$(field cursor.byteOffset "$D"); pos0=$(field virtuais "$D"); sal0=$(field saldosPorExchange "$D")
  boot "before_wal_committed"          # KILL: crash deixando PREPARED sem COMMITTED
  boot ""                              # RESTART: recuperação
  rs=$(recstate "$D"); bo1=$(field cursor.byteOffset "$D"); pos1=$(field virtuais "$D"); sal1=$(field saldosPorExchange "$D"); ws=$(walstat "$D")
  # nenhuma duplicata: com lock fresco, uma 2ª instância sai sem processar
  echo '{"pid":999999,"heartbeat":'"$(node -e 'console.log(Date.now())')"'}' > "$D/lock.json"
  dup=$(FORWARD_OBS="$OBS" FORWARD_EPOCH="$EP" node "$PROC" $A --label "supmx-$target" --once 2>&1 | grep -c "outra instância viva")
  okc=0
  { [ "$rs" = "REPLAYED_PREPARED_CYCLE" ] || [ "$rs" = "RECOVERED_FROM_PRIMARY" ]; } && okc=$((okc+1))   # checkpoint recuperado
  [ "$bo1" != "ERR" ] && [ "$bo1" -ge "$bo0" ] && okc=$((okc+1))     # cursor preservado (monotônico)
  [ "$pos1" = "$pos0" ] && okc=$((okc+1))                            # posição preservada
  [ "$sal1" = "$sal0" ] && okc=$((okc+1))                            # saldo preservado
  [ "$ws" = "COMMITTED" ] && okc=$((okc+1))                          # WAL consistente
  [ "$dup" -ge 1 ] && okc=$((okc+1))                                 # sem duplicata (single-instance)
  [ "$okc" = "6" ] && ok "$target: restart único + checkpoint($rs) + cursor + posição + saldo + WAL($ws) + sem-dup" || bad "$target: invariantes $okc/6 (rs=$rs bo=$bo0->$bo1 pos=$([ "$pos1" = "$pos0" ]&&echo ok||echo X) sal=$([ "$sal1" = "$sal0" ]&&echo ok||echo X) wal=$ws dup=$dup)"
  rm -rf "$D"
done

# ── alvo supervisor: single-instance via mutex+lock (2º supervisor sai) — ISOLADO (BASE em temp) ──
FB="$TMP/fb"; mkdir -p "$FB"
SUPT="$TMP/sup-iso"; sed "s#^BASE=auditoria/progression/forward#BASE=$FB#" "$SUP" > "$SUPT"
mkdir -p "$FB/supervisor.lockdir"   # mutex já ocupado → força a 2ª instância a checar o lock
echo '{"pid":999998,"heartbeat":'"$(node -e 'console.log(Date.now())')"'}' > "$FB/supervisor.lock"   # supervisor "vivo" fresco (<90s)
timeout 10 bash "$SUPT" >/dev/null 2>&1
OUT=$(cat "$FB/supervisor.log" 2>/dev/null)
echo "$OUT" | grep -q "outro supervisor-forward vivo" && ok "supervisor: 2ª instância detecta a viva e sai (single-supervisor)" || bad "supervisor: não bloqueou 2ª instância ($(echo "$OUT" | tail -1))"

rm -rf "$TMP"
echo "============================================"
echo "RESULTADO supervisor matrix: $PASS passaram, $FAIL falharam"
echo "(backoff BACKOFF_BASE=5s..BACKOFF_MAX=120s e downtime<=INTERVALO_CHECK=30s: lógica do supervisor-forward; restart real end-to-end provado no drill AO VIVO)"
[ "$FAIL" -eq 0 ] && exit 0 || exit 1
