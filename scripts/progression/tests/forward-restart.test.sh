#!/usr/bin/env bash
# v1.4 — PARTE 8. Testes operacionais ISOLADOS do processo forward. Usa observações
# SINTÉTICAS (FORWARD_OBS) e um label de teste. Nunca toca produção nem o Champion.
# Prova: zero perda, zero duplicação, estado/saldo/cursor preservados; robusto a
# linha parcial/truncada e evento duplicado; stale-lock => takeover.
set -u
cd "$(dirname "$0")/../../.."
PROC="scripts/progression/forward-lab.cjs"; LABEL="test-restart"; DIR="auditoria/progression/forward/$LABEL"
PASS=0; FAIL=0
ok(){ echo "  [OK]   $1"; PASS=$((PASS+1)); }
bad(){ echo "  [FALHA] $1"; FAIL=$((FAIL+1)); }
TMP=$(mktemp -d); OBS="$TMP/obs.jsonl"
rm -rf "$DIR"; mkdir -p "$DIR"
f(){ node -e 'try{const j=JSON.parse(require("fs").readFileSync(process.argv[1]));let v=j;for(const k of process.argv[2].split("."))v=v&&v[k];console.log(v==null?"":typeof v==="object"?JSON.stringify(v):v)}catch(e){console.log("ERR")}' "$DIR/estado.json" "$1"; }
run(){ rm -f "$DIR/lock.json"; FORWARD_OBS="$OBS" node "$PROC" --mode control --label "$LABEL" --once >/dev/null 2>&1; }

echo "==== TESTES forward restart/integridade ===="
# ts base (agora) — obs precisam ter ts > cursor inicial (=último ts do OBS no start)
T0=$(node -e 'console.log(Date.now())')
# obs inicial vazia com 1 linha antiga (cursor parte daqui)
echo '{"ts":'$((T0-600000))',"k":"AAA/USDT:USDT|bitget|bybit","apr":2.0,"spread":0.0005,"vol":1000000}' > "$OBS"

# T1: primeira passada abre virtual; cursor e saldo registrados
run
cur1=$(f cursorTs); aval1=$(f contadores.avaliadas); ab1=$(f contadores.abertas)
# adiciona obs NOVA (ts > cursor) de outra chave com APR alto (deve abrir)
echo '{"ts":'$((T0+60000))',"k":"BBB/USDT:USDT|bitget|bybit","apr":3.0,"spread":0.0003,"vol":2000000}' >> "$OBS"
run
cur2=$(f cursorTs); aval2=$(f contadores.avaliadas); ab2=$(f contadores.abertas)
[ "$aval2" -gt "$aval1" ] && ok "evento novo processado incrementalmente (avaliadas $aval1->$aval2, zero perda)" || bad "não processou novo evento ($aval1->$aval2)"
node -e "process.exit(Number('${cur2:-0}')>=Number('${cur1:-0}')?0:1)" && ok "cursor monotônico ($cur1 -> $cur2)" || bad "cursor recuou"

# T2: restart SEM obs novas => cursor/estado/saldo preservados, zero duplicação
saldoAntes=$(f saldosPorExchange); abAntes=$(f contadores.abertas); curAntes=$(f cursorTs)
run
[ "$(f cursorTs)" = "$curAntes" ] && ok "cursor preservado no restart ($curAntes)" || bad "cursor mudou no restart"
[ "$(f contadores.abertas)" = "$abAntes" ] && ok "zero duplicação de abertura no restart ($abAntes)" || bad "duplicou abertura"
[ "$(f saldosPorExchange)" = "$saldoAntes" ] && ok "saldo por exchange preservado" || bad "saldo mudou"

# T3: EVENTO DUPLICADO (mesma obs com ts <= cursor) => ignorado
avalD=$(f contadores.avaliadas)
echo '{"ts":'$((T0+60000))',"k":"BBB/USDT:USDT|bitget|bybit","apr":3.0,"spread":0.0003,"vol":2000000}' >> "$OBS"
run
[ "$(f contadores.avaliadas)" = "$avalD" ] && ok "evento duplicado (ts<=cursor) ignorado (avaliadas $avalD)" || bad "reprocessou duplicado"

# T4: LINHA PARCIAL/TRUNCADA no OBS => robusto, sem crash, sem contar
printf '%s' '{"ts":'$((T0+120000))',"k":"CCC/USDT:USDT|bitget|byb' >> "$OBS"   # linha truncada, sem \n
run; rc=$?
[ "$rc" = "0" ] && ok "linha parcial/truncada não quebra o processo (exit 0)" || bad "quebrou em linha parcial"
# completa a linha depois (evento anexado durante 'restart')
echo 'it","apr":2.5,"spread":0.0004,"vol":1500000}' >> "$OBS"
avalP=$(f contadores.avaliadas); run
[ "$(f contadores.avaliadas)" -ge "$avalP" ] && ok "linha completada após é processada (obs anexada durante restart)" || bad "não processou obs anexada"

# T5: STALE LOCK => takeover
echo '{"pid":99999,"heartbeat":'$((T0-120000))'}' > "$DIR/lock.json"   # heartbeat 120s atrás = stale
FORWARD_OBS="$OBS" node "$PROC" --mode control --label "$LABEL" --once >/dev/null 2>&1
novoPid=$(node -e 'try{console.log(JSON.parse(require("fs").readFileSync(process.argv[1])).pid)}catch(e){console.log(0)}' "$DIR/lock.json")
[ "$novoPid" != "99999" ] && [ "$novoPid" != "0" ] && ok "stale lock => takeover (pid 99999 -> $novoPid)" || bad "não assumiu lock stale ($novoPid)"

rm -rf "$TMP" "$DIR"
echo "===================================="
echo "RESULTADO forward: $PASS passaram, $FAIL falharam"
[ "$FAIL" -eq 0 ] && exit 0 || exit 1
