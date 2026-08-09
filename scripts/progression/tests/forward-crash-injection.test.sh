#!/usr/bin/env bash
# v1.6 — PARTE 9. Crash injection: mata o processo em 7 pontos instrumentados e prova
# que a recuperação é IDEMPOTENTE — mesmo eventCount/accumulatedEventHash/saldos/
# posições/stateHash finais que uma execução SEM crash. ISOLADO, obs sintéticas.
set -u
export FORWARD_TEST_MODE=1; FWROOT=".forward-test-tmp/forward-crash-injection"; export FORWARD_TEST_ROOT="$FWROOT"; rm -rf "$FWROOT"; mkdir -p "$FWROOT"
cd "$(dirname "$0")/../../.."
PROC="scripts/progression/forward-lab.cjs"
PASS=0; FAIL=0
ok(){ echo "  [OK]   $1"; PASS=$((PASS+1)); }
bad(){ echo "  [FALHA] $1"; FAIL=$((FAIL+1)); }
TMP=$(mktemp -d); OBS="$TMP/o.jsonl"; EP="$TMP/ep.json"
echo '{"forwardEpochId":"crash","byteOffset":0,"lineNumber":0,"timestamp":0}' > "$EP"
T=$(node -e 'console.log(Date.now())')
printf '%s\n%s\n%s\n' \
 "{\"ts\":$T,\"k\":\"AAA/USDT:USDT|bitget|bybit\",\"apr\":3.0,\"spread\":0.0003,\"vol\":1000}" \
 "{\"ts\":$((T+1)),\"k\":\"BBB/USDT:USDT|okx|gate\",\"apr\":2.5,\"spread\":0.0004,\"vol\":900}" \
 "{\"ts\":$((T+2)),\"k\":\"CCC/USDT:USDT|bybit|okx\",\"apr\":2.0,\"spread\":0.0002,\"vol\":800}" > "$OBS"
sig(){ node -e 'try{const e=JSON.parse(require("fs").readFileSync(process.argv[1]));console.log([e.eventCount,e.accumulatedEventHash,JSON.stringify(e.saldosPorExchange),Object.keys(e.virtuais).sort().join(","),e.contadores.dedupIgnorados].join("|"))}catch(x){console.log("ERR")}' "$1/estado.json"; }
runN(){ local d="$1" crash="$2"; for i in 1 2 3; do rm -f "$d/lock.json"; FORWARD_OBS="$OBS" FORWARD_EPOCH="$EP" FORWARD_CRASH_AT="$crash" node "$PROC" --mode control --label "$(basename "$d")" --once >/dev/null 2>&1; crash=""; done; }

echo "==== CRASH INJECTION (7 pontos) ===="
REF="$FWROOT/crashref"; rm -rf "$REF"; mkdir -p "$REF"; runN "$REF" ""
REFSIG=$(sig "$REF")
echo "  referência (sem crash): $REFSIG"

for pt in after_read after_wal_prepared during_tmp_write after_fsync before_rename after_rename before_wal_committed; do
  D="$FWROOT/crash-$pt"; rm -rf "$D"; mkdir -p "$D"
  # 1ª passada COM crash no ponto; depois recuperação (sem crash) até estabilizar
  runN "$D" "$pt"
  S=$(sig "$D")
  [ "$S" = "$REFSIG" ] && ok "crash em '$pt' recupera idêntico (zero perda/dup): $S" || bad "crash '$pt' divergiu: $S != $REFSIG"
  rm -rf "$D"
done
rm -rf "$REF" "$TMP"
echo "===================================="
echo "RESULTADO crash injection: $PASS passaram, $FAIL falharam"
[ "$FAIL" -eq 0 ] && exit 0 || exit 1
