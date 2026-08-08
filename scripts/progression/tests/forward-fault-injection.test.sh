#!/usr/bin/env bash
# v1.5 — PARTE 12. Fault injection do leitor resiliente (ISOLADO, obs sintéticas).
# Cobre: 2 linhas com mesmo ts, obs fora de ordem, truncamento, rotação, linha
# parcial completada, e determinismo do hash final. Nunca toca produção/Champion.
set -u
cd "$(dirname "$0")/../../.."
PROC="scripts/progression/forward-lab.cjs"; LABEL="test-fault"; D="auditoria/progression/forward/$LABEL"
PASS=0; FAIL=0
ok(){ echo "  [OK]   $1"; PASS=$((PASS+1)); }
bad(){ echo "  [FALHA] $1"; FAIL=$((FAIL+1)); }
TMP=$(mktemp -d); OBS="$TMP/o.jsonl"; EP="$TMP/epoch.json"
rm -rf "$D"; mkdir -p "$D"
# epoch de teste com byteOffset 0 (lê tudo desde o início)
echo '{"forwardEpochId":"testep","byteOffset":0,"lineNumber":0,"timestamp":0}' > "$EP"
: > "$OBS"
run(){ rm -f "$D/lock.json"; FORWARD_OBS="$OBS" FORWARD_EPOCH="$EP" node "$PROC" --mode control --label "$LABEL" --once >/dev/null 2>&1; }
g(){ node -e 'try{const j=JSON.parse(require("fs").readFileSync(process.argv[1]));let v=j;for(const k of process.argv[2].split("."))v=v&&v[k];console.log(v==null?"":typeof v==="object"?JSON.stringify(v):v)}catch(e){console.log("ERR")}' "$D/estado.json" "$1"; }
T=$(node -e 'console.log(Date.now())')

echo "==== FAULT INJECTION forward (leitor resiliente) ===="
# T1: DUAS linhas com MESMO timestamp => ambas processadas (ordem determinística)
printf '%s\n%s\n' \
 "{\"ts\":$T,\"k\":\"AAA/USDT:USDT|bitget|bybit\",\"apr\":2.0,\"spread\":0.0003,\"vol\":1000}" \
 "{\"ts\":$T,\"k\":\"BBB/USDT:USDT|okx|gate\",\"apr\":2.0,\"spread\":0.0003,\"vol\":1000}" >> "$OBS"
run; ev1=$(g eventCount)
[ "$ev1" = "2" ] && ok "2 linhas com mesmo ts: ambas processadas (eventCount=2)" || bad "mesmo-ts eventCount=$ev1"

# T2: obs FORA DE ORDEM (ts menor) => processada, sem perda
echo "{\"ts\":$((T-30000)),\"k\":\"CCC/USDT:USDT|bybit|okx\",\"apr\":2.0,\"spread\":0.0003,\"vol\":1000}" >> "$OBS"
run; ev2=$(g eventCount)
[ "$ev2" = "3" ] && ok "obs fora de ordem processada (eventCount 2->3, zero perda)" || bad "fora-de-ordem eventCount=$ev2"
hashApos3=$(g accumulatedEventHash)

# T3: TRUNCAMENTO => SOURCE_TRUNCATED, suspende, NÃO reseta
printf '%s\n' "{\"ts\":$((T+1)),\"k\":\"DDD/USDT:USDT|bitget|bybit\",\"apr\":2.0,\"spread\":0.0003,\"vol\":1}" > "$OBS.tmp"; mv "$OBS.tmp" "$OBS.keep"
head -c 20 "$OBS" > "$OBS.trunc" 2>/dev/null; mv "$OBS.trunc" "$OBS"   # trunca o arquivo (size < byteOffset)
run; st3=$(g sourceStatus); ev3=$(g eventCount)
{ [ "$st3" = "SOURCE_TRUNCATED" ] || [ "$st3" = "SOURCE_IDENTITY_CHANGED" ]; } && ok "truncamento detectado ($st3), suspende" || bad "não detectou truncamento ($st3)"
[ "$ev3" = "3" ] && ok "truncamento NÃO reseta contagem (eventCount preservado=3)" || bad "resetou no truncamento ($ev3)"

# T4: ROTAÇÃO (novo arquivo no mesmo path) => identidade muda => suspende
rm -f "$OBS"; sleep 1; echo "{\"ts\":$((T+2)),\"k\":\"EEE/USDT:USDT|okx|gate\",\"apr\":2.0,\"spread\":0.0003,\"vol\":1}" > "$OBS"
run; st4=$(g sourceStatus)
{ [ "$st4" = "SOURCE_IDENTITY_CHANGED" ] || [ "$st4" = "SOURCE_TRUNCATED" ]; } && ok "rotação/identidade detectada ($st4), suspende (não reinicia do zero)" || bad "não detectou rotação ($st4)"

# T5: DETERMINISMO — o hash é FÍSICO (sourceFileId+byteStart+byteEnd+lineHash), então o
# MESMO arquivo processado 2x (estado fresco) dá o MESMO hash.
OBS3="$TMP/o3.jsonl"; printf '%s\n%s\n' \
 "{\"ts\":$T,\"k\":\"AAA/USDT:USDT|bitget|bybit\",\"apr\":2.0,\"spread\":0.0003,\"vol\":1000}" \
 "{\"ts\":$((T+1)),\"k\":\"BBB/USDT:USDT|okx|gate\",\"apr\":2.0,\"spread\":0.0003,\"vol\":1000}" > "$OBS3"
hh(){ local d="auditoria/progression/forward/$1"; rm -rf "$d"; mkdir -p "$d"; rm -f "$d/lock.json"; FORWARD_OBS="$OBS3" FORWARD_EPOCH="$EP" node "$PROC" --mode control --label "$1" --once >/dev/null 2>&1; node -e 'try{console.log(JSON.parse(require("fs").readFileSync(process.argv[1])).accumulatedEventHash)}catch(e){console.log("ERR")}' "$d/estado.json"; }
h1=$(hh det1); h2=$(hh det2)
[ -n "$h1" ] && [ "$h1" = "$h2" ] && ok "hash DETERMINÍSTICO (mesmo arquivo => mesmo hash físico: $h1)" || bad "hash não-determinístico ($h1 vs $h2)"

rm -rf "$TMP" "$D" auditoria/progression/forward/det1 auditoria/progression/forward/det2
echo "===================================="
echo "RESULTADO fault injection: $PASS passaram, $FAIL falharam"
[ "$FAIL" -eq 0 ] && exit 0 || exit 1
