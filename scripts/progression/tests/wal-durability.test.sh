#!/usr/bin/env bash
# v1.7 — ITEM 2. Durabilidade do WAL. Prova que o WAL carrega schemaVersion/walSequence/
# checksum e que os 6 modos de dano do WAL NUNCA fazem o leitor começar do zero em silêncio:
#   vazio / parcial / truncado / checksum inválido / PREPARED-sem-COMMITTED / COMMITTED-sem-checkpoint.
# ISOLADO, obs sintéticas, nenhuma ordem.
set -u
export FORWARD_TEST_MODE=1; FWROOT=".forward-test-tmp/wal-durability"; export FORWARD_TEST_ROOT="$FWROOT"; rm -rf "$FWROOT"; mkdir -p "$FWROOT"
cd "$(dirname "$0")/../../.."
PROC="scripts/progression/forward-lab.cjs"
PASS=0; FAIL=0
ok(){ echo "  [OK]   $1"; PASS=$((PASS+1)); }
bad(){ echo "  [FALHA] $1"; FAIL=$((FAIL+1)); }
TMP=$(mktemp -d); OBS="$TMP/o.jsonl"; EP="$TMP/ep.json"
echo '{"forwardEpochId":"waldur","byteOffset":0,"lineNumber":0,"timestamp":0}' > "$EP"
T=$(node -e 'console.log(Date.now())')
printf '%s\n%s\n%s\n' \
 "{\"ts\":$T,\"k\":\"AAA/USDT:USDT|bitget|bybit\",\"apr\":3.0,\"spread\":0.0003,\"vol\":1000}" \
 "{\"ts\":$((T+1)),\"k\":\"BBB/USDT:USDT|okx|gate\",\"apr\":2.5,\"spread\":0.0004,\"vol\":900}" \
 "{\"ts\":$((T+2)),\"k\":\"CCC/USDT:USDT|bybit|okx\",\"apr\":2.0,\"spread\":0.0002,\"vol\":800}" > "$OBS"
D="$FWROOT/waldur"; rm -rf "$D"; mkdir -p "$D"
run(){ rm -f "$D/lock.json"; FORWARD_OBS="$OBS" FORWARD_EPOCH="$EP" node "$PROC" --mode control --label waldur --once >/dev/null 2>&1; }
recstate(){ node -e 'try{console.log(require("./'"$D"'/recovery.json").recoveryState)}catch(e){console.log("NONE")}'; }
field(){ node -e 'try{const e=require("./'"$D"'/estado.json");console.log(e["'"$1"'"])}catch(x){console.log("ERR")}'; }
walf(){ node -e 'try{const w=require("./'"$D"'/wal.json");console.log(w["'"$1"'"])}catch(x){console.log("ERR")}'; }

echo "==== WAL DURABILITY (item 2) ===="
run   # estado válido + WAL COMMITTED
EC0=$(field eventCount)
# 0) propriedades do WAL: schemaVersion + walSequence + checksum + status
case "$(walf schemaVersion)" in forward.v1_7|forward.v1_8) ok "WAL tem schemaVersion ($(walf schemaVersion))";; *) bad "WAL sem schemaVersion";; esac
[ "$(walf walSequence)" != "ERR" ] && [ "$(walf walSequence)" -ge 1 ] && ok "WAL tem walSequence ($(walf walSequence))" || bad "WAL sem walSequence"
[ "$(walf checksum)" != "ERR" ] && [ -n "$(walf checksum)" ] && ok "WAL tem checksum" || bad "WAL sem checksum"
[ "$(walf status)" = "COMMITTED" ] && ok "WAL final COMMITTED" || bad "WAL final != COMMITTED"

backup(){ cp "$D/estado.json" "$TMP/good_estado.json"; cp "$D/estado.prev.json" "$TMP/good_prev.json" 2>/dev/null; cp "$D/wal.json" "$TMP/good_wal.json"; }
restore(){ cp "$TMP/good_estado.json" "$D/estado.json"; cp "$TMP/good_prev.json" "$D/estado.prev.json" 2>/dev/null; cp "$TMP/good_wal.json" "$D/wal.json"; }
backup

# 1) WAL vazio → não confia; NÃO zera (SUSPENDED_WAL_CORRUPTION), estado preservado
restore; : > "$D/wal.json"; run
[ "$(recstate)" = "SUSPENDED_WAL_CORRUPTION" ] && ok "WAL vazio → SUSPENDED_WAL_CORRUPTION" || bad "WAL vazio → $(recstate)"
# 2) WAL parcial (JSON incompleto)
restore; printf '{"schemaVersion":"forward.v1_7","walSequence":9,"cycl' > "$D/wal.json"; run
[ "$(recstate)" = "SUSPENDED_WAL_CORRUPTION" ] && ok "WAL parcial → SUSPENDED_WAL_CORRUPTION" || bad "WAL parcial → $(recstate)"
# 3) WAL truncado (bytes cortados no meio)
restore; head -c 40 "$TMP/good_wal.json" > "$D/wal.json"; run
[ "$(recstate)" = "SUSPENDED_WAL_CORRUPTION" ] && ok "WAL truncado → SUSPENDED_WAL_CORRUPTION" || bad "WAL truncado → $(recstate)"
# 4) WAL checksum inválido (payload íntegro, checksum trocado)
restore; node -e 'const fs=require("fs");const p="'"$D"'/wal.json";const w=JSON.parse(fs.readFileSync(p));w.checksum="0000000000000000";fs.writeFileSync(p,JSON.stringify(w,null,2))'; run
[ "$(recstate)" = "SUSPENDED_WAL_CORRUPTION" ] && ok "WAL checksum inválido → SUSPENDED_WAL_CORRUPTION" || bad "WAL checksum inválido → $(recstate)"
# 5) PREPARED sem COMMITTED de ciclo futuro → REPLAYED_PREPARED_CYCLE (idempotente: eventCount não muda)
restore; node -e 'const fs=require("fs"),cr=require("crypto");const p="'"$D"'/wal.json";const w=JSON.parse(fs.readFileSync(p));w.status="PREPARED";w.cycleId=(w.cycleId||1)+1;delete w.checksum;const s={...w,schemaVersion:"forward.v1_7"};w.schemaVersion="forward.v1_7";w.checksum=cr.createHash("sha256").update(JSON.stringify(s)).digest("hex");fs.writeFileSync(p,JSON.stringify(w,null,2))'; run
RS=$(recstate); EC1=$(field eventCount)
{ [ "$RS" = "REPLAYED_PREPARED_CYCLE" ] && [ "$EC1" = "$EC0" ]; } && ok "PREPARED sem COMMITTED → REPLAYED_PREPARED_CYCLE idempotente (eventCount $EC1==$EC0)" || bad "PREPARED sem COMMITTED → $RS eventCount $EC1 vs $EC0"
# 6) COMMITTED com checkpoint principal AUSENTE → recupera do anterior (nunca do zero)
restore; rm -f "$D/estado.json"; run
RS=$(recstate)
{ [ "$RS" = "RECOVERED_FROM_PREVIOUS" ] || [ "$RS" = "REPLAYED_PREPARED_CYCLE" ]; } && ok "COMMITTED sem checkpoint → $RS (não do zero)" || bad "COMMITTED sem checkpoint → $RS"

rm -rf "$D" "$TMP"
echo "================================="
echo "RESULTADO WAL durability: $PASS passaram, $FAIL falharam"
[ "$FAIL" -eq 0 ] && exit 0 || exit 1
