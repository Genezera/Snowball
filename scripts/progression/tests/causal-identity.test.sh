#!/usr/bin/env bash
# v1.8 — ITEM 3. Testes de IDENTIDADE CAUSAL. Prova zero falso agrupamento, zero falsa
# separação, IDs iguais entre políticas p/ a mesma decisão, e IDs diferentes entre episódios.
# ISOLADO: FORWARD_TEST_MODE=1 + FORWARD_TEST_ROOT temp; nunca toca produção.
set -u
cd "$(dirname "$0")/../../.."
PROC="scripts/progression/forward-lab.cjs"
PASS=0; FAIL=0
ok(){ echo "  [OK]   $1"; PASS=$((PASS+1)); }
bad(){ echo "  [FALHA] $1"; FAIL=$((FAIL+1)); }
TMP=$(mktemp -d); TROOT="$TMP/root"; mkdir -p "$TROOT"; EP="$TMP/ep.json"
echo '{"forwardEpochId":"idep","byteOffset":0,"lineNumber":0,"timestamp":0}' > "$EP"
H=3600000  # 1h em ms
BASE_TS=1700000000000  # começo de "hora"
LN(){ echo "{\"ts\":$1,\"k\":\"$2\",\"apr\":3.0,\"spread\":0.0003,\"vol\":1000}"; }
# roda um obs e devolve o causal.jsonl num dir
run(){ local obs="$1" label="$2"; rm -f "$TROOT/$label/lock.json"; FORWARD_TEST_MODE=1 FORWARD_TEST_ROOT="$TROOT" FORWARD_EMIT_CAUSAL=1 FORWARD_OBS="$obs" FORWARD_EPOCH="$EP" node "$PROC" --mode control --label "$label" --once >/dev/null 2>&1; }
# extrai um campo do N-ésimo registro causal (1-indexed) de um label
cf(){ node -e 'const fs=require("fs");const ls=fs.readFileSync(process.argv[1],"utf8").split("\n").filter(Boolean).map(JSON.parse);const r=ls[+process.argv[2]-1]||{};console.log(r[process.argv[3]]||"")' "$TROOT/$1/causal.jsonl" "$2" "$3"; }

echo "==== CAUSAL IDENTITY (item 3) ===="
# 1) MESMO símbolo, MESMA hora, mas SEPARADOS por >30min ⇒ episódios distintos (zero falso agrupamento)
O="$TMP/s1.jsonl"; LN $BASE_TS "AAA|bitget|bybit" > "$O"; LN $((BASE_TS + 31*60000)) "AAA|bitget|bybit" >> "$O"
run "$O" s1
e1a=$(cf s1 1 sourceOpportunityEpisodeId); e1b=$(cf s1 2 sourceOpportunityEpisodeId)
[ -n "$e1a" ] && [ "$e1a" != "$e1b" ] && ok "1) mesmo símbolo/hora, gap>30min ⇒ episódios DIFERENTES (sem falso agrupamento)" || bad "1) episódios iguais ($e1a==$e1b)"

# 2) MESMA oportunidade ATRAVESSANDO mudança de hora (gap 2min) ⇒ MESMO episódio (sem falsa separação)
O="$TMP/s2.jsonl"; LN $((BASE_TS + 59*60000)) "BBB|okx|gate" > "$O"; LN $((BASE_TS + 61*60000)) "BBB|okx|gate" >> "$O"
run "$O" s2
e2a=$(cf s2 1 sourceOpportunityEpisodeId); e2b=$(cf s2 2 sourceOpportunityEpisodeId)
[ -n "$e2a" ] && [ "$e2a" = "$e2b" ] && ok "2) oportunidade cruza a hora (gap 2min) ⇒ MESMO episódio (sem falsa separação)" || bad "2) episódios diferentes ($e2a!=$e2b)"

# 3) DIREÇÕES OPOSTAS ⇒ decisões distintas
O="$TMP/s3.jsonl"; LN $BASE_TS "CCC|bitget|bybit" > "$O"; LN $((BASE_TS+1000)) "CCC|bybit|bitget" >> "$O"
run "$O" s3
d3a=$(cf s3 1 sourceDecisionId); d3b=$(cf s3 2 sourceDecisionId)
[ -n "$d3a" ] && [ "$d3a" != "$d3b" ] && ok "3) direções opostas ⇒ decisionId DIFERENTE" || bad "3) decisões iguais ($d3a==$d3b)"

# 4) MESMOS timestamps, chaves diferentes ⇒ decisões distintas
O="$TMP/s4.jsonl"; LN $BASE_TS "DDD|bitget|bybit" > "$O"; LN $BASE_TS "EEE|okx|gate" >> "$O"
run "$O" s4
d4a=$(cf s4 1 sourceDecisionId); d4b=$(cf s4 2 sourceDecisionId)
[ -n "$d4a" ] && [ "$d4a" != "$d4b" ] && ok "4) mesmos timestamps, chaves diferentes ⇒ decisionId DIFERENTE" || bad "4) $d4a==$d4b"

# 5) MESMA oportunidade vista por 5 POLÍTICAS ⇒ sourceDecisionId IGUAL entre elas
O="$TMP/s5.jsonl"; LN $BASE_TS "FFF|bitget|bybit" > "$O"
for lb in p_control p_trial p_max3 p_max4 p_max5; do run "$O" "$lb"; done
d5=$(cf p_control 1 sourceDecisionId); igual5=1
for lb in p_trial p_max3 p_max4 p_max5; do [ "$(cf $lb 1 sourceDecisionId)" = "$d5" ] || igual5=0; done
[ -n "$d5" ] && [ "$igual5" = "1" ] && ok "5) mesma oportunidade em 5 políticas ⇒ decisionId IGUAL entre políticas" || bad "5) decisionId divergiu entre políticas"

# 6) REABERTURA posterior do mesmo símbolo (gap>30min) ⇒ nova posição-fonte (sourcePositionId diferente)
O="$TMP/s6.jsonl"; LN $BASE_TS "GGG|bitget|bybit" > "$O"; LN $((BASE_TS + 45*60000)) "GGG|bitget|bybit" >> "$O"
run "$O" s6
p6a=$(cf s6 1 sourcePositionId); p6b=$(cf s6 2 sourcePositionId)
[ -n "$p6a" ] && [ "$p6a" != "$p6b" ] && ok "6) reabertura após gap ⇒ sourcePositionId NOVO" || bad "6) posição-fonte reusada ($p6a==$p6b)"

# 7) REAPARIÇÃO após fim do episódio: contíguo (gap 5min) mantém; após gap>30min renova
O="$TMP/s7.jsonl"; LN $BASE_TS "HHH|okx|gate" > "$O"; LN $((BASE_TS + 5*60000)) "HHH|okx|gate" >> "$O"; LN $((BASE_TS + 40*60000)) "HHH|okx|gate" >> "$O"
run "$O" s7
e7a=$(cf s7 1 sourceOpportunityEpisodeId); e7b=$(cf s7 2 sourceOpportunityEpisodeId); e7c=$(cf s7 3 sourceOpportunityEpisodeId)
{ [ "$e7a" = "$e7b" ] && [ "$e7a" != "$e7c" ]; } && ok "7) contíguo mantém episódio; reaparição após gap RENOVA ($e7a==$e7b, !=$e7c)" || bad "7) episódios inesperados ($e7a/$e7b/$e7c)"

rm -rf "$TMP"
echo "=================================="
echo "RESULTADO causal identity: $PASS passaram, $FAIL falharam"
[ "$FAIL" -eq 0 ] && exit 0 || exit 1
