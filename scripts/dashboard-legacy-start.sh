#!/usr/bin/env bash
# ROLLBACK DE EMERGÊNCIA — sobe o dashboard LEGADO (src/dashboard/server.ts,
# porta 8787) MANUALMENTE. NÃO faz parte da operação normal: o legado foi
# arquivado na unificação (o dashboard canônico é o V2, :5183/:5184).
#
# Este script NUNCA é chamado por supervisor, iniciar.ps1/cmd, reboot ou
# restart automático — só à mão, em emergência. O legado não volta sozinho.
set -u
cd "$(dirname "$0")/.."
PORTA=8787
LOG="spread/dashboard-legacy.log"

source scripts/lib/process-manifest.sh
# match PRECISO pelo entrypoint (nunca confunde com dashboard-v2/api/server.ts)
n=$(processo_vivo_por_entrypoint "src/dashboard/server.ts" 2>/dev/null)
if [ "${n:-0}" -ge 1 ] 2>/dev/null; then
  echo "Legado já está rodando ($n processo). Nada a fazer. http://localhost:$PORTA"
  exit 0
fi

echo "Subindo o dashboard LEGADO (emergência) em http://localhost:$PORTA ..."
nohup node src/dashboard/server.ts >> "$LOG" 2>&1 &
disown
echo "Iniciado (PID $!). Log: $LOG"
echo
echo "LEMBRETE: isto é TEMPORÁRIO. Pare com scripts/dashboard-legacy-stop.sh ao terminar."
echo "O legado NÃO volta sozinho após reboot/restart dos supervisores — rode este script de novo se precisar."
