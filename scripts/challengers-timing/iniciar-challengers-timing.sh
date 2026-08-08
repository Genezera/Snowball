#!/usr/bin/env bash
# Sobe os 4 challengers live-paper de timing de fechamento, cada um ISOLADO
# (capital/estado/diário/heartbeat/lock/telemetria próprios), READ-ONLY sobre o
# Champion. Cada processo tem lock próprio (não duplica). NENHUMA ORDEM.
set -u
cd "$(dirname "$0")/../.."
INTERVALO="${1:-300}"
for pol in control closeConfirm nextSettlement evExit; do
  nohup node scripts/challengers-timing/challenger-timing-live.cjs --policy "$pol" --intervalo "$INTERVALO" >> "challengers-timing/$pol/live.log" 2>&1 &
  disown
  echo "challenger $pol iniciado (intervalo ${INTERVALO}s) — PID $!"
done
echo "4 challengers no ar. Estado em challengers-timing/<policy>/. Read-only sobre o Champion."
