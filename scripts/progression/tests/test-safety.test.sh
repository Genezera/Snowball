#!/usr/bin/env bash
# v1.8 — ITEM 10. Segurança do harness: confirma que o forward-lab RECUSA tocar produção.
# Sem FORWARD_TEST_MODE não escreve em TEST_ROOT; com TEST_ROOT resolvendo p/ árvore de
# produção, ABORTA; --label duplicado ABORTA.
set -u
cd "$(dirname "$0")/../../.."
PROC="scripts/progression/forward-lab.cjs"
PASS=0; FAIL=0
ok(){ echo "  [OK]   $1"; PASS=$((PASS+1)); }
bad(){ echo "  [FALHA] $1"; FAIL=$((FAIL+1)); }
TMP=$(mktemp -d); TROOT="$TMP/root"; EP="$TMP/ep.json"
echo '{"forwardEpochId":"safe","byteOffset":0,"lineNumber":0,"timestamp":0}' > "$EP"
echo '{"ts":1700000000000,"k":"AAA|bitget|bybit","apr":3.0,"spread":0.0003,"vol":1000}' > "$TMP/o.jsonl"

echo "==== TEST SAFETY (item 10) ===="
# 1) TEST_ROOT apontando p/ árvore auditoria/progression/forward ⇒ ABORTA (exit 2)
FORWARD_TEST_MODE=1 FORWARD_TEST_ROOT="$TMP/auditoria/progression/forward" FORWARD_OBS="$TMP/o.jsonl" FORWARD_EPOCH="$EP" \
  node "$PROC" --mode control --label safe1 --once >/dev/null 2>&1; rc=$?
[ "$rc" = "2" ] && ok "1) TEST_ROOT em árvore de produção ⇒ ABORTA (exit 2)" || bad "1) não abortou (exit $rc)"

# 2) modo teste SEM TEST_ROOT ⇒ ABORTA
FORWARD_TEST_MODE=1 FORWARD_OBS="$TMP/o.jsonl" FORWARD_EPOCH="$EP" node "$PROC" --label safe2 --once >/dev/null 2>&1; rc=$?
[ "$rc" = "2" ] && ok "2) FORWARD_TEST_MODE sem TEST_ROOT ⇒ ABORTA" || bad "2) não abortou (exit $rc)"

# 3) --label duplicado ⇒ ABORTA
FORWARD_TEST_MODE=1 FORWARD_TEST_ROOT="$TROOT" node "$PROC" --label a --label b --once >/dev/null 2>&1; rc=$?
[ "$rc" = "2" ] && ok "3) --label duplicado ⇒ ABORTA" || bad "3) não abortou (exit $rc)"

# 4) modo teste com TEST_ROOT temp válido ⇒ RODA e escreve SÓ no temp (produção intocada)
before=$(ls auditoria/progression/forward 2>/dev/null | sort | md5sum 2>/dev/null || echo x)
FORWARD_TEST_MODE=1 FORWARD_TEST_ROOT="$TROOT" FORWARD_OBS="$TMP/o.jsonl" FORWARD_EPOCH="$EP" \
  node "$PROC" --mode control --label safe4 --once >/dev/null 2>&1; rc=$?
after=$(ls auditoria/progression/forward 2>/dev/null | sort | md5sum 2>/dev/null || echo x)
{ [ "$rc" = "0" ] && [ -f "$TROOT/safe4/estado.json" ] && [ "$before" = "$after" ]; } && ok "4) TEST_ROOT temp ⇒ roda e produção INTOCADA" || bad "4) rc=$rc escreveu-temp=$([ -f "$TROOT/safe4/estado.json" ]&&echo s||echo n) prodMudou=$([ "$before" != "$after" ]&&echo SIM||echo nao)"

rm -rf "$TMP"
echo "==============================="
echo "RESULTADO test safety: $PASS passaram, $FAIL falharam"
[ "$FAIL" -eq 0 ] && exit 0 || exit 1
