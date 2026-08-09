#!/usr/bin/env bash
# v1.7 — ITEM 4. Rotation overlap: quando o arquivo roda e o novo começa com uma CÓPIA
# da cauda do antigo, o leitor compara logicalObservationHash e PULA as linhas copiadas —
# sem dupla contagem. Sem sobreposição comprovada, NÃO avança (não reprocessa, não zera).
set -u
export FORWARD_TEST_MODE=1; FWROOT=".forward-test-tmp/rotation-overlap"; export FORWARD_TEST_ROOT="$FWROOT"; rm -rf "$FWROOT"; mkdir -p "$FWROOT"
cd "$(dirname "$0")/../../.."
PROC="scripts/progression/forward-lab.cjs"
PASS=0; FAIL=0
ok(){ echo "  [OK]   $1"; PASS=$((PASS+1)); }
bad(){ echo "  [FALHA] $1"; FAIL=$((FAIL+1)); }
TMP=$(mktemp -d); OBS="$TMP/o.jsonl"; EP="$TMP/ep.json"
echo '{"forwardEpochId":"rot","byteOffset":0,"lineNumber":0,"timestamp":0}' > "$EP"
T=$(node -e 'console.log(Date.now())')
LN(){ echo "{\"ts\":$1,\"k\":\"$2/USDT:USDT|bitget|bybit\",\"apr\":0.05,\"spread\":0.0001,\"vol\":100}"; }
D="$FWROOT/rotmx"; rm -rf "$D"; mkdir -p "$D"
run(){ rm -f "$D/lock.json"; FORWARD_OBS="$OBS" FORWARD_EPOCH="$EP" node "$PROC" --mode control --label rotmx --once >/dev/null 2>&1; }
field(){ node -e 'try{const e=require("./'"$D"'/estado.json");const parts=process.argv[1].split(".");let v=e;for(const k of parts)v=v[k];console.log(v)}catch(x){console.log("ERR")}' "$1"; }
status(){ node -e 'try{console.log(require("./'"$D"'/estado.json").sourceStatus)}catch(e){console.log("NONE")}'; }

echo "==== ROTATION OVERLAP (item 4) ===="
# arquivo A com 6 linhas distintas
: > "$OBS"; for i in 0 1 2 3 4 5; do LN $((T+i)) "S$i" >> "$OBS"; done
run
EC_A=$(field eventCount)
[ "$EC_A" = "6" ] && ok "arquivo A: 6 eventos processados" || bad "arquivo A: eventCount=$EC_A (esperado 6)"

# ── ROTAÇÃO COM CÓPIA DE CAUDA: novo arquivo B = últimas 3 de A + 2 novas ──
sleep 1
B="$TMP/b.jsonl"; : > "$B"
LN $((T+3)) "S3" >> "$B"; LN $((T+4)) "S4" >> "$B"; LN $((T+5)) "S5" >> "$B"   # cópia da cauda de A
LN $((T+6)) "S6" >> "$B"; LN $((T+7)) "S7" >> "$B"                              # 2 linhas NOVAS
mv -f "$B" "$OBS"   # mesma path, identidade nova
run
EC_B=$(field eventCount); SKIP=$(field contadores.rotationOverlapSkipped); ST=$(status)
[ "$ST" = "SOURCE_ROTATED_TAILCOPY" ] && ok "rotação detectada: $ST" || bad "rotação: status=$ST"
[ "$SKIP" = "3" ] && ok "cauda copiada pulada: rotationOverlapSkipped=3" || bad "overlapSkipped=$SKIP (esperado 3)"
[ "$EC_B" = "8" ] && ok "sem dupla contagem: eventCount 6→8 (+2 novas, não +5)" || bad "eventCount=$EC_B (esperado 8, seria 11 se contasse a cauda em dobro)"

# ── ROTAÇÃO SEM SOBREPOSIÇÃO: arquivo totalmente novo → não avança (não reprocessa/zera) ──
rm -rf "$D"; mkdir -p "$D"
: > "$OBS"; for i in 0 1 2 3 4 5; do LN $((T+i)) "S$i" >> "$OBS"; done
run; EC0=$(field eventCount)
sleep 1
C="$TMP/c.jsonl"; : > "$C"; for i in 0 1 2; do LN $((T+100+i)) "Z$i" >> "$C"; done
mv -f "$C" "$OBS"
run
STN=$(status); ECN=$(field eventCount)
[ "$STN" = "SOURCE_IDENTITY_CHANGED_NO_OVERLAP" ] && ok "sem overlap → SOURCE_IDENTITY_CHANGED_NO_OVERLAP" || bad "sem overlap → $STN"
[ "$ECN" = "$EC0" ] && ok "sem overlap → não avança nem zera (eventCount $ECN==$EC0)" || bad "sem overlap → eventCount $ECN != $EC0"

rm -rf "$D" "$TMP"
echo "==================================="
echo "RESULTADO rotation overlap: $PASS passaram, $FAIL falharam"
[ "$FAIL" -eq 0 ] && exit 0 || exit 1
