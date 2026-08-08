#!/usr/bin/env bash
# v1.7 — ITEM 3. Recovery matrix: 8 cenários → estados permitidos. Prova que o leitor
# escolhe a base íntegra correta, replaya ciclo PREPARED, suspende quando não há base
# confiável, e reseta explicitamente em epoch novo — NUNCA do zero silencioso.
set -u
cd "$(dirname "$0")/../../.."
PROC="scripts/progression/forward-lab.cjs"
PASS=0; FAIL=0
ok(){ echo "  [OK]   $1"; PASS=$((PASS+1)); }
bad(){ echo "  [FALHA] $1"; FAIL=$((FAIL+1)); }
TMP=$(mktemp -d); OBS="$TMP/o.jsonl"; EP="$TMP/ep.json"; EP2="$TMP/ep2.json"
echo '{"forwardEpochId":"recov1","byteOffset":0,"lineNumber":0,"timestamp":0}' > "$EP"
echo '{"forwardEpochId":"recov2","byteOffset":0,"lineNumber":0,"timestamp":0}' > "$EP2"
T=$(node -e 'console.log(Date.now())')
printf '%s\n%s\n%s\n' \
 "{\"ts\":$T,\"k\":\"AAA/USDT:USDT|bitget|bybit\",\"apr\":3.0,\"spread\":0.0003,\"vol\":1000}" \
 "{\"ts\":$((T+1)),\"k\":\"BBB/USDT:USDT|okx|gate\",\"apr\":2.5,\"spread\":0.0004,\"vol\":900}" \
 "{\"ts\":$((T+2)),\"k\":\"CCC/USDT:USDT|bybit|okx\",\"apr\":2.0,\"spread\":0.0002,\"vol\":800}" > "$OBS"
D="auditoria/progression/forward/recovmx"; rm -rf "$D"; mkdir -p "$D"
run(){ local ep="${1:-$EP}"; rm -f "$D/lock.json"; FORWARD_OBS="$OBS" FORWARD_EPOCH="$ep" node "$PROC" --mode control --label recovmx --once >/dev/null 2>&1; }
recstate(){ node -e 'try{console.log(require("./'"$D"'/recovery.json").recoveryState)}catch(e){console.log("NONE")}'; }
corrupt(){ node -e 'const fs=require("fs");const p=process.argv[1];const o=JSON.parse(fs.readFileSync(p));o.checksum="0000000000000000";fs.writeFileSync(p,JSON.stringify(o,null,2))' "$1"; }
seed(){ rm -rf "$D"; mkdir -p "$D"; run; cp "$D/estado.json" "$TMP/e.json"; cp "$D/estado.prev.json" "$TMP/p.json" 2>/dev/null || cp "$D/estado.json" "$TMP/p.json"; cp "$D/wal.json" "$TMP/w.json"; }

echo "==== RECOVERY MATRIX (item 3) ===="
# cenário 1: checkpoint principal válido → RECOVERED_FROM_PRIMARY (2ª boot, estável, epoch igual)
seed; run
[ "$(recstate)" = "RECOVERED_FROM_PRIMARY" ] && ok "1) primário válido → RECOVERED_FROM_PRIMARY" || bad "1) primário válido → $(recstate)"
# cenário 2: principal corrompido, anterior válido → RECOVERED_FROM_PREVIOUS
seed; cp "$TMP/p.json" "$D/estado.prev.json"; corrupt "$D/estado.json"; run
[ "$(recstate)" = "RECOVERED_FROM_PREVIOUS" ] && ok "2) principal corrompido + anterior ok → RECOVERED_FROM_PREVIOUS" || bad "2) → $(recstate)"
# cenário 3: principal ausente, anterior válido → RECOVERED_FROM_PREVIOUS
seed; cp "$TMP/p.json" "$D/estado.prev.json"; rm -f "$D/estado.json"; run
[ "$(recstate)" = "RECOVERED_FROM_PREVIOUS" ] && ok "3) principal ausente + anterior ok → RECOVERED_FROM_PREVIOUS" || bad "3) → $(recstate)"
# cenário 4: os dois corrompidos → SUSPENDED_CHECKPOINT_CORRUPTION (não zera)
seed; cp "$TMP/p.json" "$D/estado.prev.json"; corrupt "$D/estado.json"; corrupt "$D/estado.prev.json"; run
[ "$(recstate)" = "SUSPENDED_CHECKPOINT_CORRUPTION" ] && ok "4) ambos corrompidos → SUSPENDED_CHECKPOINT_CORRUPTION" || bad "4) → $(recstate)"
# cenário 5: WAL mais novo (PREPARED de ciclo futuro) → REPLAYED_PREPARED_CYCLE
seed; node -e 'const fs=require("fs"),cr=require("crypto");const p="'"$D"'/wal.json";const w=JSON.parse(fs.readFileSync(p));w.status="PREPARED";w.cycleId=(w.cycleId||1)+1;delete w.checksum;const s={...w,schemaVersion:"forward.v1_7"};w.schemaVersion="forward.v1_7";w.checksum=cr.createHash("sha256").update(JSON.stringify(s)).digest("hex");fs.writeFileSync(p,JSON.stringify(w,null,2))'; run
[ "$(recstate)" = "REPLAYED_PREPARED_CYCLE" ] && ok "5) WAL PREPARED mais novo → REPLAYED_PREPARED_CYCLE" || bad "5) → $(recstate)"
# cenário 6: checkpoint mais novo que o WAL (WAL COMMITTED do mesmo ciclo) → RECOVERED_FROM_PRIMARY
seed; run
[ "$(recstate)" = "RECOVERED_FROM_PRIMARY" ] && ok "6) checkpoint >= WAL COMMITTED → RECOVERED_FROM_PRIMARY" || bad "6) → $(recstate)"
# cenário 7: epoch incompatível → RESET_NEW_EPOCH (com warmup preservado)
seed; run "$EP2"
RS=$(recstate); WU=$(ls "$D"/warmup-*.json 2>/dev/null | head -1)
{ [ "$RS" = "RESET_NEW_EPOCH" ] && [ -n "$WU" ]; } && ok "7) epoch incompatível → RESET_NEW_EPOCH + warmup preservado" || bad "7) → $RS warmup=$WU"
# cenário 8: schema incompatível → SUSPENDED_SCHEMA_MISMATCH (não zera)
seed; node -e 'const fs=require("fs");const p="'"$D"'/estado.json";const o=JSON.parse(fs.readFileSync(p));o.schemaVersion="forward.v0_0";fs.writeFileSync(p,JSON.stringify(o,null,2))'; run
[ "$(recstate)" = "SUSPENDED_SCHEMA_MISMATCH" ] && ok "8) schema incompatível → SUSPENDED_SCHEMA_MISMATCH" || bad "8) → $(recstate)"

rm -rf "$D" "$TMP"
echo "=================================="
echo "RESULTADO recovery matrix: $PASS passaram, $FAIL falharam"
[ "$FAIL" -eq 0 ] && exit 0 || exit 1
