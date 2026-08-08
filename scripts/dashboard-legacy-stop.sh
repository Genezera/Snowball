#!/usr/bin/env bash
# Para o dashboard LEGADO (:8787) iniciado via dashboard-legacy-start.sh.
# Mata SÓ o legado — o filtro exige 'dashboard' + 'server.ts' na linha de
# comando e EXCLUI 'dashboard-v2', então a API V2 (:5184) nunca é tocada.
set -u
cd "$(dirname "$0")/.."

timeout 8 powershell -NoProfile -Command "Get-CimInstance Win32_Process -Filter \"Name='node.exe'\" | Where-Object { \$_.CommandLine -like '*dashboard*server.ts*' -and \$_.CommandLine -notlike '*dashboard-v2*' } | ForEach-Object { Stop-Process -Id \$_.ProcessId -Force -ErrorAction SilentlyContinue }" >/dev/null 2>&1

echo "Dashboard legado (:8787) parado (se estava rodando). A porta 8787 volta a ficar desligada por design."
