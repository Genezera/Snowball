# BLINDAGEM — inicia (só se não estiver vivo) tudo que precisa rodar, WINDOWLESS.
# Registrado no Task Scheduler para rodar no logon do Windows (sobrevivência a reboot).
# Idempotente: se algo já está vivo, não duplica. Os supervisores cuidam do restart-on-crash;
# este launcher cuida do start-on-boot. NÃO emite ordens; só inicia processos.
$cwd  = 'C:\Users\Renan\Projetos\Snowball'
$bash = 'C:\Program Files\Git\bin\bash.exe'
$node = 'C:\Program Files\nodejs\node.exe'
Set-Location $cwd
function Vivo($pat) { @(Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like "*$pat*" }).Count -gt 0 }

# 1. Supervisor principal (Champion spread-live + vigilancia + custodia + coletor + momentum + preenchimento + pares)
if (-not (Vivo 'scripts/supervisor.sh')) {
  Start-Process $bash -ArgumentList 'scripts/supervisor.sh' -WorkingDirectory $cwd -WindowStyle Hidden
}
# 2. Supervisor dos 2 competidores 2-exchange
if (-not (Vivo 'supervisor-competidores.sh')) {
  Start-Process $bash -ArgumentList 'scripts/supervisor-competidores.sh' -WorkingDirectory $cwd -WindowStyle Hidden
}
# 3. API do dashboard (:5184)
if (-not (Vivo 'dashboard-v2/api/server.ts')) {
  Start-Process $node -ArgumentList '--experimental-strip-types','dashboard-v2/api/server.ts' -WorkingDirectory $cwd -WindowStyle Hidden `
    -RedirectStandardOutput "$cwd\dashboard-v2\api\logs\api.out.log" -RedirectStandardError "$cwd\dashboard-v2\api\logs\api.err.log"
}
# 4. Frontend do dashboard (vite :5183)
if (-not (Vivo 'vite')) {
  Start-Process $bash -ArgumentList '-lc','npm --prefix dashboard-v2 run dev' -WorkingDirectory $cwd -WindowStyle Hidden
}
# 5. Coletor spot-perp (produtor de dados do radar spot-perp; a cada 10min)
if (-not (Vivo 'coletor-spotperp.cjs')) {
  Start-Process $node -ArgumentList 'scripts/progression/coletor-spotperp.cjs','--intervalo','600' -WorkingDirectory $cwd -WindowStyle Hidden `
    -RedirectStandardOutput "$cwd\vigilancia\spotperp.out.log" -RedirectStandardError "$cwd\vigilancia\spotperp.err.log"
}
