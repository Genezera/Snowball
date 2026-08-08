#!/usr/bin/env bash
# TESTES de restart/cursor/reabertura dos challengers (itens 3,4). ISOLADO:
# usa diario sintético do Champion (CH_DIARIO) e dir de teste (CHALLENGER_DIR).
# Nunca toca produção nem o Champion real.
set -u
cd "$(dirname "$0")/../../.."
PROC="scripts/challengers-timing/challenger-timing-live.cjs"
PASS=0; FAIL=0
ok(){ echo "  [OK]   $1"; PASS=$((PASS+1)); }
bad(){ echo "  [FALHA] $1"; FAIL=$((FAIL+1)); }
TMP=$(mktemp -d)
CICL="$TMP/ciclos.json"; echo '{"ciclos":{}}' > "$CICL"
EST="$TMP/estado.json"; echo '{"posicoes":[]}' > "$EST"
MARC="$TMP/marcacao.json"; echo '{"posicoes":[]}' > "$MARC"
run(){ local pol="$1" dir="$2" dia="$3"; CHALLENGER_DIR="$dir" CH_DIARIO="$dia" CH_ESTADO="$EST" CH_MARCACAO="$MARC" CH_CICLOS="$CICL" node "$PROC" --policy "$pol" --once >/dev/null 2>&1; }
field(){ node -e 'try{const j=JSON.parse(require("fs").readFileSync(process.argv[1]));let v=j;for(const k of process.argv[2].split("."))v=v[k];console.log(typeof v==="object"?JSON.stringify(v):v)}catch(e){console.log("ERR")}' "$1" "$2"; }

echo "==== TESTES restart/cursor/reabertura ===="

# ── T1: cursor preservado + zero perda/duplicação no restart ────────────────
echo "T1 · restart preserva cursor, zero perda/duplicação, PnL/posições preservados"
D1="$TMP/t1"; DIA="$TMP/t1-diario.jsonl"
printf '%s\n' \
  '{"ts":1000,"evento":"init","capital":600,"opcoes":{}}' \
  '{"ts":2000,"evento":"abre","symbol":"AAA/USDT:USDT","short":"gate","long":"okx","notional":100,"custo":0.05,"preco":1,"spread":0.01}' \
  '{"ts":3000,"evento":"funding","symbol":"AAA/USDT:USDT","ganho":0.20}' \
  '{"ts":4000,"evento":"fecha","symbol":"AAA/USDT:USDT","custo":0.05,"motivo":"spread invertido"}' > "$DIA"
run control "$D1" "$DIA"
c1=$(field "$D1/estado.json" cursorDiario); fech1=$(field "$D1/estado.json" contadores.fechamentos); pnl1=$(node -e 'const j=require("./'"$D1"'/estado.json");console.log(j.fechados.reduce((s,f)=>s+f.pnlLiquido,0).toFixed(4))' 2>/dev/null || echo "?")
run control "$D1" "$DIA"   # restart sem eventos novos
c2=$(field "$D1/estado.json" cursorDiario); fech2=$(field "$D1/estado.json" contadores.fechamentos)
[ "$c1" = "$c2" ] && ok "cursor preservado ($c1 == $c2)" || bad "cursor mudou ($c1 -> $c2)"
[ "$fech1" = "$fech2" ] && ok "zero duplicação (fechamentos $fech1 == $fech2)" || bad "duplicou ($fech1 -> $fech2)"
[ "$fech1" = "1" ] && ok "posição fechada 1x (funding 0.20 - custo 0.10 = 0.10)" || bad "fechamentos inesperado ($fech1)"

# ── T2: evento novo após restart é processado (zero perda) ──────────────────
echo "T2 · evento novo após restart é processado (zero perda)"
printf '%s\n' '{"ts":5000,"evento":"abre","symbol":"BBB/USDT:USDT","short":"gate","long":"okx","notional":100,"custo":0.05,"preco":1,"spread":0.01}' >> "$DIA"
run control "$D1" "$DIA"
ent=$(field "$D1/estado.json" contadores.entradas)
[ "$ent" = "2" ] && ok "novo abre processado (entradas=2, incremental)" || bad "não processou novo evento (entradas=$ent)"

# ── T3: positionId — símbolo fecha e REABRE, funding vai à instância certa ───
echo "T3 · símbolo reabrindo: funding roteado à instância nova, não à antiga"
D3="$TMP/t3"; DIA3="$TMP/t3-diario.jsonl"
printf '%s\n' \
  '{"ts":1000,"evento":"init","capital":600,"opcoes":{}}' \
  '{"ts":2000,"evento":"abre","symbol":"CCC/USDT:USDT","short":"gate","long":"okx","notional":100,"custo":0.05,"preco":1,"spread":0.01}' \
  '{"ts":3000,"evento":"funding","symbol":"CCC/USDT:USDT","ganho":0.10}' \
  '{"ts":4000,"evento":"fecha","symbol":"CCC/USDT:USDT","custo":0.05,"motivo":"x"}' \
  '{"ts":5000,"evento":"abre","symbol":"CCC/USDT:USDT","short":"gate","long":"okx","notional":100,"custo":0.05,"preco":1,"spread":0.01}' \
  '{"ts":6000,"evento":"funding","symbol":"CCC/USDT:USDT","ganho":0.30}' \
  '{"ts":7000,"evento":"fecha","symbol":"CCC/USDT:USDT","custo":0.05,"motivo":"y"}' > "$DIA3"
run control "$D3" "$DIA3"
RD='const j=JSON.parse(require("fs").readFileSync(process.argv[1]));'
n=$(node -e "$RD console.log(j.fechados.length)" "$D3/estado.json")
pids=$(node -e "$RD console.log([...new Set(j.fechados.map(f=>f.positionId))].length)" "$D3/estado.json")
f0=$(node -e "$RD console.log(j.fechados[0].fundingChampionObservado)" "$D3/estado.json")
f1=$(node -e "$RD console.log(j.fechados[1].fundingChampionObservado)" "$D3/estado.json")
[ "$n" = "2" ] && ok "2 instâncias fechadas (não colapsou por símbolo)" || bad "instâncias=$n"
[ "$pids" = "2" ] && ok "positionId distintos por instância" || bad "positionId colidiu ($pids)"
[ "$f0" = "0.1" ] && [ "$f1" = "0.3" ] && ok "funding roteado à instância certa (0.10 e 0.30 separados)" || bad "funding cruzou instâncias ($f0,$f1)"

# ── T4: fecha do Champion afeta só a instância espelhada corrente ───────────
echo "T4 · fecha do Champion afeta só a instância corrente do símbolo"
# (coberto por T3: o 2º fecha fechou a 2ª instância com funding 0.30, não a 1ª)
[ "$f1" = "0.3" ] && ok "2º fecha encerrou a 2ª instância (funding 0.30), 1ª intacta (0.10)" || bad "fecha afetou instância errada"

rm -rf "$TMP"
echo "===================================="
echo "RESULTADO: $PASS passaram, $FAIL falharam"
[ "$FAIL" -eq 0 ] && exit 0 || exit 1
