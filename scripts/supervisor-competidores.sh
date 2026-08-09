#!/usr/bin/env bash
# Watchdog dos 2 competidores 2-exchange (bybit+bitget, gate+okx). Religa qualquer um
# que tenha caído — detecção por HEARTBEAT (ultimoCiclo do forward-lab), não por command-line
# (os dois rodam o mesmo forward-lab.cjs; só o --label os distingue). Windowless via nohup.
# Single-instance por lock. NÃO toca no Champion nem no supervisor.sh principal.
set -u
cd "$(dirname "$0")/.."
export FORWARD_ROOT="auditoria/progression/compete"
BASE="auditoria/progression/compete"
LOCK="$BASE/supervisor-competidores.lock"
LOG="$BASE/supervisor-competidores.log"
STALE_MS=660000   # > 11min sem heartbeat = caiu (ciclo é 5min)
mkdir -p "$BASE"

declare -A CMD=(
  [compete-bybit-bitget]="node scripts/progression/forward-lab.cjs --mode control --exchanges bybit,bitget --label compete-bybit-bitget --close-policy economic_inversion --persist-min 30 --cost-model maker --intervalo 300"
  [compete-gate-okx]="node scripts/progression/forward-lab.cjs --mode control --exchanges gate,okx --label compete-gate-okx --close-policy economic_inversion --persist-min 30 --cost-model maker --intervalo 300"
  # TURBO: mesmo par do baseline (bybit+bitget) para ISOLAR o lever de utilização de capital —
  # limite 3→5 posições + reserva 30%→20%. Deploy do capital ocioso (~40%) → mais funding/dia.
  [compete-turbo-bb]="node scripts/progression/forward-lab.cjs --mode control --exchanges bybit,bitget --label compete-turbo-bb --close-policy economic_inversion --persist-min 30 --cost-model maker --maxpos 5 --reserva 0.20 --intervalo 300"
)

campo() { node -e "try{console.log(JSON.parse(require('fs').readFileSync(process.argv[1]))[process.argv[2]]||0)}catch(e){console.log(0)}" "$1" "$2" 2>/dev/null; }

# single-instance
now_ms=$(date +%s%3N)
if [ -f "$LOCK" ]; then
  last=$(campo "$LOCK" hb)
  if [ -n "$last" ] && [ "$last" -gt 0 ] 2>/dev/null && [ $(( now_ms - last )) -lt 90000 ]; then
    echo "[$(date '+%H:%M:%S')] outro supervisor-competidores vivo — saindo" >> "$LOG"; exit 0
  fi
fi
echo "{\"pid\":$$,\"hb\":$now_ms}" > "$LOCK"
trap 'rm -f "$LOCK"; exit 0' INT TERM
echo "[$(date '+%H:%M:%S')] supervisor-competidores iniciado (2 competidores, cada 60s)" >> "$LOG"

while true; do
  echo "{\"pid\":$$,\"hb\":$(date +%s%3N)}" > "$LOCK"
  for nome in "${!CMD[@]}"; do
    hbf="$BASE/$nome/heartbeat.json"
    fresco=0
    if [ -f "$hbf" ]; then
      u=$(campo "$hbf" ultimoCiclo)
      [ -n "$u" ] && [ "$u" -gt 0 ] 2>/dev/null && [ $(( $(date +%s%3N) - u )) -lt "$STALE_MS" ] && fresco=1
    fi
    if [ "$fresco" != 1 ]; then
      echo "[$(date '+%H:%M:%S')] $nome sem heartbeat fresco — religando (windowless)" >> "$LOG"
      nohup ${CMD[$nome]} >> "$BASE/$nome.live.log" 2>&1 &
      disown
    fi
  done
  sleep 60
done
