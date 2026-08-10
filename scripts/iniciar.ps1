# Sobe o SNOWBALL DASHBOARD (canônico: frontend V2 em :5183 + API V2 em :5184)
# e o watchdog dos 7 processos de trading (motor + vigilância + custódia +
# coletor + momentum + preenchimento + pares), cada um lendo o próprio estado
# salvo em disco — não há "resetar" ao reiniciar, cada motor retoma de onde
# parou.
#
# O dashboard LEGADO (src/dashboard/server.ts, porta 8787) foi ARQUIVADO na
# unificação e NÃO é mais iniciado automaticamente. Para subir o legado em
# emergência: `bash scripts/dashboard-legacy-start.sh`
# (ver docs/dashboard-legacy-rollback.md). Ele nunca sobe sozinho após reboot
# nem após restart dos supervisores.
#
# NENHUMA ORDEM É ENVIADA EM NENHUM MODO. As exchanges são apenas lidas.

$ErrorActionPreference = 'Stop'
$raiz = Split-Path -Parent $PSScriptRoot
Set-Location $raiz

# CUIDADO: o Windows tem um `bash.exe` em C:\WINDOWS\system32 — o shim do WSL,
# não o Git Bash. `Get-Command bash` costuma achar ESSE primeiro; supervisor.sh
# não roda no ambiente do WSL do mesmo jeito (caminho relativo, working
# directory). Por isso o caminho conhecido do Git Bash vem PRIMEIRO, e só cai
# pro PATH se ele especificamente não existir e não for o do System32.
$candidatosGitBash = @(
  "C:\Program Files\Git\bin\bash.exe",
  "C:\Program Files (x86)\Git\bin\bash.exe"
)
$bashExe = $candidatosGitBash | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $bashExe) {
  $doPath = (Get-Command bash -ErrorAction SilentlyContinue).Source
  if ($doPath -and $doPath -notlike '*system32*') { $bashExe = $doPath }
}
if (-not $bashExe) {
  Write-Host "Nao encontrei o bash do Git for Windows (nem no local padrao, nem no PATH"
  Write-Host "util). Instale o Git for Windows (https://git-scm.com/download/win) ou rode"
  Write-Host "manualmente: bash scripts/supervisor.sh"
  exit 1
}

# `Start-Process` sozinho NAO desanexa de verdade quando quem chama e um
# terminal (Windows Terminal, VS Code): o filho entra no MESMO job object da
# janela, com a flag "matar tudo ao fechar". Criar via WMI (Win32_Process.Create)
# faz o WmiPrvSE.exe chamar CreateProcess — o filho nunca entra no job object
# do terminal e sobrevive a janela ser fechada. Validado ao vivo.
function Start-Supervisor([string]$scriptName) {
  $cmd = "`"$bashExe`" `"$raiz\scripts\$scriptName`""
  $r = Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{ CommandLine = $cmd; CurrentDirectory = $raiz }
  return $r.ReturnValue
}

# Watchdog de TRADING: nunca subir uma segunda instancia (dois processos
# escrevendo estado.json ao mesmo tempo). Os supervisores da V2/Lab tem lock
# proprio e se auto-protegem contra duplicata, entao podem ser sempre tentados.
$tradingRodando = @(Get-CimInstance Win32_Process -Filter "Name='bash.exe'" |
  Where-Object { $_.CommandLine -like '*supervisor.sh*' }).Count
if ($tradingRodando -gt 0) {
  Write-Host "Watchdog de trading ja rodando ($tradingRodando) -- nao subi outra instancia."
} else {
  if ((Start-Supervisor 'supervisor.sh') -ne 0) { Write-Host "Falha ao criar supervisor.sh via WMI."; exit 1 }
  Write-Host "Watchdog de trading iniciado (coletor -- motor/vigilancia/custodia/Profit Lab foram arquivados, ver arquivo-6-exchanges/; momentum/preenchimento/pares ja tinham sido removidos antes)."
}

# ATENCAO: este launcher (iniciar.ps1/iniciar.cmd) e o ANTIGO -- nunca iniciou
# o motor real (supervisor-competidores.sh) nem o coletor-spotperp. Use
# scripts/blindagem.ps1 pra subir o sistema atual completo. Mantido aqui so
# pelo dashboard canonico, que continua valendo.
Start-Supervisor 'supervisor-dashboard-v2-api'      | Out-Null
Start-Supervisor 'supervisor-dashboard-v2-frontend' | Out-Null
Write-Host "Supervisores do Snowball Dashboard (API :5184, frontend :5183) iniciados. Profit Lab arquivado -- nao inicia mais aqui."
Write-Host ""
Write-Host "Aguardando o Snowball Dashboard responder..."

function Wait-Http([string]$url, [int]$tentativas) {
  for ($i = 0; $i -lt $tentativas; $i++) {
    Start-Sleep -Seconds 2
    try { if ((Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 2).StatusCode -eq 200) { return $true } } catch { }
  }
  return $false
}

$apiOk = Wait-Http 'http://localhost:5184/api/v2/champion' 45
$frontOk = Wait-Http 'http://localhost:5183/' 15

Write-Host ""
if ($apiOk -and $frontOk) {
  Write-Host "Tudo no ar. Snowball Dashboard: http://localhost:5183"
} else {
  Write-Host "Ainda subindo. API :5184 ok=$apiOk - frontend :5183 ok=$frontOk."
  Write-Host "Se demorar, confira dashboard-v2\api\logs\supervisor-watchdog.log e"
  Write-Host "vigilancia\supervisor-watchdog.log."
}
Write-Host ""
Write-Host "Dashboard LEGADO (:8787) NAO e iniciado (arquivado por design)."
Write-Host "Emergencia: bash scripts/dashboard-legacy-start.sh  (docs/dashboard-legacy-rollback.md)"
